# AGENTS.md — Engineering Rules & Constraints

## 1. Testing and Mocking Rules
- **Enforce Vitest Primitives**: Always use standard `vi.mock()` and `vi.spyOn()` from Vitest when mocking module boundaries, network calls, or clock timers in unit tests.
- **No Mock Provider Implementations**: Never, under any circumstance, implement custom mock provider classes (e.g., do NOT create `MockModelProvider`, `FakePimsAdapter`, or handwritten dummy provider stubs). All provider abstractions must point to actual implementations or have their calls intercepted cleanly via `vi.mock` / `vi.spyOn`.
- **Integration Tests with Real Data Store**: For PIMS integration tests, we reverse engineer our own version of the API backed by a real PostgreSQL data store, run inside containers / testcontainers with schema initialized from `data/gestitel_base_de_datos.sql`.

## 2. Secrets & Configuration
- **Secrets Management**: Secrets are managed via `sops`. No plaintext API keys, passwords, or tokens in git or plain config files.
- **LLM Provider**: Configurable model provider. Mistral API key is available for cost-effective execution on free tier (`V392gd36SfruU1rb7Lk5Z13TIWgnunwh`). Keep token usage strictly bounded and cheap.

## 3. Architecture & Code Quality
- **Path Imports**: Follow `biome.json` strictly: relative imports (`./` or `../`) are forbidden. Always use the `@/*` path alias.
- **Exhaustive Branching & Explicit State**: Every `if/else`, `switch`, or pattern match must explicitly manage state or raise a defined error. No silent `pass`, empty blocks, or warning-only logging.
- **Zero Fallbacks & Deterministic Control Flow**: No fallback chains, speculative catch-alls, or silent defaults. Fail fast with spec-defined named errors.
- **No Repeated Cross-File Literals**: Centralize constants, enums, error codes, and configuration parameters.
