import { CONSTANTS } from "@pims/types/constants.ts";
import {
  ModelUnavailableError,
  RagIndexError,
  RagIngestLockedError,
} from "@pims/types/errors.ts";
import type { ModelProvider } from "@pims/types/models.ts";
import type { CorpusChunk } from "@pims/types/rag.ts";
import MiniSearch from "minisearch";
import type postgres from "postgres";

export interface IndexerOptions {
  // Runtime-DI exemption: class instances; no serializable config member
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
    await this.pgClient`CREATE EXTENSION IF NOT EXISTS vector;`;
    await this.pgClient.unsafe(`CREATE TABLE IF NOT EXISTS rag_corpus_chunks (
        chunk_id text PRIMARY KEY,
        doc_id text NOT NULL,
        article_or_clause text NOT NULL,
        lines text NOT NULL,
        normative boolean NOT NULL,
        header text NOT NULL,
        text text NOT NULL,
        embedding vector(${CONSTANTS.DEFAULT_EMBEDDING_DIM})
      );`);
    await this.pgClient.unsafe(`CREATE TABLE IF NOT EXISTS rag_corpus_metadata (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamptz NOT NULL
      );`);
  }

  async indexCorpus(
    chunks: CorpusChunk[],
    version: string,
    batchSize = CONSTANTS.RAG_EMBED_BATCH_SIZE,
  ): Promise<void> {
    if (this.isIngesting) {
      throw new RagIngestLockedError(
        "RAG ingestion is currently locked by an active process",
      );
    }
    if (batchSize <= 0 || batchSize > CONSTANTS.RAG_EMBED_BATCH_SIZE) {
      throw new RagIndexError(`Invalid embed batch size: ${batchSize}`);
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

      if (this.pgClient) {
        await this.initPgvector();

        // Check if current version is already indexed and chunk count matches
        const metaRows = await this.pgClient<{ value: string }[]>`
          SELECT value FROM rag_corpus_metadata WHERE key = 'corpus_version' LIMIT 1;
        `;
        const countRows = await this.pgClient<{ count: string | number }[]>`
          SELECT count(*)::text as count FROM rag_corpus_chunks;
        `;
        const existingCount = Number(countRows[0]?.count ?? "0");

        if (
          metaRows.length > 0 &&
          metaRows[0]?.value === version &&
          existingCount === chunks.length
        ) {
          // Exact cache hit: skip embeddings generation to preserve tokens and accelerate startup
          return;
        }

        await this.pgClient`DELETE FROM rag_corpus_chunks;`;

        const batches: Array<CorpusChunk[]> = [];
        for (let i = 0; i < chunks.length; i += batchSize) {
          batches.push(chunks.slice(i, i + batchSize));
        }

        const CONCURRENCY = CONSTANTS.RAG_EMBED_CONCURRENCY;
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
                } else
                  throw new ModelUnavailableError(
                    CONSTANTS.MODEL_ROUTE_RAG,
                    "embed response missing vector for chunk",
                  );
              }
            }),
          );
        }

        await this.pgClient`
          INSERT INTO rag_corpus_metadata (key, value, updated_at)
          VALUES ('corpus_version', ${version}, NOW())
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at;
        `;
      }
    } finally {
      this.isIngesting = false;
    }
  }

  searchBM25(
    query: string,
    limit = CONSTANTS.RAG_BM25_K,
  ): Array<{ chunk_id: string; score: number }> {
    const results = this.miniSearch.search(query);
    return results.slice(0, limit).map((r) => ({
      chunk_id: String(r.id),
      score: r.score,
    }));
  }

  async searchPgvector(
    vector: number[],
    limit = CONSTANTS.RAG_DENSE_K,
  ): Promise<Array<{ chunk_id: string; score: number }>> {
    if (!this.pgClient) {
      throw new ModelUnavailableError(
        CONSTANTS.MODEL_ROUTE_RAG,
        "pgvector client is not configured",
      );
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
