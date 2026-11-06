import crypto from "node:crypto";
import { IncidentWatcherDaemon, readMarkers } from "@pims/agent";
import { createCockpitApp } from "@pims/cockpit/app.ts";
import { SessionRegistry } from "@pims/cockpit/auth.ts";
import { type AgentEvent, WatcherStateSchema } from "@pims/types/agent.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import type { CockpitSession } from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  type IntegrationHarness,
  intakeFixture,
  startIntegrationHarness,
} from "@tests/helpers/integration-harness.ts";
import { TEST_DPO_EMAIL } from "@tests/helpers/test-constants.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("Autonomous watcher daemon lifecycle", { timeout: 240_000 }, () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ autoNotify: false });
  });

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    } else {
      expect(harness).toBeUndefined();
    }
  });

  it("walks O→P→draft→human approval→notified→C with one bundle", async () => {
    const { adapter, agent, config, store, events, ragService, now } = harness;

    const recipients = await adapter.listRecipients();
    const hasDpo = recipients.results.some(
      (row) => row.email === TEST_DPO_EMAIL,
    );
    if (!hasDpo) {
      await harness.callTool("orchestrator", "pims_manage_recipient", {
        op: "create",
        email: TEST_DPO_EMAIL,
        label: "DPO",
        operator_jwt_sub: "test-op",
      });
    } else {
      expect(hasDpo).toBe(true);
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

    expect(closed.actions).toBeDefined();
    if (!closed.actions) {
      expect.fail("closed.actions is missing");
    }
    const actions = closed.actions;
    expect(actions.some((action) => action.action_type === "C")).toBe(true);
    expect(actions.some((action) => action.action_type === "A")).toBe(true);
    expect(actions.some((action) => action.action_type === "R")).toBe(true);

    const attachments = await adapter.getIncidentAttachments(incidentId);
    const bundleAttachments = attachments.filter(
      (attachment) =>
        attachment.file_name === CONSTANTS.BUNDLE_ATTACHMENT_NAME ||
        attachment.original_name === CONSTANTS.BUNDLE_ATTACHMENT_NAME,
    );
    expect(bundleAttachments).toHaveLength(1);

    const sealed = await store.getBundleManifest(code);
    if (sealed === null || sealed.seal_sha256 === null) {
      expect.fail("sealed manifest missing");
    } else {
      const expectedBytes = Buffer.from(canonicalizeJson(sealed), "utf8");
      const firstBundle = bundleAttachments[0];
      if (firstBundle === undefined) {
        expect.fail("bundle attachment missing");
      } else {
        const downloaded = await adapter.downloadAttachment(firstBundle.file);
        expect(
          crypto.createHash("sha256").update(downloaded).digest("hex"),
        ).toBe(crypto.createHash("sha256").update(expectedBytes).digest("hex"));
      }
    }

    const markers = readMarkers(closed.evidence_refs);
    expect(
      markers.some((marker) => /^BUNDLE_SEALED:[0-9a-f]{64}$/.test(marker)),
    ).toBe(true);

    await agent.orchestrator.close(incidentId);
    const afterRerun = await adapter.getIncidentAttachments(incidentId);
    expect(
      afterRerun.filter(
        (attachment) =>
          attachment.file_name === CONSTANTS.BUNDLE_ATTACHMENT_NAME ||
          attachment.original_name === CONSTANTS.BUNDLE_ATTACHMENT_NAME,
      ),
    ).toHaveLength(1);
  });

  it("gates proposal regeneration on incident evidence/status change and manual regenerate", async () => {
    const { adapter, agent, config, store, events, ragService, now } = harness;

    const intake = await agent.orchestrator.intake(
      intakeFixture({
        title: "Proposal regeneration gating fixture",
        description:
          "Independent breach fixture for proposal regeneration test.",
      }),
    );
    const incidentId = intake.incident.id;
    const code = intake.incident.incident_code;

    const watcher = new IncidentWatcherDaemon({
      adapter,
      orchestrator: agent.orchestrator,
      evidenceStore: store,
      events,
      config,
      clock: () => now,
    });

    // 1. Initial poll advances to awaiting_approval
    await watcher.pollOnce();
    const rawState = await store.getAgentState(`WATCHER:${code}`);
    const state = WatcherStateSchema.parse(rawState);
    expect(state.stage).toBe("awaiting_approval");

    const draftSpy = vi.spyOn(agent.orchestrator, "draftAndReview");
    const initialAuthPack = await store.getDraftPack(code, "authority");
    expect(initialAuthPack).not.toBeNull();

    // 2. Poll 3x with unchanged PIMS data -> 0 draftAndReview calls
    await watcher.pollOnce();
    await watcher.pollOnce();
    await watcher.pollOnce();
    expect(draftSpy).toHaveBeenCalledTimes(0);

    const packAfter3Polls = await store.getDraftPack(code, "authority");
    expect(packAfter3Polls?.id).toBe(initialAuthPack?.id);

    // 3. Edit evidence_refs on the incident -> 1x pollOnce() -> exactly one new draftAndReview
    await adapter.updateIncident(incidentId, {
      evidence_refs: "new-forensic-evidence-token-1234",
    });
    await watcher.pollOnce();
    expect(draftSpy).toHaveBeenCalledTimes(1);

    draftSpy.mockClear();

    // 4. Another poll without changes -> 0 calls
    await watcher.pollOnce();
    expect(draftSpy).toHaveBeenCalledTimes(0);

    // 5. Explicit POST /api/incidents/:id/regenerate -> next poll regenerates once
    const sessions = new SessionRegistry(() => now);
    const session: CockpitSession = {
      access_token: "regen-test-token",
      expires_at_utc: new Date("2030-01-01T00:00:00.000Z").toISOString(),
      user_id: 1,
      username: "operator",
      schema: config.PIMS_SCHEMA,
      native_role: "Operador",
      permissions: ["view_incident", "change_incident"],
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

    const regenRes = await app.request(
      `/api/incidents/${incidentId}/regenerate`,
      {
        method: "POST",
        headers: { Authorization: "Bearer regen-test-token" },
      },
    );
    expect(regenRes.status).toBe(200);

    await watcher.pollOnce();
    expect(draftSpy).toHaveBeenCalledTimes(1);

    draftSpy.mockClear();
    await watcher.pollOnce();
    expect(draftSpy).toHaveBeenCalledTimes(0);
  });
});
