# Slice 04 agent-orchestrator-main — Quality Audit

Audited files (2):
- `packages/agent/src/orchestrator/lifecycle.ts` (148 lines)
- `packages/agent/src/orchestrator/orchestrator.ts` (3227 lines)

Date: 2026-11-05

## R1

- `lifecycle.ts:48-54` — `get stage() { ...; if (stage === undefined) { return "capture"; } ... }` — silent implicit-state recovery: out-of-range `stageIndex` is coerced to `"capture"` instead of raising a dedicated error; no invalid-state branch.
- `orchestrator.ts:2709-2711` — `peruAdvisory: async () => { return; }` — empty/noop branch: timer effect does nothing, logs nothing, returns `undefined`; state left implicit.
- `orchestrator.ts:2818-2822` — `if (events === undefined) { return; }` in `announceRole` — silent skip: missing event sink drops the role-transition with no error/marker.
- `orchestrator.ts:592-600` — `if (payload.source_payload === undefined) { return; }` in `stageIntakeSource` — early-return noop branch with no `else`/marker; absent-source state is silently absorbed.
- `orchestrator.ts:1937-1940` — `if (row === null || row.state !== "approved") { continue; }` in `notifyApprovedPacks` loop — `continue` silently skips non-approved packs with no error, no skipped-pack accounting in the loop.
- `orchestrator.ts:2549-2557` fragment region (`flushRiskQueue`, ~lines 2535-2543) — `if (assetIds.length === 0) { continue; }` — silent skip of unresolvable risk signals inside the flush loop; no error raised, item left queued implicitly.
- `orchestrator.ts:555-558` — `if (older === undefined || kept === undefined) { return incident; }` — degenerate-ordering branch silently returns the input incident instead of raising a dedicated ordering invariant error.
- `orchestrator.ts:1862-1869` — `if (previousApproval !== null && ... ) { closeApprovalId = ...; }` with no `else` — mismatched/consumed prior approval falls through silently to minting a fresh approval; stale-approval state is implicit, not named/handled.
- `orchestrator.ts:1783-1785` — `const epochActions = baselineParsed.success ? actions.slice(...) : actions;` — failed-baseline-parse branch silently falls back to the full action list with no error or marker distinguishing "no baseline" from "corrupt baseline".

## R2

- `orchestrator.ts:300-306` — `const corrected = callbacks?.futureDateReprompt ? await callbacks.futureDateReprompt() : null; incidentDate = corrected ?? today;` — fallback chain: missing callback → `null` → `today`; future-dated input is silently corrected instead of fail-fast with a named error.
- `orchestrator.ts:308-312` — `let detectionDate = payload.detection_date ?? incidentDate; if (detectionDate < incidentDate) { detectionDate = incidentDate; ... }` — `??` default plus silent date coercion instead of rejecting inconsistent dates.
- `orchestrator.ts:316-327` — `if (involvesPersonalData === null) { ...; if (answer === null) { involvesPersonalData = true; ... markers.push("assumed_pii:true"); }` — fail-open default: absent PII flag *and* absent reprompt answer silently assumes PII-positive instead of fail-fast.
- `orchestrator.ts:329-330` — `payload.compromised_system ?? payload.affected_url ?? ""` — chained `??` fallback to empty string hiding absent system/URL state.
- `orchestrator.ts:463` — `incident_type: payload.incident_type ?? "OT"` — silent `"OT"` default instead of fail-fast on missing incident type.
- `orchestrator.ts:1491-1492` — `severity: incident.severity ?? "M", impact: incident.impact ?? "M"` — silent `"M"` defaults in high-risk gate evaluation hiding absent severity/impact.
- `orchestrator.ts:1733-1734` — `severity: incident.severity ?? "M", impact: incident.impact ?? "M"` (second gate call site) — same silent-default violation as above.
- `orchestrator.ts:2377` — `severity: sealedIncident.severity ?? "M"` — silent `"M"` default in close/metrics attrs.
- `orchestrator.ts:3025-3037` — `severityLevel(...)` `default: return 2;` — catch-all `default` silently maps `null`/`undefined`/unknown severity to level 2 instead of a named error.
- `orchestrator.ts:2995` — `period_name: typeof periodName === "string" ? periodName : ""` — silent `""` default for malformed queued-signal period name.
- `orchestrator.ts:2735-2738` — `const nested: JsonObject = typeof inner === "object" && ... ? inner : {};` — malformed retry payload silently replaced with `{}` instead of fail-fast.
- `orchestrator.ts:2712-2718` — `` `PHASE_DUE:${typeof phase === "number" ? phase : 2}` `` — silent `2` default for non-numeric phase payload.
- `orchestrator.ts:1320` — `responsible: current.assigned_to ?? "UNASSIGNED"` — silent `"UNASSIGNED"` default hiding absent owner.
- `orchestrator.ts:531-532` — `return candidate ?? assignees[0] ?? null;` — chained `??` fallback: no-free-assignee silently collapses to first assignee, then `null`.
- `orchestrator.ts:1407-1425` — `catch (error) { if (code === "RISK_SIGNAL_NO_ASSET") { emitEvent(...); } else if (code === "RISK_PERIOD_CLOSED") { emitEvent(...); } else { throw error; } }` — `try/catch` swallowing two error codes into marker events; control flow continues as if the signal succeeded.
- `orchestrator.ts:2245-2253` — `try { sealed = await sealBundle(code); } catch { if (BundleAlreadySealedError) { sealed = await getSealedBundle(code); } else throw }` — catch-and-retry fallback chain: seal conflict silently re-read instead of fail-fast.
- `orchestrator.ts:2559-2566` — `catch (error) { await markRiskSignalFailed(record.id, error instanceof PimsBaseError ? error.code : "RISK_QUEUE_FLUSH_FAILED"); }` — `try/catch` swallowing flush errors into a status row; loop continues, caller never sees the failure.
- `orchestrator.ts:3013-3022` — `readPackId(...)` returns `null` for non-object/array payloads — silent `null` hiding malformed pack payload instead of a named parse error.
- `orchestrator.ts:1783-1784` — `baselineParsed.success ? slice : actions` (also R1) — `safeParse` failure silently degrades to unscoped action list (fallback chain) instead of fail-fast.
- `lifecycle.ts:17-23` — `nextStage`: `if (index < 0 || ...) return null; return FIXED_STEP_ORDER[index+1] ?? null;` — unknown stage and missing successor both collapse to `null`; absent-state hidden behind `?? null` instead of a named error for the unknown-stage case.

## R3

No violations found.

## R4

Single-use local literals are not reported. Repeated literals *within* this slice:
- `"OPERATOR_HALT"` — `orchestrator.ts:2571`, `orchestrator.ts:2581`, `orchestrator.ts:2591` (agent-state key ×3).
- `"RESOLUTION_HASH:${code}"` — `orchestrator.ts:1837`, `orchestrator.ts:1845`.
- `"VETO_PARKED:${code}"` / `` `VETO_PARKED:${incidentCode}` `` — `orchestrator.ts:1907`, `orchestrator.ts:2004`.
- `"CLOSE_APPROVED:"` prefix — `orchestrator.ts:1853`, `orchestrator.ts:1860`, `orchestrator.ts:1881`, `orchestrator.ts:2320`, `orchestrator.ts:2323`.
- `"T_RETRY"` — `orchestrator.ts:1892`, `orchestrator.ts:1903`, `orchestrator.ts:2014`.
- `"VETO_WINDOW"` — `orchestrator.ts:1893`, `orchestrator.ts:1904`, `orchestrator.ts:2021`.
- `"authority"` / `"subject"` pack-type strings — `orchestrator.ts:1936`, `orchestrator.ts:1980`, `orchestrator.ts:2043-2045`, `orchestrator.ts:2396`, `orchestrator.ts:2415`, plus `2642`/`2678` region.
- `"unknown"` judge/fix fallback — `orchestrator.ts:1681` (×2 in one template), `orchestrator.ts:1814` (×2 in one template).
- `60_000` ms-per-minute factor — check `orchestrator.ts:1885` (`vetoWindowMin * 60_000`) vs any other minute/hour factor in slice: `3_600_000` at `orchestrator.ts:2353,2357` (×2, hour factor) — same-dimension magic-number family, hard-coded twice each.

Cross-file literal candidates for global synthesis (value + file:line; paired file outside this slice unknown):
- `"OPERATOR_HALT"` — `orchestrator.ts:2571`, `orchestrator.ts:2581`, `orchestrator.ts:2591`.
- `"RESOLUTION_HASH:"` key prefix — `orchestrator.ts:1837`, `orchestrator.ts:1845`.
- `"REOPEN_BASELINE:${code}"` — `orchestrator.ts:1778` (candidate; reopen-baseline key).
- `"REEVALUATED:${code}"` — `orchestrator.ts:2083`, `orchestrator.ts:2109`.
- `"CLOSE_APPROVED:"` marker prefix — `orchestrator.ts:1853`, `orchestrator.ts:1860`, `orchestrator.ts:1881`, `orchestrator.ts:2320`, `orchestrator.ts:2323`.
- `"DEDUPE_MERGED:${...}"` marker prefix — `orchestrator.ts:354`, `orchestrator.ts:385`.
- `"VETO_WINDOW"` / `"VETO_WINDOW_EXPIRED"` / `"VETO_WINDOW_REPARKED"` — `orchestrator.ts:1893`, `orchestrator.ts:1898`, `orchestrator.ts:1904`, `orchestrator.ts:2021`, `orchestrator.ts:2027`, `orchestrator.ts:2029`.
- `"T_RETRY"` timer kind — `orchestrator.ts:1892`, `orchestrator.ts:1903`, `orchestrator.ts:2014`.
- `"capture"` lifecycle fallback — `lifecycle.ts:51`.
- `"investigate"` index lookup — `lifecycle.ts:78`.
- `"UNASSIGNED"` — `orchestrator.ts:1320`.
- `"America/Lima"` IANA zone — `orchestrator.ts:2922` (`limaDate` formatter).
- `"…[truncated]"` suffix + `150` / `1000` intake limits — `orchestrator.ts:281-294`, `orchestrator.ts:2950`.
- `3_600_000` ms-per-hour — `orchestrator.ts:2353`, `orchestrator.ts:2357`.
- `60_000` ms-per-minute — `orchestrator.ts:1885` (approx line; veto-window computation).

## R5

No violations found.

## R6

- `orchestrator.ts:2940-2958` — `truncateAtWordBoundary` hand-rolled word-boundary truncation (`length` check + `lastIndexOf(" ")` + `slice` + suffix). Ecosystem alternative: `lodash.truncate` (with `separator: ' '`) or `Intl.Segmenter`-based word segmentation instead of a bespoke truncator.
- `orchestrator.ts:1219-1282` — hand-rolled keyword-heuristic security-measure classifier (8+ chained `actionTexts.includes(...)` bilingual substring checks mapping to measure codes). Ecosystem alternative: a data-driven lookup table (`Record<string, string[]>` keyword map) or an NLP/tokenizer library instead of bespoke `includes` chains.
- `orchestrator.ts:2980-3011` — `parseRiskSignal` hand-rolled discriminated-shape validation with manual `typeof` checks. Ecosystem alternative: the already-imported `zod` (`z.discriminatedUnion` on `queued`) instead of bespoke guards.
- `orchestrator.ts:3013-3022` — `readPackId` hand-rolled object-shape guard (`typeof`/`Array.isArray` + manual property read returning `null`). Ecosystem alternative: `z.object({ pack_id: z.string() }).safeParse` (zod already a dependency).
- `orchestrator.ts:900-935` region — hand-rolled conformal-quantile computation (`sort((a,b) => a-b)`, `Math.min`/`Math.ceil` rank, index lookup). Ecosystem alternative: a statistics helper (`simple-statistics` `quantileSorted` or d3-array `quantileSorted`) instead of bespoke order-statistics math.
- `orchestrator.ts:3025-3037` — `severityLevel` hand-rolled `switch` enum→number map with `default`. Ecosystem alternative: a `Record<IncidentSeverity, number>` lookup (or existing severity-ordering helper) instead of a bespoke switch.
- `orchestrator.ts:375,415` (and `547`) — hand-rolled case-insensitive key normalization via `title.toLowerCase()` for dedupe keys. Ecosystem alternative: a shared normalizer (locale-aware `toLocaleLowerCase` + trim/collapse, or `Intl.Collator`-based comparison) instead of ad-hoc `toLowerCase()` at each call site.
- `orchestrator.ts:2919-2938` — `limaDate` hand-rolled `Intl.DateTimeFormat.formatToParts` + `find` + template assembly. Ecosystem alternative: a date library already in the stack (e.g. `date-fns`/`luxon` timezone formatting, or `toLocaleDateString("en-CA", { timeZone })`) instead of bespoke part-plumbing. (Lower severity: does use native `Intl`; flagged for the manual part-lookup wrapper.)

## Summary

| Rule | Count |
|------|-------|
| R1 | 9 |
| R2 | 20 |
| R3 | 0 |
| R4 | 15 candidate groups (within-slice repeats + cross-file candidates) |
| R5 | 0 |
| R6 | 8 |
| Total | 52 |
