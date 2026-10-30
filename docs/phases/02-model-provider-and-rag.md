# Phase 2: ModelProvider Abstraction and Tri-Modal RAG Subsystem

## Objective
Implement the configurable `ModelProvider` abstraction utilizing Mistral API (and other cloud models) and construct the Tri-Modal Knowledge Graph RAG retrieval engine with HyDE expansion, CRAG grading, and reciprocal rank fusion.

## Requirements & Scope
- **ModelProvider Abstraction (`src/models/provider.ts`)**:
  - Implementation conforming to §4.3: `chat_json`, `vision_json`, `embed`, and `rerank`.
  - Mistral API integration using the provided API key, operating strictly within budget with concise prompts.
  - Configurable endpoints and environment variable resolution for `REASONING_MODEL`, `FAST_MODEL`, `VISION_MODEL`, `EMBEDDINGS_MODEL`, `RERANKER_MODEL`.
  - Strict testing rule: test model orchestration and error handling using Vitest `vi.mock()` / `vi.spyOn()` on the HTTP transport, never by instantiating mock provider classes.
- **Corpus Ingestion & Indexing (`src/rag/indexer.ts`)**:
  - Corpus sources per §7.1: `data/GDPR.txt`, `data/gdpr.txt`, `data/ISO 27701-2025_ocr.pdf`, `data/gestitel_base_de_datos.sql`, `data/Anexo_*.pdf`, `data/class*.txt`, and live capture schemas.
  - Deterministic chunking: normative sources split on article/clause boundaries (512 tokens / 64 overlap); contextual headers prepended: `[DOC:<id> | CLAUSE:<clause> | NORMATIVE:<bool>]`.
  - SHA-256 corpus hashing: version = `sha256(sorted(file hashes))`.
- **Tri-Modal Hybrid Retrieval Engine (`src/rag/engine.ts`)**:
  - Modal 1: Dense Vector Index (embeddings vectors).
  - Modal 2: SQLite FTS5 lexical BM25 index over chunk text.
  - Modal 3: Bipartite Normative Knowledge Graph (ISO clauses, controls, GDPR articles, PIMS columns, E22 catalogs).
  - Retrieval Pipeline:
    1. Agentic query decomposition & HyDE clause generation.
    2. 3-Way Reciprocal Rank Fusion (RRF) over Dense + BM25 + Personalized PageRank (PPR).
    3. Cross-encoder reranking to select top `RAG_RERANK_K` passages.
    4. Corrective RAG (CRAG) self-grading (`supported`, `ambiguous`, `unsupported`).
    5. Normative filtering (`normative_only=true` for compliance-sensitive operations).
- **Automated RAG Evaluation Gate (`tests/rag/eval-gate.test.ts`)**:
  - Automated execution of all 10 normative queries defined in §7.6 (Q01 through Q10).
  - Asserting minimum threshold score ≥0.35 and presence of required verbatim citations.

## Deliverables
- `src/models/model-provider.ts`: Multi-cloud model adapter supporting Mistral.
- `src/rag/types.ts`: Graph, chunk, and passage definitions.
- `src/rag/corpus-loader.ts`: Ingestion pipeline with deterministic contextual prefixing and SHA-256 version verification.
- `src/rag/knowledge-graph.ts`: In-memory bipartite graph with PPR traversal.
- `src/rag/rag-service.ts`: Retrieval and CRAG pipeline.
- `tests/unit/model-provider.test.ts`: Unit tests using Vitest `vi.spyOn` / `vi.mock`.
- `tests/integration/rag-eval-gate.test.ts`: Evaluation harness verifying 10/10 PASS on §7.6 queries.

## Verification & Acceptance
- §7.6 evaluation suite passes 10/10 queries with exact citations.
- Ingestion produces deterministic corpus SHA-256 hash.
- Unit tests run with zero mock provider classes.
