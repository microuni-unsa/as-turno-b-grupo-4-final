import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import {
  CorpusLoader,
  chunkSections,
  NormativeKnowledgeGraph,
  RAGService,
  RagIndexer,
} from "@pims/rag";
import {
  CitationFabricatedError,
  CitationInvalidError,
  RagIndexError,
  RagNoEvidenceError,
} from "@pims/types";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

describe("Tri-Modal RAG Subsystem Unit Suite", () => {
  const dummyModelConfig = {
    provider: "openai",
    model: "gpt-4o",
    endpoint: "https://api.openai.com/v1",
    auth_env: "OPENAI_API_KEY",
    timeout_ms: 5000,
    max_retries: 2,
    fallback: "none" as const,
  };

  const testRagConfig = {
    RAG_TOP_K: 24,
    RAG_RERANK_K: 6,
    RAG_MIN_SCORE: 0.35,
    RAG_TIMEOUT_MS: 30000,
  } as unknown as AgentConfig;

  const dummyProvider = new OpenAIModelProvider({
    reasoningConfig: dummyModelConfig,
    fastConfig: { ...dummyModelConfig, model: "gpt-4o-mini" },
    visionConfig: dummyModelConfig,
    embeddingsConfig: dummyModelConfig,
    rerankerConfig: dummyModelConfig,
    apiKey: "dummy-key",
  });

  describe("Corpus Loader & Contextual Prefixing", () => {
    it("loads corpus files and formats contextual prefixes deterministically", async () => {
      const loader = new CorpusLoader({
        projectRoot: process.cwd(),
        source: { type: "local", dirPath: "corpus" },
      });
      const corpus = await loader.loadAll();

      expect(corpus.version).toBeDefined();
      expect(corpus.version).toMatch(/^[a-f0-9]{64}$/);
      expect(corpus.chunks.length).toBeGreaterThan(10);

      for (const chunk of corpus.chunks.slice(0, 10)) {
        expect(chunk.header).toMatch(
          /^\[DOC:[^|]+ \| CLAUSE:[^|]+ \| NORMATIVE:(true|false)\]$/,
        );
        expect(chunk.text.startsWith(chunk.header)).toBe(true);
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
        source: { type: "local", dirPath: "corpus" },
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

    it("links chunks into knowledge graph by embedding similarity", async () => {
      const kg = new NormativeKnowledgeGraph();
      const nodeIds = kg.getNodeIds();
      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: nodeIds.map((id) => (id === "gdpr:art33.1" ? [1, 0] : [0, 1])),
      });
      await kg.indexNodeEmbeddings(dummyProvider);

      const mkChunk = (chunkId: string, text: string) => ({
        chunk_id: chunkId,
        doc_id: "t",
        article_or_clause: "Test clause",
        lines: "1-1",
        text,
        normative: true,
        header: "[DOC:t | CLAUSE:Test clause | NORMATIVE:true]",
        token_count: 1,
      });
      const chunks = [
        mkChunk("t:0001", "notification to supervisory authority 72 hours"),
        mkChunk("t:0002", "unrelated content about logging"),
      ];
      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: [
          [1, 0],
          [Math.SQRT1_2, Math.SQRT1_2],
        ],
      });

      await kg.linkChunks(chunks, dummyProvider, {
        minSimilarity: 0.99,
        topK: 1,
      });

      const ppr = kg.computePersonalizedPageRank(["gdpr:art33.1"]);
      const chunkScores = kg.getChunkScoresFromPPR(ppr);
      expect(chunkScores.has("t:0001")).toBe(true);
      expect(chunkScores.has("t:0002")).toBe(false);
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
        source: { type: "local", dirPath: "corpus" },
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
      expect(Object.keys(windows[0] ?? {}).sort()).toEqual(
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
      expect(() =>
        chunkSections({
          sections: [{ label: "records", lines: ["Alpha"], startLine: 1 }],
          maxTokens: 0,
          chunkOverlap: 0,
        }),
      ).toThrow(RagIndexError);
    });
  });

  describe("Normative Knowledge Graph & Personalized PageRank", () => {
    it("initializes default nodes and computes Personalized PageRank with Graphology", () => {
      const kg = new NormativeKnowledgeGraph();

      expect(kg.getNode("gdpr:art33.1")).toBeDefined();
      expect(kg.getNode("iso:b.3.12")).toBeDefined();
      expect(kg.getNode("cat:dl")).toBeDefined();

      expect(() => kg.findAnchorsByVector([1, 0, 0])).toThrow(RagIndexError);

      const anchors = ["gdpr:art33.1"];
      const ppr = kg.computePersonalizedPageRank(anchors);
      expect(ppr.size).toBeGreaterThan(0);
      expect(ppr.get("gdpr:art33.1")).toBeGreaterThan(0);

      const chunkScores = kg.getChunkScoresFromPPR(ppr);
      expect(chunkScores.size).toBe(0);
    });

    it("performs dense bi-encoder anchor resolution using pre-embedded vectors", async () => {
      const kg = new NormativeKnowledgeGraph();
      const nodeIds = kg.getNodeIds();
      const fakeVectors = nodeIds.map((_, i) => [
        i === 0 ? 1 : 0,
        i === 1 ? 1 : 0,
        i > 1 ? 1 : 0,
      ]);

      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: fakeVectors,
      });

      await kg.indexNodeEmbeddings(dummyProvider);

      const matchingAnchors = kg.findAnchorsByVector([1, 0, 0], 0.5, 3);
      expect(matchingAnchors.length).toBeGreaterThan(0);

      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: [[1, 0, 0]],
      });
      const resolved = await kg.findAnchorsInQuery(
        "Art 33(1) authority deadline 72 hours",
        dummyProvider,
        { minSimilarity: 0.5, topK: 3 },
      );
      expect(resolved.length).toBeGreaterThan(0);
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
          },
        ],
        "v1",
      );

      const kg = new NormativeKnowledgeGraph();
      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        knowledgeGraph: kg,
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

      expect(() =>
        ragService.validateCitation("invalid-format", true),
      ).toThrow(CitationInvalidError);
    });

    it("raises RagNoEvidenceError when candidate scores fall below threshold", async () => {
      const sqlStub = vi.fn().mockResolvedValue([]);
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
        pgClient: sqlStub as unknown as postgres.Sql,
      });
      const kg = new NormativeKnowledgeGraph();

      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: Array.from({ length: 60 }, () => [0.1, 0.2, 0.3]),
      });
      await kg.indexNodeEmbeddings(dummyProvider);

      vi.spyOn(dummyProvider, "chat_json").mockResolvedValueOnce({
        content: {
          sub_queries: ["unrelated question"],
          hyde_clause: "unrelated hypothetical clause",
          graph_anchors: [],
        },
        citations_requested: false,
      });

      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: [[0.1, 0.2, 0.3]],
      });

      vi.spyOn(dummyProvider, "rerank").mockResolvedValueOnce({
        ranked: [
          {
            chunk_id: "low1",
            doc_id: "doc1",
            article_or_clause: "art1",
            lines: "1-10",
            text: "Irrelevant text",
            normative: true,
            score: 0.2,
            rank: 1,
          },
        ],
      });

      const ragService = new RAGService({
        modelProvider: dummyProvider,
        indexer,
        knowledgeGraph: kg,
        config: testRagConfig,
      });

      await expect(ragService.query("unrelated question")).rejects.toThrow(
        RagNoEvidenceError,
      );
    });
  });
});
