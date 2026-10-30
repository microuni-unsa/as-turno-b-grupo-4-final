import fs from "node:fs";
import { decryptSopsFile } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import {
  CorpusLoader,
  NormativeKnowledgeGraph,
  RAGService,
  RagIndexer,
} from "@pims/rag";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface EvalSpec {
  qid: string;
  query: string;
  normative_only: boolean;
  expected_doc_id: string;
  expected_substrings: string[];
}

const EVAL_QUERIES: EvalSpec[] = [
  {
    qid: "Q01",
    query: "Art 33(1) authority deadline and delay rule",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: [
      "without undue delay and, where feasible, not later than 72 hours after having become aware",
      "accompanied by reasons for the delay",
    ],
  },
  {
    qid: "Q02",
    query: "Art 34(2) subject content subset",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: [
      "points (b), (c) and (d) of Article 33(3)",
      "clear and plain language",
    ],
  },
  {
    qid: "Q03",
    query: "Art 34(3)(a) encryption exemption",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: [
      "render the personal data unintelligible",
      "encryption",
    ],
  },
  {
    qid: "Q04",
    query: "B.3.12 breach record elements",
    normative_only: true,
    expected_doc_id: "iso27701",
    expected_substrings: [
      "description of the incident",
      "consequences of the incident",
      "steps taken to resolve",
    ],
  },
  {
    qid: "Q05",
    query: "Art 33(2) processor notification to controller without undue delay",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: ["processor", "controller without undue delay"],
  },
  {
    qid: "Q06",
    query: "Art 33(3) mandatory notification elements to supervisory authority",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: [
      "nature of the personal data breach",
      "categories and approximate number",
    ],
  },
  {
    qid: "Q07",
    query: "Art 33(5) breach documentation and internal register obligation",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: [
      "document any personal data breaches",
      "facts relating",
    ],
  },
  {
    qid: "Q08",
    query: "Art 34(1) high risk communication to data subject mandate",
    normative_only: true,
    expected_doc_id: "gdpr-full",
    expected_substrings: [
      "high risk to the rights and freedoms",
      "communicate the personal data breach",
    ],
  },
  {
    qid: "Q09",
    query: "B.3.11 incident management planning processes and roles",
    normative_only: true,
    expected_doc_id: "iso27701",
    expected_substrings: [
      "plan and prepare for managing information security incidents",
      "processes, roles and responsibilities",
    ],
  },
  {
    qid: "Q10",
    query: "Clause 10.2 nonconformity and corrective action steps",
    normative_only: true,
    expected_doc_id: "iso27701",
    expected_substrings: [
      "react to the nonconformity",
      "evaluate the need for action",
    ],
  },
];

describe("Automated RAG Evaluation Gate (§7.6 Integration Suite)", () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;
  let ragService: RAGService;
  let indexer: RagIndexer;

  beforeAll(async () => {
    // 1. Resolve API Key from env or SOPS credentials
    let apiKey = process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY;
    if (!apiKey && fs.existsSync("credentials.enc.json")) {
      try {
        const creds = decryptSopsFile("credentials.enc.json");
        apiKey = creds.OPENAI_API_KEY || creds.MISTRAL_API_KEY;
      } catch {
        // Fall through to .env
      }
    }
    if (!apiKey && fs.existsSync(".env")) {
      const envText = fs.readFileSync(".env", "utf-8");
      const match = envText.match(/(?:OPENAI_API_KEY|MISTRAL_API_KEY)=(.*)/);
      apiKey = match?.[1]?.trim() ?? envText.trim();
    }
    if (!apiKey) {
      throw new Error("API key required for integration evaluation");
    }

    // 2. Boot pgvector PostgreSQL Container
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    sql = postgres(container.getConnectionUri());

    // 3. Initialize OpenAIModelProvider (configured with Mistral OpenAI-compatible endpoint)
    const endpoint = process.env.OPENAI_BASE_URL || "https://api.mistral.ai/v1";
    const modelConfig = {
      provider: "openai",
      model: "mistral-large-latest",
      endpoint,
      auth_env: "OPENAI_API_KEY",
      timeout_ms: 15000,
      max_retries: 3,
      fallback: "none" as const,
    };

    const modelProvider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: "mistral-small-latest" },
      visionConfig: { ...modelConfig, model: "pixtral-12b-2409" },
      embeddingsConfig: { ...modelConfig, model: "mistral-embed" },
      rerankerConfig: { ...modelConfig, model: "mistral-small-latest" },
      apiKey,
      baseURL: endpoint,
    });

    // 4. Ingest Corpus with CorpusLoader from dedicated corpus/ directory
    const loader = new CorpusLoader({
      source: { type: "local", dirPath: "corpus" },
    });
    const corpus = await loader.loadAll();

    // 5. Index into pgvector + MiniSearch BM25 with batchSize 50
    indexer = new RagIndexer({
      modelProvider,
      pgClient: sql,
    });
    await indexer.indexCorpus(corpus.chunks, corpus.version, 50);

    // 6. Setup RAGService with Bipartite Knowledge Graph
    const knowledgeGraph = new NormativeKnowledgeGraph();
    ragService = new RAGService({
      modelProvider,
      indexer,
      knowledgeGraph,
      config: {
        RAG_TOP_K: 16,
        RAG_RERANK_K: 6,
        RAG_MIN_SCORE: 0.35,
        RAG_TIMEOUT_MS: 20000,
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (sql) {
      await sql.end();
    }
    if (container) {
      await container.stop();
    }
  });

  for (const q of EVAL_QUERIES) {
    it(`evaluates ${q.qid}: "${q.query}" (normative_only=${q.normative_only})`, async () => {
      const res = await ragService.query(q.query, {
        normative_only: q.normative_only,
      });

      expect(res.passages.length).toBeGreaterThan(0);
      const topPassage = res.passages[0];
      expect(topPassage).toBeDefined();

      // Assert score >= 0.35 (§7.6 threshold)
      expect(topPassage?.score).toBeGreaterThanOrEqual(0.35);

      // Verify that at least one of the top returned passages matches the expected document ID
      const matchingPassage = res.passages.find(
        (p) =>
          p.doc_id === q.expected_doc_id ||
          p.doc_id.startsWith(q.expected_doc_id),
      );
      expect(
        matchingPassage,
        `Expected at least one passage from document '${q.expected_doc_id}' for query ${q.qid}`,
      ).toBeDefined();

      // Assert expected verbatim answer substrings in returned passages text
      const combinedText = res.passages.map((p) => p.text).join("\n---\n");
      for (const substr of q.expected_substrings) {
        expect(
          combinedText,
          `Query ${q.qid} must contain expected citation answer substring: "${substr}"`,
        ).toContain(substr);
      }

      // Assert citation format doc_id:chunk_id:lines
      expect(res.citations.length).toBeGreaterThan(0);
      for (const cite of res.citations) {
        expect(cite).toMatch(/^[^:]+:.+:\d+-\d+$/);
      }
    });
  }
});
