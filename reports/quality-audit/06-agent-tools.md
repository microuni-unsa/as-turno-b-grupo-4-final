# Slice 06 agent-tools — Quality Audit

Date: 2026-11-05

Audited files (5):
- packages/agent/src/tools/helpers.ts (138 lines)
- packages/agent/src/tools/registry.ts (290 lines)
- packages/agent/src/tools/incident-tools.ts (484 lines)
- packages/agent/src/tools/knowledge-tools.ts (80 lines)
- packages/agent/src/tools/notice-tools.ts (284 lines)

## R1

- packages/agent/src/tools/incident-tools.ts:441 — `if (args.op === "create") { ... return ... }` followed by unconditional delete path at :458-467 — missing `else` / no `op === "delete"` guard or dedicated error for unexpected `op`; any non-`"create"` value silently falls into the delete path, leaving state implicit (violates "missing else where state is left implicit").
- packages/agent/src/tools/incident-tools.ts:259-271 — `if (args.action_type === "C" ...)`, `if (args.action_type === "A" ...)` with no `else` and the `"R"` gate nested inside `if (args.action_type === "R")` at :271 — any other `action_type` value falls through all three guards with no explicit state handling or dedicated error and proceeds to append at :308-323 (violates "branches must explicitly manage state or raise").
- packages/agent/src/tools/notice-tools.ts:257-266 — `if (pack.packType === "authority") { updateIncident } else { appendEvidenceMarker SUBJECT_NOTIFIED }` — `else` assumes `"subject"` without an explicit check or dedicated error for an unexpected third value (violates "missing else where state is left implicit"; narrow because the type is a 2-member union, recorded for completeness).

## R2

All `??` / `?. ??` silent-default sites in slice (each hides absent state instead of fail-fast with a named error):
- packages/agent/src/tools/helpers.ts:71 — `latest?.event_type ?? "none"` — defaults absent event type inside an error message instead of naming it.
- packages/agent/src/tools/helpers.ts:87 — `(value ?? "").trim().toLowerCase()` — defaults nullish token to `""`.
- packages/agent/src/tools/registry.ts:215 — `context?.incidentCode ?? null` — defaults absent context value to `null`.
- packages/agent/src/tools/registry.ts:218 — `context?.incidentId ?? null` — same.
- packages/agent/src/tools/registry.ts:221 — `context?.operatorJwtSub ?? null` — same.
- packages/agent/src/tools/registry.ts:225 — `this.deps.idempotencyKeyFactory?.(...) ?? idempotencyKey(...)` — fallback chain: optional-factory call with eager fallback instead of explicit branch + named error.
- packages/agent/src/tools/registry.ts:226 — `incidentCode ?? "global"` (inside factory fallback args) — defaults absent incident code to `"global"`.
- packages/agent/src/tools/registry.ts:241 — `incidentCode ?? "global"` in `resultRef` — same default.
- packages/agent/src/tools/registry.ts:248 — `incidentCode ?? "global"` in `appendToolLedger` — same default.
- packages/agent/src/tools/incident-tools.ts:100 — `args.description ?? null`.
- packages/agent/src/tools/incident-tools.ts:103 — `args.incident_time ?? null`.
- packages/agent/src/tools/incident-tools.ts:104 — `args.detection_date ?? null`.
- packages/agent/src/tools/incident-tools.ts:105 — `args.detection_time ?? null`.
- packages/agent/src/tools/incident-tools.ts:108 — `args.severity ?? null`.
- packages/agent/src/tools/incident-tools.ts:109 — `args.impact ?? null`.
- packages/agent/src/tools/incident-tools.ts:114 — `args.rep_document_number ?? null`.
- packages/agent/src/tools/incident-tools.ts:115 — `args.rep_document_expiry ?? null`.
- packages/agent/src/tools/incident-tools.ts:116 — `args.rep_first_name ?? null`.
- packages/agent/src/tools/incident-tools.ts:117 — `args.rep_last_name_p ?? null`.
- packages/agent/src/tools/incident-tools.ts:118 — `args.rep_last_name_m ?? null`.
- packages/agent/src/tools/incident-tools.ts:119 — `args.rep_position ?? null`.
- packages/agent/src/tools/incident-tools.ts:120 — `args.rep_phone ?? null`.
- packages/agent/src/tools/incident-tools.ts:121 — `args.rep_email ?? null`.
- packages/agent/src/tools/incident-tools.ts:122 — `args.entity_type ?? null`.
- packages/agent/src/tools/incident-tools.ts:123 — `args.entity_ruc ?? null`.
- packages/agent/src/tools/incident-tools.ts:124 — `args.entity_name ?? null`.
- packages/agent/src/tools/incident-tools.ts:125 — `args.entity_phone ?? null`.
- packages/agent/src/tools/incident-tools.ts:126 — `args.entity_extension ?? null`.
- packages/agent/src/tools/incident-tools.ts:127 — `args.entity_department ?? null`.
- packages/agent/src/tools/incident-tools.ts:128 — `args.entity_province ?? null`.
- packages/agent/src/tools/incident-tools.ts:129 — `args.entity_district ?? null`.
- packages/agent/src/tools/incident-tools.ts:130 — `args.reported_by ?? null`.
- packages/agent/src/tools/incident-tools.ts:131 — `args.assigned_to ?? null`.
- packages/agent/src/tools/incident-tools.ts:132 — `args.affected_treatment ?? null`.
- packages/agent/src/tools/incident-tools.ts:133 — `args.dpo_contact_name ?? null`.
- packages/agent/src/tools/incident-tools.ts:134 — `args.dpo_contact_email ?? null`.
- packages/agent/src/tools/incident-tools.ts:135 — `args.dpo_contact_phone ?? null`.
- packages/agent/src/tools/incident-tools.ts:136 — `args.num_affected_subjects ?? null`.
- packages/agent/src/tools/incident-tools.ts:137 — `args.compromised_system ?? null`.
- packages/agent/src/tools/incident-tools.ts:138 — `args.affected_url ?? null`.
- packages/agent/src/tools/incident-tools.ts:139 — `args.evidence_refs ?? null`.
- packages/agent/src/tools/incident-tools.ts:140 — `args.measure_updated_registry ?? null`.
- packages/agent/src/tools/incident-tools.ts:141 — `args.measure_new_security ?? null`.
- packages/agent/src/tools/incident-tools.ts:142 — `args.measure_improved_policies ?? null`.
- packages/agent/src/tools/incident-tools.ts:143 — `args.measure_considered_resolved ?? null`.
- packages/agent/src/tools/incident-tools.ts:145 — `args.measure_reported_authorities ?? null`.
- packages/agent/src/tools/incident-tools.ts:146 — `args.resolved_date ?? null`.
- packages/agent/src/tools/incident-tools.ts:150 — `args.incident_code ?? null`.
- packages/agent/src/tools/incident-tools.ts:151 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/incident-tools.ts:166 — `ctx.incidentCode ?? null`.
- packages/agent/src/tools/incident-tools.ts:167 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/incident-tools.ts:215 — `(incident.attachments ?? []).some(...)` — defaults absent attachments to `[]`.
- packages/agent/src/tools/incident-tools.ts:218 — `(incident.evidence_refs ?? "").split(";")` — defaults absent refs to `""`.
- packages/agent/src/tools/incident-tools.ts:232 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/incident-tools.ts:242 — `incident.actions ?? []`.
- packages/agent/src/tools/incident-tools.ts:248-250 — `baseline.success ? actions.slice(...) : actions` — silently falls back to full `actions` when the stored baseline fails to parse instead of raising a named error (speculative catch-all / silent default).
- packages/agent/src/tools/incident-tools.ts:310 — `args.responsible ?? UNASSIGNED_RESPONSIBLE`.
- packages/agent/src/tools/incident-tools.ts:311 — `args.action_date ?? todayUtc(ctx.now)`.
- packages/agent/src/tools/incident-tools.ts:313 — `args.evidence ?? null`.
- packages/agent/src/tools/incident-tools.ts:321 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/incident-tools.ts:344 — `updated.actions ?? []`.
- packages/agent/src/tools/incident-tools.ts:380 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/incident-tools.ts:416 — `attachment.uploaded_at ?? ctx.now.toISOString()`.
- packages/agent/src/tools/incident-tools.ts:418 — `stagedRow?.forensic_scan ?? null`.
- packages/agent/src/tools/incident-tools.ts:446 — `args.is_active ?? true`.
- packages/agent/src/tools/incident-tools.ts:448 — `_ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/incident-tools.ts:466 — `_ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/knowledge-tools.ts:29 — `ctx.incidentCode ?? undefined`.
- packages/agent/src/tools/knowledge-tools.ts:32 — `args.min_score ?? deps.config.RAG_MIN_SCORE` — silent default hiding absent score.
- packages/agent/src/tools/knowledge-tools.ts:33 — `args.top_k ?? deps.config.RAG_TOP_K` — same.
- packages/agent/src/tools/knowledge-tools.ts:57-63 — `catch (error: unknown) { if (error instanceof SchedulerPastDueError) { console.warn(...); return ... } throw error; }` — catch-all around `scheduler.arm` that converts one late-timer error into a normal success result (fallback return) instead of fail-fast with a named error.
- packages/agent/src/tools/notice-tools.ts:52 — `row.recipients_snapshot ?? []`.
- packages/agent/src/tools/notice-tools.ts:81 — `(incident.evidence_refs ?? "").split(";")`.
- packages/agent/src/tools/notice-tools.ts:209 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/notice-tools.ts:215 — `alreadySent.recipients_snapshot ?? []`.
- packages/agent/src/tools/notice-tools.ts:222 — `ctx.idempotencyKey ?? undefined`.
- packages/agent/src/tools/notice-tools.ts:235 — `notified.recipients_snapshot ?? []`.
- packages/agent/src/tools/notice-tools.ts:263 — `ctx.idempotencyKey ?? undefined`.

## R3

No violations found.

## R4

Repeated literals WITHIN this slice (each hardcoded in 2+ files of the 5, so must live in a shared constant/config):
- `"global"` — registry.ts:225,226,241,248 (4x); cross-file candidate: no other slice file uses `"global"`, but the 4x within-registry repetition itself violates single-source (should be one `GLOBAL_INCIDENT_CODE` constant).
- `"measure_reported_authorities"` — registry.ts:83,114,122; incident-tools.ts:144-145; notice-tools.ts:206,259 (patch key + update payload repeated across 3 files).
- `"status"` / `"resolved_date"` / `"actions"` / `"measure_updated_registry"` / `"measure_new_security"` / `"measure_improved_policies"` / `"measure_considered_resolved"` / `"is_deleted"` / `"deleted_at"` — registry.ts:76-85 denied-key set; several (`status`, `resolved_date`, `actions`) reappear as object keys in incident-tools.ts:107,146-147,229 — patch-field name literals duplicated across registry + incident-tools.
- `";"` evidence/marker split delimiter — incident-tools.ts:219; notice-tools.ts:82 (same operational delimiter in 2 files).
- `"REOPENED:"` marker prefix — incident-tools.ts:46 (pattern),214,221 (3x, plus `REOPEN_BASELINE:` at :245 and `REOPENED:` in pattern).
- `"UNASSIGNED"` — incident-tools.ts:47 (`UNASSIGNED_RESPONSIBLE` value) reused at :310,339.
- `"authority"` / `"subject"` pack-type literals — notice-tools.ts:101-104,112,119-127,160,191-196,203,243-248,257 (each ~6x+ within file, plus approval `pack_type !== "resolution"` at incident-tools.ts:295 vs notice-tools.ts:160 — pack-type string family repeated across incident-tools + notice-tools).
- `"approved"` / `"sent"` draft-pack state literals — notice-tools.ts:136,190-197,243-250.
- `"updated"` history event-type literal — incident-tools.ts:324 (`assertPostHistory(..., "updated")`); cross-file candidate: `helpers.ts:62-75 assertPostHistory` takes the same `eventType` string param and `"notified"` plays the same role in notice-tools.ts:49 — event-type string family across incident-tools + notice-tools.
- `"pims_add_action"` consumer tag — incident-tools.ts:330; cross-file candidate: `pims_notify:${pack.packType}` consumer tags at notice-tools.ts:201,253 (tool-name-derived ledger/consumer strings rebuilt per file).
- `"SUBJECT_NOTIFIED:"` marker prefix — notice-tools.ts:84,272.
- `ctx.idempotencyKey ?? undefined` / `incidentCode: code` option-object shape — repeated verbatim at incident-tools.ts:151,167,232,321,380,448,466 and notice-tools.ts:209,222,263 (same operational literal shape in 2 files; should be one helper).
- `16` in `.slice(0, 16)` — registry.ts:244; `10` in `.slice(0, 10)` — incident-tools.ts:62 (magic truncation lengths; cross-file candidate pair for shared constants).
- `1000` ms multiplier — registry.ts:168 (`PIMS_ACCESS_TOKEN_TTL_S * 1000`).

Cross-file-literal candidates for global synthesis (literal value + file:line each; other file may be outside this slice):
- `"global"` — registry.ts:225,226,241,248.
- `"measure_reported_authorities"` — registry.ts:83,114,122; incident-tools.ts:144; notice-tools.ts:206,259.
- `";"` — incident-tools.ts:219; notice-tools.ts:82.
- `"UNASSIGNED"` — incident-tools.ts:47,310,339.
- `"REOPENED:"` — incident-tools.ts:46,214,221.
- `"SUBJECT_NOTIFIED:"` — notice-tools.ts:84,272.
- `"approved"` / `"sent"` — notice-tools.ts:136,190,243.
- `"updated"` — incident-tools.ts:324.
- `"notified"` — notice-tools.ts:49.
- `"TIMER_FIRED_LATE:"` — knowledge-tools.ts:59.
- `"REOPEN_BASELINE:"` — incident-tools.ts:245.
- `"pims_add_action"` — incident-tools.ts:330.
- `"resolution"` — incident-tools.ts:295.

## R5

No violations found.

## R6

- packages/agent/src/tools/helpers.ts:37 — `JsonObjectSchema.parse(JSON.parse(JSON.stringify(value)))` — hand-rolled deep-clone via JSON round-trip; native alternative: `structuredClone(value)` (then schema-parse the clone).
- packages/agent/src/tools/helpers.ts:44-60 and packages/agent/src/tools/notice-tools.ts:44-67 — hand-rolled newest-row max loops (`new Date(...).getTime()` comparisons + id tiebreak) duplicated in two files; native/ecosystem alternative: a shared `maxBy` helper (or `Array.prototype.reduce`) instead of two bespoke loops.
- packages/agent/src/tools/helpers.ts:109-121 — `matchesAsset` hand-rolled multi-field substring/fuzzy matcher (`normalizeAssetToken`, `includes` chains); ecosystem alternative: a standard fuzzy/search helper or a single shared predicate instead of bespoke per-file matching.
- packages/agent/src/tools/registry.ts:139-147 — `firstIssueField` hand-rolled zod issue formatter (`issues[0]`, `path.join(".")`); native/ecosystem alternative: zod's own error formatting (`error.format()` / `z.prettifyError`) instead of a custom extractor.
- packages/agent/src/tools/incident-tools.ts:61-63 — `todayUtc` hand-rolled date truncation (`toISOString().slice(0, 10)`); native alternative: `Date.prototype.toISOString` + shared date-only helper or `Intl.DateTimeFormat` with UTC day precision instead of per-file slicing.
- packages/agent/src/tools/incident-tools.ts:53-59 — `isAllowedTransition` hand-rolled boolean transition table; ecosystem alternative: a declarative transition map / Set of `from->to` pairs instead of chained `||` conditions.

## Summary

| Rule | Count |
| ---- | ----- |
| R1 | 3 |
| R2 | 73 |
| R3 | 0 |
| R4 | 15 |
| R5 | 0 |
| R6 | 6 |
| Total | 97 |
