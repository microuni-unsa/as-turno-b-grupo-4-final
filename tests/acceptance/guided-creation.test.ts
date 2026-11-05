import { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import {
  AgentModelClient,
  setGlobalPresidioClient,
} from "@pims/agent/llm/safe-prompt.ts";
import { createCockpitApp } from "@pims/cockpit/app.ts";
import { SessionRegistry } from "@pims/cockpit/auth.ts";
import type { AgentConfig } from "@pims/config";
import type {
  CockpitSession,
  GuidedDraftResponse,
  GuidedExplainResponse,
} from "@pims/types/cockpit.ts";
import type { ChatJsonArgs, JsonObject } from "@pims/types/models.ts";
import {
  type IntegrationHarness,
  startIntegrationHarness,
} from "@tests/helpers/integration-harness.ts";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Acceptance Tests A18–A22: Cockpit Guided Incident Creation", {
  timeout: 240_000,
}, () => {
  let presidioContainer: StartedTestContainer;
  let presidioUrl: string;
  let presidioClient: PresidioClient;
  let harness: IntegrationHarness;
  let app: ReturnType<typeof createCockpitApp>;
  let sessions: SessionRegistry;
  const operatorToken = "operator-guided-token";

  beforeAll(async () => {
    const defaultUrl = process.env.PRESIDIO_URL ?? "http://127.0.0.1:3001";
    let isAlreadyUp = false;
    try {
      const probe = await fetch(`${defaultUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (probe.ok) {
        isAlreadyUp = true;
        presidioUrl = defaultUrl;
      }
    } catch {
      isAlreadyUp = false;
    }

    if (!isAlreadyUp) {
      presidioContainer = await new GenericContainer(
        "presidio-analyzer:2.2.x-es",
      )
        .withExposedPorts(3000)
        .withWaitStrategy(Wait.forHttp("/health", 3000))
        .withStartupTimeout(60_000)
        .start();

      const host = presidioContainer.getHost();
      const port = presidioContainer.getMappedPort(3000);
      presidioUrl = `http://${host}:${port}`;
    }

    presidioClient = new PresidioClient({
      baseUrl: presidioUrl,
      timeoutMs: 5000,
      minScore: 0.5,
    });
    setGlobalPresidioClient(presidioClient);

    harness = await startIntegrationHarness({
      autoNotify: false,
      presidioUrl,
      chatHandler: (args: ChatJsonArgs) => {
        if (
          args.system.includes("Extract incident reporting fields") ||
          args.system.includes("GUIDED_DRAFT")
        ) {
          return {
            title: "Exfiltración de credenciales en portal de admisiones",
            description:
              "Se detectó exfiltración de registros conteniendo DNI y correos.",
            involves_personal_data: true,
            incident_type: "DL",
            incident_date: "2026-10-01",
            incident_time: "10:00:00",
            detection_date: "2026-10-01",
            detection_time: "10:30:00",
            affected_data_types: ["id_doc", "email"],
            security_measures_adopted: ["encrypt_rest"],
            affected_cid: ["C"],
            num_affected_subjects: 50,
            compromised_system: "admissions-portal",
            affected_url: "https://admissions.unsa.edu.pe",
            rep_first_name: "Carlos",
            rep_last_name_p: "Mendoza",
            rep_document_number: "72345678",
            rep_email: "cmendoza@unsa.edu.pe",
            dpo_contact_name: "DPO UNSA",
            dpo_contact_email: "dpo@unsa.edu.pe",
            confidence_scores: {
              title: 0.95,
              incident_type: 0.9,
              involves_personal_data: 0.95,
              num_affected_subjects: 0.85,
            },
          } as unknown as JsonObject;
        }
        if (args.system.includes("expert incident privacy officer")) {
          return {
            reply:
              "Este campo evalúa si el incidente afecta datos de carácter personal.",
            citations: [harness.authorityCitation],
          } as unknown as JsonObject;
        }
        return null;
      },
    });

    sessions = new SessionRegistry();
    const operatorSession: CockpitSession = {
      access_token: operatorToken,
      expires_at_utc: new Date(Date.now() + 3600 * 1000).toISOString(),
      user_id: 1,
      username: "operator_test",
      schema: "unsa",
      native_role: "Operador",
      permissions: ["view_incident", "change_incident"],
      default_persona: "auditor",
      can_switch_persona: true,
    };
    sessions.add(operatorSession);

    const agentModelClient = new AgentModelClient(
      harness.provider,
      presidioClient,
    );

    app = createCockpitApp({
      config: {
        ...harness.config,
        PRESIDIO_URL: presidioUrl,
      } as AgentConfig,
      adapter: harness.adapter,
      store: harness.store,
      agent: {
        ...harness.agent,
        presidioClient,
        modelClient: agentModelClient,
      },
      ragService: harness.ragService,
      events: harness.events,
      sessions,
      clock: () => harness.now,
    });
  }, 180_000);

  afterAll(async () => {
    if (presidioContainer) {
      await presidioContainer.stop();
    }
    if (harness) {
      await harness.stop();
    }
  });

  describe("A19 & A20: Guided Draft (Typed & Dictated)", () => {
    const narrativeText =
      "El 2026-10-01 a las 10:00 se detectó un incidente de fuga de datos en el sistema admissions-portal. " +
      "Se comprometieron 50 registros de postulantes con DNI y email. Reportado por Carlos Mendoza con DNI 72345678.";

    it("A19: extracts reporting fields from typed narrative with provenance and deterministic defaults without persistence", async () => {
      const initialIncidents = await harness.adapter.listIncidents();
      const initialCount = initialIncidents.count;

      const res = await app.request("/api/incidents/draft", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ narrative: narrativeText }),
      });

      if (res.status !== 200) {
        console.error("DRAFT ERROR BODY:", await res.json());
      }

      expect(res.status).toBe(200);
      const draft = (await res.json()) as GuidedDraftResponse;

      // Extractable fields
      expect(draft.draft.title).toBe(
        "Exfiltración de credenciales en portal de admisiones",
      );
      expect(draft.draft.incident_type).toBe("DL");
      expect(draft.draft.involves_personal_data).toBe(true);
      expect(draft.draft.num_affected_subjects).toBe(50);
      expect(draft.draft.compromised_system).toBe("admissions-portal");

      // Provenance tracking
      expect(draft.provenance.title).toBe("narrative");
      expect(draft.provenance.incident_type).toBe("narrative");
      expect(draft.provenance.involves_personal_data).toBe("narrative");

      // Deterministic operator default
      expect(draft.draft.reported_by).toBe("operator_test");
      expect(draft.provenance.reported_by).toBe("default");

      // Redaction report
      expect(draft.redaction_report.total_spans).toBeGreaterThan(0);

      // Verify no persistence occurred in PIMS
      const afterIncidents = await harness.adapter.listIncidents();
      expect(afterIncidents.count).toBe(initialCount);
    });

    it("A20: dictated narrative follows identical extraction path as typed draft", async () => {
      // Browser Web Speech API delivers transcript as string; endpoint is identical
      const res = await app.request("/api/incidents/draft", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ narrative: narrativeText }),
      });

      if (res.status !== 200) {
        console.error("DRAFT ERROR BODY:", await res.json());
      }

      expect(res.status).toBe(200);
      const draft = (await res.json()) as GuidedDraftResponse;
      expect(draft.draft.incident_type).toBe("DL");
      expect(draft.draft.compromised_system).toBe("admissions-portal");
      expect(draft.provenance.compromised_system).toBe("narrative");
    });
  });

  describe("A21: Guided Explain", () => {
    it("incident_type returns deterministic code table with zero LLM call", async () => {
      const res = await app.request("/api/incidents/explain", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ field: "incident_type" }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as GuidedExplainResponse;
      expect(data.type).toBe("enum");
      expect(data.options).toBeDefined();
      const dlOption = data.options?.find((o) => o.code === "DL");
      expect(dlOption).toBeDefined();
      expect(dlOption?.label).toBe("Fuga o pérdida de datos");

      // Repeat call must be byte-identical
      const res2 = await app.request("/api/incidents/explain", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ field: "incident_type" }),
      });
      const data2 = await res2.json();
      expect(data2).toEqual(data);
    });

    it("involves_personal_data returns cited explanation from RAG", async () => {
      const res = await app.request("/api/incidents/explain", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ field: "involves_personal_data" }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as GuidedExplainResponse;
      expect(data.type).toBe("semantic");
      expect(data.explanation).toContain("datos de carácter personal");
      expect(data.citations?.length).toBeGreaterThan(0);
    });
  });

  describe("A18 & A22: Guided Submit and Dedupe", () => {
    let createdIncidentCode: string;

    it("A18: guided submit creates an O row with reporting sections verbatim and arms timers", async () => {
      const submitPayload = {
        idempotency_key: "guided-submit-idemp-1",
        title: "Incidente Guiado Portal Admisiones",
        description: "Brecha detectada en el servicio de admisiones.",
        involves_personal_data: true,
        incident_date: "2026-10-01",
        incident_time: "10:00:00",
        detection_date: "2026-10-01",
        detection_time: "10:30:00",
        incident_type: "DL",
        affected_data_types: ["id_doc", "email"],
        security_measures_adopted: ["encrypt_rest"],
        affected_cid: ["C"],
        num_affected_subjects: 50,
        compromised_system: "admissions-portal",
        rep_first_name: "Carlos",
        rep_last_name_p: "Mendoza",
        rep_document_number: "72345678",
        rep_email: "cmendoza@unsa.edu.pe",
        dpo_contact_name: "DPO UNSA",
        dpo_contact_email: "dpo@unsa.edu.pe",
      };

      const res = await app.request("/api/incidents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submitPayload),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        incident_code: string;
        status: string;
        dedupe: boolean;
      };

      expect(body.incident_code).toBeDefined();
      expect(body.status).toBe("O");
      expect(body.dedupe).toBe(false);

      createdIncidentCode = body.incident_code;

      // Verify row in PIMS
      const incidents = await harness.adapter.listIncidents();
      const created = incidents.results.find(
        (i) => i.incident_code === body.incident_code,
      );
      expect(created).toBeDefined();
      if (!created) {
        throw new Error("Created incident not found in PIMS");
      }
      expect(created.status).toBe("O");
      expect(created.title).toBe(submitPayload.title);
      expect(created.incident_type).toBe("DL");
      expect(created.involves_personal_data).toBe(true);
      expect(created.compromised_system).toBe("admissions-portal");
      expect(created.severity).toBeNull();
      expect(created.impact).toBeNull();
      expect(created.measure_reported_authorities).toBeNull();

      // Verify timers are armed in evidence store
      const timers = await harness.store.listActiveTimers();
      const incidentTimers = timers.filter(
        (t) => t.incident_code === body.incident_code,
      );
      expect(incidentTimers.length).toBeGreaterThan(0);
      expect(incidentTimers.some((t) => t.timer_type === "T72_AUTHORITY")).toBe(
        true,
      );
    });

    it("A22: near-duplicate guided submit dedupes and surfaces DEDUPE_MERGED:cockpit_guided", async () => {
      const nearDuplicatePayload = {
        idempotency_key: "guided-submit-idemp-2",
        title: "Incidente Guiado Portal Admisiones", // Same title
        description: "Brecha detectada en el servicio de admisiones.",
        involves_personal_data: true,
        incident_date: "2026-10-01", // Same date
        detection_date: "2026-10-01",
        incident_type: "DL",
        affected_data_types: ["id_doc"],
        security_measures_adopted: [],
        affected_cid: ["C"],
        num_affected_subjects: 50,
        compromised_system: "admissions-portal", // Same system
      };

      const res = await app.request("/api/incidents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nearDuplicatePayload),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        incident_code: string;
        status: string;
        dedupe: boolean;
        marker?: string;
      };

      expect(body.dedupe).toBe(true);
      expect(body.incident_code).toBe(createdIncidentCode);
      expect(body.marker).toBe("DEDUPE_MERGED:cockpit_guided");

      // Verify no duplicate row was created in PIMS
      const incidents = await harness.adapter.listIncidents();
      const matching = incidents.results.filter(
        (i) => i.title === nearDuplicatePayload.title,
      );
      expect(matching.length).toBe(1);
    });
  });
});
