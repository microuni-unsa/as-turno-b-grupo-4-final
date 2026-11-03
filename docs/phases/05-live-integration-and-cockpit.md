# Phase 5: Live PIMS Integration Hardening, Continuous Watcher Daemon, and Real-Time Cockpit & AI Chat

## Objective
Establish seamless, live end-to-end integration with the deployed GESTITEL PIMS application at `https://unsa.27k.pe`, eliminate all production serializer discrepancies between the reverse-engineered schemas and live Django REST responses, build an autonomous continuous Live Incident Watcher Daemon in `@pims/agent`, integrate native PIMS roles and permission filtering (Anexo 05), strictly prohibit all static or mocked runtime data, and construct a feature-complete Real-Time Cockpit & AI Chat assistant exposing internal agent reasoning and verbatim RAG citations.

---

## Requirements & Scope

### 1. Live API Compatibility & Serialization Alignment
- **Discrepancy Remediation in `@pims/types`**:
  - `PimsIncidentSchema`: Normalize `is_deleted` (`null`/omitted → `false`) because Django REST Framework querysets omit soft-deleted flags from `/api/incidents/` responses.
  - `PimsIncidentHistorySchema`: Normalize `recipients_snapshot` from comma-separated string, array, or null to `string[] | null | undefined`. Live status transitions are emitted as `event_type:"updated"`; no `status_changed` row is produced.
  - `UserProfileSchema`: Make `id` and `must_change_password` optional and accept live `is_external_advisor` / `platform_role`.
  - `PimsPermissionSchema` + `PimsJwtClaimsSchema`: Match the live E01 `permissions[]` matrix and JWT payload exactly.
  - E12 attachment response: live returns a single object, mock returns an array; the adapter normalizes both. Live rejects `.json` attachments, so the bundle is `bundle.json.txt` with `text/plain`.
- **Live Verification**:
  - Run live integration smoke tests verifying authentication, profile inspection, incident listing, SPA attachment acceptance, and a throwaway `LIVE-SMOKE-<uuid>` create → patch (severity/impact/CID) → append `C` action → `O→P→C` walk against tenant `unsa` using operator credentials `grupob4`. The throwaway incident remains closed (operator lacks `delete_incident`).

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
  - Periodically polls `GET /api/incidents/?status=O` and `?status=P` on `WATCHER_POLL_INTERVAL_MS` (default 5000), paginating until a short page and ignoring `C`.
  - In-memory lock and retry backoff prevent concurrent executions on the same incident; stage state persists under `WATCHER:<incident_code>` and is inferred after restart from live PIMS + evidence.
  - When an unhandled open incident is detected:
    - Automatically transitions `O -> P`.
    - Triggers triage, single-prompt root-cause analysis (5-whys), containment actions (`C`), and audit finding linkage (`E19`).
    - Executes Dual-Modal RAG retrieval, drafts regulatory notices, and evaluates statutory exemptions.
    - Emits real-time lifecycle events to the Cockpit.
    - With `AUTO_NOTIFY=false` (default), parks approved packs at `AWAITING_APPROVAL` and emits `review:approval_requested`; `POST /api/incidents/:id/approve` resumes. With `AUTO_NOTIFY=true`, notices send automatically (`HUMAN_VETO_WINDOW_MIN` applies only then).
    - Dispatches notices, seals the cryptographic bundle, uploads exactly one `bundle.json.txt` to `core_incidentattachment` (E12), and transitions status to `C`; a close re-run reuses the sealed manifest and never duplicates the attachment.

### 5. Real-Time Glass-Box Cockpit & AI Chat Backend (JSON/SSE only)
*(No UI, no HTML, no visual layout, no browser voice/SpeechRecognition. Every endpoint returns JSON or Server-Sent Events; a separate client may consume it later.)*
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
*(Note: The standalone Web Intake Form is dropped. Incident intake occurs directly in `https://unsa.27k.pe` or via the AI Chat assistant).*

---

## Deliverables
- `packages/types/src/pims.ts`: Resilient Zod schemas matching live Django REST serialization.
- `packages/agent/src/orchestrator/watcher.ts`: Autonomous background polling daemon.
- `packages/agent/src/events/agent-events.ts`: Typed lifecycle and mutation event emitter.
- `packages/cockpit/`: Decoupled JSON/SSE cockpit backend (`@pims/cockpit`) providing login/session handling, `/api/stream` SSE, approve/revision/exemption endpoints, AI Chat, and `/healthz` + `/readyz`, with PIMS role and permission filtering.
- `tests/integration/live-pims-smoke.test.ts`: Live integration smoke tests validating authentication, profile inspection, and incident operations against `https://unsa.27k.pe`.

---

## Verification & Acceptance
- Live authentication, profile, listing, history and throwaway create→patch→close pass without Zod validation errors; `.json` upload is recorded as rejected and `bundle.json.txt` is accepted.
- Creating an incident on `https://unsa.27k.pe` is detected and advanced to `awaiting_approval` within one poll interval; `POST /api/incidents/:id/approve` sends notices and closes it with one `bundle.json.txt`.
- Real-time events, exact verbatim RAG quotes (chunk SHA-256, dense score, BM25 rank, RRF score), and dynamic 72h countdown clocks stream over SSE with zero static/mocked data.
- Permission filtering correctly hides mutation actions and security logs for Lector accounts, and rejects approve/persona-override attempts with 403.
- Operator role switching dynamically adjusts AI chat persona responses and explanations; the configured live recipient must be provisioned via E15 (`grupob4@unsa.edu.com`) before live close can pass.

### Secret hygiene
`data/site.md` was previously tracked and contains live tenant credentials. It is now untracked (`git rm --cached`, local file kept) and listed in `.gitignore` together with `data/pims_password`; neither file is read by code or tests. The old password remains in git history and **must be rotated after verification**.

### Live verification result (2026-11-03)
- Tenant `unsa`, operator `grupob4`, live incident `INC-001`: detected at `O`, triaged to `P` (H/H), contained/analysed, drafted and reviewed authority+subject packs, parked at `AWAITING_APPROVAL`, sent notices after cockpit approval, uploaded exactly one `bundle.json.txt`, and closed `P→C` with `BUNDLE_SEALED:<sha256>`.
- Bundle bytes match `canonicalizeJson(sealed manifest)`; history contains `notified`; close fields `measure_considered_resolved=Y` and `measure_reported_authorities=Y`; actions are `C*→A+→R`.
- Live chat returned 4 verbatim citations with 64-hex `chunk_sha256` and non-null dense/BM25/RRF/rerank scores.
- Live serializer/tool fixes required by this run: `.json` attachments rejected (use `.txt`), history status changes emitted as `updated`, audit nested finding/action ids omitted (link by position), media download needs `Accept: */*`, and free-tier Ministral rejects logprobs (set `MODEL_LOGPROBS=false`).
- The phase follow-up timer for the phased authority pack was fast-forwarded to exercise the overdue path; the live audit corrective-action link was created after the first investigation attempt hit the nested-audit serializer gap. Both are recorded as live-compatibility follow-ups, not hidden defaults.
