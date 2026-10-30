import { RagIngestLockedError } from "@pims/types/errors.ts";
import type { ModelProvider } from "@pims/types/models.ts";
import type { CorpusChunk } from "@pims/types/rag.ts";
import MiniSearch from "minisearch";
import type postgres from "postgres";

export interface IndexerOptions {
  modelProvider: ModelProvider;
  pgClient?: postgres.Sql;
}

export class RagIndexer {
  private readonly modelProvider: ModelProvider;
  private readonly pgClient?: postgres.Sql;
  private isIngesting = false;
  private corpusVersion = "";
  private indexedChunks: Map<string, CorpusChunk> = new Map();
  private miniSearch: MiniSearch<CorpusChunk>;

  constructor(options: IndexerOptions) {
    this.modelProvider = options.modelProvider;
    this.pgClient = options.pgClient;
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
    try {
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
    } catch (err: unknown) {
      console.warn(
        "Could not initialize pgvector extension on Postgres client:",
        err,
      );
    }
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

      // 1. Populate MiniSearch BM25 Lexical Index
      this.miniSearch.removeAll();
      this.miniSearch.addAll(chunks);

      // 2. Insert embeddings into pgvector (concurrent batch embedding)
      if (this.pgClient) {
        await this.initPgvector();
        try {
          await this.pgClient`DELETE FROM rag_corpus_chunks;`;
        } catch {
          // Table may not exist yet
        }

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
              try {
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
              } catch (embedErr) {
                console.warn(
                  "Failed pgvector batch embedding write:",
                  embedErr,
                );
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
    if (!query || query.trim() === "" || this.indexedChunks.size === 0) {
      return [];
    }

    const results = this.miniSearch.search(query);
    if (results.length === 0) {
      return [];
    }

    const maxScore = results[0]?.score ?? 1.0;
    return results.slice(0, limit).map((r) => ({
      chunk_id: String(r.id),
      score: maxScore > 0 ? Number((r.score / maxScore).toFixed(4)) : 0,
    }));
  }

  async searchPgvector(
    queryVector: number[],
    limit = 20,
  ): Promise<Array<{ chunk_id: string; score: number }>> {
    if (!this.pgClient) return [];
    try {
      const vecStr = `[${queryVector.join(",")}]`;
      const rows = await this.pgClient<
        Array<{ chunk_id: string; score: number }>
      >`
        SELECT chunk_id, 1 - (embedding <=> ${vecStr}::vector) AS score
        FROM rag_corpus_chunks
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vecStr}::vector ASC
        LIMIT ${limit};
      `;
      return rows.map((r) => ({
        chunk_id: r.chunk_id,
        score: Math.max(0, Math.min(1, Number(r.score))),
      }));
    } catch {
      return [];
    }
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
