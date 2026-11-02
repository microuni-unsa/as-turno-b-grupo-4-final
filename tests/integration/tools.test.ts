import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentModelClient,
  CloseChecklistVerifier,
  createIncidentToolHandlers,
  createKnowledgeToolHandlers,
  createNoticeToolHandlers,
  createRiskAuditToolHandlers,
  DeadlineScheduler,
  IndicatorEmitter,
  type RoleCapabilityHandle,
  RoleRegistry,
  type TimerEffects,
  ToolRegistry,
} from "@pims/agent";
import { readMarkers } from "@pims/agent/lifecycle/markers.ts";
import type {
  ToolCallContext,
  ToolHandler,
} from "@pims/agent/tools/registry.ts";
import type { AgentConfig } from "@pims/config";
import { BundleSealer } from "@pims/evidence/bundle-sealer.ts";
import { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { OpenAIModelProvider } from "@pims/models";
import { PimsAdapter } from "@pims/pims-adapter";
import {
  createMockDatabase,
  createPimsTestServer,
  type MockDatabaseClient,
  type PimsTestServerInstance,
} from "@pims/pims-mock";
import { RAGService, RagIndexer } from "@pims/rag";
import type { AgentRole, ToolName } from "@pims/types/agent.ts";
import { PIMS_TEST_SEED_PASSWORD } from "@pims/types/constants.ts";
import type { TimerRecord } from "@pims/types/evidence.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { AuthorityNoticePack } from "@pims/types/notices.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { generateSpanAwareEmbedding } from "@tests/helpers/span-geometry.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_CONFIG = {
  PIMS_SCHEMA: "unsa",
  IDEMPOTENCY_KEY_PREFIX: "agi1",
  CORRECTIVE_DEFAULT_DUE_DAYS: 30,
  RAG_TOP_K: 5,
  RAG_RERANK_K: 3,
  RAG_MIN_SCORE: 0.5,
  RAG_TIMEOUT_MS: 5000,
  INDICATOR_SPOOL_MAX: 1000,
  SCHEDULER_MAX_TIMERS: 1000,
} as unknown as AgentConfig;

const CLOCK_NOW = new Date("2026-10-02T12:00:00.000Z");

function baseIncidentArgs(overrides: JsonObject = {}): JsonObject {
  return {
    title: "Tools integration incident",
    description: "Synthetic incident used to exercise agent tools",
    involves_personal_data: true,
    incident_date: "2026-10-01",
    incident_type: "OT",
    status: "O",
    affected_data_types: ["email"],
    security_measures_adopted: [],
    affected_cid: [],
    ...overrides,
  };
}

function authorityPack(
  incidentCode: string,
  packId: string,
): AuthorityNoticePack {
  return {
    pack: "authority",
    pack_id: packId,
    incident_code: incidentCode,
    jurisdiction: "EU_GDPR",
    awareness_at_utc: "2026-10-02T10:00:00.000Z",
    deadline_at_utc: "2026-10-05T10:00:00.000Z",
    submitted_at_utc: null,
    delay_reasons: null,
    phased: false,
    phases_planned: 1,
    item_a_nature: "Unauthorised access to an admissions database",
    item_a_categories_subjects: ["applicants"],
    item_a_approx_subjects: 120,
    item_a_categories_records: ["identity", "contact"],
    item_a_approx_records: 120,
    item_a_unknown: [],
    item_b_dpo: {
      name: "DPO Office",
      email: "dpo@example.test",
      phone: null,
    },
    item_c_consequences: "Potential identity misuse",
    item_d_measures_taken: ["Credentials rotated"],
    item_d_measures_proposed: ["Monitoring of exposed accounts"],
    citations: ["gdpr:art33.3:1-2"],
    review_approval_id: null,
    state: "approved",
  };
}

function sha256Of(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

describe("Agent Tool Registry integration suite", {
  timeout: 240_000,
}, () => {
  let container: StartedPostgreSqlContainer;
  let dbClient: MockDatabaseClient;
  let serverInstance: PimsTestServerInstance;
  let adapter: PimsAdapter;
  let store: EvidenceStore;
  let roles: RoleRegistry;
  let registry: ToolRegistry;
  let storageDir: string;
  let pageAlerts: Array<{ incident_code: string; kind: string }>;

  async function call(
    role: AgentRole,
    tool: string,
    args: JsonObject,
    ctx?: ToolCallContext,
  ): Promise<JsonObject> {
    return registry.execute(
      roles.createCapabilityHandle(role),
      tool,
      args,
      ctx,
    );
  }

  async function createIncident(
    overrides: JsonObject = {},
  ): Promise<PimsIncident> {
    const created = await call(
      "intake",
      "pims_create_incident",
      baseIncidentArgs(overrides),
    );
    return created.incident as unknown as PimsIncident;
  }

  async function armTestTimer(incidentCode: string): Promise<void> {
    const timer: TimerRecord = {
      timer_id: `timer:${incidentCode}:T72_AUTHORITY:test`,
      incident_code: incidentCode,
      timer_type: "T72_AUTHORITY",
      fire_at_utc: "2026-10-04T12:00:00.000Z",
      payload: {},
      fired: false,
      cancelled_reason: null,
    };
    await store.armTimer(timer);
  }

  beforeAll(async () => {
    const projectRoot = process.cwd();
    const dumpPath = path.resolve(
      projectRoot,
      "data/gestitel_base_de_datos.sql",
    );
    const seedPath = path.resolve(projectRoot, "data/02-init-unsa-seed.sql");

    container = await new PostgreSqlContainer("postgres:16-alpine")
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
    serverInstance = await createPimsTestServer(dbClient, {
      nestedActionMode: "replace",
    });
    adapter = new PimsAdapter({
      baseUrl: serverInstance.url,
      schema: "unsa",
      username: "admin",
      password: PIMS_TEST_SEED_PASSWORD,
      timeoutMs: 15_000,
    });

    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "pims-tools-"));
    store = new EvidenceStore({
      connectionUri: container.getConnectionUri(),
      keyHex: "a".repeat(64),
      baseStorageDir: storageDir,
    });
    await store.init();

    const modelConfig = {
      provider: "openai",
      model: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      auth_env: "OPENAI_API_KEY",
      timeout_ms: 20_000,
      max_retries: 3,
      fallback: "none" as const,
    };
    const provider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: "gpt-4o-mini" },
      visionConfig: modelConfig,
      embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
      rerankerConfig: { ...modelConfig, model: "gpt-4o-mini" },
      apiKey: "tools-integration-key",
      baseURL: "https://api.openai.com/v1",
    });

    vi.spyOn(provider, "embed").mockImplementation(async ({ texts }) => ({
      vectors: texts.map((text) => generateSpanAwareEmbedding(text)),
    }));
    vi.spyOn(provider, "chat_json").mockImplementation(async () => ({
      content: { ok: true },
      citations_requested: false,
    }));
    vi.spyOn(provider, "rerank").mockImplementation(async () => ({
      ranked: [],
    }));

    const modelClient = new AgentModelClient(provider);
    const indexer = new RagIndexer({ modelProvider: provider });
    await indexer.indexCorpus(
      [
        {
          chunk_id: "chunk-1",
          doc_id: "gdpr",
          article_or_clause: "Article 33(3)",
          lines: "1-2",
          text: "The notification shall describe the nature of the personal data breach.",
          normative: true,
          header: "Article 33(3)",
          token_count: 12,
        },
      ],
      "tools-test-v1",
    );
    const ragService = new RAGService({
      modelProvider: provider,
      indexer,
      config: TEST_CONFIG,
    });

    const bundleSealer = new BundleSealer(store);
    const clock = () => CLOCK_NOW;
    const closeChecklist = new CloseChecklistVerifier({
      evidenceStore: store,
      adapter,
      clock,
    });
    const indicator = new IndicatorEmitter({
      store,
      config: TEST_CONFIG,
      clock,
    });
    const effects: TimerEffects = {
      authorityDeadline: async () => "satisfied",
      processorDeadline: async () => "satisfied",
      subjectDeadline: async () => "satisfied",
      reviewDeadline: async () => "satisfied",
      peruAdvisory: async () => undefined,
      phaseFollowup: async () => undefined,
      retry: async () => undefined,
    };
    pageAlerts = [];
    const scheduler = new DeadlineScheduler({
      store,
      config: TEST_CONFIG,
      clock,
      effects,
      page: (alert) => {
        pageAlerts.push({
          incident_code: alert.incident_code,
          kind: alert.kind,
        });
      },
    });

    roles = new RoleRegistry();
    const deps = {
      adapter,
      evidenceStore: store,
      bundleSealer,
      closeChecklist,
      ragService,
      modelClient,
      scheduler,
      indicator,
      config: TEST_CONFIG,
      clock,
      roleRegistry: roles,
    };

    const handlers: Partial<Record<ToolName, ToolHandler>> = {
      ...createIncidentToolHandlers(deps),
      ...createNoticeToolHandlers(deps),
      ...createRiskAuditToolHandlers(deps),
      ...createKnowledgeToolHandlers(deps),
    };
    registry = new ToolRegistry(
      deps,
      handlers as Record<ToolName, ToolHandler>,
    );
  }, 240_000);

  afterAll(async () => {
    if (store) {
      await store.sql.end();
    }
    if (serverInstance) {
      await serverInstance.stop();
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
  }, 120_000);

  it("rejects unknown tool names", async () => {
    await expect(call("triage", "does_not_exist", {})).rejects.toMatchObject({
      code: "TOOL_UNKNOWN:does_not_exist",
    });
  });

  it("rejects invalid tool arguments with the offending field", async () => {
    await expect(
      call("triage", "pims_get_incident", { id: "x" }),
    ).rejects.toMatchObject({
      code: "TOOL_ARGS_INVALID:pims_get_incident:id",
    });
  });

  it("enforces the role tool matrix", async () => {
    const incident = await createIncident();

    await expect(
      call("investigator", "pims_notify", {
        incident_id: incident.id,
        pack_id: crypto.randomUUID(),
        review_approval_id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "ROLE_TOOL_DENIED:investigator:pims_notify",
    });

    await expect(
      call("intake", "pims_transition_status", {
        id: incident.id,
        to: "P",
        reason: "intake cannot transition",
      }),
    ).rejects.toMatchObject({
      code: "ROLE_TOOL_DENIED:intake:pims_transition_status",
    });

    await expect(call("orchestrator", "pims_login", {})).rejects.toMatchObject({
      code: "ROLE_TOOL_DENIED:orchestrator:pims_login",
    });
  });

  it("rejects a capability handle whose prompt hash was tampered with", async () => {
    const incident = await createIncident();
    const handle: RoleCapabilityHandle = roles.createCapabilityHandle("triage");
    handle.promptSha256 = "0".repeat(64);

    await expect(
      registry.execute(handle, "pims_get_incident", { id: incident.id }),
    ).rejects.toMatchObject({
      code: "ROLE_TOOL_DENIED:triage:pims_get_incident",
    });
  });

  it("applies role patch policies field by field", async () => {
    const incident = await createIncident();

    const renamed = await call("triage", "pims_update_incident", {
      id: incident.id,
      patch: { title: "Triage-owned title" },
    });
    expect(renamed.title).toBe("Triage-owned title");

    await expect(
      call("triage", "pims_update_incident", {
        id: incident.id,
        patch: { status: "P" },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_ARGS_INVALID:pims_update_incident:forbidden_field:status",
    });

    await expect(
      call("triage", "pims_update_incident", {
        id: incident.id,
        patch: { resolved_date: "2026-10-02" },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_ARGS_INVALID:pims_update_incident:forbidden_field:resolved_date",
    });

    const reported = await call("notifier", "pims_update_incident", {
      id: incident.id,
      patch: { measure_reported_authorities: "Y" },
    });
    expect(reported.measure_reported_authorities).toBe("Y");

    await expect(
      call("notifier", "pims_update_incident", {
        id: incident.id,
        patch: { title: "notifier may not rename" },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_ARGS_INVALID:pims_update_incident:forbidden_field:title",
    });

    const resolved = await call("monitor", "pims_update_incident", {
      id: incident.id,
      patch: { resolved_date: "2026-10-02" },
    });
    expect(resolved.resolved_date).toBe("2026-10-02");
  });

  it("guards status transitions and requires classification plus an armed timer", async () => {
    const incident = await createIncident();

    await expect(
      call("triage", "pims_transition_status", {
        id: incident.id,
        to: "P",
        reason: "classification incomplete",
      }),
    ).rejects.toMatchObject({
      code: "TRANSITION_FORBIDDEN:O->P",
    });

    await armTestTimer(incident.incident_code);
    await call("triage", "pims_update_incident", {
      id: incident.id,
      patch: { severity: "H", impact: "H" },
    });

    const progressed = await call("triage", "pims_transition_status", {
      id: incident.id,
      to: "P",
      reason: "triage complete",
    });
    expect(progressed.status).toBe("P");

    await expect(
      call("triage", "pims_transition_status", {
        id: incident.id,
        to: "C",
        reason: "triage cannot close",
      }),
    ).rejects.toMatchObject({
      code: "TRANSITION_FORBIDDEN:P->C",
    });

    const openIncident = await createIncident();
    await expect(
      call("monitor", "pims_transition_status", {
        id: openIncident.id,
        to: "C",
        reason: "cannot skip triage",
      }),
    ).rejects.toMatchObject({
      code: "TRANSITION_FORBIDDEN:O->C",
    });
  });

  it("enforces action sequencing and single-use resolution approvals", async () => {
    const incident = await createIncident();
    await armTestTimer(incident.incident_code);
    await call("triage", "pims_update_incident", {
      id: incident.id,
      patch: { severity: "H", impact: "H" },
    });
    await call("triage", "pims_transition_status", {
      id: incident.id,
      to: "P",
      reason: "ready for investigation",
    });

    await expect(
      call("investigator", "pims_add_action", {
        incident_id: incident.id,
        action_type: "R",
        description: "premature resolution",
        responsible: "analyst",
      }),
    ).rejects.toMatchObject({ code: "ACTION_SEQUENCE_VIOLATION" });

    await call("investigator", "pims_add_action", {
      incident_id: incident.id,
      action_type: "A",
      description: "root cause analysis",
      responsible: "analyst",
      evidence: "tot:posterior=0.81",
    });

    await expect(
      call("investigator", "pims_add_action", {
        incident_id: incident.id,
        action_type: "C",
        description: "containment after analysis",
        responsible: "analyst",
      }),
    ).rejects.toMatchObject({ code: "ACTION_SEQUENCE_VIOLATION" });

    await expect(
      call("investigator", "pims_add_action", {
        incident_id: incident.id,
        action_type: "R",
        description: "resolution without approval",
        responsible: "analyst",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_APPROVAL_MISSING" });

    const contentSha = sha256Of({ resolution: incident.incident_code });
    const approval = await store.mintReviewApproval({
      incidentCode: incident.incident_code,
      packType: "resolution",
      contentSha256: contentSha,
      note: "tools integration resolution",
    });

    const resolved = await call("investigator", "pims_add_action", {
      incident_id: incident.id,
      action_type: "R",
      description: "resolution once approved",
      responsible: "analyst",
      review_approval_id: approval.approval_id,
    });
    const resolvedIncident = resolved.incident as unknown as PimsIncident;
    expect(resolvedIncident.actions?.at(-1)?.action_type).toBe("R");

    const afterResolution = await adapter.getIncident(incident.id);
    await store.setAgentState(`REOPEN_BASELINE:${incident.incident_code}`, {
      action_count: afterResolution.actions?.length ?? 0,
      at_utc: CLOCK_NOW.toISOString(),
    });
    await call("investigator", "pims_add_action", {
      incident_id: incident.id,
      action_type: "A",
      description: "post-reopen analysis",
      responsible: "analyst",
    });

    await expect(
      call("investigator", "pims_add_action", {
        incident_id: incident.id,
        action_type: "R",
        description: "reuse the same approval",
        responsible: "analyst",
        review_approval_id: approval.approval_id,
      }),
    ).rejects.toMatchObject({ code: "REVIEW_APPROVAL_REUSED" });
  });

  it("verifies attachment hashes before and after upload", async () => {
    const incident = await createIncident();
    const bytes = Buffer.from("forensic evidence payload", "utf8");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await store.stageAttachment(
      "unsa",
      incident.incident_code,
      "evidence.txt",
      bytes,
      "text/plain",
      "test",
      null,
    );

    await expect(
      call("investigator", "pims_upload_attachment", {
        incident_id: incident.id,
        bytes_ref: "0".repeat(64),
        file_name: "evidence.txt",
        mime: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_HASH_MISMATCH" });

    const downloadSpy = vi
      .spyOn(adapter, "downloadAttachment")
      .mockResolvedValueOnce(bytes);
    const uploaded = await call("investigator", "pims_upload_attachment", {
      incident_id: incident.id,
      bytes_ref: sha256,
      file_name: "evidence.txt",
      mime: "text/plain",
    });
    downloadSpy.mockRestore();
    expect(uploaded.sha256).toBe(sha256);
    expect(uploaded.sha256).toMatch(/^[0-9a-f]{64}$/);

    const staged = await store.listStagedAttachments(incident.incident_code);
    const row = staged.find((entry) => entry.file_name === "evidence.txt");
    expect(row?.pims_attachment_id).toBeGreaterThan(0);
    expect(row?.pims_attachment_id).toBe(uploaded.attachment_id);
  });

  it("blocks notification without recipients and consumes a valid approval once", async () => {
    const incident = await createIncident();
    const pack = authorityPack(incident.incident_code, crypto.randomUUID());
    const contentSha = sha256Of(pack);
    const approval = await store.mintReviewApproval({
      incidentCode: incident.incident_code,
      packType: "authority",
      contentSha256: contentSha,
      note: "tools integration authority",
    });
    await store.saveDraftPack(
      incident.incident_code,
      "authority",
      pack,
      contentSha,
      approval.approval_id,
      "approved",
    );

    await expect(
      call(
        "notifier",
        "pims_notify",
        {
          incident_id: incident.id,
          pack_id: pack.pack_id,
          review_approval_id: approval.approval_id,
        },
        { incidentId: incident.id, incidentCode: incident.incident_code },
      ),
    ).rejects.toMatchObject({ code: "NOTIFY_NO_RECIPIENTS" });

    const remaining = await store.getDraftPack(
      incident.incident_code,
      "authority",
    );
    expect(remaining?.state).toBe("approved");

    const recipient = await call(
      "orchestrator",
      "pims_manage_recipient",
      {
        op: "create",
        email: "dpo@example.test",
        label: "DPO",
        operator_jwt_sub: "test-op",
      },
      { operatorJwtSub: "test-op" },
    );
    expect(recipient.email).toBe("dpo@example.test");

    const notified = await call(
      "notifier",
      "pims_notify",
      {
        incident_id: incident.id,
        pack_id: pack.pack_id,
        review_approval_id: approval.approval_id,
      },
      { incidentId: incident.id, incidentCode: incident.incident_code },
    );
    const snapshot = notified.recipients_snapshot as unknown as string[];
    expect(snapshot).toContain("dpo@example.test");

    const sent = await store.getDraftPack(incident.incident_code, "authority");
    expect(sent?.state).toBe("sent");

    const mismatchedIncident = await createIncident({
      title: "Hash mismatch incident",
    });
    const mismatchPack = authorityPack(
      mismatchedIncident.incident_code,
      crypto.randomUUID(),
    );
    const mismatchSha = sha256Of(mismatchPack);
    const mismatchApproval = await store.mintReviewApproval({
      incidentCode: mismatchedIncident.incident_code,
      packType: "authority",
      contentSha256: sha256Of({ wrong: true }),
      note: "intentionally mismatched",
    });
    await store.saveDraftPack(
      mismatchedIncident.incident_code,
      "authority",
      mismatchPack,
      mismatchSha,
      mismatchApproval.approval_id,
      "approved",
    );

    await expect(
      call(
        "notifier",
        "pims_notify",
        {
          incident_id: mismatchedIncident.id,
          pack_id: mismatchPack.pack_id,
          review_approval_id: mismatchApproval.approval_id,
        },
        {
          incidentId: mismatchedIncident.id,
          incidentCode: mismatchedIncident.incident_code,
        },
      ),
    ).rejects.toMatchObject({ code: "REVIEW_APPROVAL_INVALID" });
  });

  it("creates risk evaluations and queues signals when no asset matches", async () => {
    const incident = await createIncident({
      title: "Risk signal incident",
      compromised_system: "AST-001",
    });

    const created = await call(
      "investigator",
      "pims_emit_risk_signal",
      {
        description: "Risk signal from INC risk tool test",
        controlled_probability: 2,
        controlled_impact: 3,
        threat_code: "TH10",
        vulnerability_code: "VN03",
      },
      { incidentId: incident.id, incidentCode: incident.incident_code },
    );
    expect(created.risk_id).toBeGreaterThan(0);
    expect(created.period_name).toBe("Periodo inicial");
    expect(typeof created.risk_code).toBe("string");

    const orphanIncident = await createIncident({
      title: "No asset match incident",
      compromised_system: "unmatched-system-xyz",
    });

    await expect(
      call(
        "investigator",
        "pims_emit_risk_signal",
        {
          description: "Signal without a matching asset",
          controlled_probability: 2,
          controlled_impact: 2,
        },
        {
          incidentId: orphanIncident.id,
          incidentCode: orphanIncident.incident_code,
        },
      ),
    ).rejects.toMatchObject({ code: "RISK_SIGNAL_NO_ASSET" });

    const queued = await store.listQueuedRiskSignals(
      orphanIncident.incident_code,
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.signal_payload.asset_pending).toBe(true);
    expect(queued[0]?.signal_payload.reason).toBe("RISK_SIGNAL_NO_ASSET");
  });

  it("reuses a single corrective-action finding on repeated audit links", async () => {
    const incident = await createIncident({
      title: "Audit link incident",
      severity: "H",
      impact: "H",
    });
    const ctx: ToolCallContext = {
      incidentId: incident.id,
      incidentCode: incident.incident_code,
    };
    const args: JsonObject = {
      action_plan: "Patch the admissions portal and rotate credentials",
      responsible: "security-team",
      source_requirement_code: "A.3.12",
      finding_description: `10.2 corrective action for ${incident.incident_code}: exposure`,
    };

    const first = await call(
      "investigator",
      "pims_create_audit_action",
      args,
      ctx,
    );
    const second = await call(
      "investigator",
      "pims_create_audit_action",
      args,
      ctx,
    );
    expect(second.audit_id).toBe(first.audit_id);

    const audits = await adapter.listAudits();
    const audit = audits.results.find(
      (candidate) => candidate.id === first.audit_id,
    );
    const prefix = `10.2 corrective action for ${incident.incident_code}`;
    const matching = (audit?.findings ?? []).filter((finding) =>
      finding.description.startsWith(prefix),
    );
    expect(matching).toHaveLength(1);

    const updated = await adapter.getIncident(incident.id);
    const markers = readMarkers(updated.evidence_refs).filter((marker) =>
      marker.startsWith("AUDIT_LINK:"),
    );
    expect(markers).toHaveLength(2);
    expect(markers[0]).toBe(
      `AUDIT_LINK:${first.audit_id}:${first.finding_id}:${first.action_plan_id}`,
    );
    expect(markers[1]).toBe(
      `AUDIT_LINK:${second.audit_id}:${second.finding_id}:${second.action_plan_id}`,
    );
    expect(matching[0]?.actions).toHaveLength(2);
  });
});
