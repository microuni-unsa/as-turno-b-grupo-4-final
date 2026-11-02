# Phase 5: Live PIMS Integration Hardening, Continuous Watcher Daemon, and Real-Time Cockpit & AI Chat

## Objective
Establish seamless, live end-to-end integration with the deployed GESTITEL PIMS application at `https://unsa.27k.pe`, eliminate all production serializer discrepancies between the reverse-engineered schemas and live Django REST responses, build an autonomous continuous Live Incident Watcher Daemon in `@pims/agent`, integrate native PIMS roles and permission filtering (Anexo 05), strictly prohibit all static or mocked runtime data, and construct a feature-complete Real-Time Cockpit & AI Chat assistant exposing internal agent reasoning and verbatim RAG citations.

---

## Requirements & Scope

### 1. Live API Compatibility & Serialization Alignment
- **Discrepancy Remediation in `@pims/types`**:
  - `PimsIncidentSchema`: Make `is_deleted` optional/defaulted to `false` (Django REST Framework querysets omit soft-deleted flags from `/api/incidents/` responses).
  - `PimsIncidentHistorySchema`: Support `recipients_snapshot` as a union of string, array of strings, or null to match live database representations.
  - `UserProfileSchema`: Make `id` and `must_change_password` optional to match live `/business/profile/`.
- **Live Verification**:
  - Run live integration smoke tests verifying authentication, profile inspection, incident listing, and mutation against tenant `unsa` using operator credentials `grupob4`.

### 2. Strict Prohibition of Static or Mocked Runtime Data
- **Live Data Mandate**: Zero synthetic dummy strings, canned clauses, hardcoded timestamps, or simulated payloads in runtime execution. All displayed data must originate from live PIMS API calls (E01–E26) or live computed agent state.
- **Verbatim RAG Grounding**: RAG retrieval must output exact verbatim quotes from the ingested normative corpora (ISO 27701:2025, ISO 27001:2022, GDPR, Ley 29733), chunk SHA-256 identifiers, dense embedding similarity scores, BM25 ranks, and Reciprocal Rank Fusion (RRF) scores. Hand-waving citations ("clauses xxx, yyy apply") are strictly forbidden.
- **Authentic Incident Lifecycle Data**: 5-whys root-cause analyses and containment actions must be synthesized dynamically by the LLM from genuine incident attributes and written directly to `core_incidentaction` (E08) and `core_auditfinding` (E19). Regulatory countdown timers are calculated dynamically from live `awareness_at_utc`.

### 3. Native PIMS Roles & Permissions Integration (Anexo 05 §4.5–§4.7)
- **Automatic Per-User Role Detection**:
  - Reads authenticated JWT claims and user profile from `E01 /business/login/` and `E04 /business/profile/`.
  - Automatically configures user visibility and chat persona according to their native PIMS role:
    - **Administrador** (`is_platform_admin: true`, `manage_users`): Complete access to all panels, security logs, mutation ledger, and audit links.
    - **Operador** (`operator` / `grupob4`): Operational control over incidents, mutation ledger, and approvals.
    - **Editor («Oficial de Protección de Datos» / DPO)**: Compliance views, 72h countdown clocks, draft notices, and statutory exemption attestations.
    - **Lector («Auditor / Consultor»)**: View-only access to incidents and verbatim RAG citations.
- **Granular Permission Filtering**:
  - `change_incident`: Guards notice approval triggers, status transitions, and exemption attestations. Lector accounts receive read-only indicators.
  - `view_securitylog`: Guards raw HTTP mutation ledger and bitácora streams; visible exclusively to Administrador and Operador.
  - `view_audit` / `view_riskevaluation`: Filters out audit finding and risk assessment panels if permissions are lacking.
- **Operator/Admin Role-Switching**:
  - Users with Operador or Administrador privileges can switch the active chat persona at will (*"Viewing as: Auditor"*, *"Viewing as: Executive / Manager"*, *"Viewing as: DPO / Legal"*), modifying tone, explanation depth, and proactive alert routing.

### 4. Autonomous Live Incident Watcher Daemon (`@pims/agent`)
- **Continuous Polling Loop**:
  - Runs continuously as a background service (`bun run start`).
  - Periodically polls `GET /api/incidents/?status=O` on a configurable tick interval (default: 5–10s).
  - In-memory lock and state tracking prevent concurrent executions on the same incident.
  - When an unhandled open incident is detected:
    - Automatically transitions `O -> P`.
    - Triggers triage, single-prompt root-cause analysis (5-whys), containment actions (`C`), and audit finding linkage (`E19`).
    - Executes Dual-Modal RAG retrieval, drafts regulatory notices, and evaluates statutory exemptions.
    - Emits real-time lifecycle events to the Cockpit.
    - Upon human approval (or auto-approval policy), dispatches notices, seals cryptographic bundle (`bundle.json`), uploads it to `core_incidentattachment` (E12), and transitions status to `C`.

### 5. Real-Time Glass-Box Cockpit & AI Chat Features
*(Feature-only specification: layout, styling, and visual component design are handled entirely separately).*
- **Observability Streams (SSE via `/api/stream`)**:
  - **Live PIMS Incident Synchronization**: Streaming list of open, in-progress, and closed incidents synchronized with the live tenant.
  - **Regulatory Countdown Timers**: Live countdown clock for GDPR Art 33 72-hour deadline derived from `awareness_at_utc`, and internal 4-hour review SLA clock.
  - **Agent Brain & Role Transitions**: Real-time broadcast of role handoffs (`triage` → `investigator` → `drafter` → `reviewer` → `notifier`) and active lease holders.
  - **Dual-Modal RAG Citation Stream**: Real-time display of cited ISO 27701 and GDPR clauses with exact verbatim quotes and retrieval scores.
  - **Mutation Ledger**: Chronological stream of outbound PIMS HTTP calls (idempotency key, duration, endpoint, payload summary, HTTP status).
  - **DPO Decision Triggers**: Actions for notice approval ("Approve Authority Notice" / "Request Revision") and Art 34(3)(a) encryption proof attestation.
- **AI Chat Assistant**:
  - **Persona-Adapted Language**: Dynamically alters explanations, terminology, and granularity based on the user's role (or selected operator persona).
  - **Proactive Decision Warnings**: Proactively notifies the user if an action is awaiting human sign-off (e.g. notice approval required before 72h window closes).
  - **Connected Query Tools**:
    - `get_incident_status(code)`: Current lifecycle state, severity, and timestamps.
    - `list_active_incidents()`: Summary of active breaches.
    - `get_regulatory_timers()`: Time remaining on regulatory and internal SLAs.
    - `get_rag_citations(code)`: Verbatim normative quotes and retrieval scores.
    - `check_pending_decisions()`: Check for pending human sign-off actions.
  - **Browser-Native Voice Transcription**: Speech-to-text input via standard browser Web Speech API (`SpeechRecognition`), allowing spoken questions and dictation without backend audio processing dependencies.

*(Note: The standalone Web Intake Form is dropped. Incident intake occurs directly in `https://unsa.27k.pe` or via the AI Chat assistant).*

---

## Deliverables
- `packages/types/src/pims.ts`: Resilient Zod schemas matching live Django REST serialization.
- `packages/agent/src/orchestrator/watcher.ts`: Autonomous background polling daemon.
- `packages/agent/src/events/agent-events.ts`: Typed lifecycle and mutation event emitter.
- `packages/cockpit/`: Cockpit web service providing SSE stream (`/api/stream`), approval triggers, and AI Chat endpoints with PIMS role and permission filtering.
- `tests/integration/live-pims-smoke.test.ts`: Live integration smoke tests validating authentication, profile inspection, and incident operations against `https://unsa.27k.pe`.

---

## Verification & Acceptance
- Live authentication and incident listing on `https://unsa.27k.pe` pass without Zod validation errors.
- Creating an incident on `https://unsa.27k.pe` is detected autonomously by the running watcher daemon within 10 seconds.
- Real-time events, exact verbatim RAG quotes, and dynamic 72h countdown clocks stream cleanly over SSE with zero static/mocked data.
- Permission filtering correctly hides mutation actions and security logs for Lector accounts.
- Operator role switching dynamically adjusts AI chat persona responses and explanations.
