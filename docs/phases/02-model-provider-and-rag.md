# Phase 2: ModelProvider Abstraction and Tri-Modal RAG Subsystem

## Objective
Implement the configurable `ModelProvider` abstraction utilizing OpenAI-compatible cloud provider SDKs and construct the Tri-Modal Knowledge Graph RAG retrieval engine with dense bi-encoder anchor grounding, HyDE expansion, CRAG grading, and reciprocal rank fusion.

## Requirements & Scope
- **ModelProvider Abstraction (`packages/models/src/openai-provider.ts`)**:
  - Implementation conforming to §4.3: `chat_json`, `vision_json`, `embed`, and `rerank`.
  - Configurable cloud endpoints (OpenAI SDK / OpenAI-compatible provider e.g. Mistral API via OpenAI endpoint).
  - Configurable endpoints and environment variable resolution for `REASONING_MODEL`, `FAST_MODEL`, `VISION_MODEL`, `EMBEDDINGS_MODEL`, `RERANKER_MODEL`.
  - Zero-fallback discipline: no silent endpoint defaults or ad-hoc cosine similarity fallbacks; strict Zod schema validation.
  - Strict testing rule: test model orchestration and error handling using Vitest `vi.mock()` / `vi.spyOn()` on the HTTP transport, never by instantiating mock provider classes.
- **Corpus Ingestion & Pluggable Sources (`packages/rag/src/corpus-loader.ts`)**:
  - Pluggable ingestion sources: `LocalCorpusSource` (local directory) and `S3CorpusSource` (AWS S3 bucket via `@aws-sdk/client-s3`).
  - Normative compliance corpus: `GDPR.txt` (`gdpr-full`, normative) and `ISO 27701-2025_ocr.pdf` (`iso27701`, normative). Note: PIMS database schemas and Anexos are operational data queried dynamically live via PIMS client adapter tools (E01–E26) and are excluded from static RAG.
  - Deterministic chunking: normative sources split on article/clause boundaries (512 tokens / 64 overlap); contextual headers prepended: `[DOC:<id> | CLAUSE:<clause> | NORMATIVE:<bool>]`.
  - Globally unique chunk IDs generated to prevent collision in indexers: `${docId}:${clause}:L${lineNum}:${subIdx}`.
  - SHA-256 corpus hashing: version = `sha256(sorted(file hashes))`.
- **Tri-Modal Hybrid Retrieval Engine (`packages/rag/src/rag-service.ts`)**:
  - Modal 1: Dense Vector Index (pgvector embeddings vectors).
  - Modal 2: MiniSearch / BM25 lexical index over chunk text.
  - Modal 3: Bipartite Normative Knowledge Graph with Dense Bi-Encoder Anchor Grounding (pre-embedded node definitions, cosine similarity anchor selection, and Personalized PageRank traversal).
  - Retrieval Pipeline:
    1. Agentic query decomposition, HyDE clause generation, and dense bi-encoder entity anchor grounding.
    2. 3-Way Reciprocal Rank Fusion (RRF) over Dense + BM25 + Personalized PageRank (PPR).
    3. Cross-encoder / LLM reranking to select top `RAG_RERANK_K` passages.
    4. Corrective RAG (CRAG) self-grading (`supported`, `ambiguous`, `unsupported`).
    5. Normative filtering (`normative_only=true` for compliance-sensitive operations).
- **Automated RAG Evaluation Gate (`tests/integration/rag-eval-gate.test.ts`)**:
  - Automated execution of all 10 normative queries defined in §7.6 (Q01 through Q10).
  - Asserting minimum threshold score ≥0.35 and presence of required verbatim citations.

## Deliverables
- `packages/models/src/openai-provider.ts`: Configurable cloud model adapter conforming to `ModelProvider`.
- `packages/types/src/rag.ts` & `models.ts`: Strict Zod schemas and inferred types for RAG, Knowledge Graph, and model contracts.
- `packages/rag/src/corpus-loader.ts`: Ingestion pipeline supporting local and S3 sources with deterministic contextual prefixing and unique chunk IDs.
- `packages/rag/src/knowledge-graph.ts`: In-memory bipartite graph with dense bi-encoder anchor resolution and PPR traversal.
- `packages/rag/src/rag-service.ts`: Retrieval and CRAG pipeline.
- `tests/unit/model-provider.test.ts`: Unit tests using Vitest `vi.spyOn` / `vi.mock`.
- `tests/integration/rag-eval-gate.test.ts`: Evaluation harness verifying 10/10 PASS on §7.6 queries.

## Verification & Acceptance
- §7.6 evaluation suite passes 10/10 queries with exact citations.
- Ingestion produces deterministic corpus SHA-256 hash and unique chunk IDs.
- Unit tests run with zero mock provider classes.
