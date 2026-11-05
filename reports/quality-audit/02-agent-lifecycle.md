# Slice 02 agent-lifecycle — Quality Audit

Audited files (line counts), date 2026-11-05:
- `packages/agent/src/lifecycle/awareness.ts` — 4 lines
- `packages/agent/src/lifecycle/close-checklist.ts` — 338 lines
- `packages/agent/src/lifecycle/dedupe.ts` — 192 lines
- `packages/agent/src/lifecycle/markers.ts` — 70 lines

## R1

- `packages/agent/src/lifecycle/close-checklist.ts:115` — `switch (item) { case "analysis_action": ... case "bundle_sealed": ... }` (no `default`, function ends at `:132`) — switch over `CloseChecklistItem` has no `default`/exhaustive guard; an unknown future item falls off the end and resolves `undefined` instead of raising a dedicated error (unhandled switch case / missing else where state is left implicit).
- `packages/agent/src/lifecycle/close-checklist.ts:73` — `if (value.length > 0) { found = value; }` (inside `if (marker.startsWith(prefix))`, no `else`) — a marker with an empty suffix (e.g. bare `"CLOSE_APPROVED:"`) is silently skipped, leaving prior `found` state implicit instead of managing it or raising a dedicated error.

## R2

- `packages/agent/src/lifecycle/close-checklist.ts:92` — `const skipped = new Set<CloseChecklistItem>(opts?.skip ?? []);` — `?? default` hides absent `skip` state instead of requiring it or failing fast with a named error.
- `packages/agent/src/lifecycle/close-checklist.ts:138` — `const actions = incident.actions ?? [];` — `?? default` hides absent `actions` state instead of fail-fast with a named error.
- `packages/agent/src/lifecycle/dedupe.ts:44` — `counts.set(trigram, (counts.get(trigram) ?? 0) + 1);` — `?? default` hides absent map-entry state (speculative default instead of explicit get-or-insert handling).
- `packages/agent/src/lifecycle/dedupe.ts:81` — `const valueA = a[index] ?? 0;` — `?? default` hides absent vector-element state (index access that should be provably in-bounds or fail fast).
- `packages/agent/src/lifecycle/dedupe.ts:82` — `const valueB = b[index] ?? 0;` — same as above for `b`.
- `packages/agent/src/lifecycle/dedupe.ts:119` — `candidate.embedding_vector ?? embeddingByCode.get(incident.incident_code) ?? [];` — chained `??` fallback cascade (live vector → index map → empty array) hiding absent embedding state instead of fail-fast with a named error; the empty-vector case is then silently skipped at `:122`.
- `packages/agent/src/lifecycle/dedupe.ts:52` — `if (countsA.size === 0 && countsB.size === 0) { return 1; }` — silent default (`1`) for degenerate absent/empty input instead of fail-fast with a named error.
- `packages/agent/src/lifecycle/dedupe.ts:67` — `if (union === 0) { return 1; }` — silent default (`1`) hiding the zero-union state instead of a named error.
- `packages/agent/src/lifecycle/dedupe.ts:74` — `if (a.length !== b.length || a.length === 0) { return 0; }` — silent default (`0`) that swallows dimension-mismatch/empty-vector errors instead of raising a dedicated error.
- `packages/agent/src/lifecycle/dedupe.ts:58` — `const countB = countsB.get(trigram) ?? 0;` — `?? default` hides absent map-entry state (speculative default instead of explicit get-or-insert handling).
- `packages/agent/src/lifecycle/dedupe.ts:129` — `normalizeTitle(incident.compromised_system ?? incident.affected_url ?? "");` — chained `??` fallback cascade (two nullable fields → empty string) hiding absent system/URL state instead of fail-fast with a named error.

## R3

No violations found.

## R4

- `"ok"` — `close-checklist.ts:157,169,179,200,234,258,281,306,311,317,336` — success-detail magic string hardcoded in 11 places; must live in a shared constant.
- `"subject_pack_not_terminal"` — `close-checklist.ts:256,270` — same failure-detail literal hardcoded twice in one file; must live in a shared constant.
- `"T_PHASE_FOLLOWUP"`-adjacent detail duplicates: `"authority_pack_not_sent"` (`:262`), `"subject_pack_not_terminal"` (`:256,:270`), `"phase_followup_pending"` (`:281`) are each operational literals that would also collide cross-file if reused elsewhere.

Cross-file literal candidates (literal value + file:line each; counterpart files outside this slice included for global synthesis):
- `"CLOSE_APPROVED:"` — `close-checklist.ts:32` (const `CLOSE_APPROVED_PREFIX`); counterparts `packages/agent/src/orchestrator/orchestrator.ts:1853,1860,1881,2320,2323` (inline `"CLOSE_APPROVED:"` / template `` `CLOSE_APPROVED:${...}` ``) — prefix constant duplicated as inline literals in another file.
- `"BUNDLE_SEALED:"` — `close-checklist.ts:35` (const `BUNDLE_SEALED_PREFIX`); counterparts `packages/evidence/src/bundle-sealer.ts:122,142` (template `` `BUNDLE_SEALED:${...}` ``).
- `"REOPEN_BASELINE:"` — `close-checklist.ts:140` (template `` `REOPEN_BASELINE:${incident.incident_code}` ``); counterparts `packages/agent/src/orchestrator/orchestrator.ts:1778,2483`, `packages/agent/src/tools/incident-tools.ts:245`.
- `"T_PHASE_FOLLOWUP"` — `close-checklist.ts:276`; counterparts `packages/agent/src/orchestrator/orchestrator.ts:1526,2720,2725,2755`, `packages/agent/src/orchestrator/scheduler.ts:31,353`, `packages/types/src/agent.ts:101`, `packages/cockpit/src/ui/components/TimerCard.astro:21`, `packages/cockpit/src/ui/pages/compliance.astro:129`.
- `"systemic:false"` — `close-checklist.ts:313`; counterpart `packages/agent/src/orchestrator/orchestrator.ts:1427`.
- `"audit_link_skipped:"` — `close-checklist.ts:34` (const `AUDIT_LINK_SKIPPED_PREFIX`); counterpart `packages/agent/src/orchestrator/orchestrator.ts:1331` (`"audit_link_skipped:not_qualifying"`).
- `"unknown:PHASED_PENDING"` — `close-checklist.ts:33` (const `PHASED_PENDING_PREFIX`); counterpart concept `PHASED_PENDING` in `packages/agent/src/review/draft-service.ts:47` (prompt text) — different usage, listed for synthesis only.

## R5

No violations found.

## R6

- `packages/agent/src/lifecycle/close-checklist.ts:65` — `function lastMarkerWithPrefix(markers: string[], prefix: string)` hand-rolls a last-with-prefix scan (`let found ...; for (...) { if (marker.startsWith(prefix)) ... }`) — native alternative: `Array.prototype.findLast` (+ `findLastIndex`) already provides last-match search without a manual loop.
- `packages/agent/src/lifecycle/close-checklist.ts:50` — `function readsActionCount(value: JsonValue)` hand-rolls object-shape validation (`typeof`/`Number.isInteger`/`>= 0` checks) — ecosystem alternative: the zod `ReopenBaselineSchema` (`z.object({ action_count: z.number().int().nonnegative() })`) already used for the same baseline payload in `packages/agent/src/orchestrator/orchestrator.ts` and `packages/agent/src/tools/incident-tools.ts`.

## Summary

| Rule | Count |
| ---- | ----- |
| R1 | 2 |
| R2 | 11 |
| R3 | 0 |
| R4 | 8 (3 within-slice + 5 cross-file candidates, plus 1 synthesis note) |
| R5 | 0 |
| R6 | 2 |
| Total | 23 |
