# AGENTS.md — Engineering Rules & Constraints

## 1. Testing and Mocking Rules
- **Enforce Vitest Primitives**: Always use standard `vi.mock()` and `vi.spyOn()` from Vitest when mocking module boundaries, network calls, or clock timers in unit tests.
- **No Mock Provider Implementations**: Never, under any circumstance, implement custom mock provider classes (e.g., do NOT create `MockModelProvider`, `FakePimsAdapter`, or handwritten dummy provider stubs). All provider abstractions must point to actual implementations or have their calls intercepted cleanly via `vi.mock` / `vi.spyOn`.
- **Zero-Cost Model Testing**: Tests must never call live LLM/embeddings APIs over the network. Always intercept `ModelProvider` methods (`embed`, `chat_json`, `rerank`) using Vitest `vi.spyOn()` on the concrete `OpenAIModelProvider` instance to eliminate token costs while running authentic pgvector and retrieval pipelines.
- **Integration Tests with Real Data Store**: For PIMS integration tests, we run our reverse-engineered PIMS API server (built with Hono and Drizzle ORM) backed by a real PostgreSQL data store in testcontainers. The schema and initial data are mounted into `/docker-entrypoint-initdb.d/` (`01-gestitel.sql` and `02-seed.sql`) and run natively on container boot.

## 2. Secrets, Tooling & Configuration
- **Secrets Management**: Production secrets are managed via `sops`; no plaintext production API keys, passwords, or tokens in git or plain config files. A local gitignored `.env` (never committed; template in `.env.example`) MAY hold development-only or dummy credentials for local runs; production credentials live exclusively in SOPS-encrypted files.
- **Tooling & Nix Policy**: NEVER assume Nix is available dynamically at runtime. If system packages or CLI tools are needed, declare them explicitly in `flake.nix`. All JavaScript/TypeScript dependencies must be managed via `bun` in `package.json`.
- **LLM Provider**: Configurable model provider abstraction implemented via `OpenAIModelProvider` (OpenAI SDK / OpenAI-compatible cloud endpoint, e.g. Mistral API via OpenAI client compatibility). SOPS credentials manage API keys deterministically. Keep token usage strictly bounded and cheap.

## 3. Architecture & Code Quality
- **Monorepo Structure**: The repository is organized as a Bun workspace monorepo under `packages/`:
  - `@pims/types`: Strict Zod schemas, inferred TypeScript types, and central error taxonomy.
  - `@pims/config`: Centralized configuration manager with `sops` decryption.
  - `@pims/models`: Configurable `ModelProvider` abstraction (`OpenAIModelProvider`).
  - `@pims/rag`: Ingestion, Tri-Modal Hybrid Index (Vector + MiniSearch BM25 + Knowledge Graph), and CRAG retrieval pipeline.
  - `@pims/pims-mock`: Reverse-engineered PIMS test API server using Hono and Drizzle ORM.
  - `@pims/pims-adapter`: Production PIMS HTTP client adapter (endpoints E01–E26).
- **Path Imports**: Follow `biome.json` strictly: relative imports (`./` or `../`) are forbidden. Always use `@pims/*` package imports.
- **Type Rigor & Zod Validation**: Loose types (such as `(string & {})`, `unknown`, `any`, and arbitrary `Record<string, unknown>`) are strictly forbidden in public contracts. Every domain model and API request/response shape must have a dedicated Zod schema and inferred TypeScript type.
- **Exhaustive Branching & Explicit State**: Every `if/else`, `switch`, or pattern match must explicitly manage state or raise a defined error. No silent `pass`, empty blocks, or warning-only logging.
- **Zero Fallbacks & Deterministic Control Flow**:
  - No machine-dependent path fallbacks (e.g., hardcoded absolute paths, `fs.existsSync(p1) ? p1 : p2`). Paths must resolve deterministically relative to workspace/project root or fail fast.
  - No speculative fallback cascades (e.g., catching errors and falling back through multiple speculative auth methods). If an expected token or credentials fail, fail fast with spec-defined named errors.
- **No Repeated Cross-File Literals**: Centralize constants, enums, error codes, and configuration parameters in `@pims/types` or designated config modules.

## 4. Specification & Agent Documentation Synchronization
- **Spec Modification Policy**: The project specifications (`docs/incident-agent-spec.md` and phase documentation) can be modified with explicit user consent.
- **Automatic Synchronization**: `AGENTS.md` and the specification files must always be kept up to date automatically whenever architectural decisions, contract shapes, or engineering constraints change.
