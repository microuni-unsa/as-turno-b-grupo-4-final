import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type Agent,
  AgentEventEmitter,
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
import { createStack, type StackHandle } from "@pims/config/stack-def.ts";
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
import {
  type AgentRole,
  type IntakePayload,
  IntakePayloadSchema,
} from "@pims/types/agent.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import type { JsonObject, RankedPassage } from "@pims/types/models.ts";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  buildGdprTextAxes,
  generateSpanAwareEmbedding,
} from "@tests/helpers/span-geometry.ts";
import {
  TEST_ADMISSIONS_PORTAL,
  TEST_DEFAULT_ADMIN,
  TEST_EVIDENCE_KEY_HEX,
  TEST_GPT_4O,
  TEST_GPT_4O_MINI,
  TEST_OPENAI_BASE_URL,
  TEST_PRESIDIO_URL,
  TEST_SCHEMA,
  TEST_TEXT_EMBEDDING_3_SMALL,
} from "@tests/helpers/test-constants.ts";
import { vi } from "vitest";

export interface HarnessChatContext {
  authorityCitation: string;
  isNonPii: boolean;
}

export type HarnessChatHandler = (
  args: Parameters<OpenAIModelProvider["chat_json"]>[0],
  context: HarnessChatContext,
) => JsonObject | null;

export interface IntegrationHarness {
  stack: StackHandle;
  container: StartedPostgreSqlContainer;
  dbClient: MockDatabaseClient;
  server: PimsTestServerInstance;
  adapter: PimsAdapter;
  store: EvidenceStore;
  provider: OpenAIModelProvider;
  agent: Agent;
  config: AgentConfig;
  ragService: RAGService;
  indexer: RagIndexer;
  events: AgentEventEmitter;
  now: Date;
  authorityCitation: string;
  callTool: (
    role: AgentRole,
    tool: string,
    args: JsonObject,
  ) => Promise<JsonObject>;
  stop: () => Promise<void>;
}

export function intakeFixture(
  overrides?: Partial<IntakePayload>,
): IntakePayload {
  return IntakePayloadSchema.parse({
    channel: "form",
    title: "DL breach integration fixture",
    involves_personal_data: true,
    incident_date: "2026-10-01",
    detection_date: "2026-10-01",
    detection_time: "10:00:00",
    incident_type: "DL",
    affected_data_types: ["id_doc", "email"],
    security_measures_adopted: ["encrypt_rest"],
    num_affected_subjects: 500,
    compromised_system: TEST_ADMISSIONS_PORTAL,
    dpo: { name: "DPO Name", email: "dpo@example.test" },
    description: "Integration fixture: exfiltration of admissions records.",
    ...overrides,
  });
}

function respond(content: JsonObject): {
  content: JsonObject;
  citations_requested: boolean;
  semantic_entropy: number;
} {
  return { content, citations_requested: false, semantic_entropy: 0.2 };
}

export async function startIntegrationHarness(options?: {
  autoNotify?: boolean;
  chatHandler?: HarnessChatHandler;
  presidioUrl?: string;
  includePresidio?: boolean;
}): Promise<IntegrationHarness> {
  const projectRoot = process.cwd();
  const now = new Date("2026-10-01T20:00:00.000Z");
  const includePresidio = options?.includePresidio ?? !options?.presidioUrl;
  const stack = createStack({ projectRoot, includePresidio });
  const stackEnv = await stack.up();

  const connectionUri = stackEnv.EVIDENCE_DB_URL;
  if (typeof connectionUri !== "string" || connectionUri.trim().length === 0) {
    throw new Error("EVIDENCE_DB_URL was not populated by microcompose stack");
  }

  const container = {
    getConnectionUri: () => connectionUri,
    stop: async () => {
      await stack.down();
    },
  } as unknown as StartedPostgreSqlContainer;

  const dbClient = createMockDatabase(connectionUri);
  const server = await createPimsTestServer(dbClient, {
    nestedActionMode: "replace",
  });
  await dbClient.sql.unsafe(
    `UPDATE ${TEST_SCHEMA}.core_asset SET name='${TEST_ADMISSIONS_PORTAL}' WHERE id=1;`,
  );

  const adapter = new PimsAdapter({
    baseUrl: server.url,
    schema: TEST_SCHEMA,
    username: TEST_DEFAULT_ADMIN,
    password: CONSTANTS.PIMS_TEST_SEED_PASSWORD,
    timeoutMs: CONSTANTS.DEFAULT_PIMS_TIMEOUT_MS,
  });

  const storageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pims-integration-"),
  );
  const store = new EvidenceStore({
    connectionUri: container.getConnectionUri(),
    keyHex: TEST_EVIDENCE_KEY_HEX,
    baseStorageDir: storageDir,
  });
  await store.init();

  const modelConfig = {
    model: TEST_GPT_4O,
    endpoint: TEST_OPENAI_BASE_URL,
    apiKey: "integration-test-key",
    timeout_ms: 20000,
    max_retries: 0,
  };
  const provider = new OpenAIModelProvider({
    reasoningConfig: modelConfig,
    fastConfig: { ...modelConfig, model: TEST_GPT_4O_MINI },
    visionConfig: modelConfig,
    embeddingsConfig: { ...modelConfig, model: TEST_TEXT_EMBEDDING_3_SMALL },
    rerankerConfig: { ...modelConfig, model: TEST_GPT_4O_MINI },
    defaultApiKey: "integration-test-key",
    defaultBaseURL: TEST_OPENAI_BASE_URL,
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
    source: { type: "local", dirPath: CONSTANTS.DEFAULT_CORPUS_DIR },
  });
  const corpus = await loader.loadAll();
  buildGdprTextAxes(corpus.chunks);

  const indexer = new RagIndexer({
    modelProvider: provider,
    pgClient: dbClient.sql,
  });
  await indexer.indexCorpus(corpus.chunks, corpus.version, 25);

  const allChunks = indexer.getAllChunks();
  const gdprChunk = allChunks.find((chunk) => chunk.doc_id === "gdpr-full");
  if (gdprChunk === undefined) {
    throw new Error("Required 'gdpr-full' chunk not found in corpus index");
  }
  const authorityCitation = `${gdprChunk.doc_id}:${gdprChunk.chunk_id}:${gdprChunk.lines}`;

  const events = new AgentEventEmitter();
  const ragService = new RAGService({
    modelProvider: provider,
    indexer,
    config: {
      RAG_TOP_K: 24,
      RAG_RERANK_K: 6,
      RAG_MIN_SCORE: CONSTANTS.DEFAULT_RAG_MIN_SCORE,
      RAG_TIMEOUT_MS: 30000,
    } as unknown as AgentConfig,
    onRetrieval: async (record) => {
      await store.saveRagRetrieval(record);
      events.emit({ type: "rag:retrieval", ...record });
    },
  });

  vi.spyOn(provider, "chat_json").mockImplementation(async (args) => {
    const firstMessage = args.messages[0];
    if (
      firstMessage === undefined ||
      typeof firstMessage.content !== "string"
    ) {
      throw new Error(
        "chat_json requires at least one message with string content",
      );
    }
    const prompt = firstMessage.content;
    const isNonPii =
      prompt.includes('"involves_personal_data":false') ||
      prompt.includes('"incident_type":"OT"') ||
      prompt.includes("Port scan") ||
      prompt.includes("edge-router");
    const custom = options?.chatHandler?.(args, {
      authorityCitation,
      isNonPii,
    });
    if (custom !== null && custom !== undefined) {
      return respond(custom);
    }

    if (
      args.system.startsWith(TRIAGE_SYSTEM) ||
      args.system.includes("triage classifier")
    ) {
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
    if (
      args.system.startsWith(CONTAINMENT_SYSTEM) ||
      args.system.includes("containment")
    ) {
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
    if (
      args.system.startsWith(B3_12_SYSTEM) ||
      (args.system.includes("breach") && !args.system.includes("You review"))
    ) {
      return respond({
        breach_requiring_response: !isNonPii,
        rationale: isNonPii
          ? "Port scan with no successful logon is a documented non-trigger."
          : "Exfiltration of admissions records is a personal data breach.",
        citations: [authorityCitation],
      });
    }
    if (
      args.system.startsWith(ROOT_CAUSE_SYSTEM) ||
      args.system.includes("root cause")
    ) {
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
    if (
      args.system.startsWith(RISK_CATALOG_SYSTEM) ||
      args.system.includes("threat_code") ||
      args.system.includes("risk catal")
    ) {
      return respond({ threat_code: "TH04", vulnerability_code: null });
    }
    if (
      args.system.startsWith(DRAFT_AUTHORITY_SYSTEM) ||
      args.system.includes("draft a GDPR Article 33") ||
      args.system.includes("notification pack for the supervisory authority")
    ) {
      return respond({
        item_a_nature:
          "Exfiltración de registros de admisiones mediante el endpoint de exportación del portal.",
        item_a_categories_subjects: ["postulantes"],
        item_a_approx_subjects: 500,
        item_a_categories_records: ["identificación", "contacto"],
        item_a_approx_records: 500,
        item_a_unknown: [],
        item_c_consequences:
          "Terceros no autorizados podrían suplantar a postulantes en el proceso de admisión.",
        item_d_measures_taken: [
          "El endpoint de exportación del portal fue deshabilitado y se rotaron credenciales.",
        ],
        item_d_measures_proposed: [
          "La monitorización de salida se extenderá a todas las exportaciones del portal.",
        ],
        citations: [authorityCitation],
      });
    }
    if (
      args.system.startsWith(DRAFT_SUBJECT_SYSTEM) ||
      args.system.includes("draft a GDPR Article 34") ||
      args.system.includes("communication to affected data subjects")
    ) {
      return respond({
        body_plain:
          "Un tercero no autorizado accedió a parte de sus registros de admisión. Detuvimos el acceso y rotamos las credenciales. Por favor esté atento a mensajes sospechosos sobre su postulación.",
        item_c_consequences:
          "Alguien podría intentar suplantarlo durante el proceso de admisión.",
        item_d_measures: [
          "Deshabilitamos el endpoint de exportación afectado.",
          "Rotamos todas las credenciales que podían acceder al mismo.",
        ],
        recommendations: [
          "Reporte cualquier mensaje sospechoso sobre su postulación a la oficina de admisiones.",
        ],
        citations: [authorityCitation],
      });
    }
    // Challenge routing precedes resolution routing: the resolution-challenge
    // system prompt contains the word "resolution" and would otherwise be
    // hijacked by the resolution-draft branch below.
    if (
      args.system.startsWith(REVIEW_CHALLENGE_SYSTEM) ||
      args.system.startsWith(REVIEW_CHALLENGE_AUTHORITY_SYSTEM) ||
      args.system.includes("challenge") ||
      args.system.includes("You review")
    ) {
      return respond({ challenges: [] });
    }
    if (
      args.system.startsWith(RESOLUTION_SYSTEM) ||
      args.system.includes("resolution")
    ) {
      return respond({
        summary:
          "The portal export credential was rotated and the endpoint restricted.",
        remediation:
          "Least-privilege review of every export endpoint and continuous egress monitoring.",
        citations: [authorityCitation],
      });
    }
    throw new Error(
      `Unrouted chat_json system prompt: ${args.system.slice(0, 60)}`,
    );
  });

  const autoNotify =
    options !== undefined && options.autoNotify !== undefined
      ? options.autoNotify
      : CONSTANTS.DEFAULT_AUTO_NOTIFY;
  const presidioUrl =
    options !== undefined && options.presidioUrl !== undefined
      ? options.presidioUrl
      : stackEnv.PRESIDIO_URL !== undefined && stackEnv.PRESIDIO_URL.length > 0
        ? stackEnv.PRESIDIO_URL
        : TEST_PRESIDIO_URL;

  const config = loadConfig({
    PIMS_BASE_URL: server.url,
    PIMS_SCHEMA: TEST_SCHEMA,
    PIMS_USERNAME: TEST_DEFAULT_ADMIN,
    PIMS_PASSWORD: CONSTANTS.PIMS_TEST_SEED_PASSWORD,
    EVIDENCE_DB_URL: container.getConnectionUri(),
    OPENAI_API_KEY: "integration-test-key",
    OPENAI_BASE_URL: TEST_OPENAI_BASE_URL,
    REASONING_MODEL: TEST_GPT_4O,
    FAST_MODEL: TEST_GPT_4O_MINI,
    VISION_MODEL: TEST_GPT_4O,
    EMBEDDINGS_MODEL: TEST_TEXT_EMBEDDING_3_SMALL,
    RERANKER_MODEL: TEST_GPT_4O_MINI,
    EVIDENCE_KEY: TEST_EVIDENCE_KEY_HEX,
    ASSIGNEES: '["analyst-1","analyst-2"]',
    RAG_TOP_K: "24",
    RAG_RERANK_K: "6",
    RAG_MIN_SCORE: `${CONSTANTS.DEFAULT_RAG_MIN_SCORE}`,
    RAG_TIMEOUT_MS: "30000",
    MAX_REVIEW_CYCLES: `${CONSTANTS.MAX_REVIEW_CYCLES}`,
    SCHEDULER_MAX_TIMERS: "100",
    AUTO_NOTIFY: autoNotify ? "true" : "false",
    WATCHER_POLL_INTERVAL_MS: `${CONSTANTS.DEFAULT_WATCHER_POLL_INTERVAL_MS}`,
    PRESIDIO_URL: presidioUrl,
    PRESIDIO_TIMEOUT_MS: `${CONSTANTS.DEFAULT_WATCHER_POLL_INTERVAL_MS}`,
  });

  const agent = await createAgent(
    {
      adapter,
      evidenceStore: store,
      modelProvider: provider,
      ragService,
      config,
      clock: () => now,
      events,
    },
    { runProbes: false },
  );

  const callTool = async (
    role: AgentRole,
    tool: string,
    args: JsonObject,
  ): Promise<JsonObject> =>
    agent.tools.execute(agent.roles.createCapabilityHandle(role), tool, args);

  const stop = async (): Promise<void> => {
    await server.stop();
    await store.close();
    await dbClient.sql.end();
    await stack.down();
    fs.rmSync(storageDir, { recursive: true, force: true });
  };

  return {
    stack,
    container,
    dbClient,
    server,
    adapter,
    store,
    provider,
    agent,
    config,
    ragService,
    indexer,
    events,
    now,
    authorityCitation,
    callTool,
    stop,
  };
}
