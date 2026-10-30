# Phase 1: Foundation, Reverse-Engineered PIMS Test API, and PIMS Client Adapter

## Objective
Establish the foundational type system, error taxonomy, configuration loader with `sops` decryption, a reverse-engineered PIMS test API server backed by a real PostgreSQL data store in containers, and the complete PIMS HTTP Client Adapter covering endpoints E01–E26 with exact capture fidelity.

## Requirements & Scope
- **Domain & Schema Modeling**:
  - Full TypeScript types for `core_incident` (48 domain columns + 7 `AuditModel` columns = 55 DB columns / 57 JSON keys), `core_incidentaction`, `core_incidentattachment`, `core_incidenthistory`, `core_incidentrecipient`, `core_auditfinding`, `core_auditactionplan`, `core_riskevaluation`.
  - Fixed catalogs from the PIMS SPA bundle: 12 `affected_data_types`, 10 `security_measures_adopted`, `affected_cid` (C/I/D), attachment allowlists, and single-code enums (`status`, `severity`, `impact`, `incident_type`, `action_type`, etc.).
- **Configuration & Secrets**:
  - Centralized configuration manager reading keys defined in §13 of the spec.
  - Integration with `sops` for decrypting sensitive environment variables and credentials.
  - Strict validation: missing required keys fail fast with `CONFIG_MISSING:<KEY>`, type errors raise `CONFIG_TYPE:<KEY>`.
- **Reverse-Engineered PIMS Test API Server**:
  - Real PostgreSQL container loaded with `data/gestitel_base_de_datos.sql`.
  - Lightweight HTTP server running inside testcontainers / docker mimicking GESTITEL Django REST Framework behavior:
    - JWT authentication (`/business/login/`, `/business/token/refresh/`) with tenant schema validation.
    - Endpoints E01 through E26 with exact status codes, error structures (`{"field": ["..."]}`, HTTP 400 validation, HTTP 404, HTTP 401, HTTP 403, HTTP 429).
    - Reproducing server-side logic: system code generation (`INC-###`, `AUD-2026-###`, `R-###`), immutable `core_incidenthistory` logging, logical deletion semantics.
- **PIMS Client Adapter (`src/adapter/pims-adapter.ts`)**:
  - Implementation of all 26 endpoints with Bearer token auto-refresh and session re-login on expiration.
  - Comprehensive error mapping per §3.6 to spec-defined named errors.
  - Client-side idempotency key injection (`<IDEMPOTENCY_KEY_PREFIX>:<incident_code>:<op>:<uuid>`) and reconcile-before-retry pattern.
  - Startup probe execution for nested array mutation strategy (`replace` vs `merge`) for incident actions (E08) and audit findings/actions (E19).
  - Null-clear capability probing for nullable fields.

## Deliverables
- `src/types/pims.ts`: Complete data models, enums, and catalog definitions.
- `src/types/errors.ts`: Central error taxonomy with all named errors.
- `src/config/index.ts`: Strongly typed configuration loader with `sops` decryption.
- `src/testing/pims-server/`: Reverse-engineered PIMS server implementation and database seeding script.
- `src/adapter/pims-adapter.ts`: Production PIMS HTTP client adapter.
- `tests/integration/pims-adapter.test.ts`: Integration test suite running against the containerized PIMS API server.
- `tests/unit/config.test.ts`: Unit tests using Vitest `vi.mock` / `vi.spyOn` for config and error mapping.

## Verification & Acceptance
- Startup probe successfully identifies REPLACE vs MERGE and logs `NESTED_PROBE:<mode>`.
- Full pass rate on integration tests for incident creation, triage update, nested action additions, recipient management, and simulated network failures.
- Zero mock provider implementations created.
