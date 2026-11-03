import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type Agent,
  B3_12_SYSTEM,
  CONTAINMENT_SYSTEM,
  createAgent,
  DRAFT_AUTHORITY_SYSTEM,
  DRAFT_SUBJECT_SYSTEM,
  RESOLUTION_SYSTEM,
  REVIEW_CHALLENGE_AUTHORITY_SYSTEM,
  REVIEW_CHALLENGE_SYSTEM,
  RISK_CATALOG_SYSTEM,
  ROOT_CAUSE_SYSTEM,
  TRIAGE_SYSTEM,
} from "@pims/agent";
import { type AgentConfig, loadConfig } from "@pims/config";
import { EvidenceStore } from "@pims/evidence";
import { OpenAIModelProvider } from "@pims/models";
import { PimsAdapter } from "@pims/pims-adapter";
import {
  createMockDatabase,
  createPimsTestServer,
  type MockDatabaseClient,
  type PimsTestServerInstance,
} from "@pims/pims-mock";
import { CorpusLoader, RAGService, RagIndexer } from "@pims/rag";
import { ModelSchemaViolationError } from "@pims/types";
import {
  type AgentRole,
  CLOSE_CHECKLIST_ITEMS,
  type IntakePayload,
  IntakePayloadSchema,
} from "@pims/types/agent.ts";
import { PIMS_TEST_SEED_PASSWORD } from "@pims/types/constants.ts";
import type { IndicatorSpoolRecord } from "@pims/types/evidence.ts";
import type { JsonObject, RankedPassage } from "@pims/types/models.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  buildGdprTextAxes,
  generateSpanAwareEmbedding,
} from "@tests/helpers/span-geometry.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

function scenarioFixture(params: {
  title: string;
  detectionTime: string;
  system: string;
}): IntakePayload {
  return IntakePayloadSchema.parse({
    channel: "form",
    title: params.title,
    involves_personal_data: true,
    incident_date: "2026-10-01",
    detection_date: "2026-10-01",
    detection_time: params.detectionTime,
    incident_type: "DL",
    affected_data_types: ["id_doc", "email"],
    security_measures_adopted: ["encrypt_rest"],
    num_affected_subjects: 500,
    compromised_system: params.system,
    dpo: { name: "DPO Name", email: "dpo@example.test" },
    description: "Dry-walk fixture: exfiltration of admissions records.",
  });
}

const FIXTURE = IntakePayloadSchema.parse({
  channel: "form",
  title: "DL breach dry-walk",
  involves_personal_data: true,
  incident_date: "2026-10-01",
  detection_date: "2026-10-01",
  detection_time: "10:00:00",
  incident_type: "DL",
  affected_data_types: ["id_doc", "email"],
  security_measures_adopted: ["encrypt_rest"],
  num_affected_subjects: 500,
  compromised_system: "admissions-portal",
  dpo: { name: "DPO Name", email: "dpo@example.test" },
  description: "Dry-walk fixture: exfiltration of admissions records.",
});

const NON_PII_FIXTURE = IntakePayloadSchema.parse({
  channel: "siem",
  title: "Port scan against edge router",
  involves_personal_data: false,
  incident_date: "2026-10-01",
  detection_date: "2026-10-01",
  detection_time: "09:00:00",
  incident_type: "OT",
  affected_data_types: [],
  security_measures_adopted: ["encrypt_rest"],
  compromised_system: "edge-router",
  dpo: { name: "DPO Name", email: "dpo@example.test" },
  description:
    "Repeated port scan against the edge router with no successful logon.",
});

describe("Phase 4 autonomous lifecycle loop (§6, §9, §14.2)", {
  timeout: 240_000,
}, () => {
  let container: StartedPostgreSqlContainer;
  let dbClient: MockDatabaseClient;
  let server: PimsTestServerInstance;
  let adapter: PimsAdapter;
  let store: EvidenceStore;
  let ragService: RAGService;
  let provider: OpenAIModelProvider;
  let agent: Agent;
  let config: AgentConfig;
  let authorityCitation: string;
  let storageDir: string;
  let reviewChallengePayload: JsonObject = { challenges: [] };
  const now = new Date("2026-10-01T20:00:00.000Z");

  beforeAll(async () => {
    const projectRoot = process.cwd();
    const dumpPath = path.resolve(
      projectRoot,
      "data/gestitel_base_de_datos.sql",
    );
    const seedPath = path.resolve(projectRoot, "data/02-init-unsa-seed.sql");

    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withBindMounts([
        {
          source: dumpPath,
          target: "/docker-entrypoint-initdb.d/01-gestitel.sql",
          mode: "ro",
        },
        {
          source: seedPath,
          target: "/docker-entrypoint-initdb.d/02-seed.sql",
          mode: "ro",
        },
      ])
      .start();

    dbClient = createMockDatabase(container.getConnectionUri());
    server = await createPimsTestServer(dbClient, {
      nestedActionMode: "replace",
    });

    await dbClient.sql.unsafe(
      "UPDATE unsa.core_asset SET name='admissions-portal' WHERE id=1;",
    );

    adapter = new PimsAdapter({
      baseUrl: server.url,
      schema: "unsa",
      username: "admin",
      password: PIMS_TEST_SEED_PASSWORD,
      timeoutMs: 15000,
    });

    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "pims-agent-loop-"));
    store = new EvidenceStore({
      connectionUri: container.getConnectionUri(),
      keyHex: "a1".repeat(32),
      baseStorageDir: storageDir,
    });
    await store.init();

    const modelConfig = {
      provider: "openai",
      model: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      auth_env: "OPENAI_API_KEY",
      timeout_ms: 20000,
      max_retries: 0,
      fallback: "none" as const,
    };

    provider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: "gpt-4o-mini" },
      visionConfig: modelConfig,
      embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
      rerankerConfig: { ...modelConfig, model: "gpt-4o-mini" },
      apiKey: "lifecycle-loop-test-key",
      baseURL: "https://api.openai.com/v1",
    });

    vi.spyOn(provider, "embed").mockImplementation(async ({ texts }) => ({
      vectors: texts.map((text) => generateSpanAwareEmbedding(text)),
    }));

    vi.spyOn(provider, "rerank").mockImplementation(async ({ passages }) => {
      const ranked: RankedPassage[] = passages.map((passage, index) => ({
        ...passage,
        score: 0.9,
        rank: index + 1,
      }));
      return { ranked };
    });

    const loader = new CorpusLoader({
      projectRoot,
      source: { type: "local", dirPath: "corpus" },
    });
    const corpus = await loader.loadAll();
    buildGdprTextAxes(corpus.chunks);

    const indexer = new RagIndexer({
      modelProvider: provider,
      pgClient: dbClient.sql,
    });
    await indexer.indexCorpus(corpus.chunks, corpus.version, 25);

    const authorityChunk =
      indexer.getAllChunks().find((chunk) => chunk.doc_id === "gdpr-full") ??
      indexer.getAllChunks()[0];
    if (authorityChunk === undefined) {
      throw new Error("Corpus index produced no chunks");
    }

    ragService = new RAGService({
      modelProvider: provider,
      indexer,
      config: {
        RAG_TOP_K: 24,
        RAG_RERANK_K: 6,
        RAG_MIN_SCORE: 0.35,
        RAG_TIMEOUT_MS: 30000,
      } as unknown as AgentConfig,
    });
    authorityCitation = ragService.formatCitation(authorityChunk);

    vi.spyOn(provider, "chat_json").mockImplementation(async (args) => {
      const respond = (content: JsonObject) => ({
        content,
        citations_requested: false,
        semantic_entropy: 0.2,
      });
      const prompt = args.messages[0]?.content ?? "";
      const isNonPii = prompt.includes("Port scan");

      if (args.system === TRIAGE_SYSTEM) {
        return respond({
          incident_type: isNonPii ? "OT" : "DL",
          candidate_probabilities: [
            { type: isNonPii ? "OT" : "DL", probability: 0.85 },
            { type: "UA", probability: 0.15 },
          ],
          severity: isNonPii ? "M" : "H",
          impact: isNonPii ? "L" : "H",
          affected_cid: isNonPii ? ["I"] : ["C"],
          rationale: ["fixture classification"],
          citations: [authorityCitation],
        });
      }
      if (args.system === CONTAINMENT_SYSTEM) {
        return respond({
          actions: [
            {
              description:
                "Isolate the compromised system behind the WAF block rule.",
              responsible: "soc",
              evidence: "file:containment.txt:deadbeef",
            },
          ],
        });
      }
      if (args.system === B3_12_SYSTEM) {
        return respond({
          breach_requiring_response: !isNonPii,
          rationale: isNonPii
            ? "Port scan with no successful logon is a documented non-trigger."
            : "Exfiltration of admissions records is a personal data breach.",
          citations: [authorityCitation],
        });
      }
      if (args.system === ROOT_CAUSE_SYSTEM) {
        return respond({
          method: "5-whys",
          cause: isNonPii
            ? "Edge router exposes an unnecessary management port"
            : "Stale service credential allowed bulk export",
          evidence_refs: ["file:containment.txt:deadbeef"],
          systemic: !isNonPii,
          remediation:
            "Rotate the service credential and enforce least privilege on the export endpoint.",
          root_cause_unproven: false,
        });
      }
      if (args.system === RISK_CATALOG_SYSTEM) {
        return respond({ threat_code: "TH04", vulnerability_code: null });
      }
      if (args.system === DRAFT_AUTHORITY_SYSTEM) {
        return respond({
          item_a_nature:
            "Exfiltration of admissions records through the portal export endpoint.",
          item_a_categories_subjects: ["applicants"],
          item_a_approx_subjects: 500,
          item_a_categories_records: ["identification", "contact"],
          item_a_approx_records: 500,
          item_a_unknown: [],
          item_c_consequences:
            "Unauthorised parties could impersonate applicants in admissions processes.",
          item_d_measures_taken: [
            "The portal export endpoint was disabled and credentials were rotated.",
          ],
          item_d_measures_proposed: [
            "Egress monitoring will be extended to every portal export.",
          ],
          citations: [authorityCitation],
        });
      }
      if (args.system === DRAFT_SUBJECT_SYSTEM) {
        return respond({
          body_plain:
            "An unauthorised party accessed some of your admissions records. We stopped the access and rotated the credentials. Please watch for unexpected messages about your application.",
          item_c_consequences:
            "Someone could try to impersonate you during the admissions process.",
          item_d_measures: [
            "We disabled the affected export endpoint.",
            "We rotated every credential that could reach it.",
          ],
          recommendations: [
            "Report unexpected messages about your application to the admissions office.",
          ],
          citations: [authorityCitation],
        });
      }
      if (args.system === RESOLUTION_SYSTEM) {
        return respond({
          summary:
            "The portal export credential was rotated and the endpoint restricted.",
          remediation:
            "Least-privilege review of every export endpoint and continuous egress monitoring.",
          citations: [authorityCitation],
        });
      }
      if (
        args.system === REVIEW_CHALLENGE_SYSTEM ||
        args.system === REVIEW_CHALLENGE_AUTHORITY_SYSTEM
      ) {
        return respond(reviewChallengePayload);
      }
      throw new Error(
        `Unrouted chat_json system prompt: ${args.system.slice(0, 60)}`,
      );
    });

    config = loadConfig({
      PIMS_BASE_URL: server.url,
      PIMS_SCHEMA: "unsa",
      PIMS_TOKEN_CMD: "true",
      EVIDENCE_DB_URL: container.getConnectionUri(),
      OPENAI_API_KEY: "lifecycle-loop-test-key",
      REASONING_MODEL:
        "openai,gpt-4o,https://api.openai.com/v1,OPENAI_API_KEY,20000,0,fallback:none",
      FAST_MODEL:
        "openai,gpt-4o-mini,https://api.openai.com/v1,OPENAI_API_KEY,20000,0,fallback:none",
      VISION_MODEL:
        "openai,gpt-4o,https://api.openai.com/v1,OPENAI_API_KEY,20000,0,fallback:none",
      EMBEDDINGS_MODEL:
        "openai,text-embedding-3-small,https://api.openai.com/v1,OPENAI_API_KEY,20000,0,fallback:none",
      RERANKER_MODEL:
        "openai,gpt-4o-mini,https://api.openai.com/v1,OPENAI_API_KEY,20000,0,fallback:none",
      EVIDENCE_KEY: "a1".repeat(32),
      ASSIGNEES: '["analyst-1","analyst-2"]',
      RAG_TOP_K: "24",
      RAG_RERANK_K: "6",
      RAG_MIN_SCORE: "0.35",
      RAG_TIMEOUT_MS: "30000",
      MAX_REVIEW_CYCLES: "3",
      SCHEDULER_MAX_TIMERS: "100",
    });

    agent = await createAgent(
      {
        adapter,
        evidenceStore: store,
        modelProvider: provider,
        ragService,
        config,
        clock: () => now,
      },
      { runProbes: false },
    );
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    if (store) {
      await store.close();
    }
    if (dbClient) {
      await dbClient.sql.end();
    }
    if (container) {
      await container.stop();
    }
    if (storageDir) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  async function callTool(
    role: AgentRole,
    tool: string,
    args: JsonObject,
  ): Promise<JsonObject> {
    return agent.tools.execute(
      agent.roles.createCapabilityHandle(role),
      tool,
      args,
    );
  }

  async function ensureRecipient(): Promise<void> {
    const recipients = await adapter.listRecipients();
    if (recipients.results.some((row) => row.email === "dpo@example.test")) {
      return;
    }
    await callTool("orchestrator", "pims_manage_recipient", {
      op: "create",
      email: "dpo@example.test",
      label: "DPO",
      operator_jwt_sub: "test-op",
    });
  }

  async function removeAllRecipients(): Promise<void> {
    const recipients = await adapter.listRecipients();
    for (const recipient of recipients.results) {
      await callTool("orchestrator", "pims_manage_recipient", {
        op: "delete",
        id: recipient.id,
        operator_jwt_sub: "test-op",
      });
    }
  }

  async function freshReviewIncident(title: string) {
    return (await agent.orchestrator.intake({ ...FIXTURE, title })).incident;
  }

  const spool = (): Promise<IndicatorSpoolRecord[]> =>
    store.listIndicatorSpool();

  it("A01: walks the §14.2 fixture from intake to sealed close", async () => {
    await ensureRecipient();

    const intake = await agent.orchestrator.intake(FIXTURE);
    const code = intake.incident.incident_code;

    expect(intake.incident.status).toBe("O");
    expect(intake.incident.involves_personal_data).toBe(true);
    expect(intake.incident.assigned_to).toBe("analyst-1");

    const timers = await store.listActiveTimers(code);
    const t72 = timers.find((timer) => timer.timer_type === "T72_AUTHORITY");
    expect(t72?.fire_at_utc).toBe("2026-10-04T15:00:00.000Z");
    expect(timers.some((timer) => timer.timer_type === "T_PERU_ADVISORY")).toBe(
      true,
    );

    const opened = (await spool()).filter(
      (row) =>
        row.event_type === "incident_opened" &&
        row.payload.incident_code === code,
    );
    expect(opened).toHaveLength(1);

    const triage = await agent.orchestrator.triage(intake.incident.id);
    expect(triage.incident.status).toBe("P");
    expect(triage.classification.incident_type).toBe("DL");
    expect(triage.classification.severity).toBe("H");
    expect(triage.classification.impact).toBe("H");
    expect(triage.classification.affected_cid).toEqual(["C"]);
    expect(triage.calibration_mode).toBe("cold_start");

    const investigation = await agent.orchestrator.investigate(
      intake.incident.id,
    );
    const actions = investigation.incident.actions ?? [];
    expect(actions.map((action) => action.action_type)).toEqual([
      "C",
      "A",
      "A",
    ]);
    expect(investigation.rootCause.cause).toBe(
      "Stale service credential allowed bulk export",
    );
    expect(investigation.auditLink).not.toBeNull();
    expect(investigation.riskSignal).not.toBeNull();

    const risks = await adapter.listRiskEvaluations();
    expect(risks.results.length).toBeGreaterThan(0);

    const auditLink = investigation.auditLink;
    if (auditLink === null) {
      throw new Error("expected an audit link");
    }
    const audits = await adapter.listAudits();
    const audit = audits.results.find((row) => row.id === auditLink.audit_id);
    const finding = (audit?.findings ?? []).find(
      (row) => row.id === auditLink.finding_id,
    );
    expect(finding?.classification).toBe("N");
    expect(finding?.description).toContain(
      `10.2 corrective action for ${code}`,
    );

    const draft = await agent.orchestrator.draftAndReview(intake.incident.id);
    expect(draft.high_risk_gate.verdict).toBe(true);
    expect(draft.authority_pack_id).not.toBeNull();
    expect(draft.subject_pack_id).not.toBeNull();
    expect(draft.authority_approval_id).not.toBeNull();
    expect(draft.subject_approval_id).not.toBeNull();
    expect(draft.authority_approval_id).not.toBe(draft.subject_approval_id);

    const authorityRow = await store.getDraftPack(code, "authority");
    expect(authorityRow?.state).toBe("approved");
    const authorityPayload = authorityRow?.payload as JsonObject;
    expect(authorityPayload.item_a_approx_subjects).toBe(500);
    expect(authorityPayload.item_a_nature).toBeTruthy();
    expect(authorityPayload.item_b_dpo).toMatchObject({
      name: "DPO Name",
      email: "dpo@example.test",
    });
    expect(authorityPayload.item_c_consequences).toBeTruthy();
    expect(
      (authorityPayload.item_d_measures_taken as string[]).length,
    ).toBeGreaterThan(0);
    expect(authorityPayload.phased).toBe(false);
    expect(authorityPayload.citations).toEqual([authorityCitation]);

    const subjectRow = await store.getDraftPack(code, "subject");
    expect(subjectRow?.state).toBe("approved");

    const notify = await agent.orchestrator.approveAndNotify(
      intake.incident.id,
    );
    expect(notify.parked).toBe(false);
    expect(notify.notifies.length).toBe(2);
    expect(notify.notifies[0]?.recipients_snapshot).toContain(
      "dpo@example.test",
    );
    expect(notify.actions.map((action) => action.action_type)).toEqual([
      "C",
      "A",
      "A",
      "R",
    ]);

    const afterNotify = await adapter.getIncident(intake.incident.id);
    expect(afterNotify.measure_reported_authorities).toBe("Y");
    expect(afterNotify.evidence_refs ?? "").toContain("SUBJECT_NOTIFIED:");
    expect(afterNotify.evidence_refs ?? "").toContain("CLOSE_APPROVED:");

    const history = await adapter.getIncidentHistory(intake.incident.id);
    expect(
      history.some(
        (row) =>
          row.event_type === "notified" &&
          (row.recipients_snapshot ?? []).length > 0,
      ),
    ).toBe(true);

    const closed = await agent.orchestrator.close(intake.incident.id);
    expect(closed.incident.status).toBe("C");
    expect(closed.incident.resolved_date).toBeTruthy();
    expect(closed.incident.measure_considered_resolved).toBe("Y");
    expect(closed.marker).toMatch(/^BUNDLE_SEALED:[0-9a-f]{64}$/);
    expect(closed.incident.evidence_refs ?? "").toContain(closed.marker);

    const closedEvents = (await spool()).filter(
      (row) =>
        row.event_type === "incident_closed" &&
        row.payload.incident_code === code,
    );
    expect(closedEvents).toHaveLength(1);
    const attrs = closedEvents[0]?.payload.attrs as JsonObject;
    expect(typeof attrs.mttd_hours).toBe("number");
    expect(typeof attrs.mttr_hours).toBe("number");
    expect(attrs.mttd_hours).toBeCloseTo(10, 6);

    expect(await store.listActiveTimers(code)).toHaveLength(0);
    expect(closed.incident.evidence_refs ?? "").toContain("CLOSE_APPROVED:");
  });

  it("A05: blocks notify with zero recipients, keeps the pack approved and resumes", async () => {
    await removeAllRecipients();

    const intake = await agent.orchestrator.intake(
      scenarioFixture({
        title: "A05 recipient gap walk",
        detectionTime: "11:00:00",
        system: "admissions-portal",
      }),
    );
    const code = intake.incident.incident_code;
    await agent.orchestrator.triage(intake.incident.id);
    await agent.orchestrator.investigate(intake.incident.id);
    const draft = await agent.orchestrator.draftAndReview(intake.incident.id);
    expect(draft.authority_approval_id).not.toBeNull();

    await expect(
      agent.orchestrator.approveAndNotify(intake.incident.id),
    ).rejects.toMatchObject({ code: "NOTIFY_NO_RECIPIENTS" });

    const blocked = await store.getDraftPack(code, "authority");
    expect(blocked?.state).toBe("approved");
    const approvals = await store.listReviewApprovals(code);
    expect(
      approvals.some(
        (row) => row.pack_type === "authority" && row.consumed_at_utc === null,
      ),
    ).toBe(true);

    await ensureRecipient();
    const resumed = await agent.orchestrator.resumeParkedNotifications();
    expect(resumed.length).toBeGreaterThan(0);

    const history = await adapter.getIncidentHistory(intake.incident.id);
    expect(
      history.some(
        (row) =>
          row.event_type === "notified" &&
          (row.recipients_snapshot ?? []).length > 0,
      ),
    ).toBe(true);
  });

  it("A06: parks approved packs for the veto window, vetoes, then auto-sends on expiry", async () => {
    await ensureRecipient();

    const intake = await agent.orchestrator.intake(
      scenarioFixture({
        title: "A06 veto window walk",
        detectionTime: "12:00:00",
        system: "admissions-portal",
      }),
    );
    const code = intake.incident.incident_code;
    await agent.orchestrator.triage(intake.incident.id);
    await agent.orchestrator.investigate(intake.incident.id);
    await agent.orchestrator.draftAndReview(intake.incident.id);

    const parked = await agent.orchestrator.approveAndNotify(
      intake.incident.id,
      { vetoWindowMin: 30 },
    );
    expect(parked.parked).toBe(true);
    expect(parked.notifies).toHaveLength(0);
    expect(parked.parkedUntilUtc).not.toBeNull();

    const beforeVeto = await adapter.getIncidentHistory(intake.incident.id);
    expect(beforeVeto.some((row) => row.event_type === "notified")).toBe(false);

    await agent.orchestrator.veto(
      code,
      "authority",
      "operator-1",
      "unsafe wording",
    );
    const vetoed = await store.getDraftPack(code, "authority");
    expect(vetoed?.state).toBe("draft");
    const vetoIncident = await adapter.getIncident(intake.incident.id);
    expect(vetoIncident.evidence_refs ?? "").toContain(
      "VETOED_BY:operator-1:unsafe wording",
    );

    await agent.orchestrator.draftAndReview(intake.incident.id);
    const reparked = await agent.orchestrator.approveAndNotify(
      intake.incident.id,
      { vetoWindowMin: 30 },
    );
    expect(reparked.parked).toBe(true);

    const sent = await agent.orchestrator.processVetoExpiry(
      new Date(now.getTime() + 31 * 60_000),
    );
    expect(sent).toBeGreaterThan(0);

    const afterExpiry = await adapter.getIncident(intake.incident.id);
    expect(afterExpiry.evidence_refs ?? "").toContain("VETO_WINDOW_EXPIRED");
    const history = await adapter.getIncidentHistory(intake.incident.id);
    expect(history.some((row) => row.event_type === "notified")).toBe(true);
  });

  it("A07: reopens a closed incident on new evidence and revokes old approvals", async () => {
    await ensureRecipient();

    const intake = await agent.orchestrator.intake(
      scenarioFixture({
        title: "A07 reopen walk",
        detectionTime: "13:00:00",
        system: "admissions-portal",
      }),
    );
    const code = intake.incident.incident_code;
    await agent.orchestrator.triage(intake.incident.id);
    await agent.orchestrator.investigate(intake.incident.id);
    await agent.orchestrator.draftAndReview(intake.incident.id);
    await agent.orchestrator.approveAndNotify(intake.incident.id);
    const closed = await agent.orchestrator.close(intake.incident.id);
    expect(closed.incident.status).toBe("C");
    expect((await store.listReviewApprovals(code)).length).toBeGreaterThan(0);

    const bytes = Buffer.from("post-close forensic note", "utf8");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await store.stageAttachment(
      config.PIMS_SCHEMA,
      code,
      "post-close.txt",
      bytes,
      "text/plain",
      "investigator",
      null,
    );

    const upload = await callTool("investigator", "pims_upload_attachment", {
      incident_id: intake.incident.id,
      bytes_ref: sha256,
      file_name: "post-close.txt",
      mime: "text/plain",
    });
    const attachmentId = upload.attachment_id;
    expect(typeof attachmentId).toBe("number");

    const monitored = await agent.orchestrator.monitor(intake.incident.id);
    expect(monitored.newAttachments).toBeGreaterThan(0);
    expect(monitored.closed).toBe(false);

    const reopened = await adapter.getIncident(intake.incident.id);
    expect(reopened.status).toBe("P");
    expect(reopened.evidence_refs ?? "").toContain(`REOPENED:${attachmentId}`);
    expect(await store.listReviewApprovals(code)).toHaveLength(0);
    expect(await store.getAgentState(`REOPEN_BASELINE:${code}`)).not.toBeNull();
  });

  it("A04: runs the security-incident path with no Art 33/34 packs", async () => {
    await ensureRecipient();

    const intake = await agent.orchestrator.intake(NON_PII_FIXTURE);
    const code = intake.incident.incident_code;
    expect(intake.incident.involves_personal_data).toBe(false);

    const timers = await store.listActiveTimers(code);
    expect(timers.some((timer) => timer.timer_type === "T72_AUTHORITY")).toBe(
      false,
    );
    expect(timers.some((timer) => timer.timer_type === "T_PERU_ADVISORY")).toBe(
      true,
    );

    await agent.orchestrator.triage(intake.incident.id);
    const investigation = await agent.orchestrator.investigate(
      intake.incident.id,
    );
    expect(investigation.riskSignal).toBeNull();
    expect(investigation.auditLink).toBeNull();
    const incident = await adapter.getIncident(intake.incident.id);
    expect(incident.evidence_refs ?? "").toContain("systemic:false");
    expect(incident.evidence_refs ?? "").toContain(
      "audit_link_skipped:not_qualifying",
    );

    const draft = await agent.orchestrator.draftAndReview(intake.incident.id);
    expect(draft.authority_pack_id).toBeNull();
    expect(draft.high_risk_gate.verdict).toBe(false);
    const subject = await store.getDraftPack(code, "subject");
    expect(subject?.state).toBe("not_required");
    const subjectPayload = subject?.payload as JsonObject;
    expect(subjectPayload.state).toBe("not_required");
    expect(await store.getDraftPack(code, "authority")).toBeNull();

    const notify = await agent.orchestrator.approveAndNotify(
      intake.incident.id,
    );
    expect(notify.notifies).toHaveLength(0);

    const closed = await agent.orchestrator.close(intake.incident.id);
    expect(closed.incident.status).toBe("C");
    expect(closed.marker).toMatch(/^BUNDLE_SEALED:[0-9a-f]{64}$/);
  });

  it("stamps the tool ledger for every executed tool", async () => {
    const page = await adapter.listIncidents({});
    const code = page.results[0]?.incident_code;
    if (code === undefined) {
      throw new Error("no incidents created");
    }
    const ledger = await store.listToolLedger(code);
    expect(ledger.length).toBeGreaterThan(0);
    for (const entry of ledger) {
      expect(entry.idempotency_key.length).toBeGreaterThan(0);
      expect(entry.result_ref).toContain(":");
    }
  });

  it("reviewer: blocks approval on a high-severity model challenge", async () => {
    const incident = await freshReviewIncident("Reviewer high challenge");
    reviewChallengePayload = {
      challenges: [
        {
          target: "item_a_nature",
          challenge: "Nature omits the storage location",
          severity: "high",
          evidence_required: "Hosting location evidence",
        },
      ],
    };

    const result = await agent.reviewer.review(
      {
        incident_code: incident.incident_code,
        pack_type: "authority",
        content_sha256: "a".repeat(64),
        body_text:
          "We detected a breach and notified the supervisory authority.",
        citations: [authorityCitation],
        numeric_approvals: [],
        plain_language_waiver: null,
        checklist: null,
      },
      incident,
    );

    expect(result.approved).toBe(false);
    expect(result.rejection?.item).toBe("item_a_nature");
    expect(result.challenges[0]?.severity).toBe("high");
  });

  it("reviewer: rejects a malformed challenge response instead of approving", async () => {
    const incident = await freshReviewIncident("Reviewer malformed challenge");
    reviewChallengePayload = {};

    await expect(
      agent.reviewer.review(
        {
          incident_code: incident.incident_code,
          pack_type: "authority",
          content_sha256: "a".repeat(64),
          body_text:
            "We detected a breach and notified the supervisory authority.",
          citations: [authorityCitation],
          numeric_approvals: [],
          plain_language_waiver: null,
          checklist: null,
        },
        incident,
      ),
    ).rejects.toBeInstanceOf(ModelSchemaViolationError);
  });

  it("reviewer: rejects unredacted PII without echoing the value", async () => {
    const incident = await freshReviewIncident("Reviewer pii leakage");
    reviewChallengePayload = { challenges: [] };

    const result = await agent.reviewer.review(
      {
        incident_code: incident.incident_code,
        pack_type: "authority",
        content_sha256: "a".repeat(64),
        body_text: "We emailed the applicant at juan@example.test.",
        citations: [authorityCitation],
        numeric_approvals: [],
        plain_language_waiver: null,
        checklist: null,
      },
      incident,
    );

    expect(result.approved).toBe(false);
    expect(result.rejection?.item).toBe("pii_leakage");
    expect(result.rejection?.required_fix).not.toContain("juan@example.test");
  });

  it("reviewer: rejects an authority pack without DPO contact data", async () => {
    const incident = {
      ...(await freshReviewIncident("Reviewer dpo gap")),
      dpo_contact_name: null,
    };
    reviewChallengePayload = { challenges: [] };

    const result = await agent.reviewer.review(
      {
        incident_code: incident.incident_code,
        pack_type: "authority",
        content_sha256: "a".repeat(64),
        body_text:
          "We detected a breach and notified the supervisory authority.",
        citations: [authorityCitation],
        numeric_approvals: [],
        plain_language_waiver: null,
        checklist: null,
      },
      incident,
    );

    expect(result.approved).toBe(false);
    expect(result.rejection?.item).toBe("dpo_contact_name");
  });

  it("reviewer: rejects a resolution without the full close checklist", async () => {
    const incident = await freshReviewIncident("Reviewer checklist gap");
    reviewChallengePayload = { challenges: [] };

    const result = await agent.reviewer.reviewResolution(
      {
        incident_code: incident.incident_code,
        pack_type: "resolution",
        content_sha256: "a".repeat(64),
        body_text: "",
        citations: [],
        numeric_approvals: [],
        plain_language_waiver: null,
        checklist: ["analysis_action"],
      },
      incident,
    );

    expect(result.approved).toBe(false);
    expect(result.rejection?.item).toBe("resolution_action_or_considered");
  });

  it("reviewer: enforces plain language on a resolution with a full checklist", async () => {
    const incident = await freshReviewIncident("Reviewer plain language");
    reviewChallengePayload = { challenges: [] };

    const result = await agent.reviewer.reviewResolution(
      {
        incident_code: incident.incident_code,
        pack_type: "resolution",
        content_sha256: "a".repeat(64),
        body_text:
          "We have reviewed every action taken during this incident and we confirm that all containment measures remain in place across every affected production system and every related backup system without exception.",
        citations: [],
        numeric_approvals: [],
        plain_language_waiver: null,
        checklist: [...CLOSE_CHECKLIST_ITEMS],
      },
      incident,
    );

    expect(result.approved).toBe(false);
    expect(result.rejection?.item).toBe("PLAIN_LANGUAGE_VIOLATION");
  });
});
