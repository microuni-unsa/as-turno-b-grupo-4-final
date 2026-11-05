# Slice 05 agent-orchestrator-roles — Quality Audit

Audited files (line counts, date 2026-11-05):
- packages/agent/src/orchestrator/roles.ts — 284 lines
- packages/agent/src/orchestrator/scheduler.ts — 363 lines
- packages/agent/src/orchestrator/watcher.ts — 592 lines
- packages/agent/src/tools/risk-audit-tools.ts — 407 lines

## R1
No violations found.

## R2
- packages/agent/src/orchestrator/scheduler.ts:145 — `this.random = deps.random ?? Math.random;` — `?? default` supplying a concrete function instead of fail-fast with a named error.
- packages/agent/src/orchestrator/watcher.ts:69 — `this.clock = deps.clock ?? (() => new Date());` — `?? default` supplying a concrete clock instead of fail-fast with a named error.
- packages/agent/src/orchestrator/watcher.ts:70-76 — `deps.page ?? ((alert) => { console.error(...); });` — `?? default` page handler that only logs without affecting control flow, hiding absent dependency instead of fail-fast.
- packages/agent/src/orchestrator/watcher.ts:357 — `const attempt = this.retryByIncident.get(incident.id)?.attempt ?? 0;` — `?? 0` defaulting absent retry state to zero instead of explicit state handling.
- packages/agent/src/orchestrator/watcher.ts:365 — `] ?? RECIPIENT_RETRY_MS` — `?? default` fallback when backoff index misses, hiding out-of-range state instead of fail-fast.
- packages/agent/src/orchestrator/watcher.ts:371 — `const attempt = (current?.attempt ?? 0) + 1;` — `?? 0` defaulting absent attempt count instead of explicit state handling.
- packages/agent/src/tools/risk-audit-tools.ts:34-36 — `if (value === undefined) { return "O"; }` — silent default `"O"` hiding absent status instead of fail-fast with a named error.
- packages/agent/src/tools/risk-audit-tools.ts:64 — `action.action_plan ?? action.description ?? ""` — chained `??` fallbacks ending in `""`, hiding absent action_plan/description instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:65 — `action.responsible ?? "UNASSIGNED"` — `?? default` string hiding absent responsible instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:66 — `action.due_date ?? fallbackDueDate` — `?? default` hiding absent due_date instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:68 — `action.progress ?? 0` — `?? 0` hiding absent progress instead of explicit handling.
- packages/agent/src/tools/risk-audit-tools.ts:88 — `` `${risk.name} ${risk.code} ${risk.risk_code ?? ""}` `` — `?? ""` hiding absent risk_code in search haystack.
- packages/agent/src/tools/risk-audit-tools.ts:127 — `asset_ids: args.asset_ids ?? []` — `?? []` hiding absent asset_ids instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:150 — `let assetIds = args.asset_ids ?? [];` — `?? []` hiding absent asset_ids instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:229 — `risk_code: row.risk_code ?? row.code` — `??` fallback chain hiding absent risk_code instead of explicit branch with named error.
- packages/agent/src/tools/risk-audit-tools.ts:248-253 — `args.due_date ?? addDays(...)` — `??` computed default hiding absent due_date instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:254 — `args.responsible ?? "UNASSIGNED"` — `?? default` hiding absent responsible instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:288 — `const findings = audit.findings ?? [];` — `?? []` hiding absent findings instead of explicit handling.
- packages/agent/src/tools/risk-audit-tools.ts:342 — `args.finding_description ?? `${prefix}: root cause pending`` — `??` generated default hiding absent description instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:361 — `const writtenFindings = afterAudit.findings ?? [];` — `?? []` hiding absent findings after write instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:369 — `const writtenActions = writtenFinding.actions ?? [];` — `?? []` hiding absent actions after write instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:378 — `const findingId = writtenFinding.id ?? writtenFindingIndex;` — `??` index fallback hiding absent persisted id instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:379 — `const actionPlanId = writtenAction.id ?? writtenActionIndex;` — `??` index fallback hiding absent persisted id instead of fail-fast.
- packages/agent/src/tools/risk-audit-tools.ts:401 — `audit_code: afterAudit.audit_code ?? afterAudit.code` — `??` fallback chain hiding absent audit_code instead of explicit handling.

## R3
No violations found.

## R4
Within-slice repeats (same operational literal hardcoded 2+ times in these 4 files):
- `"UNASSIGNED"` — packages/agent/src/tools/risk-audit-tools.ts:65, packages/agent/src/tools/risk-audit-tools.ts:254 — shared default-responsible string; must live in a shared constant.
- `"RISK_PERIOD_CLOSED"` — packages/agent/src/tools/risk-audit-tools.ts:132, packages/agent/src/tools/risk-audit-tools.ts:146 — reason string repeated; must live in a shared constant.
- `"post_write_missing"` — packages/agent/src/tools/risk-audit-tools.ts:359, packages/agent/src/tools/risk-audit-tools.ts:367, packages/agent/src/tools/risk-audit-tools.ts:375 — error-code string repeated; must live in a shared constant.
- `"AUDIT_LINK:"` — packages/agent/src/tools/risk-audit-tools.ts:385, packages/agent/src/tools/risk-audit-tools.ts:395 — marker prefix repeated; must live in a shared constant.
- `"watcher_state"` — packages/agent/src/orchestrator/watcher.ts:240, packages/agent/src/orchestrator/watcher.ts:248, packages/agent/src/orchestrator/watcher.ts:467 — validation-field string repeated; must live in a shared constant.
- `"INVALID_WATCHER_STATE"` — packages/agent/src/orchestrator/watcher.ts:385, packages/agent/src/orchestrator/watcher.ts:467 — error-code string repeated; must live in a shared constant.
- `"awaiting_approval"` — packages/agent/src/orchestrator/watcher.ts:196, packages/agent/src/orchestrator/watcher.ts:203, packages/agent/src/orchestrator/watcher.ts:211, packages/agent/src/orchestrator/watcher.ts:221, packages/agent/src/orchestrator/watcher.ts:260, packages/agent/src/orchestrator/watcher.ts:285, packages/agent/src/orchestrator/watcher.ts:316 — stage string repeated; must live in a shared constant/enum.
- `"notified"` — packages/agent/src/orchestrator/watcher.ts:215, packages/agent/src/orchestrator/watcher.ts:264, packages/agent/src/orchestrator/watcher.ts:275, packages/agent/src/orchestrator/watcher.ts:289 — stage string repeated; must live in a shared constant/enum.
- `"investigated"` — packages/agent/src/orchestrator/watcher.ts:185, packages/agent/src/orchestrator/watcher.ts:269, packages/agent/src/orchestrator/watcher.ts:422 — stage string repeated; must live in a shared constant/enum.
- `"drafted"` — packages/agent/src/orchestrator/watcher.ts:194, packages/agent/src/orchestrator/watcher.ts:317, packages/agent/src/orchestrator/watcher.ts:414 — stage string repeated; must live in a shared constant/enum.
- `"NOTIFY_NO_RECIPIENTS"` — packages/agent/src/orchestrator/watcher.ts:255, packages/agent/src/orchestrator/watcher.ts:318, packages/agent/src/orchestrator/watcher.ts:333 — reason string repeated; must live in a shared constant.
- `"T_RETRY"` — packages/agent/src/orchestrator/scheduler.ts:32, packages/agent/src/orchestrator/scheduler.ts:238, packages/agent/src/orchestrator/scheduler.ts:290, packages/agent/src/orchestrator/watcher.ts:332, packages/agent/src/orchestrator/watcher.ts:355 — timer-kind string repeated; must live in a shared constant/enum.
- `` `timer:${...}` `` prefix `"timer:"` — packages/agent/src/orchestrator/scheduler.ts:173, packages/agent/src/orchestrator/scheduler.ts:286 — id-prefix string repeated; must live in a shared constant.
- `` `WATCHER:${incident.incident_code}` `` prefix `"WATCHER:"` — packages/agent/src/orchestrator/watcher.ts:380, packages/agent/src/orchestrator/watcher.ts:451, packages/agent/src/orchestrator/watcher.ts:460 — state-key prefix repeated; must live in a shared constant.
- `60_000` — packages/agent/src/orchestrator/watcher.ts:24, packages/agent/src/orchestrator/watcher.ts:25 — same timeout ms repeated in `RECIPIENT_RETRY_MS` and `TRANSIENT_BACKOFF_MS`; must live in a shared constant.
- `"REQUIRED"` — packages/agent/src/tools/risk-audit-tools.ts:112, packages/agent/src/tools/risk-audit-tools.ts:239 — validation-message string repeated; must live in a shared constant.
- `"incident_id"` — packages/agent/src/tools/risk-audit-tools.ts:112, packages/agent/src/tools/risk-audit-tools.ts:239 — field-name string repeated; must live in a shared constant.

Cross-file-literal candidates for global synthesis (literal value + file:line each; other file may be outside this slice):
- `"T_RETRY"` — packages/agent/src/orchestrator/scheduler.ts:32, packages/agent/src/orchestrator/scheduler.ts:238, packages/agent/src/orchestrator/scheduler.ts:290, packages/agent/src/orchestrator/watcher.ts:332, packages/agent/src/orchestrator/watcher.ts:355
- `"UNASSIGNED"` — packages/agent/src/tools/risk-audit-tools.ts:65, packages/agent/src/tools/risk-audit-tools.ts:254
- `"RISK_PERIOD_CLOSED"` — packages/agent/src/tools/risk-audit-tools.ts:132, packages/agent/src/tools/risk-audit-tools.ts:146
- `"post_write_missing"` — packages/agent/src/tools/risk-audit-tools.ts:359, packages/agent/src/tools/risk-audit-tools.ts:367, packages/agent/src/tools/risk-audit-tools.ts:375
- `"AUDIT_LINK:"` — packages/agent/src/tools/risk-audit-tools.ts:385, packages/agent/src/tools/risk-audit-tools.ts:395
- `"NOTIFY_NO_RECIPIENTS"` — packages/agent/src/orchestrator/watcher.ts:255, packages/agent/src/orchestrator/watcher.ts:318, packages/agent/src/orchestrator/watcher.ts:333
- `"watcher_state"` — packages/agent/src/orchestrator/watcher.ts:240, packages/agent/src/orchestrator/watcher.ts:248, packages/agent/src/orchestrator/watcher.ts:467
- `"awaiting_approval"` — packages/agent/src/orchestrator/watcher.ts:196, packages/agent/src/orchestrator/watcher.ts:203, packages/agent/src/orchestrator/watcher.ts:211, packages/agent/src/orchestrator/watcher.ts:221, packages/agent/src/orchestrator/watcher.ts:260, packages/agent/src/orchestrator/watcher.ts:285, packages/agent/src/orchestrator/watcher.ts:316
- `"America/Lima"` — packages/agent/src/orchestrator/scheduler.ts:22
- `"00:00:00"` — packages/agent/src/orchestrator/scheduler.ts:120
- `"10.2 corrective action for "` — packages/agent/src/tools/risk-audit-tools.ts:31
- `"O"` (risk/incident status default) — packages/agent/src/tools/risk-audit-tools.ts:35, packages/agent/src/orchestrator/watcher.ts:147

## R5
No violations found.

## R6
- packages/agent/src/orchestrator/scheduler.ts:64-94 — `limaOffsetMs` hand-rolls timezone-offset math via `Intl.DateTimeFormat.formatToParts` + `Date.UTC` subtraction — custom date/timezone math; use native `Temporal.ZonedDateTime` or ecosystem Luxon / date-fns-tz instead.
- packages/agent/src/orchestrator/scheduler.ts:96-110 — `limaLocalToUtc` hand-rolls `split("-")`/`split(":")` date parsing + naive-UTC-minus-offset conversion — custom date parsing/math; use `Temporal.PlainDateTime.toZonedDateTime` or Luxon `DateTime.fromFormat` with zone instead.
- packages/agent/src/tools/risk-audit-tools.ts:46-50 — `addDays` hand-rolls day arithmetic via `new Date(...)` + `setUTCDate` + `toISOString().slice(0, 10)` — custom date math; use native `Temporal.PlainDate` addition or ecosystem date-fns `addDays`/`formatISO` instead.

## Summary
| Rule | Count |
|------|-------|
| R1 | 0 |
| R2 | 24 |
| R3 | 0 |
| R4 | 18 |
| R5 | 0 |
| R6 | 3 |
| Total | 45 |
