import { createCockpitApp } from "@pims/cockpit/app.ts";
import { SessionRegistry } from "@pims/cockpit/auth.ts";
import type { CockpitSession } from "@pims/types/cockpit.ts";
import { PIMS_TEST_SEED_PASSWORD } from "@pims/types/constants.ts";
import type { ChatJsonArgs, JsonObject } from "@pims/types/models.ts";
import {
  type IntegrationHarness,
  intakeFixture,
  startIntegrationHarness,
} from "@tests/helpers/integration-harness.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type HonoApp = ReturnType<typeof createCockpitApp>;

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  text: string,
  matcher: (value: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  let accumulated = text;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      return accumulated;
    }
    accumulated += decoder.decode(value, { stream: true });
    if (matcher(accumulated)) {
      return accumulated;
    }
  }
  throw new Error(`SSE read timed out; received: ${accumulated.slice(-500)}`);
}

describe("Cockpit backend", { timeout: 240_000 }, () => {
  let harness: IntegrationHarness;
  let app: HonoApp;
  let sessions: SessionRegistry;
  let chatMode: "valid" | "fabricated" | "pii" = "valid";
  let authorityCitation = "";

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      autoNotify: false,
      chatHandler: (args: ChatJsonArgs) => {
        const isCockpitPersona =
          args.system.includes("compliance auditor assistant") ||
          args.system.includes("executive incident-response assistant") ||
          args.system.includes("Data Protection Officer assistant");
        if (!isCockpitPersona) {
          return null;
        }
        const context = JSON.parse(
          args.messages[0]?.content ?? "{}",
        ) as JsonObject;
        const citations = Array.isArray(context.citations)
          ? context.citations
          : [];
        const first = citations[0];
        const firstCitation =
          typeof first === "object" &&
          first !== null &&
          !Array.isArray(first) &&
          typeof (first as JsonObject).citation_id === "string"
            ? String((first as JsonObject).citation_id)
            : null;

        if (chatMode === "fabricated") {
          return {
            reply: "Fabricated citation test.",
            citations_used: ["gdpr-full:invented:1-2"],
            suggested_actions: [],
          };
        }
        if (chatMode === "pii") {
          return {
            reply: "Contact the applicant at leak@example.com immediately.",
            citations_used: [],
            suggested_actions: [],
          };
        }
        if (firstCitation === null) {
          return {
            reply:
              "No normative citation is available in the supplied context.",
            citations_used: [],
            suggested_actions: [],
          };
        }
        return {
          reply: `El incidente está contenido. ${firstCitation}`,
          citations_used: [firstCitation],
          suggested_actions: ["Revisar el paquete de evidencias."],
        };
      },
    });
    authorityCitation = harness.authorityCitation;

    const recipients = await harness.adapter.listRecipients();
    if (!recipients.results.some((row) => row.email === "dpo@example.test")) {
      await harness.callTool("orchestrator", "pims_manage_recipient", {
        op: "create",
        email: "dpo@example.test",
        label: "DPO",
        operator_jwt_sub: "test-op",
      });
    }

    sessions = new SessionRegistry();
    app = createCockpitApp({
      config: harness.config,
      adapter: harness.adapter,
      store: harness.store,
      agent: harness.agent,
      ragService: harness.ragService,
      events: harness.events,
      sessions,
      clock: () => harness.now,
    });
  });

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    }
  });

  async function login(): Promise<CockpitSession> {
    const response = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: PIMS_TEST_SEED_PASSWORD,
      }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as CockpitSession;
  }

  async function freshIncident(title: string): Promise<{
    id: number;
    code: string;
  }> {
    const intake = await harness.agent.orchestrator.intake(
      intakeFixture({ title }),
    );
    return {
      id: intake.incident.id,
      code: intake.incident.incident_code,
    };
  }

  it("authenticates against live PIMS permissions", async () => {
    const session = await login();
    expect(session.native_role).toBe("Administrador");
    expect(session.schema).toBe("unsa");
    expect(session.default_persona).toBe("executive");
    expect(session.can_switch_persona).toBe(true);
    expect(session.permissions).toContain("view_securitylog");
    expect(session.permissions).toContain("change_incident");
    expect(session.expires_at_utc.length).toBeGreaterThan(0);
  });

  it("validates session and returns remaining seconds over /api/session", async () => {
    const session = await login();
    const response = await app.request("/api/session", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      username: string;
      native_role: string;
      remaining_seconds: number;
    };
    expect(body.username).toBe(session.username);
    expect(body.native_role).toBe(session.native_role);
    expect(body.remaining_seconds).toBeGreaterThan(0);

    const unauth = await app.request("/api/session");
    expect(unauth.status).toBe(401);
  });

  it("streams a snapshot and live agent events over SSE", async () => {
    const session = await login();
    const controller = new AbortController();
    const response = await app.request("/api/stream", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("SSE body missing");
    }
    const decoder = new TextDecoder();
    let text = await readSseUntil(reader, decoder, "", (value) =>
      value.includes("event: snapshot"),
    );
    expect(text).toContain("stream:ready");
    expect(text).toContain("pending_decisions");
    expect(text).toContain("incidents");

    harness.events.emit({
      type: "tool:mutation",
      at_utc: harness.now.toISOString(),
      incident_code: null,
      method: "GET",
      endpoint: "/api/incidents/",
      operation: "list_incidents",
      idempotency_key: null,
      duration_ms: 3,
      status: 200,
      attempt: 1,
      payload_keys: [],
      error_code: null,
    });
    harness.events.emit({
      type: "role:transition",
      at_utc: harness.now.toISOString(),
      incident_code: "INC-001",
      role: "triage",
      previous_role: null,
      lease_holder: "test",
    });

    text = await readSseUntil(reader, decoder, text, (value) =>
      value.includes('"type":"role:transition"'),
    );
    expect(text).toContain('"type":"tool:mutation"');
    controller.abort();
    await reader.cancel();
  });

  it("fetches compliance timers and pending decisions over /api/compliance", async () => {
    const session = await login();
    const response = await app.request("/api/compliance", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      timers: unknown[];
      pending_decisions: unknown[];
    };
    expect(Array.isArray(body.timers)).toBe(true);
    expect(Array.isArray(body.pending_decisions)).toBe(true);
  });

  it("approves drafted notices through the cockpit endpoint", async () => {
    const session = await login();
    const incident = await freshIncident("Cockpit approval fixture");
    await harness.agent.orchestrator.triage(incident.id);
    await harness.agent.orchestrator.investigate(incident.id);
    await harness.agent.orchestrator.draftAndReview(incident.id);

    const response = await app.request(
      `/api/incidents/${incident.id}/approve`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      parked: boolean;
      notifies: unknown[];
      actions: unknown[];
    };
    expect(body.parked).toBe(false);
    expect(body.notifies.length).toBeGreaterThan(0);
    expect(body.actions.length).toBeGreaterThan(0);
  });

  it("requests a revision and resets the pack to draft", async () => {
    const session = await login();
    const incident = await freshIncident("Cockpit revision fixture");
    await harness.agent.orchestrator.triage(incident.id);
    await harness.agent.orchestrator.investigate(incident.id);
    const draft = await harness.agent.orchestrator.draftAndReview(incident.id);
    expect(draft.authority_pack_id).not.toBeNull();

    const response = await app.request(
      `/api/incidents/${incident.id}/revision`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pack_type: "authority",
          reason: "Legal review requested a clearer consequence statement.",
        }),
      },
    );
    expect(response.status).toBe(200);
    const row = await harness.store.getDraftPack(incident.code, "authority");
    expect(row?.state).toBe("draft");
  });

  it("attests an Art 34(3)(a) encryption exemption", async () => {
    const session = await login();
    const incident = await freshIncident("Cockpit exemption fixture");
    await harness.agent.orchestrator.triage(incident.id);
    const sourceSha = "c".repeat(64);

    const response = await app.request(
      `/api/incidents/${incident.id}/exemption`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          letter: "a",
          source_file_sha256: sourceSha,
          scope: "encrypt_rest",
          algorithm: "AES-256-GCM",
          key_management_ref: "kms://evidence/keys/2026",
          applies_to_affected_data: true,
          evidence_refs: [`sha256:${sourceSha}`],
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      exemption: { kind: string; exemption?: { letter: string } };
      pack_id: string;
    };
    expect(body.exemption.kind).toBe("exempted");
    expect(body.exemption.exemption?.letter).toBe("a");
    expect(body.pack_id.length).toBeGreaterThan(0);
    const pack = await harness.store.getDraftPack(incident.code, "subject");
    expect(pack?.state).toBe("exempted");
  });

  it("answers chat with verbatim RAG citations and rejects fabricated ones", async () => {
    const session = await login();
    const incident = await freshIncident("Cockpit chat fixture");
    await harness.agent.orchestrator.triage(incident.id);
    await harness.agent.orchestrator.investigate(incident.id);
    await harness.agent.orchestrator.draftAndReview(incident.id);

    chatMode = "valid";
    const okResponse = await app.request("/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Estado del incidente ${incident.code} y citas normativas que respaldan la notificación`,
        persona: "auditor",
      }),
    });
    if (okResponse.status !== 200) {
      throw new Error(`CHAT_FAILED:${await okResponse.text()}`);
    }
    const okBody = (await okResponse.json()) as {
      reply: string;
      persona: string;
      citations: Array<{
        chunk_sha256: string;
        citation: string;
        text: string;
      }>;
      tool_calls: string[];
    };
    expect(okBody.reply.length).toBeGreaterThan(0);
    expect(okBody.persona).toBe("auditor");
    expect(okBody.citations.length).toBeGreaterThan(0);
    const citation = okBody.citations[0];
    expect(citation?.chunk_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(citation?.text.length).toBeGreaterThan(0);
    expect(okBody.tool_calls).toContain("get_rag_citations");

    chatMode = "fabricated";
    const fabricated = await app.request("/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Estado del incidente ${incident.code}`,
      }),
    });
    expect(fabricated.status).toBe(400);
    const fabricatedBody = (await fabricated.json()) as { error: string };
    expect(fabricatedBody.error).toContain("CITATION_FABRICATED");

    chatMode = "pii";
    const pii = await app.request("/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Estado del incidente ${incident.code}`,
      }),
    });
    expect(pii.status).toBe(400);
    const piiBody = (await pii.json()) as { error: string };
    expect(piiBody.error).toBe("COCKPIT_PII_BLOCKED");
    chatMode = "valid";
  });

  it("denies mutations and mutation events to a Lector", async () => {
    const lector: CockpitSession = {
      access_token: "lector-token",
      expires_at_utc: new Date("2030-01-01T00:00:00.000Z").toISOString(),
      user_id: 2,
      username: "lector",
      schema: "unsa",
      native_role: "Lector",
      permissions: ["view_incident"],
      default_persona: "auditor",
      can_switch_persona: false,
    };
    sessions.add(lector);

    const approve = await app.request("/api/incidents/1/approve", {
      method: "POST",
      headers: { Authorization: "Bearer lector-token" },
    });
    expect(approve.status).toBe(403);
    const approveBody = (await approve.json()) as { error: string };
    expect(approveBody.error).toBe("COCKPIT_PERMISSION_DENIED");

    const persona = await app.request("/api/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer lector-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Resumen ejecutivo",
        persona: "executive",
      }),
    });
    expect(persona.status).toBe(403);

    const controller = new AbortController();
    const stream = await app.request("/api/stream", {
      headers: { Authorization: "Bearer lector-token" },
      signal: controller.signal,
    });
    const reader = stream.body?.getReader();
    if (reader === undefined) {
      throw new Error("SSE body missing");
    }
    const decoder = new TextDecoder();
    let text = await readSseUntil(reader, decoder, "", (value) =>
      value.includes("event: snapshot"),
    );

    harness.events.emit({
      type: "tool:mutation",
      at_utc: harness.now.toISOString(),
      incident_code: null,
      method: "DELETE",
      endpoint: "/api/incidents/9/",
      operation: "delete_incident",
      idempotency_key: "hidden",
      duration_ms: 5,
      status: 204,
      attempt: 1,
      payload_keys: [],
      error_code: null,
    });
    harness.events.emit({
      type: "role:transition",
      at_utc: harness.now.toISOString(),
      incident_code: "INC-001",
      role: "monitor",
      previous_role: "notifier",
      lease_holder: "test",
    });

    text = await readSseUntil(reader, decoder, text, (value) =>
      value.includes('"type":"role:transition"'),
    );
    expect(text).not.toContain('"type":"tool:mutation"');
    controller.abort();
    await reader.cancel();
  });

  it("reports readiness from database, index and PIMS", async () => {
    const ready = await app.request("/readyz");
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as {
      status: string;
      checks: Record<string, boolean>;
    };
    expect(body.status).toBe("ready");
    expect(body.checks.database).toBe(true);
    expect(body.checks.rag_index).toBe(true);
    expect(body.checks.pims).toBe(true);
    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
    expect(authorityCitation.length).toBeGreaterThan(0);
  });
});
