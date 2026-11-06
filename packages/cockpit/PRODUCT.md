# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro + Starwind UI + Lucide icons for the new UI, over the existing Hono JSON/SSE backend (`@pims/cockpit`, already built). User-chose. Deploy topology (same Bun server vs separate static host) explicitly undecided — see Capabilities and Constraints.

## Users

Primary: incident operator (native PIMS Operador, e.g. `grupob4`) running live breach response end to end: drafting incidents in the guided-create section instead of the PIMS SPA form, watching the daemon's intake/triage/containment loop, approving Art 33/34 notice packs, attesting Art 34(3)(a) exemptions, requesting revisions, closing incidents against the 72h clock.

Secondary (confirmed by backend role/permission filtering, `docs/phases/05-live-integration-and-cockpit.md` §3):

- DPO (Editor, «Oficial de Protección de Datos»): 72h countdowns, draft notices, statutory exemption attestations — the sole approver of notice packs.
- Auditor / consultant reader (Lector): view-only incidents plus verbatim RAG citations.
- Platform admin (Administrador): full panels, security logs, mutation ledger, audit links.

## Product Purpose

Web UI client for the Glass-Box Cockpit backend: a real-time operations console over the autonomous incident-response agent acting on live GESTITEL PIMS, tenant `unsa`. The backend streams every agent step (role handoffs, RAG retrievals, PIMS mutations, timers) over SSE; the UI makes that stream operable. Success: the operator drafts each incident's reporting sections once (agent-drafted, operator-checked) and clears every human gate (approvals, exemptions, revisions) before its clock expires, with zero invented data on screen.

## Positioning

Glass-box console for an autonomous GDPR breach-response closed loop: watcher daemon → triage → single-prompt root-cause analysis → C/A/R actions → Dual-Modal RAG drafts → human DPO approval → sealed evidence bundle → PIMS close. Every step is streamed live with verbatim normative quotes, retrieval scores, and forensic hashes, and every irreversible step (notice dispatch, Art 34(3) exemption) waits on an explicit, permission-gated human decision. A neighboring dashboard could not truthfully copy the loop behind the glass.

## Operating Context

- Agent loop: guided-create submit (or watcher-detected `O`) → `O→P` → triage → 5-whys RCA → `C` actions + E19 audit link → RAG retrieval → notice drafts → `AWAITING_APPROVAL` (`AUTO_NOTIFY=false` default) → cockpit approve (content-hash-bound, single-use authorization) → notify → seal bundle → exactly one `bundle.json.txt` upload → `C`.
- Clocks: Art 33 72h from `awareness_at_utc`, 4h internal review SLA, phased follow-up timers, Peru 48h advisory (never asserted as law).
- Backend already exists (`packages/cockpit/src/`): `POST /api/login` (live PIMS E01/E04, native roles + permission matrix), `GET /api/stream` (SSE snapshot + agent events + heartbeat), guided-create endpoints (`POST /api/incidents/draft`, `POST /api/incidents/explain`, `POST /api/incidents` per spec §8.4), approve / revision / exemption endpoints, `POST /api/chat` (persona-adapted, five query tools), `/healthz` + `/readyz`.
- Operator/admin chat persona switching («Viewing as: Auditor / Executive / DPO-Legal») changes tone, depth, and alert routing.
- Runtime: Bun server + Docker, env-driven config, AES-256-GCM evidence store, secrets via env/`*_CMD` only, never in git.

## Capabilities and Constraints

Confirmed UI scope (user chose full glass-box ops console): guided incident creation (agent-drafted reporting form with per-field explain and dictation input, operator check/fix before submit), live incident sync, regulatory countdown clocks, role-transition stream, verbatim RAG citation stream (quote + chunk SHA-256 + dense/BM25/RRF/rerank scores), mutation ledger, DPO decision triggers (approve authority notice / request revision / Art 34(3)(a) attestation), persona-adapted AI chat with pending-decision warnings.

Constraints:

- Zero static or mocked runtime data: every pixel comes from live PIMS E01–E26 calls or live agent state. RAG shows exact quotes with scores, never "clauses xxx apply".
- Permission-shaped UI: `change_incident` gates guided-create draft/submit, approvals, transitions, and exemptions; `view_incident` gates field explain; `view_securitylog` gates the raw ledger/bitácora (admin + operator only); `view_audit` / `view_riskevaluation` gate audit/risk panels. Lector gets read-only indicators; mutations return 403.
- PII never enters model prompts (Presidio sidecar redaction per spec §11.3); chat citations are grounded in stored retrieval records validated by `chunk_sha256` + scores.
- Art 34 subject notices exclude Art 33(3)(a) counts unless the DPO explicitly approves; exemptions require structured attestations plus DPO approval; an authority order to notify overrides any granted exemption.

Explicitly undecided: deploy topology (serve the Astro UI from the same Bun/Hono server vs a separate static host behind Docker); UI copy language (the PIMS SPA is Spanish, the spec is English); which cockpit surface gets built first (no surface brief exists yet).

## Brand Commitments

- Product/tenant identity: UNSA Gestión Integrada on the GESTITEL platform (live reference `https://unsa.27k.pe`).
- Binding user direction: replicate the primary PIMS site's visual style, cleaned of AI-slop tells, as a cleaner version of it — not a new visual world. Visual specifics belong to new-work/document, not here.

## Evidence on Hand

- Live tenant `https://unsa.27k.pe` plus operator credentials in `data/site.md` and `data/pims_password` (untracked, gitignored, never read by code; the old password remains in git history and must be rotated per the phase-05 secret-hygiene note).
- Backend contracts: `packages/cockpit/src/*.ts`; agent, RAG, evidence, notices, and adapter packages; `docs/incident-agent-spec.md` (v1.1.0-final) plus `docs/phases/*.md`; 38 live-API transcripts in `docs/incident-agent-capture/`; corpora in `corpus/`.
- Live verification 2026-11-03: `INC-001` full-loop proof recorded in the phase-05 footer.
- Absent and must not be fabricated: UI scaffold and tokens, testimonials, customers, benchmarks, pricing, licensing. No PRODUCT.md existed before this file; no DESIGN.md exists.

## Product Principles

1. Live truth only: if it did not come from PIMS or the agent, it is not on screen.
2. Nothing irreversible without a human: every dispatch and exemption waits on an explicit, permission-gated decision.
3. Verbatim over paraphrase: norms are quoted with provenance and scores, never summarized into hand-waving.
4. Same language as PIMS: identical codes (`INC-###`), statuses (`O`/`P`/`C`), action types (`C`/`A`/`R`), roles, and vocabulary as the GESTITEL SPA.
5. Role-shaped visibility: every panel reflects what the signed-in role may see and do — nothing more.
