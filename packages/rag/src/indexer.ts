import type { NormativeKnowledgeGraph } from "@pims/rag/knowledge-graph.ts";
import { RagIngestLockedError } from "@pims/types/errors.ts";
import type { ModelProvider } from "@pims/types/models.ts";
import type { CorpusChunk } from "@pims/types/rag.ts";
import MiniSearch from "minisearch";
import type postgres from "postgres";

export interface IndexerOptions {
  modelProvider: ModelProvider;
  pgClient?: postgres.Sql;
  knowledgeGraph?: NormativeKnowledgeGraph;
}

export class RagIndexer {
  private readonly modelProvider: ModelProvider;
  private readonly pgClient?: postgres.Sql;
  private readonly knowledgeGraph?: NormativeKnowledgeGraph;
  private isIngesting = false;
  private corpusVersion = "";
  private indexedChunks: Map<string, CorpusChunk> = new Map();
  private miniSearch: MiniSearch<CorpusChunk>;

  constructor(options: IndexerOptions) {
    this.modelProvider = options.modelProvider;
    this.pgClient = options.pgClient;
    this.knowledgeGraph = options.knowledgeGraph;
    this.miniSearch = new MiniSearch<CorpusChunk>({
      idField: "chunk_id",
      fields: ["text", "article_or_clause"],
      storeFields: [
        "chunk_id",
        "doc_id",
        "article_or_clause",
        "lines",
        "normative",
        "text",
        "header",
      ],
      searchOptions: {
        boost: { article_or_clause: 2 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
  }

  private async initPgvector(): Promise<void> {
    if (!this.pgClient) return;
    await this.pgClient`CREATE EXTENSION IF NOT EXISTS vector;`;
    await this.pgClient`
      CREATE TABLE IF NOT EXISTS rag_corpus_chunks (
        chunk_id text PRIMARY KEY,
        doc_id text NOT NULL,
        article_or_clause text NOT NULL,
        lines text NOT NULL,
        normative boolean NOT NULL,
        header text NOT NULL,
        text text NOT NULL,
        embedding vector(1024)
      );
    `;
  }

  async indexCorpus(
    chunks: CorpusChunk[],
    version: string,
    batchSize = 25,
  ): Promise<void> {
    if (this.isIngesting) {
      throw new RagIngestLockedError(
        "RAG ingestion is currently locked by an active process",
      );
    }

    this.isIngesting = true;
    try {
      this.corpusVersion = version;
      this.indexedChunks.clear();

      for (const chunk of chunks) {
        this.indexedChunks.set(chunk.chunk_id, chunk);
      }

      this.miniSearch.removeAll();
      this.miniSearch.addAll(chunks);

      if (this.knowledgeGraph) {
        await this.knowledgeGraph.indexNodeEmbeddings(this.modelProvider);
      }

      if (this.pgClient) {
        await this.initPgvector();
        await this.pgClient`DELETE FROM rag_corpus_chunks;`;

        const batches: Array<CorpusChunk[]> = [];
        const effectiveBatchSize = Math.min(batchSize, 25);
        for (let i = 0; i < chunks.length; i += effectiveBatchSize) {
          batches.push(chunks.slice(i, i + effectiveBatchSize));
        }

        const CONCURRENCY = 2;
        for (let i = 0; i < batches.length; i += CONCURRENCY) {
          const currentGroup = batches.slice(i, i + CONCURRENCY);
          await Promise.all(
            currentGroup.map(async (slice) => {
              const texts = slice.map((c) => c.text);
              const embRes = await this.modelProvider.embed({ texts });
              for (let j = 0; j < slice.length; j++) {
                const chunk = slice[j];
                const vec = embRes.vectors[j];
                if (chunk && vec && this.pgClient) {
                  const vecStr = `[${vec.join(",")}]`;
                  await this.pgClient`
                    INSERT INTO rag_corpus_chunks (chunk_id, doc_id, article_or_clause, lines, normative, header, text, embedding)
                    VALUES (${chunk.chunk_id}, ${chunk.doc_id}, ${chunk.article_or_clause}, ${chunk.lines}, ${chunk.normative}, ${chunk.header}, ${chunk.text}, ${vecStr}::vector)
                    ON CONFLICT (chunk_id) DO UPDATE SET
                      embedding = EXCLUDED.embedding,
                      text = EXCLUDED.text;
                  `;
                }
              }
            }),
          );
        }
      }
    } finally {
      this.isIngesting = false;
    }
  }

  searchFts5(
    query: string,
    limit = 20,
  ): Array<{ chunk_id: string; score: number }> {
    return this.searchBM25(query, limit);
  }

  searchBM25(
    query: string,
    limit = 20,
  ): Array<{ chunk_id: string; score: number }> {
    const results = this.miniSearch.search(query);
    return results.slice(0, limit).map((r) => ({
      chunk_id: String(r.id),
      score: r.score,
    }));
  }

  async searchPgvector(
    vector: number[],
    limit = 20,
  ): Promise<Array<{ chunk_id: string; score: number }>> {
    if (!this.pgClient) {
      return [];
    }

    const vecStr = `[${vector.join(",")}]`;
    const rows = (await this.pgClient`
      SELECT chunk_id, 1 - (embedding <=> ${vecStr}::vector) AS similarity
      FROM rag_corpus_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vecStr}::vector ASC
      LIMIT ${limit};
    `) as Array<{ chunk_id: string; similarity: number | string }>;

    return rows.map((r) => ({
      chunk_id: r.chunk_id,
      score:
        typeof r.similarity === "number"
          ? r.similarity
          : Number.parseFloat(String(r.similarity)),
    }));
  }

  getChunk(chunkId: string): CorpusChunk | undefined {
    return this.indexedChunks.get(chunkId);
  }

  getAllChunks(): CorpusChunk[] {
    return Array.from(this.indexedChunks.values());
  }

  getVersion(): string {
    return this.corpusVersion;
  }
}
