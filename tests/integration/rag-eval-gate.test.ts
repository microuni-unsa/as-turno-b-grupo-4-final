import type { AgentConfig } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import { CorpusLoader, RAGService, RagIndexer } from "@pims/rag";
import type { RankedPassage } from "@pims/types";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  buildGdprTextAxes,
  generateSpanAwareEmbedding,
} from "@tests/helpers/span-geometry.ts";
import {
  TEST_CORPUS_DIR,
  TEST_GPT_4O,
  TEST_GPT_4O_MINI,
  TEST_OPENAI_BASE_URL,
  TEST_PGVECTOR_IMAGE,
  TEST_TEXT_EMBEDDING_3_SMALL,
} from "@tests/helpers/test-constants.ts";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
    container = await new PostgreSqlContainer(TEST_PGVECTOR_IMAGE).start();
    sql = postgres(container.getConnectionUri());

    const modelConfig = {
      model: TEST_GPT_4O,
      endpoint: TEST_OPENAI_BASE_URL,
      apiKey: "eval-gate-test-key",
      timeout_ms: 20000,
      max_retries: CONSTANTS.DEFAULT_PIMS_MAX_RETRIES,
    };

    const modelProvider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: TEST_GPT_4O_MINI },
      visionConfig: modelConfig,
      embeddingsConfig: { ...modelConfig, model: TEST_TEXT_EMBEDDING_3_SMALL },
      rerankerConfig: { ...modelConfig, model: TEST_GPT_4O_MINI },
      defaultApiKey: "eval-gate-test-key",
      defaultBaseURL: TEST_OPENAI_BASE_URL,
    });

    vi.spyOn(modelProvider, "embed").mockImplementation(async ({ texts }) => {
      const vectors = texts.map((t) => generateSpanAwareEmbedding(t));
      return { vectors };
    });

    vi.spyOn(modelProvider, "rerank").mockImplementation(
      async ({ query, passages }) => {
        const queryMatches = query.toLowerCase().match(/[a-z0-9_.]+/g);
        if (queryMatches === null || queryMatches.length === 0) {
          throw new Error(
            `RAG rerank query contains no indexable terms: "${query}"`,
          );
        }
        const queryWords = queryMatches;
        const scored = passages.map((passage) => {
          const textLower = passage.text.toLowerCase();
          let matches = 0;
          let _nonMatches = 0;
          for (const w of queryWords) {
            if (textLower.includes(w)) {
              matches++;
            } else {
              _nonMatches++;
            }
          }
          const ratio = matches / queryWords.length;
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

    const loader = new CorpusLoader({
      projectRoot: process.cwd(),
      source: { type: "local", dirPath: TEST_CORPUS_DIR },
    });
    const corpus = await loader.loadAll();
    buildGdprTextAxes(corpus.chunks);

    indexer = new RagIndexer({
      modelProvider,
      pgClient: sql,
    });
    await indexer.indexCorpus(corpus.chunks, corpus.version, 25);

    ragService = new RAGService({
      modelProvider,
      indexer,
      // RAGService reads only the four RAG_* keys.
      config: {
        RAG_TOP_K: 100,
        RAG_RERANK_K: 20,
        RAG_MIN_SCORE: CONSTANTS.DEFAULT_RAG_MIN_SCORE,
        RAG_TIMEOUT_MS: 30000,
      } as unknown as AgentConfig,
    });
  }, 180_000);

  afterAll(async () => {
    if (sql) {
      await sql.end();
    } else {
      expect(sql).toBeUndefined();
    }
    if (container) {
      await container.stop();
    } else {
      expect(container).toBeUndefined();
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

      expect(topPassage?.score).toBeGreaterThanOrEqual(
        CONSTANTS.DEFAULT_RAG_MIN_SCORE,
      );

      const matchingPassage = res.passages.find(
        (p) =>
          p.doc_id === q.expected_doc_id ||
          p.doc_id.startsWith(q.expected_doc_id),
      );
      expect(
        matchingPassage,
        `Expected at least one passage from document '${q.expected_doc_id}' for query ${q.qid}`,
      ).toBeDefined();

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

      expect(res.citations.length).toBeGreaterThan(0);
      for (const cite of res.citations) {
        expect(cite).toMatch(/^[^:]+:.+:\d+-\d+$/);
      }
    });
  }
});
