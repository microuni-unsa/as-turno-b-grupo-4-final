import type { AgentConfig } from "@pims/config";
import type { RagIndexer } from "@pims/rag/indexer.ts";
import {
  MODEL_ROUTE_RAG,
  RAG_BM25_K,
  RAG_DENSE_K,
  RRF_K,
  RRF_WEIGHT_BM25,
  RRF_WEIGHT_DENSE,
} from "@pims/types/constants.ts";
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
import type { CorpusChunk, RagQueryResult } from "@pims/types/rag.ts";

export interface RAGServiceOptions {
  modelProvider: ModelProvider;
  indexer: RagIndexer;
  config: AgentConfig;
}

export class RAGService {
  private readonly modelProvider: ModelProvider;
  private readonly indexer: RagIndexer;
  private readonly topK: number;
  private readonly rerankK: number;
  private readonly minScore: number;
  private readonly timeoutMs: number;

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
  }

  private calculateRRF(
    denseRankings: string[],
    bm25Rankings: string[],
    k = RRF_K,
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
    addRank(denseRankings, RRF_WEIGHT_DENSE);
    addRank(bm25Rankings, RRF_WEIGHT_BM25);
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
      chunk,
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

  async query(
    userQuery: string,
    options: {
      normative_only?: boolean;
      expected_version?: string;
    } = {},
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
        MODEL_ROUTE_RAG,
        `RAG retrieval timeout after ${this.timeoutMs}ms`,
      );
    }

    const embRes = await this.modelProvider.embed({ texts: [userQuery] });
    const qVec = embRes.vectors[0];
    if (!qVec) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_RAG,
        "Failed to compute query vector for dense retrieval",
      );
    }

    const pgvectorHits = await this.indexer.searchPgvector(qVec, RAG_DENSE_K);
    const denseRankings = pgvectorHits.map((h) => h.chunk_id);

    const bm25Hits = this.indexer.searchBM25(userQuery, RAG_BM25_K);
    const bm25Rankings = bm25Hits.map((h) => h.chunk_id);

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
    const topPassages = rerankRes.ranked.slice(0, this.rerankK);
    const passedPassages = topPassages.filter((p) => p.score >= this.minScore);
    if (passedPassages.length === 0) {
      throw new RagNoEvidenceError(
        `No evidence found meeting threshold score >= ${this.minScore} for query: ${userQuery}`,
      );
    }

    const citations: string[] = [];
    for (const p of passedPassages) {
      const cite = this.formatCitation(p);
      this.validateCitation(cite, normativeOnly);
      citations.push(cite);
    }

    return {
      query: userQuery,
      passages: passedPassages,
      citations,
      corpus_version: activeVersion,
    };
  }
}
