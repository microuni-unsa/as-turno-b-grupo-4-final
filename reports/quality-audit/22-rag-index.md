# Slice 22 rag-index — Quality Audit

Audited files (line counts) — date 2026-11-05:
- `packages/rag/src/corpus-loader.ts` — 269 lines
- `packages/rag/src/indexer.ts` — 223 lines
- `packages/rag/src/rag-service.ts` — 327 lines

## R1

- packages/rag/src/corpus-loader.ts:162 — `} else {` (pairs with `if (this.source.type === "local")` at line 145) — else branch assumes S3 without a discriminant check (`=== "s3"`); any future non-`"local"` source variant is silently treated as S3 instead of raising a dedicated error — unhandled-variant catch-all.
- packages/rag/src/rag-service.ts:185 — `if (firstKey !== undefined) {` / `this.queryEmbeddingCache.delete(firstKey);` — missing `else`: when the iterator yields `undefined`, eviction is silently skipped and the cache grows past its bound with state left implicit (no error, no fallback handling).

## R2

- packages/rag/src/corpus-loader.ts:66 — `this.source = options.source ?? {` — `?? default` silently supplies a `local` source instead of fail-fast with a named error when absent.
- packages/rag/src/corpus-loader.ts:71 — `maxTokens: options.maxTokens ?? DEFAULT_CHUNK_MAX_TOKENS,` — `?? default` hiding absent state.
- packages/rag/src/corpus-loader.ts:72 — `chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,` — `?? default` hiding absent state.
- packages/rag/src/corpus-loader.ts:73 — `defaultNormative: options.defaultNormative ?? true,` — `?? default` hiding absent state.
- packages/rag/src/corpus-loader.ts:80 — `options.sectionLoaders ?? createDefaultSectionLoaders();` — `?? default` hiding absent state.
- packages/rag/src/corpus-loader.ts:163 — `const region = this.source.region ?? process.env.AWS_REGION;` — fallback chain (`source.region` → env var) instead of fail-fast with a named error; speculative env-var cascade.
- packages/rag/src/corpus-loader.ts:196 — `const contents = listRes.Contents ?? [];` — `?? default` hiding absent S3 listing state (absent `Contents` silently becomes empty corpus input).
- packages/rag/src/corpus-loader.ts:246 — `const seqStart = this.seqByDoc.get(docId) ?? 1;` — `?? default` hiding absent map state.
- packages/rag/src/indexer.ts:79 — `batchSize = RAG_EMBED_BATCH_SIZE,` — default parameter silently supplies batch size instead of requiring it explicitly.
- packages/rag/src/indexer.ts:112 — `const existingCount = Number(countRows[0]?.count ?? "0");` — `?.` + `?? "0"` hiding absent row/count state (missing count row silently becomes zero).
- packages/rag/src/indexer.ts:174 — `limit = RAG_BM25_K,` — default parameter silently supplies limit.
- packages/rag/src/indexer.ts:185 — `limit = RAG_DENSE_K,` — default parameter silently supplies limit.
- packages/rag/src/rag-service.ts:66 — `k = RRF_K,` — default parameter silently supplies RRF constant.
- packages/rag/src/rag-service.ts:69 — `const addRank = (list: string[], weight = 1.0) => {` — default parameter silently supplies weight.
- packages/rag/src/rag-service.ts:73 — `const current = rrfScores.get(id) ?? 0;` — `?? default` hiding absent map state.
- packages/rag/src/rag-service.ts:150 — `options: RagQueryOptions = {},` — default empty-object parameter hiding absent options.
- packages/rag/src/rag-service.ts:153 — `const normativeOnly = Boolean(options.normative_only);` — `Boolean()` coercion silently defaults absent flag to `false` instead of requiring it explicitly.
- packages/rag/src/rag-service.ts:300 — `dense_score: dense?.score ?? null,` — `?.` + `?? null` hiding absent dense metadata.
- packages/rag/src/rag-service.ts:301 — `dense_rank: dense?.rank ?? null,` — `?.` + `?? null` hiding absent dense metadata.
- packages/rag/src/rag-service.ts:302 — `bm25_score: bm25?.score ?? null,` — `?.` + `?? null` hiding absent BM25 metadata.
- packages/rag/src/rag-service.ts:303 — `bm25_rank: bm25?.rank ?? null,` — `?.` + `?? null` hiding absent BM25 metadata.
- packages/rag/src/rag-service.ts:311 — `incident_code: options.incident_code ?? null,` — `?? default` hiding absent state.

## R3

No violations found.

## R4

Within-slice repeated literals (same literal hardcoded 2+ times inside the slice):
- `rag_corpus_chunks` — packages/rag/src/indexer.ts:59, packages/rag/src/indexer.ts:110, packages/rag/src/indexer.ts:123, packages/rag/src/indexer.ts:143
- `rag_corpus_metadata` — packages/rag/src/indexer.ts:69, packages/rag/src/indexer.ts:106, packages/rag/src/indexer.ts:160
- `'corpus_version'` (SQL metadata key) — packages/rag/src/indexer.ts:107, packages/rag/src/indexer.ts:161
- `::vector` cast fragment — packages/rag/src/indexer.ts:144, packages/rag/src/indexer.ts:196, packages/rag/src/indexer.ts:199
- `embedding` (SQL identifier / ORDER BY / WHERE) — packages/rag/src/indexer.ts:67, packages/rag/src/indexer.ts:146, packages/rag/src/indexer.ts:196, packages/rag/src/indexer.ts:198, packages/rag/src/indexer.ts:199
- `chunk_id` (MiniSearch `idField` + `storeFields` + SQL columns + mappings) — packages/rag/src/indexer.ts:37, packages/rag/src/indexer.ts:40, packages/rag/src/indexer.ts:61, packages/rag/src/indexer.ts:143, packages/rag/src/indexer.ts:145, packages/rag/src/indexer.ts:178, packages/rag/src/indexer.ts:196, packages/rag/src/indexer.ts:203
- `article_or_clause` (MiniSearch fields/boost/storeFields + SQL) — packages/rag/src/indexer.ts:38, packages/rag/src/indexer.ts:42, packages/rag/src/indexer.ts:49, packages/rag/src/indexer.ts:62, packages/rag/src/indexer.ts:143
- `":"` chunk-id/citation delimiter — packages/rag/src/corpus-loader.ts:111 (`${docId}:${...}`), packages/rag/src/rag-service.ts:83, packages/rag/src/rag-service.ts:91, packages/rag/src/rag-service.ts:92, packages/rag/src/rag-service.ts:115, packages/rag/src/rag-service.ts:116, packages/rag/src/rag-service.ts:127, packages/rag/src/rag-service.ts:128
- `"\n"` (header/body separator + version-hash join) — packages/rag/src/corpus-loader.ts:109, packages/rag/src/corpus-loader.ts:261
- `","` (vector serialization + unknown-id join) — packages/rag/src/indexer.ts:141, packages/rag/src/indexer.ts:194, packages/rag/src/rag-service.ts:252, packages/rag/src/rag-service.ts:253
- `"sha256"` (hash algorithm + field references) — packages/rag/src/corpus-loader.ts:84, packages/rag/src/corpus-loader.ts:119, packages/rag/src/rag-service.ts:299 (`chunk_sha256` consumer)

Cross-file literal candidates for global synthesis (literal value + file:line each; other file may be outside this slice):
- `":"` delimiter — packages/rag/src/corpus-loader.ts:111, packages/rag/src/rag-service.ts:83, packages/rag/src/rag-service.ts:91, packages/rag/src/rag-service.ts:92, packages/rag/src/rag-service.ts:115, packages/rag/src/rag-service.ts:116, packages/rag/src/rag-service.ts:127, packages/rag/src/rag-service.ts:128
- `"\n"` — packages/rag/src/corpus-loader.ts:109, packages/rag/src/corpus-loader.ts:261
- `","` vector/id-list join — packages/rag/src/indexer.ts:141, packages/rag/src/indexer.ts:194, packages/rag/src/rag-service.ts:252, packages/rag/src/rag-service.ts:253
- `rag_corpus_chunks` table name — packages/rag/src/indexer.ts:59, packages/rag/src/indexer.ts:110, packages/rag/src/indexer.ts:123, packages/rag/src/indexer.ts:143
- `rag_corpus_metadata` table name — packages/rag/src/indexer.ts:69, packages/rag/src/indexer.ts:106, packages/rag/src/indexer.ts:160
- `corpus_version` metadata key — packages/rag/src/indexer.ts:107, packages/rag/src/indexer.ts:161
- `"sha256"` — packages/rag/src/corpus-loader.ts:84, packages/rag/src/corpus-loader.ts:119
- `"local"` source discriminant — packages/rag/src/corpus-loader.ts:67, packages/rag/src/corpus-loader.ts:145
- `"0"` zero-count string — packages/rag/src/indexer.ts:112 (candidate if echoed in loaders/config/tests outside slice)
- `100` query-embedding cache bound — packages/rag/src/rag-service.ts:183 (single use in slice; candidate if echoed elsewhere)

## R5

No violations found.

## R6

- packages/rag/src/indexer.ts:130-157 — `for (let i = 0; i < batches.length; i += CONCURRENCY)` + `batches.slice(...)` + `await Promise.all(currentGroup.map(...))` — hand-rolled concurrency limiter over embed batches; use an established dependency such as `p-limit`/`p-queue` instead of manual batch-group slicing.
- packages/rag/src/rag-service.ts:46, packages/rag/src/rag-service.ts:172-190 — hand-rolled bounded query-embedding cache (`Map` + manual `size >= 100` check + manual first-key eviction via `keys().next()`); use an established LRU such as `lru-cache` instead of manual eviction bookkeeping.
- packages/rag/src/rag-service.ts:86-142 — hand-rolled citation serialization/parsing/validation (`indexOf`/`lastIndexOf`/`slice` splitting plus manual three-segment shape checks in `validateCitation`); use a schema validator such as `zod` (e.g. a `doc_id:chunk_id:lines` template schema) instead of hand-rolled string surgery.

## Summary

| Rule | Count |
| ---- | ----- |
| R1 | 2 |
| R2 | 22 |
| R3 | 0 |
| R4 | 12 within-slice groups / 10 cross-file candidates (informational, not violations per se) |
| R5 | 0 |
| R6 | 3 |
| Total | 29 (plus R4 literal inventory above) |
