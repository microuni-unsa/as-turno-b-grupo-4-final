import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import { CorpusLoader, chunkSections, RAGService, RagIndexer } from "@pims/rag";
import {
  CitationFabricatedError,
  CitationInvalidError,
  RagIndexError,
  RagNoEvidenceError,
} from "@pims/types";
import { CONSTANTS } from "@pims/types/constants.ts";
import type { RagRetrievalRecord } from "@pims/types/rag.ts";
import {
  TEST_ALT_INCIDENT_CODE,
  TEST_CORPUS_DIR,
  TEST_GPT_4O,
  TEST_GPT_4O_MINI,
  TEST_OPENAI_BASE_URL,
} from "@tests/helpers/test-constants.ts";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

describe("Tri-Modal RAG Subsystem Unit Suite", () => {
  const dummyModelConfig = {
    model: TEST_GPT_4O,
    endpoint: TEST_OPENAI_BASE_URL,
    apiKey: "dummy-key",
    timeout_ms: 5000,
    max_retries: 2,
  };

  const testRagConfig = {
    RAG_TOP_K: 24,
    RAG_RERANK_K: 6,
    RAG_MIN_SCORE: 0.35,
    RAG_TIMEOUT_MS: 30000,
  } as unknown as AgentConfig;

  const dummyProvider = new OpenAIModelProvider({
    reasoningConfig: dummyModelConfig,
    fastConfig: { ...dummyModelConfig, model: TEST_GPT_4O_MINI },
    visionConfig: dummyModelConfig,
    embeddingsConfig: dummyModelConfig,
    rerankerConfig: dummyModelConfig,
    defaultApiKey: "dummy-key",
  });

  describe("Corpus Loader & Contextual Prefixing", () => {
    it("loads corpus files and formats contextual prefixes deterministically", async () => {
      const loader = new CorpusLoader({
        projectRoot: process.cwd(),
        source: { type: "local", dirPath: TEST_CORPUS_DIR },
      });
      const corpus = await loader.loadAll();

      expect(corpus.version).toBeDefined();
      expect(corpus.version).toMatch(CONSTANTS.SHA256_HEX_REGEX);
      expect(corpus.chunks.length).toBeGreaterThan(10);

      for (const chunk of corpus.chunks.slice(0, 10)) {
        expect(chunk.header).toMatch(
          /^\[DOC:[^|]+ \| CLAUSE:[^|]+ \| NORMATIVE:(true|false)\]$/,
        );
        expect(chunk.text.startsWith(chunk.header)).toBe(true);
        expect(chunk.sha256).toMatch(CONSTANTS.SHA256_HEX_REGEX);
      }

      expect(corpus.docHashes["gdpr-full"]).toBeDefined();
      expect(corpus.docHashes.iso27701).toBeDefined();

      const chunkIds = corpus.chunks.map((c) => c.chunk_id);
      for (const id of chunkIds) {
        expect(id).toMatch(/^[^:]+:\d{4}$/);
      }
      expect(new Set(chunkIds).size).toBe(chunkIds.length);
      for (const chunk of corpus.chunks) {
        expect(["gdpr-full", "iso27701"]).toContain(chunk.doc_id);
        expect(chunk.text).not.toContain("doc_id:");
      }
    });

    it("derives docIds from filename stems without hardcoded mappings", async () => {
      const loader = new CorpusLoader({
        projectRoot: process.cwd(),
        source: { type: "local", dirPath: TEST_CORPUS_DIR },
      });
      const corpus = await loader.loadAll();
      const docIds = [...new Set(corpus.chunks.map((c) => c.doc_id))].sort();
      expect(docIds).toEqual(["gdpr-full", "iso27701"]);
      expect(corpus.docHashes["gdpr-full.txt"]).toBeDefined();
      expect(corpus.docHashes["iso27701.md"]).toBeDefined();
    });

    it("loads new formats through registered section loaders", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pims-rag-test-"));
      try {
        fs.writeFileSync(
          path.join(tempDir, "notes.csv"),
          "Alpha note body.\nBeta note body.\n",
          "utf-8",
        );
        const loader = new CorpusLoader({
          projectRoot: tempDir,
          source: {
            type: "local",
            dirPath: ".",
          },
        });
        loader.registerSectionLoader({
          extensions: [".csv"],
          loadSections: (buffer) => [
            {
              label: "records",
              lines: buffer.toString("utf-8").split("\n"),
              startLine: 1,
            },
          ],
        });
        const corpus = await loader.loadAll();
        expect(corpus.chunks.length).toBe(1);
        expect(corpus.chunks[0]?.doc_id).toBe("notes");
        expect(corpus.chunks[0]?.chunk_id).toBe("notes:0001");
        expect(corpus.chunks[0]?.article_or_clause).toBe("records");
        expect(corpus.chunks[0]?.text).toContain("Alpha note body.");
        expect(loader.supportedExtensions).toContain(".csv");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("ingests markdown sections via parser without heuristics", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pims-rag-test-"));
      try {
        const mdContent = `# Internal Incident Procedures

## Section 1.1 First Response
Isolate the compromised network host immediately.

## Section 1.2 Escalation Matrix
Notify the designated Incident Commander within 30 minutes.
`;
        fs.writeFileSync(
          path.join(tempDir, "internal-sop.md"),
          mdContent,
          "utf-8",
        );

        const loader = new CorpusLoader({
          projectRoot: tempDir,
          source: {
            type: "local",
            dirPath: ".",
          },
          defaultNormative: false,
        });
        const corpus = await loader.loadAll();

        expect(corpus.docHashes["internal-sop"]).toBeDefined();
        expect(corpus.chunks.length).toBe(3);
        expect(corpus.chunks.map((c) => c.article_or_clause)).toEqual([
          "Internal Incident Procedures",
          "Section 1.1 First Response",
          "Section 1.2 Escalation Matrix",
        ]);

        for (const chunk of corpus.chunks) {
          expect(chunk.doc_id).toBe("internal-sop");
          expect(chunk.normative).toBe(false);
          expect(chunk.header).toContain("NORMATIVE:false");
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("splits oversized sections and numbers chunks sequentially", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pims-rag-test-"));
      try {
        const txtContent = [
          "Alpha paragraph with several words for token counting purposes here.",
          "Beta paragraph with several words for token counting purposes here.",
          "Gamma paragraph with several words for token counting purposes here.",
        ].join("\n\n");
        fs.writeFileSync(path.join(tempDir, "tiny.txt"), txtContent, "utf-8");

        const loader = new CorpusLoader({
          projectRoot: tempDir,
          source: {
            type: "local",
            dirPath: ".",
          },
          maxTokens: 12,
          chunkOverlap: 0,
        });
        const corpus = await loader.loadAll();

        expect(corpus.chunks.length).toBeGreaterThanOrEqual(2);
        expect(corpus.chunks.map((c) => c.chunk_id)).toEqual(
          corpus.chunks.map((_, i) => `tiny:${String(i + 1).padStart(4, "0")}`),
        );
        for (const chunk of corpus.chunks) {
          expect(chunk.text.length).toBeGreaterThan(0);
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects duplicate section loader extensions", () => {
      const loader = new CorpusLoader({
        projectRoot: process.cwd(),
        source: { type: "local", dirPath: TEST_CORPUS_DIR },
      });
      expect(() =>
        loader.registerSectionLoader({
          extensions: [".md"],
          loadSections: () => [],
        }),
      ).toThrow(RagIndexError);
    });

    it("chunks sections into domain-free windows", () => {
      const windows = chunkSections({
        sections: [
          { label: "records", lines: ["Alpha", "Beta"], startLine: 4 },
        ],
        maxTokens: 450,
        chunkOverlap: 1,
      });
      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({
        sectionLabel: "records",
        sectionIndex: 0,
        windowIndex: 0,
        windowCount: 1,
        body: "Alpha\nBeta",
        firstLine: 4,
        lastLine: 5,
      });
      const firstWindow = windows[0];
      expect(firstWindow).toBeDefined();
      if (firstWindow) {
        expect(Object.keys(firstWindow).sort()).toEqual(
          [
            "body",
            "firstLine",
            "lastLine",
            "sectionIndex",
            "sectionLabel",
            "tokenCount",
            "windowCount",
            "windowIndex",
          ].sort(),
        );
      }
      expect(() =>
        chunkSections({
          sections: [{ label: "records", lines: ["Alpha"], startLine: 1 }],
          maxTokens: 0,
          chunkOverlap: 0,
        }),
      ).toThrow(RagIndexError);
    });
  });

  describe("MiniSearch BM25 Lexical Index", () => {
    it("indexes chunks and performs BM25 lexical ranking", () => {
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
      });

      const sampleChunks = [
        {
          chunk_id: "c1",
          doc_id: "gdpr-full",
          article_or_clause: "art33",
          lines: "1-10",
          text: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]\nIn the case of a personal data breach notify within 72 hours without undue delay",
          normative: true,
          header: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]",
          token_count: 20,
          sha256: "a".repeat(CONSTANTS.SHA256_HEX_LENGTH),
        },
        {
          chunk_id: "c2",
          doc_id: "iso27701",
          article_or_clause: "b.3.12",
          lines: "11-20",
          text: "[DOC:iso27701 | CLAUSE:b.3.12 | NORMATIVE:true]\nPII breach record element description and consequences of the incident",
          normative: true,
          header: "[DOC:iso27701 | CLAUSE:b.3.12 | NORMATIVE:true]",
          token_count: 20,
          sha256: "a".repeat(CONSTANTS.SHA256_HEX_LENGTH),
        },
      ];

      indexer.indexCorpus(sampleChunks, "v1");

      const hits = indexer.searchBM25("72 hours undue delay");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.chunk_id).toBe("c1");

      const hits2 = indexer.searchBM25("breach record consequences");
      expect(hits2.length).toBeGreaterThan(0);
      expect(hits2[0]?.chunk_id).toBe("c2");
    });
  });

  describe("RAG Retrieval Service & Citation Formatting", () => {
    it("formats and validates citations strictly", () => {
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
      });

      indexer.indexCorpus(
        [
          {
            chunk_id: "art33",
            doc_id: "gdpr-full",
            article_or_clause: "art33",
            lines: "2171-2175",
            text: "Article 33 content",
            normative: true,
            header: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]",
            token_count: 10,
            sha256: "a".repeat(CONSTANTS.SHA256_HEX_LENGTH),
          },
        ],
        "v1",
      );

      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        config: testRagConfig,
      });

      const cite = ragService.formatCitation({
        chunk_id: "art33",
        doc_id: "gdpr-full",
        article_or_clause: "art33",
        lines: "2171-2175",
        text: "Article 33 content",
        normative: true,
      });

      expect(cite).toBe("gdpr-full:art33:2171-2175");
      expect(() => ragService.validateCitation(cite, true)).not.toThrow();

      expect(() =>
        ragService.validateCitation("gdpr-full:non_existent:1-10", true),
      ).toThrow(CitationFabricatedError);

      expect(() => ragService.validateCitation("invalid-format", true)).toThrow(
        CitationInvalidError,
      );
    });

    it("raises RagNoEvidenceError when candidate scores fall below threshold", async () => {
      const sqlStub = Object.assign(
        vi.fn().mockResolvedValue([{ chunk_id: "low1", similarity: 0.5 }]),
        { unsafe: vi.fn().mockResolvedValue([]) },
      );
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });
      vi.spyOn(dummyProvider, "embed").mockResolvedValue({
        vectors: [[0.1, 0.2, 0.3]],
      });
      await indexer.indexCorpus(
        [
          {
            chunk_id: "low1",
            doc_id: "doc1",
            article_or_clause: "art1",
            lines: "1-10",
            text: "[DOC:doc1 | CLAUSE:art1 | NORMATIVE:true]\nIrrelevant text",
            normative: true,
            header: "[DOC:doc1 | CLAUSE:art1 | NORMATIVE:true]",
            token_count: 5,
            sha256: "a".repeat(CONSTANTS.SHA256_HEX_LENGTH),
          },
        ],
        "v-low-score",
      );

      vi.spyOn(dummyProvider, "rerank").mockResolvedValueOnce({
        ranked: [
          {
            chunk_id: "low1",
            doc_id: "doc1",
            article_or_clause: "art1",
            lines: "1-10",
            text: "[DOC:doc1 | CLAUSE:art1 | NORMATIVE:true]\nIrrelevant text",
            normative: true,
            score: 0.2,
            rank: 1,
          },
        ],
      });

      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        config: testRagConfig,
      });

      await expect(ragService.query("unrelated question")).rejects.toThrow(
        RagNoEvidenceError,
      );
    });

    it("exposes verbatim chunk hashes and per-retriever scores", async () => {
      const sqlStub = Object.assign(vi.fn().mockResolvedValue([]), {
        unsafe: vi.fn().mockResolvedValue([]),
      });
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });

      vi.spyOn(dummyProvider, "embed").mockResolvedValue({
        vectors: [[0.1, 0.2, 0.3]],
      });

      const chunkSha = "b".repeat(CONSTANTS.SHA256_HEX_LENGTH);
      await indexer.indexCorpus(
        [
          {
            chunk_id: "art33",
            doc_id: "gdpr-full",
            article_or_clause: "art33",
            lines: "2171-2175",
            text: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]\nThe controller shall notify the personal data breach to the supervisory authority within 72 hours",
            normative: true,
            header: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]",
            token_count: 20,
            sha256: chunkSha,
          },
        ],
        "v-metadata",
      );

      sqlStub.mockResolvedValue([{ chunk_id: "art33", similarity: 0.82 }]);
      vi.spyOn(dummyProvider, "rerank").mockResolvedValue({
        ranked: [
          {
            chunk_id: "art33",
            doc_id: "gdpr-full",
            article_or_clause: "art33",
            lines: "2171-2175",
            text: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]\nThe controller shall notify the personal data breach to the supervisory authority within 72 hours",
            normative: true,
            score: 0.91,
            rank: 1,
          },
        ],
      });

      const records: RagRetrievalRecord[] = [];
      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        config: testRagConfig,
        onRetrieval: (record) => {
          records.push(record);
        },
      });

      const result = await ragService.query(
        "personal data breach 72 hours supervisory authority",
        { incident_code: TEST_ALT_INCIDENT_CODE },
      );

      const passage = result.passages[0];
      if (passage === undefined) {
        throw new Error("Expected one retrieval passage");
      }
      expect(passage.chunk_sha256).toBe(chunkSha);
      expect(passage.dense_score).toBe(0.82);
      expect(passage.dense_rank).toBe(1);
      expect(passage.bm25_score).toBeGreaterThan(0);
      expect(passage.bm25_rank).toBeGreaterThan(0);
      expect(passage.rrf_score).toBeGreaterThan(0);
      expect(passage.rerank_score).toBe(0.91);

      expect(records).toHaveLength(1);
      expect(records[0]?.incident_code).toBe(TEST_ALT_INCIDENT_CODE);
      expect(records[0]?.passages[0]?.chunk_sha256).toBe(chunkSha);
      expect(records[0]?.citations).toEqual(result.citations);
    });

    it("skips embedding API calls when corpus version and chunk count match (cache hit)", async () => {
      const sqlStub = Object.assign(
        vi.fn().mockImplementation((strings: TemplateStringsArray) => {
          const queryText = strings.join(" ");
          if (queryText.includes("rag_corpus_metadata")) {
            return Promise.resolve([{ value: "v-cached" }]);
          }
          if (queryText.includes("count(*)")) {
            return Promise.resolve([{ count: "1" }]);
          }
          if (queryText.includes("CREATE EXTENSION")) {
            return Promise.resolve([]);
          }
          throw new Error(`Unexpected query in sqlStub: ${queryText}`);
        }),
        {
          unsafe: vi.fn().mockResolvedValue([]),
        },
      );

      const embedSpy = vi.spyOn(dummyProvider, "embed");
      embedSpy.mockClear();

      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });

      await indexer.indexCorpus(
        [
          {
            chunk_id: "art33",
            doc_id: "gdpr-full",
            article_or_clause: "art33",
            lines: "1-5",
            text: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]\nArticle 33",
            normative: true,
            header: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]",
            token_count: 5,
            sha256: "c".repeat(CONSTANTS.SHA256_HEX_LENGTH),
          },
        ],
        "v-cached",
      );

      expect(embedSpy).not.toHaveBeenCalled();
      expect(indexer.getVersion()).toBe("v-cached");
    });

    it("reuses cached query embedding vector across identical queries", async () => {
      const sqlStub = Object.assign(
        vi.fn().mockResolvedValue([{ chunk_id: "art33", similarity: 0.9 }]),
        { unsafe: vi.fn().mockResolvedValue([]) },
      );

      const embedSpy = vi
        .spyOn(dummyProvider, "embed")
        .mockResolvedValue({ vectors: [[0.5, 0.5]] });

      vi.spyOn(dummyProvider, "rerank").mockResolvedValue({
        ranked: [
          {
            chunk_id: "art33",
            doc_id: "gdpr-full",
            article_or_clause: "art33",
            lines: "1-5",
            text: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]\nArticle 33",
            normative: true,
            score: 0.95,
            rank: 1,
          },
        ],
      });

      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });

      await indexer.indexCorpus(
        [
          {
            chunk_id: "art33",
            doc_id: "gdpr-full",
            article_or_clause: "art33",
            lines: "1-5",
            text: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]\nArticle 33",
            normative: true,
            header: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]",
            token_count: 5,
            sha256: "d".repeat(CONSTANTS.SHA256_HEX_LENGTH),
          },
        ],
        "v-query-cache",
      );

      embedSpy.mockClear();

      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        config: testRagConfig,
      });

      const queryText = "data breach 72 hours";
      await ragService.query(queryText);
      expect(embedSpy).toHaveBeenCalledTimes(1);

      // Repeat identical query
      await ragService.query(queryText);
      expect(embedSpy).toHaveBeenCalledTimes(1);
    });

    it("drops reranked chunk ids outside the candidate list and re-ranks survivors", async () => {
      const sqlStub = Object.assign(
        vi.fn().mockResolvedValue([
          { chunk_id: "gdpr-full:0001", similarity: 0.9 },
          { chunk_id: "gdpr-full:0002", similarity: 0.8 },
        ]),
        { unsafe: vi.fn().mockResolvedValue([]) },
      );
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });
      vi.spyOn(dummyProvider, "embed").mockResolvedValue({
        vectors: [
          [0.5, 0.5],
          [0.6, 0.6],
        ],
      });
      const chunks = ["gdpr-full:0001", "gdpr-full:0002"].map((chunk_id) => ({
        chunk_id,
        doc_id: "gdpr-full",
        article_or_clause: "section",
        lines: "1-5",
        text: `[DOC:gdpr-full | CLAUSE:section | NORMATIVE:true]\nBreach notification ${chunk_id}`,
        normative: true,
        header: "[DOC:gdpr-full | CLAUSE:section | NORMATIVE:true]",
        token_count: 8,
        sha256: "e".repeat(CONSTANTS.SHA256_HEX_LENGTH),
      }));
      await indexer.indexCorpus(chunks, "v-rerank-filter");

      vi.spyOn(dummyProvider, "embed").mockResolvedValue({
        vectors: [[0.5, 0.5]],
      });
      const passageFor = (chunk_id: string) => {
        const chunk = chunks.find((c) => c.chunk_id === chunk_id);
        if (!chunk) {
          throw new Error(`Missing fixture chunk ${chunk_id}`);
        }
        return chunk;
      };
      vi.spyOn(dummyProvider, "rerank").mockResolvedValue({
        ranked: [
          { ...passageFor("gdpr-full:0002"), score: 0.95, rank: 1 },
          // Real chunk id, but not in this retrieval's candidate list.
          {
            chunk_id: "gdpr-full:0026",
            doc_id: "gdpr-full",
            article_or_clause: "section 26",
            lines: "100-110",
            text: "intruder",
            normative: true,
            score: 0.9,
            rank: 2,
          },
          { ...passageFor("gdpr-full:0001"), score: 0.8, rank: 3 },
        ],
      });

      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        config: testRagConfig,
      });
      const result = await ragService.query("breach notification");
      expect(result.passages.map((p) => p.chunk_id)).toEqual([
        "gdpr-full:0002",
        "gdpr-full:0001",
      ]);
      expect(result.passages.map((p) => p.rank)).toEqual([1, 2]);
      expect(result.citations).toHaveLength(2);
    });

    it("fails closed when the reranker returns only unknown chunk ids", async () => {
      const sqlStub = Object.assign(
        vi
          .fn()
          .mockResolvedValue([{ chunk_id: "gdpr-full:0001", similarity: 0.9 }]),
        { unsafe: vi.fn().mockResolvedValue([]) },
      );
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });
      vi.spyOn(dummyProvider, "embed").mockResolvedValue({
        vectors: [[0.5, 0.5]],
      });
      await indexer.indexCorpus(
        [
          {
            chunk_id: "gdpr-full:0001",
            doc_id: "gdpr-full",
            article_or_clause: "section",
            lines: "1-5",
            text: "[DOC:gdpr-full | CLAUSE:section | NORMATIVE:true]\nBreach notification",
            normative: true,
            header: "[DOC:gdpr-full | CLAUSE:section | NORMATIVE:true]",
            token_count: 8,
            sha256: "f".repeat(CONSTANTS.SHA256_HEX_LENGTH),
          },
        ],
        "v-rerank-fail-closed",
      );

      vi.spyOn(dummyProvider, "embed").mockResolvedValue({
        vectors: [[0.5, 0.5]],
      });
      vi.spyOn(dummyProvider, "rerank").mockResolvedValue({
        ranked: [
          {
            chunk_id: "gdpr-full:0026",
            doc_id: "gdpr-full",
            article_or_clause: "section 26",
            lines: "100-110",
            text: "intruder",
            normative: true,
            score: 0.9,
            rank: 1,
          },
        ],
      });

      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        config: testRagConfig,
      });
      await expect(ragService.query("breach notification")).rejects.toThrow(
        CitationFabricatedError,
      );
    });
  });
});
