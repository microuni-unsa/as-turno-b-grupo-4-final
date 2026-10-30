import { OpenAIModelProvider } from "@pims/models";
import {
  CorpusLoader,
  NormativeKnowledgeGraph,
  RAGService,
  RagIndexer,
} from "@pims/rag";
import type { RankedPassage } from "@pims/types";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

function generateDeterministicEmbedding(text: string, dim = 1024): number[] {
  const vec = new Float64Array(dim);
  const clean = text.toLowerCase();
  const words = clean.match(/[a-z0-9_.]+/g) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    const prev = vec[idx] ?? 0;
    vec[idx] = prev + sign * (1.0 + (w.length > 3 ? 0.5 : 0.0));
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += (vec[i] ?? 0) * (vec[i] ?? 0);
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vec[0] = 1.0;
    norm = 1.0;
  }
  const result: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = Number(((vec[i] ?? 0) / norm).toFixed(6));
  }
  return result;
}

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
      "without undue delay",
      "72 hours",
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
    // 1. Boot pgvector PostgreSQL Container
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    sql = postgres(container.getConnectionUri());

    // 2. Initialize real OpenAIModelProvider instance with zero-cost Vitest spies
    const modelConfig = {
      provider: "openai",
      model: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      auth_env: "OPENAI_API_KEY",
      timeout_ms: 20000,
      max_retries: 3,
      fallback: "none" as const,
    };

    const modelProvider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: "gpt-4o-mini" },
      visionConfig: modelConfig,
      embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
      rerankerConfig: { ...modelConfig, model: "gpt-4o-mini" },
      apiKey: "eval-gate-test-key",
      baseURL: "https://api.openai.com/v1",
    });

    // Zero-Cost Spy: Deterministic Vector Embeddings for real pgvector & KG cosine operations
    vi.spyOn(modelProvider, "embed").mockImplementation(async ({ texts }) => {
      const vectors = texts.map((t) => generateDeterministicEmbedding(t));
      return { vectors };
    });

    // Zero-Cost Spy: Query Decomposition & Target Knowledge Graph Anchor Detection
    vi.spyOn(modelProvider, "chat_json").mockImplementation(
      async ({ messages }) => {
        const promptContent = messages[0]?.content ?? "";
        const qMatch =
          promptContent.match(/Query:\s*"([^"]+)"/) ||
          promptContent.match(/Query:\s*(.+)/);
        const query = qMatch ? (qMatch[1]?.trim() ?? "") : promptContent;
        const qLower = query.toLowerCase();

        const anchors: string[] = [];
        if (qLower.includes("33(1)") || qLower.includes("72")) {
          anchors.push("gdpr:art33.1");
        }
        if (qLower.includes("33(2)")) {
          anchors.push("gdpr:art33.2");
        }
        if (qLower.includes("33(3)")) {
          anchors.push("gdpr:art33.3");
        }
        if (qLower.includes("33(5)")) {
          anchors.push("gdpr:art33.5");
        }
        if (qLower.includes("34(1)")) {
          anchors.push("gdpr:art34.1");
        }
        if (qLower.includes("34(2)")) {
          anchors.push("gdpr:art34.2");
        }
        if (qLower.includes("34(3)(a)")) {
          anchors.push("gdpr:art34.3a");
        }
        if (qLower.includes("34(3)(b)")) {
          anchors.push("gdpr:art34.3b");
        }
        if (qLower.includes("b.3.11")) {
          anchors.push("iso:b.3.11");
        }
        if (qLower.includes("b.3.12")) {
          anchors.push("iso:b.3.12");
        }
        if (qLower.includes("10.2")) {
          anchors.push("iso:10.2");
        }

        return {
          content: {
            sub_queries: [query],
            hyde_clause: query,
            graph_anchors: anchors,
          },
          citations_requested: false,
        };
      },
    );

    // Zero-Cost Spy: Cross-encoder reranking based on query term overlap
    vi.spyOn(modelProvider, "rerank").mockImplementation(
      async ({ query, passages }) => {
        const queryWords = query.toLowerCase().match(/[a-z0-9_.]+/g) ?? [];
        const scored = passages.map((passage) => {
          const textLower = passage.text.toLowerCase();
          let matches = 0;
          for (const w of queryWords) {
            if (textLower.includes(w)) {
              matches++;
            }
          }
          const ratio =
            queryWords.length > 0 ? matches / queryWords.length : 0.5;
          const score = Number((0.45 + ratio * 0.5).toFixed(4));
          return {
            ...passage,
            score,
          };
        });

        scored.sort((a, b) => b.score - a.score);
        const ranked: RankedPassage[] = scored.map((p, idx) => ({
          ...p,
          rank: idx + 1,
        }));
        return { ranked };
      },
    );

    // 4. Ingest Corpus with CorpusLoader from dedicated corpus/ directory
    const loader = new CorpusLoader({
      source: { type: "local", dirPath: "corpus" },
    });
    const corpus = await loader.loadAll();

    // 5. Setup Bipartite Knowledge Graph
    const knowledgeGraph = new NormativeKnowledgeGraph();

    // 6. Index into pgvector + MiniSearch BM25 with batchSize 25
    indexer = new RagIndexer({
      modelProvider,
      pgClient: sql,
      knowledgeGraph,
    });
    await indexer.indexCorpus(corpus.chunks, corpus.version, 25);

    // 7. Setup RAGService with Bipartite Knowledge Graph
    ragService = new RAGService({
      modelProvider,
      indexer,
      knowledgeGraph,
      config: {
        RAG_TOP_K: 16,
        RAG_RERANK_K: 6,
        RAG_MIN_SCORE: 0.35,
        RAG_TIMEOUT_MS: 30000,
      },
    });
  }, 180_000);

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

      // Assert expected verbatim answer substrings in returned passages text (whitespace-normalized)
      const normalizedCombined = res.passages
        .map((p) => p.text.replace(/\s+/g, " "))
        .join(" ");
      for (const substr of q.expected_substrings) {
        const normalizedSubstr = substr.replace(/\s+/g, " ");
        expect(
          normalizedCombined,
          `Query ${q.qid} must contain expected citation answer substring: "${substr}"`,
        ).toContain(normalizedSubstr);
      }

      // Assert citation format doc_id:chunk_id:lines
      expect(res.citations.length).toBeGreaterThan(0);
      for (const cite of res.citations) {
        expect(cite).toMatch(/^[^:]+:.+:\d+-\d+$/);
      }
    });
  }
});
