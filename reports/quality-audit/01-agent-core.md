# Slice 01 agent-core — Quality Audit

Audited files (date 2026-11-05):
- `packages/agent/src/events/agent-events.ts` (24 lines)
- `packages/agent/src/index.ts` (251 lines)
- `packages/agent/src/indicators/indicator-emitter.ts` (185 lines)

## R1

- `packages/agent/src/indicators/indicator-emitter.ts:44` — `if (parsed.event === "incident_closed") {` with no `else` — missing `else` where non-`incident_closed` events leave state implicit (fall through to spool-or-post with no explicit branch).
- `packages/agent/src/indicators/indicator-emitter.ts:62` — `if (url === undefined || url.trim() === "") { spool; return { spooled: true }; }` with no explicit `else` — false path falls through implicitly to resolveSecret/post path.
- `packages/agent/src/indicators/indicator-emitter.ts:71` — `if (delivered) { return { accepted: true }; }` with no explicit `else` — false path falls through to spool implicitly rather than an explicit `else` branch.
- `packages/agent/src/indicators/indicator-emitter.ts:81` — `if (url === undefined || url.trim() === "") { return { delivered: 0, ... }; }` with no `else` — false path implicit fall-through to delivery loop.
- `packages/agent/src/indicators/indicator-emitter.ts:90` — `if (delivered) { deliveredIds.push(record.id); }` — missing `else` / silent noop when delivery fails; failed record left implicit (no explicit state handling or dedicated error for the false branch).
- `packages/agent/src/indicators/indicator-emitter.ts:177` — `if (count >= this.config.INDICATOR_SPOOL_MAX) { ...drop... }` with no `else` — under-capacity path left implicit (noop fall-through).
- `packages/agent/src/index.ts:95` — `if (holder.current === null) { throw ... } return holder.current;` — no explicit `else`; false path is implicit fall-through (guard style, noted for exhaustiveness).
- `packages/agent/src/index.ts:232` — `if (options?.runProbes !== false) { ...probes... }` with no `else` — `runProbes: false` path is a silent noop; state left implicit.

## R2

- `packages/agent/src/index.ts:107` — `const clock = deps.clock ?? (() => new Date());` — `?? default` hiding absent state instead of fail-fast with a named error.
- `packages/agent/src/index.ts:111` — `const bundleSealer = deps.bundleSealer ?? new BundleSealer(evidenceStore);` — `?? default` speculative fallback instead of fail-fast.
- `packages/agent/src/index.ts:112` — `const composer = deps.composer ?? new NoticeComposer({ now: clock });` — `?? default` hiding absent state.
- `packages/agent/src/index.ts:113` — `const exemptionEngine = deps.exemptionEngine ?? new ExemptionEngine();` — `?? default` hiding absent state.
- `packages/agent/src/index.ts:115` — `deps.presidioClient ?? new PresidioClient({...})` — `?? default` fallback chain for an absent client.
- `packages/agent/src/index.ts:134` — `fetchImpl: deps.fetchImpl,` passed through to `?? fetch` default in callee — optional-dependency fallback chain (resolves at `indicator-emitter.ts:36`).
- `packages/agent/src/index.ts:138` — `deps.page ?? ((alert) => { console.error(...) })` — `?? default` fallback handler hiding absent paging dependency; fallback only logs.
- `packages/agent/src/index.ts:232` — `if (options?.runProbes !== false)` — `?.` + `!== false` treats absent (`undefined`) as enabled; silent default instead of fail-fast with a named error.
- `packages/agent/src/indicators/indicator-emitter.ts:36` — `this.fetchImpl = deps.fetchImpl ?? fetch;` — `?? default` hiding absent `fetchImpl`.
- `packages/agent/src/indicators/indicator-emitter.ts:62-66` — `if (url === undefined || url.trim() === "") { await this.spool(...); return { spooled: true }; }` — fallback chain: absent webhook URL silently spools instead of fail-fast with a named error.
- `packages/agent/src/indicators/indicator-emitter.ts:71-75` — `if (delivered) { return accepted } await this.spool(...); return { spooled: true };` — delivery-failure fallback chain (spool as silent fallback for failed POST).
- `packages/agent/src/indicators/indicator-emitter.ts:81-83` — `if (url === undefined || ...) { return { delivered: 0, remaining: records.length }; }` — absent-URL silent default instead of fail-fast.
- `packages/agent/src/indicators/indicator-emitter.ts:114-117` — `Math.max((awareness.getTime() - occurrence.getTime()) / HOUR_MS, 0)` — clamping negative to `0` (silent default hiding invalid/negative duration instead of fail-fast with a named error).
- `packages/agent/src/indicators/indicator-emitter.ts:118-121` — `Math.max((now.getTime() - awareness.getTime()) / HOUR_MS, 0)` — same silent-`0` default for negative duration.
- `packages/agent/src/indicators/indicator-emitter.ts:137-139` — `secretEnv === undefined || secretEnv.trim() === "" ? undefined : process.env[secretEnv];` — ternary fallback hiding absent env-var name (`? undefined` default).
- `packages/agent/src/indicators/indicator-emitter.ts:158-172` — `try { const response = await this.fetchImpl(...); return response.ok; } catch (error) { ...; return false; }` — `try/except` swallowing errors / `catch { fallback }`: network error converted to silent `false` instead of raising a dedicated error.
- `packages/agent/src/indicators/indicator-emitter.ts:169` — `const reason = error instanceof Error ? error.name : "unknown";` — ternary `??`-style `"unknown"` default hiding non-`Error` state.

## R3

No violations found.

## R4

Within-slice repeats:
- `packages/agent/src/index.ts:234,236` — literal prefix `NESTED_PROBE:` hardcoded twice (`console.info(\`NESTED_PROBE:${nestedAction}\`)` / `console.info(\`NESTED_PROBE:audit:${nestedAudit}\`)`) — repeated operational literal; must live in a shared constant.
- `packages/agent/src/indicators/indicator-emitter.ts:62,81,137` (`indicator-emitter.ts:62,81,137,140`) — empty-string literal `""` used as the absent/blank sentinel in 4 checks (`url.trim() === ""`, `secretEnv.trim() === ""`, `secret === ""`) — repeated operational literal within slice; must live in a shared constant/helper.
- `packages/agent/src/indicators/indicator-emitter.ts:115,119` — `HOUR_MS` divisor with `0` clamp floor in `Math.max(..., 0)` twice — `0` floor literal repeated; note: `HOUR_MS` itself is correctly factored into one `const` (not a violation).

Cross-file-literal candidates for global synthesis (single-use in slice, verify repo-wide):
- `packages/agent/src/index.ts:97` — `"DeadlineScheduler effects used before the orchestrator was wired"`.
- `packages/agent/src/index.ts:141` — `` `PAGE:${alert.kind}:${alert.incident_code}:${alert.reason}` ``.
- `packages/agent/src/index.ts:234` — `` `NESTED_PROBE:${nestedAction}` ``.
- `packages/agent/src/index.ts:236` — `` `NESTED_PROBE:audit:${nestedAudit}` ``.
- `packages/agent/src/indicators/indicator-emitter.ts:17` — `3_600_000` (`HOUR_MS`).
- `packages/agent/src/indicators/indicator-emitter.ts:64` — `"INDICATOR_SPOOL_ONLY"`.
- `packages/agent/src/indicators/indicator-emitter.ts:113` — `"00:00:00"`.
- `packages/agent/src/indicators/indicator-emitter.ts:142-143` — `"INDICATOR_WEBHOOK_SECRET_ENV is required when INDICATOR_WEBHOOK_URL is set"` + `"CONFIG_MISSING:INDICATOR_WEBHOOK_SECRET_ENV"`.
- `packages/agent/src/indicators/indicator-emitter.ts:155` — `"sha256"` (plus `packages/agent/src/indicators/indicator-emitter.ts:163` — `` `sha256=${hmac}` `` / `"X-PIMS-Signature"`).
- `packages/agent/src/indicators/indicator-emitter.ts:156-157` — `"utf8"` / `"hex"`.
- `packages/agent/src/indicators/indicator-emitter.ts:160-162` — `"POST"` / `"Content-Type"` / `"application/json"`.
- `packages/agent/src/indicators/indicator-emitter.ts:170` — `"unknown"`.
- `packages/agent/src/indicators/indicator-emitter.ts:170,181` — `"INDICATOR_WEBHOOK_FAILED:${reason}"` / `"INDICATOR_SPOOL_FULL:dropped=${dropped}"` (`INDICATOR_` log-prefix family).

## R5

No violations found.

## R6

- `packages/agent/src/events/agent-events.ts:5-24` — hand-rolled `AgentEventEmitter` (Set-based subscribe/emit/unsubscribe/count) where the stdlib provides it — native alternative: `node:events` `EventEmitter` (or `EventTarget` with `addEventListener`/`dispatchEvent`).
- `packages/agent/src/indicators/indicator-emitter.ts:59` — `const payload: JsonObject = JSON.parse(JSON.stringify(parsed));` hand-rolled deep clone where the runtime provides it — native alternative: `structuredClone(parsed)`.

## Summary

| Rule | Count |
|------|-------|
| R1 | 8 |
| R2 | 17 |
| R3 | 0 |
| R4 | 3 within-slice repeats + 15 cross-file candidates |
| R5 | 0 |
| R6 | 2 |
| Total | 30 findings (+ 15 candidates) |
