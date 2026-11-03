import crypto from "node:crypto";
import { IncidentWatcherDaemon, readMarkers } from "@pims/agent";
import { createCockpitApp } from "@pims/cockpit/app.ts";
import { SessionRegistry } from "@pims/cockpit/auth.ts";
import { type AgentEvent, WatcherStateSchema } from "@pims/types/agent.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import type { CockpitSession } from "@pims/types/cockpit.ts";
import { BUNDLE_ATTACHMENT_NAME } from "@pims/types/constants.ts";
import {
  type IntegrationHarness,
  intakeFixture,
  startIntegrationHarness,
} from "@tests/helpers/integration-harness.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Autonomous watcher daemon lifecycle", { timeout: 240_000 }, () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ autoNotify: false });
  });

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    }
  });

  it("walks O→P→draft→human approval→notified→C with one bundle", async () => {
    const { adapter, agent, config, store, events, ragService, now } = harness;

    const recipients = await adapter.listRecipients();
    if (!recipients.results.some((row) => row.email === "dpo@example.test")) {
      await harness.callTool("orchestrator", "pims_manage_recipient", {
        op: "create",
        email: "dpo@example.test",
        label: "DPO",
        operator_jwt_sub: "test-op",
      });
    }

    const intake = await agent.orchestrator.intake(intakeFixture());
    const incidentId = intake.incident.id;
    const code = intake.incident.incident_code;

    const log: AgentEvent[] = [];
    events.subscribe((event) => {
      log.push(event);
    });

    const watcher = new IncidentWatcherDaemon({
      adapter,
      orchestrator: agent.orchestrator,
      evidenceStore: store,
      events,
      config,
      clock: () => now,
    });

    await watcher.pollOnce();

    const afterDraft = await adapter.getIncident(incidentId);
    expect(afterDraft.status).toBe("P");

    const rawState = await store.getAgentState(`WATCHER:${code}`);
    const state = WatcherStateSchema.parse(rawState);
    expect(state.stage).toBe("awaiting_approval");

    const statusChanges = log.filter(
      (event) => event.type === "lifecycle:status_change",
    );
    expect(
      statusChanges.some(
        (event) =>
          event.type === "lifecycle:status_change" &&
          event.from === "O" &&
          event.to === "P",
      ),
    ).toBe(true);

    const roleTransitions = log.filter(
      (event) => event.type === "role:transition",
    );
    expect(roleTransitions.length).toBeGreaterThan(0);

    const retrievalEvents = log.filter(
      (event) => event.type === "rag:retrieval",
    );
    expect(retrievalEvents.length).toBeGreaterThan(0);
    const passages = retrievalEvents.flatMap((event) =>
      event.type === "rag:retrieval" ? event.passages : [],
    );
    const complete = passages.find(
      (passage) =>
        passage.chunk_sha256.length === 64 &&
        passage.dense_score !== null &&
        passage.bm25_rank !== null &&
        passage.rrf_score > 0,
    );
    expect(complete).toBeDefined();
    expect(complete?.text.length).toBeGreaterThan(0);

    const approvalRequests = log.filter(
      (event) => event.type === "review:approval_requested",
    );
    expect(approvalRequests.length).toBeGreaterThan(0);

    const sessions = new SessionRegistry(() => now);
    const session: CockpitSession = {
      access_token: "watcher-test-token",
      expires_at_utc: new Date("2030-01-01T00:00:00.000Z").toISOString(),
      user_id: 1,
      username: "operator",
      schema: config.PIMS_SCHEMA,
      native_role: "Operador",
      permissions: ["view_incident", "change_incident", "view_securitylog"],
      default_persona: "executive",
      can_switch_persona: true,
    };
    sessions.add(session);

    const app = createCockpitApp({
      config,
      adapter,
      store,
      agent,
      ragService,
      events,
      sessions,
      clock: () => now,
    });

    const approveResponse = await app.request(
      `/api/incidents/${incidentId}/approve`,
      {
        method: "POST",
        headers: { Authorization: "Bearer watcher-test-token" },
      },
    );
    expect(approveResponse.status).toBe(200);
    const approveBody = (await approveResponse.json()) as {
      parked: boolean;
      notifies: unknown[];
    };
    expect(approveBody.parked).toBe(false);
    expect(approveBody.notifies.length).toBeGreaterThan(0);

    await watcher.pollOnce();

    const closed = await adapter.getIncident(incidentId);
    expect(closed.status).toBe("C");
    expect(closed.resolved_date).not.toBeNull();
    expect(closed.measure_considered_resolved).toBe("Y");
    expect(closed.measure_reported_authorities).toBe("Y");

    const actions = closed.actions ?? [];
    expect(actions.some((action) => action.action_type === "C")).toBe(true);
    expect(actions.some((action) => action.action_type === "A")).toBe(true);
    expect(actions.some((action) => action.action_type === "R")).toBe(true);

    const attachments = await adapter.getIncidentAttachments(incidentId);
    const bundleAttachments = attachments.filter(
      (attachment) =>
        attachment.file_name === BUNDLE_ATTACHMENT_NAME ||
        attachment.original_name === BUNDLE_ATTACHMENT_NAME,
    );
    expect(bundleAttachments).toHaveLength(1);

    const sealed = await store.getBundleManifest(code);
    if (sealed === null || sealed.seal_sha256 === null) {
      throw new Error("sealed manifest missing");
    }
    const expectedBytes = Buffer.from(canonicalizeJson(sealed), "utf8");
    const firstBundle = bundleAttachments[0];
    if (firstBundle === undefined) {
      throw new Error("bundle attachment missing");
    }
    const downloaded = await adapter.downloadAttachment(firstBundle.file);
    expect(crypto.createHash("sha256").update(downloaded).digest("hex")).toBe(
      crypto.createHash("sha256").update(expectedBytes).digest("hex"),
    );

    const markers = readMarkers(closed.evidence_refs);
    expect(
      markers.some((marker) => /^BUNDLE_SEALED:[0-9a-f]{64}$/.test(marker)),
    ).toBe(true);

    await agent.orchestrator.close(incidentId);
    const afterRerun = await adapter.getIncidentAttachments(incidentId);
    expect(
      afterRerun.filter(
        (attachment) =>
          attachment.file_name === BUNDLE_ATTACHMENT_NAME ||
          attachment.original_name === BUNDLE_ATTACHMENT_NAME,
      ),
    ).toHaveLength(1);
  });
});
