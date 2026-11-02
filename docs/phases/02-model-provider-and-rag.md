# Phase 2: ModelProvider Abstraction and Dual-Modal RAG Subsystem

## Objective
Implement the configurable `ModelProvider` abstraction utilizing OpenAI-compatible cloud provider SDKs and construct the Dual-Modal (dense + BM25) retrieval engine with 2-way reciprocal rank fusion, cross-encoder rerank, and min-score filtering.

## Requirements & Scope
- **ModelProvider Abstraction (`packages/models/src/openai-provider.ts`)**:
  - Implementation conforming to §4.3: `chat_json`, `vision_json`, `embed`, and `rerank`.
  - Configurable cloud endpoints (OpenAI SDK / OpenAI-compatible provider e.g. Mistral API via OpenAI endpoint).
  - Configurable endpoints and environment variable resolution for `REASONING_MODEL`, `FAST_MODEL`, `VISION_MODEL`, `EMBEDDINGS_MODEL`, `RERANKER_MODEL`.
  - Zero-fallback discipline: no silent endpoint defaults or ad-hoc cosine similarity fallbacks; strict Zod schema validation.
  - Strict testing rule: test model orchestration and error handling using Vitest `vi.mock()` / `vi.spyOn()` on the HTTP transport, never by instantiating mock provider classes.
- **Corpus Ingestion & Pluggable Sources (`packages/rag/src/corpus-loader.ts`)**:
  - Pluggable ingestion sources: `LocalCorpusSource` (local directory) and `S3CorpusSource` (AWS S3 bucket via `@aws-sdk/client-s3`).
  - Extensible section-loader registry (`SectionLoader` strategy + `SectionLoaderRegistry`, extension-keyed): markdown heading sections via mdast AST (remark), plain-text paragraph groups, PDF per-page sections via unpdf; shared token-cap chunker with sequential IDs.
  - Normative compliance corpus: `gdpr-full.txt` (`gdpr-full`, normative) and `iso27701.md` (`iso27701`, normative curated markdown containing project-relevant clauses 4.2, 5.3, 6.1.2, 6.1.3, 6.13, 6.13.1.1–6.13.1.7, 8.2, 9.2, 9.3.2, 10.2, A.3.11, A.3.12, B.3.11, B.3.12).
  - Deterministic chunking: sections capped to maxTokens with chunkOverlap-line windows; contextual headers prepended: `[DOC:<id> | CLAUSE:<label> | NORMATIVE:<bool>]`; doc_id from slugified filename stem only.
  - Globally unique chunk IDs generated to prevent collision in indexers.
  - SHA-256 corpus hashing: version = `sha256(sorted(file hashes))`.
- **Dual-Modal Hybrid Retrieval Engine (`packages/rag/src/rag-service.ts`)**:
  - Modal 1: Dense Vector Index (pgvector embeddings vectors).
  - Modal 2: MiniSearch / BM25 lexical index over chunk text.
  - Retrieval Pipeline:
    1. Parallel dense (pgvector) and BM25 retrieval over the same chunk corpus.
    2. 2-Way Reciprocal Rank Fusion (RRF) over Dense + BM25 (`RRF_K`, `RRF_WEIGHT_DENSE`, `RRF_WEIGHT_BM25` in `@pims/types/constants.ts`) → `RAG_TOP_K` candidates.
    3. Cross-encoder / LLM reranking to select top `RAG_RERANK_K` passages.
    4. Min-score filter (`RAG_MIN_SCORE`); every passage below threshold is dropped and an empty result raises `RAG_NO_EVIDENCE`.
    5. Normative filtering (`normative_only=true` for compliance-sensitive operations).
- **Automated RAG Evaluation Gate (`tests/integration/rag-eval-gate.test.ts`)**:
  - Automated execution of all 10 normative queries defined in §7.6 (Q01 through Q10).
  - Asserting minimum threshold score ≥0.35 and presence of required verbatim citations.
  - Zero-cost test architecture using Vitest `vi.spyOn()` function replacements on the concrete `OpenAIModelProvider` instance backed by real pgvector testcontainers.
  - Harness embedding geometry (`tests/helpers/span-geometry.ts`, authorized deviation 2026-10-30): deterministic hash vectors plus explicit normative-span axes (GDPR Art 33/34 line ranges from the fixture, ISO heading markers) so dense retrieval ranks the normative sections as real embeddings would; pure-hash vectors peak at cosine ~0.15 and collapse the dense ranking.

## Deliverables
- `packages/models/src/openai-provider.ts`: Configurable cloud model adapter conforming to `ModelProvider`.
- `packages/types/src/rag.ts` & `models.ts`: Strict Zod schemas and inferred types for RAG and model contracts.
- `packages/rag/src/corpus-loader.ts`: Ingestion pipeline supporting local and S3 sources with deterministic contextual prefixing and unique chunk IDs.
- `packages/rag/src/rag-service.ts`: Dual-modal retrieval and rerank pipeline.
- `tests/unit/model-provider.test.ts`: Unit tests using Vitest `vi.spyOn` / `vi.mock`.
- `tests/integration/rag-eval-gate.test.ts`: Evaluation harness verifying 10/10 PASS on §7.6 queries.

## Verification & Acceptance
- §7.6 evaluation suite passes 10/10 queries with exact citations.
- Ingestion produces deterministic corpus SHA-256 hash and unique chunk IDs.
- Unit tests run with zero mock provider classes.

## Audit sync 2026-10-30

Temperature→route rule replaced by an explicit caller-supplied `route` arg on `chat_json` (`FAST_MODEL`/`REASONING_MODEL`); retrieval constants centralized in `@pims/types/constants.ts` (`RRF_K`, `RRF_WEIGHT_DENSE`, `RRF_WEIGHT_BM25`, `RAG_DENSE_K`, `RAG_BM25_K`, top-K); Cohere-native `/v2/rerank` branch documented with explicit endpoint+model requirements; corpus version formula fixed to `sha256(sorted(file hashes))`; `searchFts5` alias removed (canonical `searchBM25`); the knowledge-graph module, `graphology-pagerank` dependency, and the `linkChunks`/PPR harness geometry were removed in the downscale (2-way RRF over dense + BM25 only); local gitignored `.env` for dev/dummy credentials explicitly allowed by the updated AGENTS.md secrets rule.
