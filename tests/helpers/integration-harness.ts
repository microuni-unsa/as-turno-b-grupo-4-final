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
import { PIMS_TEST_SEED_PASSWORD } from "@pims/types/constants.ts";
import type { JsonObject, RankedPassage } from "@pims/types/models.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  buildGdprTextAxes,
  generateSpanAwareEmbedding,
} from "@tests/helpers/span-geometry.ts";
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
    compromised_system: "admissions-portal",
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
}): Promise<IntegrationHarness> {
  const projectRoot = process.cwd();
  const now = new Date("2026-10-01T20:00:00.000Z");
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withBindMounts([
      {
        source: path.resolve(projectRoot, "data/gestitel_base_de_datos.sql"),
        target: "/docker-entrypoint-initdb.d/01-gestitel.sql",
        mode: "ro",
      },
      {
        source: path.resolve(projectRoot, "data/02-init-unsa-seed.sql"),
        target: "/docker-entrypoint-initdb.d/02-seed.sql",
        mode: "ro",
      },
    ])
    .start();

  const dbClient = createMockDatabase(container.getConnectionUri());
  const server = await createPimsTestServer(dbClient, {
    nestedActionMode: "replace",
  });
  await dbClient.sql.unsafe(
    "UPDATE unsa.core_asset SET name='admissions-portal' WHERE id=1;",
  );

  const adapter = new PimsAdapter({
    baseUrl: server.url,
    schema: "unsa",
    username: "admin",
    password: PIMS_TEST_SEED_PASSWORD,
    timeoutMs: 15000,
  });

  const storageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pims-integration-"),
  );
  const store = new EvidenceStore({
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
  const provider = new OpenAIModelProvider({
    reasoningConfig: modelConfig,
    fastConfig: { ...modelConfig, model: "gpt-4o-mini" },
    visionConfig: modelConfig,
    embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
    rerankerConfig: { ...modelConfig, model: "gpt-4o-mini" },
    apiKey: "integration-test-key",
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
  const authorityCitation = `${authorityChunk.doc_id}:${authorityChunk.chunk_id}:${authorityChunk.lines}`;

  const events = new AgentEventEmitter();
  const ragService = new RAGService({
    modelProvider: provider,
    indexer,
    config: {
      RAG_TOP_K: 24,
      RAG_RERANK_K: 6,
      RAG_MIN_SCORE: 0.35,
      RAG_TIMEOUT_MS: 30000,
    } as unknown as AgentConfig,
    onRetrieval: async (record) => {
      await store.saveRagRetrieval(record);
      events.emit({ type: "rag:retrieval", ...record });
    },
  });

  vi.spyOn(provider, "chat_json").mockImplementation(async (args) => {
    const prompt = args.messages[0]?.content ?? "";
    const isNonPii = prompt.includes("Port scan");
    const custom = options?.chatHandler?.(args, {
      authorityCitation,
      isNonPii,
    });
    if (custom !== null && custom !== undefined) {
      return respond(custom);
    }

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
      return respond({ challenges: [] });
    }
    throw new Error(
      `Unrouted chat_json system prompt: ${args.system.slice(0, 60)}`,
    );
  });

  const config = loadConfig({
    PIMS_BASE_URL: server.url,
    PIMS_SCHEMA: "unsa",
    PIMS_USERNAME: "admin",
    PIMS_PASSWORD: PIMS_TEST_SEED_PASSWORD,
    EVIDENCE_DB_URL: container.getConnectionUri(),
    OPENAI_API_KEY: "integration-test-key",
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
    AUTO_NOTIFY: options?.autoNotify === true ? "true" : "false",
    WATCHER_POLL_INTERVAL_MS: "5000",
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
    await container.stop();
    fs.rmSync(storageDir, { recursive: true, force: true });
  };

  return {
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
