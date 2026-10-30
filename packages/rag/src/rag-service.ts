import type { AgentConfig } from "@pims/config";
import type { RagIndexer } from "@pims/rag/indexer.ts";
import type { NormativeKnowledgeGraph } from "@pims/rag/knowledge-graph.ts";
import {
  DEFAULT_RAG_MIN_SCORE,
  DEFAULT_RAG_RERANK_K,
  DEFAULT_RAG_TIMEOUT_MS,
  DEFAULT_RAG_TOP_K,
} from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CitationInvalidError,
  ModelUnavailableError,
  RagCorpusStaleError,
  RagNoEvidenceError,
} from "@pims/types/errors.ts";
import type {
  ModelProvider,
  Passage,
  RankedPassage,
} from "@pims/types/models.ts";
import type {
  CRAGResult,
  QueryDecomposition,
  RagQueryResult,
} from "@pims/types/rag.ts";

export interface RAGServiceOptions {
  modelProvider: ModelProvider;
  indexer: RagIndexer;
  knowledgeGraph: NormativeKnowledgeGraph;
  config?: Partial<AgentConfig>;
  decompositionPrompt?: string;
}

export class RAGService {
  private readonly modelProvider: ModelProvider;
  private readonly indexer: RagIndexer;
  private readonly knowledgeGraph: NormativeKnowledgeGraph;
  private readonly topK: number;
  private readonly rerankK: number;
  private readonly minScore: number;
  private readonly timeoutMs: number;
  private readonly decompositionPrompt?: string;

  constructor(options: RAGServiceOptions) {
    this.modelProvider = options.modelProvider;
    this.indexer = options.indexer;
    this.knowledgeGraph = options.knowledgeGraph;
    this.topK = options.config?.RAG_TOP_K ?? DEFAULT_RAG_TOP_K;
    this.rerankK = options.config?.RAG_RERANK_K ?? DEFAULT_RAG_RERANK_K;
    this.minScore = options.config?.RAG_MIN_SCORE ?? DEFAULT_RAG_MIN_SCORE;
    this.timeoutMs = options.config?.RAG_TIMEOUT_MS ?? DEFAULT_RAG_TIMEOUT_MS;
    this.decompositionPrompt = options.decompositionPrompt;
  }

  async decomposeAndHyde(query: string): Promise<QueryDecomposition> {
    try {
      const systemPrompt =
        this.decompositionPrompt ??
        `You are an expert regulatory, legal, and technical query analyst.
Given a query, return strict JSON with:
1. "sub_queries": Array of 1-3 targeted short sub-queries breaking down compound elements.
2. "hyde_clause": A concise 1-2 sentence hypothetical normative clause snippet (under 50 words).
3. "graph_anchors": Key domain entity anchors (e.g. "gdpr:art33.1", "gdpr:art33.5", "iso:b.3.12", "iso:10.2").
Keep the response concise and strictly valid JSON.`;

      const res = await this.modelProvider.chat_json({
        system: systemPrompt,
        messages: [{ role: "user", content: `Query: ${query}` }],
        max_tokens: 1500,
        temperature: 0.0,
      });

      const parsed = res.content as Partial<QueryDecomposition>;
      const subQueries =
        Array.isArray(parsed.sub_queries) && parsed.sub_queries.length > 0
          ? (parsed.sub_queries as string[])
          : [query];
      const hydeClause =
        typeof parsed.hyde_clause === "string" ? parsed.hyde_clause : query;
      const graphAnchors = Array.isArray(parsed.graph_anchors)
        ? (parsed.graph_anchors as string[])
        : [];

      return {
        sub_queries: subQueries,
        hyde_clause: hydeClause,
        graph_anchors: graphAnchors,
      };
    } catch (err: unknown) {
      if (err instanceof ModelUnavailableError) {
        throw err;
      }
      throw new ModelUnavailableError(
        "rag",
        `Query decomposition failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private calculateRRF(
    denseRankings: string[],
    bm25Rankings: string[],
    pprRankings: string[],
    k = 60,
  ): Map<string, number> {
    const rrfScores = new Map<string, number>();

    const addRank = (list: string[], weight = 1.0) => {
      for (let r = 0; r < list.length; r++) {
        const id = list[r];
        if (!id) continue;
        const current = rrfScores.get(id) ?? 0;
        rrfScores.set(id, current + weight / (k + (r + 1)));
      }
    };

    addRank(denseRankings, 1.0);
    addRank(bm25Rankings, 1.2);
    addRank(pprRankings, 1.5);

    return rrfScores;
  }

  async cragGrade(
    query: string,
    passages: RankedPassage[],
  ): Promise<CRAGResult> {
    if (passages.length === 0) {
      return {
        grade: "unsupported",
        reason: "Zero candidate passages retrieved",
        passed_passages: [],
      };
    }

    const eligible = passages.filter((p) => p.score >= this.minScore);
    if (eligible.length === 0) {
      return {
        grade: "unsupported",
        reason: `All passages fell below min_score threshold (${this.minScore})`,
        passed_passages: [],
      };
    }

    const topScore = eligible[0]?.score ?? 0;
    if (topScore >= 0.65) {
      return {
        grade: "supported",
        reason: `Top passage score ${topScore} strongly supports the query`,
        passed_passages: eligible,
      };
    }

    return {
      grade: "ambiguous",
      reason: `Moderate passage confidence (top score ${topScore})`,
      rewritten_query: `${query} verbatim legal definition and requirements`,
      passed_passages: eligible,
    };
  }

  formatCitation(passage: Passage): string {
    return `${passage.doc_id}:${passage.chunk_id}:${passage.lines}`;
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

    const decomposed = await this.decomposeAndHyde(userQuery);

    if (Date.now() - startTime > this.timeoutMs) {
      throw new ModelUnavailableError(
        "rag",
        `RAG retrieval timeout after ${this.timeoutMs}ms`,
      );
    }

    const embRes = await this.modelProvider.embed({ texts: [userQuery] });
    const qVec = embRes.vectors[0];
    if (!qVec) {
      throw new ModelUnavailableError(
        "rag",
        "Failed to compute query vector for dense retrieval",
      );
    }

    const pgvectorHits = await this.indexer.searchPgvector(qVec, 30);
    const denseRankings = pgvectorHits.map((h) => h.chunk_id);

    const biEncoderAnchors = this.knowledgeGraph.findAnchorsByVector(qVec);
    const allAnchors = Array.from(
      new Set([...decomposed.graph_anchors, ...biEncoderAnchors]),
    );

    const pprScores =
      this.knowledgeGraph.computePersonalizedPageRank(allAnchors);
    const chunkPprMap = this.knowledgeGraph.getChunkScoresFromPPR(pprScores);
    const pprRankings = Array.from(chunkPprMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cid]) => cid);

    const anchorLabels = allAnchors
      .map((a) => this.knowledgeGraph.getNode(a)?.label ?? "")
      .filter(Boolean)
      .join(" ");
    const bm25Hits = this.indexer.searchFts5(
      `${userQuery} ${decomposed.sub_queries.join(" ")} ${anchorLabels}`,
      40,
    );
    const bm25Rankings = bm25Hits.map((h) => h.chunk_id);

    const rrfMap = this.calculateRRF(denseRankings, bm25Rankings, pprRankings);
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
      }
    }

    const rerankRes = await this.modelProvider.rerank({
      query: userQuery,
      passages: candidatePassages,
    });

    const blendedRanked = rerankRes.ranked.map((p) => {
      const pprVal = chunkPprMap.get(p.chunk_id) ?? 0;
      const combinedScore = Number(
        (0.85 * p.score + 0.15 * Math.min(1, pprVal * 2.5)).toFixed(4),
      );
      return {
        ...p,
        score: combinedScore,
      };
    });
    blendedRanked.sort((a, b) => b.score - a.score);

    const topPassages = blendedRanked.slice(0, this.rerankK);

    let cragResult = await this.cragGrade(userQuery, topPassages);

    if (cragResult.grade === "ambiguous" && cragResult.rewritten_query) {
      const rewriteBm25 = this.indexer.searchFts5(
        cragResult.rewritten_query,
        20,
      );
      const additionalChunks = rewriteBm25
        .map((h) => this.indexer.getChunk(h.chunk_id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .filter((c) => !normativeOnly || c.normative)
        .map((c) => ({
          chunk_id: c.chunk_id,
          doc_id: c.doc_id,
          article_or_clause: c.article_or_clause,
          lines: c.lines,
          text: c.text,
          normative: c.normative,
        }));

      if (additionalChunks.length > 0) {
        const rewriteRerank = await this.modelProvider.rerank({
          query: cragResult.rewritten_query,
          passages: [...candidatePassages, ...additionalChunks],
        });
        const revisedTop = rewriteRerank.ranked.slice(0, this.rerankK);
        cragResult = await this.cragGrade(userQuery, revisedTop);
      }
    }

    if (cragResult.passed_passages.length === 0) {
      throw new RagNoEvidenceError(
        `No evidence found meeting threshold score >= ${this.minScore} for query: ${userQuery}`,
      );
    }

    const citations: string[] = [];
    for (const p of cragResult.passed_passages) {
      const cite = this.formatCitation(p);
      this.validateCitation(cite, normativeOnly);
      citations.push(cite);
    }

    return {
      query: userQuery,
      passages: cragResult.passed_passages,
      citations,
      crag_grade: cragResult.grade,
      decomposed,
      corpus_version: activeVersion,
    };
  }
}
