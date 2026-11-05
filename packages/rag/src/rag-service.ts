import type { AgentConfig } from "@pims/config";
import type { RagIndexer } from "@pims/rag/indexer.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CitationInvalidError,
  ConfigError,
  ModelUnavailableError,
  RagCorpusStaleError,
  RagIndexError,
  RagNoEvidenceError,
} from "@pims/types/errors.ts";
import type { ModelProvider, Passage } from "@pims/types/models.ts";
import type {
  CorpusChunk,
  RagQueryOptions,
  RagQueryResult,
  RagRetrievalRecord,
  RetrievalPassage,
} from "@pims/types/rag.ts";

export interface RAGServiceOptions {
  modelProvider: ModelProvider;
  indexer: RagIndexer;
  config: AgentConfig;
  onRetrieval?: (record: RagRetrievalRecord) => void | Promise<void>;
}

export class RAGService {
  private readonly modelProvider: ModelProvider;
  private readonly indexer: RagIndexer;
  private readonly topK: number;
  private readonly rerankK: number;
  private readonly minScore: number;
  private readonly timeoutMs: number;
  private readonly onRetrieval?: (
    record: RagRetrievalRecord,
  ) => void | Promise<void>;
  private readonly queryEmbeddingCache = new Map<string, number[]>();

  constructor(options: RAGServiceOptions) {
    if (!options.config)
      throw new ConfigError(
        "RAGService requires explicit RAG config",
        "CONFIG_MISSING:RAG",
      );
    this.modelProvider = options.modelProvider;
    this.indexer = options.indexer;
    this.topK = options.config.RAG_TOP_K;
    this.rerankK = options.config.RAG_RERANK_K;
    this.minScore = options.config.RAG_MIN_SCORE;
    this.timeoutMs = options.config.RAG_TIMEOUT_MS;
    this.onRetrieval = options.onRetrieval;
  }

  private calculateRRF(
    denseRankings: string[],
    bm25Rankings: string[],
    k = CONSTANTS.RRF_K,
  ): Map<string, number> {
    const rrfScores = new Map<string, number>();
    const addRank = (list: string[], weight = 1.0) => {
      for (let r = 0; r < list.length; r++) {
        const id = list[r];
        if (!id) throw new RagIndexError("RRF ranking contains empty chunk id");
        const current = rrfScores.get(id) ?? 0;
        rrfScores.set(id, current + weight / (k + (r + 1)));
      }
    };
    addRank(denseRankings, CONSTANTS.RRF_WEIGHT_DENSE);
    addRank(bm25Rankings, CONSTANTS.RRF_WEIGHT_BM25);
    return rrfScores;
  }

  formatCitation(passage: Passage): string {
    return `${passage.doc_id}:${passage.chunk_id}:${passage.lines}`;
  }

  getPassageByCitation(citation: string): {
    passage: Passage;
    chunk: CorpusChunk;
  } {
    this.validateCitation(citation, false);
    const firstColonIdx = citation.indexOf(":");
    const lastColonIdx = citation.lastIndexOf(":");
    const chunkId = citation.slice(firstColonIdx + 1, lastColonIdx);
    const chunk = this.indexer.getChunk(chunkId);
    if (!chunk) {
      throw new CitationFabricatedError(
        chunkId,
        `Citation references unknown chunk: ${chunkId}`,
      );
    }
    return {
      passage: {
        chunk_id: chunk.chunk_id,
        doc_id: chunk.doc_id,
        article_or_clause: chunk.article_or_clause,
        lines: chunk.lines,
        text: chunk.text,
        normative: chunk.normative,
      },
      chunk: structuredClone(chunk),
    };
  }

  validateCitation(citation: string, normativeOnly: boolean): void {
    const firstColonIdx = citation.indexOf(":");
    const lastColonIdx = citation.lastIndexOf(":");
    if (
      firstColonIdx === -1 ||
      lastColonIdx === -1 ||
      firstColonIdx === lastColonIdx
    ) {
      throw new CitationInvalidError(
        citation,
        "Citation does not conform to doc_id:chunk_id:lines",
      );
    }
    const docId = citation.slice(0, firstColonIdx);
    const chunkId = citation.slice(firstColonIdx + 1, lastColonIdx);
    const chunk = this.indexer.getChunk(chunkId);
    if (!chunk || chunk.doc_id !== docId) {
      throw new CitationFabricatedError(
        chunkId,
        `Citation references unknown chunk: ${chunkId}`,
      );
    }
    if (normativeOnly && !chunk.normative) {
      throw new CitationInvalidError(
        citation,
        `Non-normative citation '${citation}' used in normative-only operation`,
      );
    }
  }

  getVersion(): string {
    return this.indexer.getVersion();
  }

  async query(
    userQuery: string,
    options: RagQueryOptions = {},
  ): Promise<RagQueryResult> {
    const startTime = Date.now();
    const normativeOnly = Boolean(options.normative_only);

    const activeVersion = this.indexer.getVersion();
    if (
      options.expected_version &&
      options.expected_version !== activeVersion
    ) {
      throw new RagCorpusStaleError(
        `Corpus version mismatch. Expected: ${options.expected_version}, Active: ${activeVersion}`,
      );
    }

    if (Date.now() - startTime > this.timeoutMs) {
      throw new ModelUnavailableError(
        CONSTANTS.MODEL_ROUTE_RAG,
        `RAG retrieval timeout after ${this.timeoutMs}ms`,
      );
    }

    let qVec = this.queryEmbeddingCache.get(userQuery);
    if (!qVec) {
      const embRes = await this.modelProvider.embed({ texts: [userQuery] });
      const computed = embRes.vectors[0];
      if (!computed) {
        throw new ModelUnavailableError(
          CONSTANTS.MODEL_ROUTE_RAG,
          "Failed to compute query vector for dense retrieval",
        );
      }
      qVec = computed;
      if (this.queryEmbeddingCache.size >= 100) {
        const firstKey = this.queryEmbeddingCache.keys().next().value;
        if (firstKey !== undefined) {
          this.queryEmbeddingCache.delete(firstKey);
        } else {
          this.queryEmbeddingCache.clear();
        }
      }
      this.queryEmbeddingCache.set(userQuery, qVec);
    }

    const pgvectorHits = await this.indexer.searchPgvector(
      qVec,
      CONSTANTS.RAG_DENSE_K,
    );
    const denseRankings = pgvectorHits.map((h) => h.chunk_id);
    const denseMetadata = new Map<string, { score: number; rank: number }>();
    pgvectorHits.forEach((hit, index) => {
      denseMetadata.set(hit.chunk_id, { score: hit.score, rank: index + 1 });
    });

    const bm25Hits = this.indexer.searchBM25(userQuery, CONSTANTS.RAG_BM25_K);
    const bm25Rankings = bm25Hits.map((h) => h.chunk_id);
    const bm25Metadata = new Map<string, { score: number; rank: number }>();
    bm25Hits.forEach((hit, index) => {
      bm25Metadata.set(hit.chunk_id, { score: hit.score, rank: index + 1 });
    });

    const rrfMap = this.calculateRRF(denseRankings, bm25Rankings);
    const fusedCandidateIds = Array.from(rrfMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, this.topK);

    const candidatePassages: Passage[] = [];
    for (const cid of fusedCandidateIds) {
      const chunk = this.indexer.getChunk(cid);
      if (chunk) {
        if (normativeOnly && !chunk.normative) {
          continue;
        }
        candidatePassages.push({
          chunk_id: chunk.chunk_id,
          doc_id: chunk.doc_id,
          article_or_clause: chunk.article_or_clause,
          lines: chunk.lines,
          text: chunk.text,
          normative: chunk.normative,
        });
      } else {
        throw new CitationFabricatedError(
          cid,
          `Fused chunk id not in index: ${cid}`,
        );
      }
    }

    const rerankRes = await this.modelProvider.rerank({
      query: userQuery,
      passages: candidatePassages,
    });
    // The rerank model occasionally returns chunk_ids outside the candidate
    // list (real ids, wrong retrieval). Those entries carry no RRF/dense/BM25
    // metadata, so they are dropped and the surviving order is re-ranked
    // contiguously instead of failing the whole retrieval.
    const candidateIds = new Set(candidatePassages.map((p) => p.chunk_id));
    const knownRanked = rerankRes.ranked.filter((p) =>
      candidateIds.has(p.chunk_id),
    );
    if (knownRanked.length === 0 && rerankRes.ranked.length > 0) {
      throw new CitationFabricatedError(
        rerankRes.ranked
          .map((p) => p.chunk_id)
          .filter((id) => !candidateIds.has(id))
          .join(","),
        `Reranker returned only chunk ids outside the candidate list: ${rerankRes.ranked.map((p) => p.chunk_id).join(",")}`,
      );
    }
    const reranked = knownRanked.map((p, index) => ({
      ...p,
      rank: index + 1,
    }));
    const topPassages = reranked.slice(0, this.rerankK);
    const passedPassages = topPassages.filter((p) => p.score >= this.minScore);
    if (passedPassages.length === 0) {
      throw new RagNoEvidenceError(
        `No evidence found meeting threshold score >= ${this.minScore} for query: ${userQuery}`,
      );
    }

    const citations: string[] = [];
    const retrievalPassages: RetrievalPassage[] = [];
    for (const p of passedPassages) {
      const cite = this.formatCitation(p);
      this.validateCitation(cite, normativeOnly);
      citations.push(cite);

      const chunk = this.indexer.getChunk(p.chunk_id);
      if (!chunk) {
        throw new CitationFabricatedError(
          p.chunk_id,
          `Reranked chunk id not in index: ${p.chunk_id}`,
        );
      }
      const rrfScore = rrfMap.get(p.chunk_id);
      if (rrfScore === undefined) {
        throw new RagIndexError(
          `Reranked chunk ${p.chunk_id} missing from the RRF fusion map`,
        );
      }
      const dense = denseMetadata.get(p.chunk_id);
      const bm25 = bm25Metadata.get(p.chunk_id);
      retrievalPassages.push({
        chunk_id: chunk.chunk_id,
        doc_id: chunk.doc_id,
        article_or_clause: chunk.article_or_clause,
        lines: chunk.lines,
        text: chunk.text,
        normative: chunk.normative,
        score: p.score,
        rank: p.rank,
        chunk_sha256: chunk.sha256,
        dense_score: dense?.score ?? null,
        dense_rank: dense?.rank ?? null,
        bm25_score: bm25?.score ?? null,
        bm25_rank: bm25?.rank ?? null,
        rrf_score: rrfScore,
        rerank_score: p.score,
      });
    }

    if (this.onRetrieval !== undefined) {
      await this.onRetrieval({
        incident_code: options.incident_code ?? null,
        query: userQuery,
        corpus_version: activeVersion,
        at_utc: new Date().toISOString(),
        passages: retrievalPassages,
        citations,
      });
    }

    return {
      query: userQuery,
      passages: retrievalPassages,
      citations,
      corpus_version: activeVersion,
    };
  }
}
