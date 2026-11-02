# Phase 1: Foundation, Reverse-Engineered PIMS Test API, and PIMS Client Adapter

## Objective
Establish the foundational type system with strict Zod validation, error taxonomy, configuration loader with fail-fast environment/`*_CMD` validation, a reverse-engineered PIMS test API server built with Hono and Drizzle ORM backed by a real PostgreSQL data store in testcontainers (initialized via `/docker-entrypoint-initdb.d/`), and the complete PIMS HTTP Client Adapter covering endpoints E01–E26 with exact capture fidelity in a clean Bun workspace monorepo.

## Requirements & Scope
- **Monorepo Architecture**:
  - Organized under `packages/` using Bun workspaces (`@pims/types`, `@pims/config`, `@pims/pims-mock`, `@pims/pims-adapter`).
  - Strict `@pims/*` package path imports; relative cross-file imports strictly forbidden.
- **Domain & Schema Modeling (`@pims/types`)**:
  - Full TypeScript types and runtime Zod schemas for `core_incident` (48 domain columns + 7 `AuditModel` columns = 55 DB columns / 57 JSON keys), `core_incidentaction`, `core_incidentattachment`, `core_incidenthistory`, `core_incidentrecipient`, `core_auditfinding`, `core_auditactionplan`, `core_riskevaluation`.
  - Fixed catalogs from the PIMS SPA bundle: 12 `affected_data_types`, 10 `security_measures_adopted`, `affected_cid` (C/I/D), attachment allowlists, and single-code enums (`status`, `severity`, `impact`, `incident_type`, `action_type`, etc.).
  - Zero weak types: no `(string & {})`, `unknown`, `any`, or loose `Record<string, unknown>`.
- **Configuration & Secrets (`@pims/config`)**:
  - Centralized configuration manager reading keys defined in §13 of the spec.
  - Secrets resolve from environment variables or `*_CMD` helpers per spec §11.2; no encrypted-file path.
  - Strict validation: missing required keys fail fast with `CONFIG_MISSING:<KEY>`, type errors raise `CONFIG_TYPE:<KEY>`.
  - Zero fallback paths; deterministic path resolution.
- **Reverse-Engineered PIMS Test API Server (`@pims/pims-mock`)**:
  - Real PostgreSQL container loaded natively with `data/gestitel_base_de_datos.sql` and `data/02-init-unsa-seed.sql` via `/docker-entrypoint-initdb.d/` bind mounts.
  - Fast, modular HTTP server implemented with Hono and Drizzle ORM mimicking GESTITEL Django REST Framework behavior:
    - JWT authentication (`/business/login/`, `/business/token/refresh/`) with tenant schema validation.
    - Endpoints E01 through E26 with exact status codes, error structures (`{"field": ["..."]}`, HTTP 400 validation, HTTP 404, HTTP 401, HTTP 403, HTTP 429).
    - Reproducing server-side logic: system code generation (`INC-###`, `AUD-2026-###`, `R-###`), immutable `core_incidenthistory` logging, logical deletion semantics.
- **PIMS Client Adapter (`@pims/pims-adapter`)**:
  - Implementation of all 26 endpoints with Bearer token refresh and deterministic re-login.
  - Comprehensive error mapping per §3.6 to spec-defined named errors.
  - Client-side idempotency key injection (`<IDEMPOTENCY_KEY_PREFIX>:<incident_code>:<op>:<uuid>`) and reconcile-before-retry pattern.
  - Startup probe execution for nested array mutation strategy (`replace` vs `merge`) for incident actions (E08) and audit findings/actions (E19).
  - Null-clear capability probing for nullable fields.

## Deliverables
- `packages/types/`: Complete Zod schemas, TypeScript models, enums, catalog definitions, and error taxonomy.
- `packages/config/`: Strongly typed configuration loader with fail-fast environment/`*_CMD` validation and zero fallback paths.
- `packages/pims-mock/`: Reverse-engineered PIMS server implementation using Hono and Drizzle ORM.
- `packages/pims-adapter/`: Production PIMS HTTP client adapter with strict typing.
- `data/02-init-unsa-seed.sql`: Container entrypoint initialization and seeding script.
- `tests/integration/pims-adapter.test.ts`: Integration test suite running against containerized PostgreSQL and Hono test server.
- `tests/unit/config.test.ts`: Unit tests using Vitest `vi.mock` / `vi.spyOn` for config and error mapping.

## Verification & Acceptance
- Database container automatically initializes schema and seed without manual stream parsing.
- Startup probe successfully identifies REPLACE vs MERGE and logs `NESTED_PROBE:<mode>`.
- Full pass rate on integration tests for incident creation, triage update, nested action additions, recipient management, and simulated network failures.
- Zero mock provider implementations created.
