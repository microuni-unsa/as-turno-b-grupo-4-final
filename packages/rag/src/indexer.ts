import { RagIngestLockedError } from "@pims/types/errors.ts";
import type { ModelProvider } from "@pims/types/models.ts";
import type { CorpusChunk } from "@pims/types/rag.ts";
import type postgres from "postgres";

export interface IndexerOptions {
  modelProvider: ModelProvider;
  pgClient?: postgres.Sql;
}

interface InvertedIndexEntry {
  docFreq: number;
  postings: Map<string, number>; // chunk_id -> term count
}

export class RagIndexer {
  private readonly modelProvider: ModelProvider;
  private readonly pgClient?: postgres.Sql;
  private isIngesting = false;
  private corpusVersion = "";
  private indexedChunks: Map<string, CorpusChunk> = new Map();

  // Inverted BM25 index (runs identically on Bun, Node/Vitest, and everywhere)
  private invertedIndex: Map<string, InvertedIndexEntry> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength = 0;

  // Optional Bun SQLite handle if running natively under Bun
  private bunSqliteDb: unknown = null;

  constructor(options: IndexerOptions) {
    this.modelProvider = options.modelProvider;
    this.pgClient = options.pgClient;
    this.tryInitBunSqlite();
  }

  private async tryInitBunSqlite(): Promise<void> {
    if (typeof globalThis !== "undefined" && "Bun" in globalThis) {
      try {
        const mod = await import("bun:sqlite");
        const db = new mod.Database(":memory:");
        db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
            chunk_id UNINDEXED,
            doc_id UNINDEXED,
            article_or_clause UNINDEXED,
            normative UNINDEXED,
            text,
            tokenize = 'unicode61'
          );
        `);
        this.bunSqliteDb = db;
      } catch {
        // Fallback to pure TS BM25
      }
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1);
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
      this.invertedIndex.clear();
      this.docLengths.clear();

      let totalTokens = 0;

      // 1. Build Inverted BM25 Index
      for (const chunk of chunks) {
        this.indexedChunks.set(chunk.chunk_id, chunk);
        const tokens = this.tokenize(chunk.text);
        const docLen = tokens.length;
        this.docLengths.set(chunk.chunk_id, docLen);
        totalTokens += docLen;

        const termCounts = new Map<string, number>();
        for (const t of tokens) {
          termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
        }

        for (const [term, count] of termCounts.entries()) {
          let entry = this.invertedIndex.get(term);
          if (!entry) {
            entry = { docFreq: 0, postings: new Map() };
            this.invertedIndex.set(term, entry);
          }
          entry.docFreq++;
          entry.postings.set(chunk.chunk_id, count);
        }
      }

      this.avgDocLength = chunks.length > 0 ? totalTokens / chunks.length : 1;

      // 2. Insert into Bun SQLite FTS5 if active
      if (this.bunSqliteDb) {
        try {
          const db = this.bunSqliteDb as {
            run: (sql: string) => void;
            prepare: (sql: string) => { run: (...args: unknown[]) => void };
          };
          db.run("DELETE FROM rag_chunks_fts;");
          const insertStmt = db.prepare(`
            INSERT INTO rag_chunks_fts (chunk_id, doc_id, article_or_clause, normative, text)
            VALUES (?, ?, ?, ?, ?);
          `);
          for (const chunk of chunks) {
            insertStmt.run(
              chunk.chunk_id,
              chunk.doc_id,
              chunk.article_or_clause,
              chunk.normative ? "1" : "0",
              chunk.text,
            );
          }
        } catch (sqliteErr) {
          console.warn("Bun SQLite insertion error:", sqliteErr);
        }
      }

      // 3. Insert embeddings into pgvector (concurrent batch embedding)
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
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const n = this.indexedChunks.size;
    if (n === 0) return [];

    const k1 = 1.2;
    const b = 0.75;
    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const entry = this.invertedIndex.get(term);
      if (!entry) continue;

      const df = entry.docFreq;
      // IDF formula with add-1 smoothing
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));

      for (const [chunkId, tf] of entry.postings.entries()) {
        const docLen = this.docLengths.get(chunkId) ?? this.avgDocLength;
        const tfNorm =
          (tf * (k1 + 1)) /
          (tf + k1 * (1 - b + b * (docLen / this.avgDocLength)));
        const termScore = idf * tfNorm;
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + termScore);
      }
    }

    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    // Normalize top score to 0..1 scale
    const maxScore = sorted[0]?.[1] ?? 1.0;
    return sorted.map(([chunk_id, rawScore]) => ({
      chunk_id,
      score: maxScore > 0 ? Number((rawScore / maxScore).toFixed(4)) : 0,
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
