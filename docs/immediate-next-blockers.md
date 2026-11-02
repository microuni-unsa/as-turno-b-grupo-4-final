# Immediate Next Blockers & Implementation Plan

> **Goal**: Launch the autonomous agent daemon configured via environment variables (`bun run start` or containerized via Docker), create a personal data breach incident in the live deployed application at `https://unsa.27k.pe`, and verify that the daemon autonomously detects, analyzes, contains, notifies, and closes the incident live on the deployed platform while an interactive Cockpit & AI Chat assistant streams all internal reasoning, verbatim RAG citations, and live mutation ledgers with zero static or mocked data.

---

## Blocker 1: Live PIMS API Serializer Alignment (Schema Hotfix)

### Status & Root Cause
Live probing against `https://unsa.27k.pe` with tenant credentials (`grupob4`) confirmed that authentication works, but `adapter.listIncidents()` and `adapter.getProfile()` threw `PimsErrorShapeUnknownError` due to discrepancies between Django REST Framework (DRF) serializers and `@pims/types`:
1. **`is_deleted`**: DRF querysets on `https://unsa.27k.pe` filter out soft-deleted rows and omit `is_deleted` from the public JSON serializer.
2. **`recipients_snapshot`**: In `core_incidenthistory`, DRF returns a comma-separated string (e.g. `"spec-capture-throwaway@example.com"`) or `null`, whereas our schema expected `z.array(z.string()).nullable()`.
3. **`UserProfile`**: DRF `/business/profile/` returns `{username, first_name, last_name, email, is_platform_admin, is_external_advisor, platform_role}`, omitting `id` and `must_change_password`.

### Immediate Actions
1. In `packages/types/src/pims.ts`:
   - Change `is_deleted: z.boolean()` in `PimsIncidentSchema` to `is_deleted: z.boolean().default(false)`.
   - Update `recipients_snapshot` in `PimsIncidentHistorySchema` to accept `z.union([z.string(), z.array(z.string())]).nullable()`.
   - Update `UserProfileSchema` to make `id` and `must_change_password` optional.
2. Run `bun run test:unit` to guarantee zero regressions across existing unit tests.
3. Run a live smoke test to confirm `adapter.listIncidents()`, `adapter.getIncident(1)`, and `adapter.getProfile()` return 100% valid parsed objects against `https://unsa.27k.pe`.

---

## Blocker 2: Autonomous Continuous Incident Watcher Daemon (`@pims/agent`)

### Status & Root Cause
The Orchestrator currently executes lifecycle steps (`triage`, `investigate`, `draftAndReview`, `approveAndNotify`, `close`) on-demand when called directly in tests. There is no background service polling the live PIMS continuously for newly created incidents.

### Immediate Actions
1. Create `packages/agent/src/orchestrator/watcher.ts`:
   - Polls `GET /api/incidents/?status=O` on a configurable interval (default: 5–10 seconds).
   - In-memory lock & tracking set to prevent concurrent or duplicate runs on the same incident ID.
   - When an open incident is detected:
     - Automatically transitions `O -> P` via adapter.
     - Runs `triage()` (PII detection, severity, impact).
     - Runs `investigate()` (single-prompt root-cause 5-whys, C* actions pushed to live PIMS via E08).
     - Links qualifying corrective actions in `core_auditfinding` (E19).
     - Runs `draftAndReview()` (Dual-Modal RAG retrieval with verbatim quotes on ISO 27701 B.3.11/B.3.12 and GDPR Art 33/34, adversarial challenge review).
     - If auto-notify is disabled or human review required, pauses in state `AWAITING_APPROVAL` and emits an event to the Cockpit.
     - Upon approval, invokes `approveAndNotify()`, uploads sealed evidence bundle (`bundle.json`) via E12, and invokes `close()` (`P -> C`).
2. Implement typed event emitter (`packages/agent/src/events/agent-events.ts`) broadcasting each state change, tool call, verbatim RAG score, and countdown timer update.

---

## Blocker 3: Real-Time Cockpit & AI Chat Service (`@pims/cockpit`)

### Status & Root Cause
The agent currently operates headlessly. For interactive observability and stakeholder engagement, the system must stream all internal operations in real time and provide an AI Chat assistant with native PIMS role adaptation and permission-based data filtering.

### Immediate Actions
1. Implement Cockpit backend service in `packages/cockpit`:
   - Endpoint `GET /api/stream`: Server-Sent Events (SSE) streaming real-time agent events (role transitions, 72h countdown ticks, verbatim RAG citations, mutation ledger).
   - Endpoint `POST /api/incidents/:id/approve`: Human approval trigger to resume and complete notification.
   - Endpoint `POST /api/incidents/:id/exemption`: Attest Art 34(3)(a) encryption proof exemption.
   - Endpoint `POST /api/chat`: AI Chat assistant endpoint connecting live query tools (`get_incident_status`, `list_active_incidents`, `get_regulatory_timers`, `get_rag_citations`, `check_pending_decisions`).
2. Implement Native PIMS Roles & Permissions (Anexo 05):
   - Authenticate incoming sessions via PIMS JWT claims (`E01 /business/login/` and `E04 /business/profile/`).
   - Automatically adapt visibility and chat responses according to user's role (`Administrador`, `Operador`, `Editor / DPO`, `Lector / Auditor`).
   - Filter out mutation actions for read-only roles and hide security logs for non-admin/non-operator users.
   - Provide role switcher in chat for users with Operator or Administrador privileges.
3. Client-side browser voice transcription:
   - Provide speech-to-text input via standard browser Web Speech API (`SpeechRecognition`).

---

## Blocker 4: Production Build & Docker Continuous Deployment

### Status & Root Cause
The daemon must run continuously in background environments driven purely by environment variables, with zero staged runbooks or artificial demo workflows.

### Immediate Actions
1. Add production build script in `package.json`:
   ```bash
   "build": "bun build packages/cockpit/src/server.ts --outdir dist --target bun"
   ```
2. Create multi-stage `Dockerfile` packaging the compiled daemon and cockpit service.
3. Verify that running the container with live environment variables continuously watches `https://unsa.27k.pe`, handles newly created incidents automatically, and seals cryptographic bundles upon closure.

---

## Execution Checklist

- [ ] **Task 1**: Update Zod schemas in `packages/types/src/pims.ts` and verify unit tests (`bun run test:unit`).
- [ ] **Task 2**: Write live integration smoke test (`tests/integration/live-pims-smoke.test.ts`) against `https://unsa.27k.pe`.
- [ ] **Task 3**: Implement `IncidentWatcherDaemon` and event emitter in `packages/agent`.
- [ ] **Task 4**: Build the Cockpit server and AI Chat service with PIMS role and permission filtering in `packages/cockpit`.
- [ ] **Task 5**: Configure `bun run build` and multi-stage `Dockerfile`.
- [ ] **Task 6**: Verify end-to-end continuous flow: live incident created in `https://unsa.27k.pe` -> Watcher detects -> Cockpit streams -> AI Chat adapts -> Autonomous resolution -> Sealed closure (`P -> C`).
