import { OpenAIModelProvider } from "@pims/models";
import {
  CorpusLoader,
  NormativeKnowledgeGraph,
  RAGService,
  RagIndexer,
} from "@pims/rag";
import {
  CitationFabricatedError,
  CitationInvalidError,
  RagNoEvidenceError,
} from "@pims/types";
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
        source: { type: "local", dirPath: "corpus" },
      });
      const corpus = await loader.loadAll();

      expect(corpus.version).toBeDefined();
      expect(corpus.version).toMatch(/^[a-f0-9]{64}$/);
      expect(corpus.chunks.length).toBeGreaterThan(10);

      // Verify contextual header on chunks
      for (const chunk of corpus.chunks.slice(0, 10)) {
        expect(chunk.header).toMatch(
          /^\[DOC:[^|]+ \| CLAUSE:[^|]+ \| NORMATIVE:(true|false)\]$/,
        );
        expect(chunk.text.startsWith(chunk.header)).toBe(true);
      }

      // Check key normative documents are present
      expect(corpus.docHashes["gdpr-full"]).toBeDefined();
      expect(corpus.docHashes.iso27701).toBeDefined();
    });
  });

  describe("Normative Knowledge Graph & Personalized PageRank", () => {
    it("initializes default nodes and computes Personalized PageRank with Graphology", () => {
      const kg = new NormativeKnowledgeGraph();

      expect(kg.getNode("gdpr:art33.1")).toBeDefined();
      expect(kg.getNode("iso:b.3.12")).toBeDefined();
      expect(kg.getNode("cat:dl")).toBeDefined();

      const anchors = kg.findAnchorsInQuery(
        "Art 33(1) authority deadline 72 hours",
      );
      expect(anchors).toContain("gdpr:art33.1");

      const ppr = kg.computePersonalizedPageRank(anchors);
      expect(ppr.size).toBeGreaterThan(0);
      expect(ppr.get("gdpr:art33.1")).toBeGreaterThan(0);

      const chunkScores = kg.getChunkScoresFromPPR(ppr);
      expect(chunkScores.has("art33") || chunkScores.has("art33:p1")).toBe(
        true,
      );
    });

    it("performs dense bi-encoder anchor resolution using pre-embedded vectors", async () => {
      const kg = new NormativeKnowledgeGraph();
      const nodeCount = 5;
      const fakeVectors = Array.from({ length: nodeCount }, (_, i) => [
        i === 0 ? 1 : 0,
        i === 1 ? 1 : 0,
        0,
      ]);

      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: fakeVectors,
      });

      await kg.indexNodeEmbeddings(dummyProvider);

      // Query vector matching first node [1, 0, 0]
      const matchingAnchors = kg.findAnchorsByVector([1, 0, 0], 0.5, 3);
      expect(matchingAnchors.length).toBeGreaterThan(0);
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

      // Fabricated chunk id
      expect(() =>
        ragService.validateCitation("gdpr-full:non_existent:1-10", true),
      ).toThrowError(CitationFabricatedError);

      // Malformed format
      expect(() =>
        ragService.validateCitation("invalid-format", true),
      ).toThrowError(CitationInvalidError);
    });

    it("raises RagNoEvidenceError when candidate scores fall below threshold", async () => {
      const indexer = new RagIndexer({
        modelProvider: dummyProvider,
      });
      const kg = new NormativeKnowledgeGraph();

      // Mock chat_json for query decomposition
      vi.spyOn(dummyProvider, "chat_json").mockResolvedValueOnce({
        content: {
          sub_queries: ["unrelated question"],
          hyde_clause: "unrelated hypothetical clause",
          graph_anchors: [],
        },
        citations_requested: false,
      });

      // Mock embed for query embedding
      vi.spyOn(dummyProvider, "embed").mockResolvedValueOnce({
        vectors: [[0.1, 0.2, 0.3]],
      });

      // Mock reranker returning low score < 0.35
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
        config: { RAG_MIN_SCORE: 0.35 },
      });

      await expect(ragService.query("unrelated question")).rejects.toThrowError(
        RagNoEvidenceError,
      );
    });
  });
});
