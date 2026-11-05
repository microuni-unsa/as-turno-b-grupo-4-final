# Phase 6: Production Hardening, Continuous Daemon Deployment, and Acceptance Suite

## Objective
Establish the definitive autonomous production deployment of the incident response daemon, package a production build target (`bun run build`) with a containerized Docker distribution, execute the automated acceptance suite (A01 through A24), and verify that the daemon operates continuously in the background—detecting and resolving live personal data breaches created via Cockpit guided-create (§8.4) or in `https://unsa.27k.pe` purely through environment variable configuration without any separate runbooks or staged scripts.

---

## Requirements & Scope

### 1. Autonomous Continuous Execution (Zero Staged Workflows)
- **Continuous Daemon Lifecycle**:
  - The system launches as a single background daemon (`bun run start`) and runs continuously.
  - No staged presentation scripts, no artificial test runners, and no bespoke demo runbooks are permitted.
  - The watcher daemon continuously polls `GET /api/incidents/?status=O` against the configured PIMS instance.
- **Natural Live Incident Handling**:
  - An operator drafts a genuine personal data breach incident (e.g., electoral registry leak) in the Cockpit guided-create section (§8.4: narrative + targeted fills, operator review, explicit PII yes/no) and submits it, or creates it in the live university application at `https://unsa.27k.pe` using their regular web browser.
  - The running daemon automatically detects the new incident within its polling tick:
    - Automatically transitions status `O -> P`.
    - Retrieves relevant ISO 27701 (B.3.11, B.3.12, 10.2) controls and GDPR (Art 33, 34) articles with exact verbatim quotes and retrieval scores.
    - Arms the dynamic 72-hour countdown timer calculated from live `awareness_at_utc`.
    - Synthesizes dynamic 5-whys root-cause analysis and pushes containment actions (`C`) directly into `core_incidentaction` via E08.
    - Creates qualifying corrective action findings in `core_auditfinding` (E19).
    - Drafts GDPR Art 33/34 notices, runs plain-language token validation, and evaluates statutory exemptions.
    - Upon DPO approval (or configured auto-approval policy), dispatches the notice, seals the canonical cryptographic evidence bundle (`bundle.json.txt`), uploads it to `core_incidentattachment` (E12), and transitions status to `C` (Closed).
- **Zero-Touch Verification**:
  - Refreshing `https://unsa.27k.pe` confirms the incident is closed, actions are listed, attachments contain the sealed bundle, and `core_incidenthistory` reflects the full audit trail.

### 2. Unified Environment Configuration
- The entire system switches between local test/mock mode and production live mode strictly via environment variables:
  - **Local Mock Mode**:
    ```bash
    PIMS_BASE_URL="http://localhost:8080"
    PIMS_TENANT="unsa"
    PIMS_USERNAME="mock_user"
    PIMS_PASSWORD="mock_password"
    EVIDENCE_DB_URL="postgres://pims:pims@localhost:5432/pims_evidence"
    ```
  - **Production Live Mode**:
    ```bash
    PIMS_BASE_URL="https://unsa.27k.pe"
    PIMS_TENANT="unsa"
    PIMS_USERNAME="grupob4"
    PIMS_PASSWORD="<plain-password-from-secret-store>"
    LLM_API_KEY_CMD="cat /run/secrets/llm_key"
    EVIDENCE_DB_URL="postgres://pims:pims@db:5432/pims_evidence"
    ```
- All configuration values fail fast on startup if required variables are missing or malformed.

### 3. Production Build & Docker Packaging
- **Build Target (`bun run build`)**:
  - Bundles the daemon, agent orchestrator, and Cockpit service into a standalone, optimized distribution.
  - Compiles TypeScript cleanly without type-checking errors (`tsc --noEmit`).
- **Minimal Multi-Stage Dockerfile**:
  - Builds an unprivileged, read-only root container image running the compiled Bun distribution.
  - Boots cleanly with a single `docker run` command using mounted environment variables or secret commands.
  - Exposes health (`/healthz`), readiness (`/readyz`), SSE stream (`/api/stream`), and Cockpit endpoints.

### 4. Automated Acceptance Suite (A01–A24)
- Maintain and verify the 24 acceptance test scenarios against containerized PostgreSQL and live API probes:
  - **A01**: Full autonomous breach lifecycle flow (`O -> P -> C`).
  - **A02**: Expedited 4-hour review SLA breach and escalation.
  - **A03**: Intake with missing PII flag (conservative fallback with `assumed_pii` tag).
  - **A04**: Non-PII security incident path (C/A/R actions without Art 33/34 notices).
  - **A05**: Blocked notification when zero active recipients are configured (`NOTIFY_NO_RECIPIENTS`).
  - **A06**: Human approval window parking and auto-send on expiry.
  - **A07**: Post-close evidence arrival triggering `C -> P` reopening.
  - **A08**: Art 34(3)(a) encryption exemption evaluation with verified evidence.
  - **A09**: Art 34(3)(c) disproportionate effort exemption requiring public communication artifact.
  - **A10**: Supervisory authority override of exemption decision.
  - **A11**: PIMS 5xx network retry resilience and exponential backoff.
  - **A12**: Restart replay with unverified notify state recovery from history.
  - **A13**: `OPERATOR_HALT` kill-switch halting autonomous loop.
  - **A14**: 10/10 RAG evaluation gate with exact verbatim citations.
  - **A15**: Risk signal creation and queuing when risk period is closed.
  - **A16**: Full mechanical verification gates execution (G1–G6).
  - **A18**: Guided submit creates a fully-reported `O` row via `channel: "cockpit_guided"` (response fields empty, timers armed, stream events emitted).
  - **A19**: Guided draft from one free narrative returns fielded reporting sections with provenance, no persistence.
  - **A20**: Dictated narrative follows the identical redaction + extraction path (no backend STT).
  - **A21**: Field explain returns deterministic code tables or RAG-cited guidance, repeat-identical.
  - **A22**: Guided near-duplicate submission dedupes (no second row, kept code surfaced).
  - **A23**: Presidio sidecar outage fails closed (`PII_REDACTION_UNAVAILABLE`, `/readyz` red).
  - **A24**: Golden redaction fixtures tokenize exactly per the §11.3 entity→token table.

---

## Deliverables
- `Dockerfile`: Multi-stage Docker container specification for the continuous daemon.
- `package.json`: Updated `build` and `start` scripts.
- `tests/acceptance/a01-a24.test.ts`: Automated test suite covering all 24 acceptance scenarios.
- `scripts/verify-gates.sh`: Automated mechanical validation script (G1–G6).

---

## Verification & Acceptance
- `bun run build` succeeds and produces a standalone distribution bundle.
- The daemon boots inside a Docker container using live environment variables and marks readiness (`/readyz`).
- Creating a personal data breach via Cockpit guided-create (or in `https://unsa.27k.pe`) triggers automatic detection, containment action creation, audit finding creation, regulatory notice generation, evidence bundle sealing, and closure without human intervention or external scripts.
- All acceptance tests A01–A24 and mechanical gates G1–G6 pass cleanly.
