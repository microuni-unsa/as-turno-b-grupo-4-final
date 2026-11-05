# Slice 32 Unit-A — Quality Audit

Audited files (line counts), date 2026-11-05:

- `tests/unit/adapter.test.ts` — 190 lines
- `tests/unit/canonical.test.ts` — 74 lines
- `tests/unit/chat-trace.test.ts` — 209 lines
- `tests/unit/chat-tree.test.ts` — 150 lines
- `tests/unit/cockpit-auth.test.ts` — 207 lines

All findings are in test context (`(test context)`); nothing suppressed per instructions.

## R1

- `tests/unit/adapter.test.ts:40` — `if (headers["Idempotency-Key"]) {` with no `else` — branch silently no-ops when the header is absent, leaving `keysSent` state implicit instead of explicitly managing or raising (missing-`else` clause) `(test context)`.
- No other violations found. `adapter.test.ts:44` (`if (attempts === 1)` + fallthrough `return`) manages both paths via early return; `canonical.test.ts:31-41` `try/catch` asserts explicitly in both arms (`expect.unreachable` + `toBeInstanceOf`); `chat-trace.test.ts` `.find()` results are followed by explicit `toBeDefined()` assertions; no `switch` statements or empty branches exist in the slice.

## R2

- `tests/unit/cockpit-auth.test.ts:26` — `canSwitch = false` — default parameter silently supplies absent state instead of requiring the caller to pass it explicitly / fail fast with a named error `(test context)`.
- `tests/unit/cockpit-auth.test.ts:44` — `overrides: Partial<PimsPermission> = {}` — default parameter silently supplies absent state instead of fail-fast `(test context)`.
- `tests/unit/cockpit-auth.test.ts:37` — `role === "Editor" ? "dpo" : role === "Lector" ? "auditor" : "executive"` — chained-ternary fallback silently defaults any non-Editor/non-Lector role to `"executive"` instead of raising a named error for unexpected roles `(test context)`.
- No other violations found. No `?? default` / `|| default` / `.get(k, default)`, no `catch { fallback }`, no `try/except` swallowing errors (the one `catch` in `canonical.test.ts:34-41` only asserts), no `if exists(p1) … elif exists(p2)` chains, no retry/auth cascades, no optional-chaining-based assertions that hide state (every `?.` here — e.g. `chat-tree.test.ts:125`, `chat-trace.test.ts:123`, `adapter.test.ts:187`, `canonical.test.ts:38` — feeds an `expect` that fails on `undefined`).

## R3

No violations found. No backwards-compat shims, polyfills, legacy wrappers, deprecated-API support, version sniffing, or `// for backwards compat` paths in any of the 5 files; all imports use current `@pims/*` / `vitest` APIs.

## R4

Within-slice repeated operational literals (each repeated literal = one finding; single-use local literals not reported):

- `tests/unit/adapter.test.ts:63,92,111,126,180` — `"application/json"` (5x) — repeated header literal, belongs in a shared constant `(test context)`.
- `tests/unit/adapter.test.ts:51,52,147,148,163,164` — `"2026-10-29T10:00:00Z"` (6x) — repeated timestamp literal `(test context)`.
- `tests/unit/adapter.test.ts:55,70,151,167` — `"2026-10-29"` (4x) — repeated date literal `(test context)`.
- `tests/unit/adapter.test.ts:56,72,152,168` — `"OT"` incident_type (4x) — repeated magic string `(test context)`.
- `tests/unit/adapter.test.ts:57,73,153,169` — `"O"` status (4x) — repeated magic string `(test context)`.
- `tests/unit/canonical.test.ts:7,8` — `'{"a":1,"b":2}'` (2x) — repeated expected-output literal `(test context)`.
- `tests/unit/canonical.test.ts:46,52,61` — `"INC-2026-001"` (3x) — repeated fixture literal `(test context)`.
- `tests/unit/canonical.test.ts:48,53,62` — `"kept"` review_approval_id value (3x) — repeated fixture literal `(test context)`.
- `tests/unit/chat-trace.test.ts:15,153` — `"token-123"` (2x) — repeated fixture token `(test context)`.
- `tests/unit/chat-trace.test.ts:16,154` — `"2030-01-01T00:00:00Z"` (2x) — repeated expiry literal `(test context)`.
- `tests/unit/chat-trace.test.ts:19,157` — `"unsa"` schema (2x) — repeated fixture literal `(test context)`.
- `tests/unit/chat-trace.test.ts:20,158` — `"Operador"` (2x) — repeated role literal `(test context)`.
- `tests/unit/chat-trace.test.ts:21,159` — `"view_incident"` (2x) — repeated permission literal `(test context)`.
- `tests/unit/chat-trace.test.ts:72,179` — `"test-model"` (2x) — repeated model-name literal `(test context)`.
- `tests/unit/chat-trace.test.ts:71,178` — `route: "reasoning"` (2x) — repeated route literal `(test context)`.
- `tests/unit/chat-trace.test.ts:86,190` — `TEMP_REASONING: 0.1` (2x) — repeated config literal `(test context)`.
- `tests/unit/chat-trace.test.ts:89,191` — `"2026-11-05T12:00:00Z"` clock (2x) — repeated timestamp literal `(test context)`.
- `tests/unit/chat-trace.test.ts:43,44,45,46` (+55/56 block) — `"2026-11-01T10:00:00Z"` (6x) — repeated timestamp literal `(test context)`.
- `tests/unit/chat-trace.test.ts:35,77,80,101` — `"INC-001"` (4x+) — repeated fixture literal `(test context)`.
- `tests/unit/cockpit-auth.test.ts:59,68` — `"2026-10-01T10:00:00.000Z"` (2x) — repeated timestamp literal `(test context)`.
- `tests/unit/cockpit-auth.test.ts:60,69` — `"INC-001"` (2x) — repeated fixture literal `(test context)`.
- `tests/unit/cockpit-auth.test.ts:153,158,164,172,177,186,196` — `"view_incident"` (7x) — repeated permission literal `(test context)`.
- `tests/unit/cockpit-auth.test.ts:98,107,118,164,186,196` — `"Operador"` (6x) — repeated role literal `(test context)`.

Cross-file literal candidates for global synthesis (literal + file:line each; other file may be outside this slice):

- `"unsa"` — `tests/unit/adapter.test.ts:16`, `tests/unit/chat-trace.test.ts:19`, `tests/unit/chat-trace.test.ts:157`, `tests/unit/cockpit-auth.test.ts:33`
- `"view_incident"` — `tests/unit/chat-trace.test.ts:21`, `tests/unit/chat-trace.test.ts:159`, `tests/unit/cockpit-auth.test.ts:153`, `:158`, `:164`, `:172`, `:177`, `:186`, `:196`
- `"Operador"` — `tests/unit/chat-trace.test.ts:20`, `:158`, `tests/unit/cockpit-auth.test.ts:98`, `:107`, `:118`, `:164`, `:186`, `:196`
- `"INC-001"` — `tests/unit/chat-trace.test.ts:35`, `:77`, `:80`, `:101`, `tests/unit/chat-tree.test.ts:56`, `:62`, `:77`, `:87`, `:94`, `tests/unit/cockpit-auth.test.ts:60`, `:69`
- `"auditor"` — `tests/unit/chat-trace.test.ts:22`, `:102`, `:165`, `tests/unit/chat-tree.test.ts:10`, `tests/unit/cockpit-auth.test.ts:141`
- `"application/json"` — `tests/unit/adapter.test.ts:63`, `:92`, `:111`, `:126`, `:180` (5x within file; flag if seen in any other file globally)
- `"2030-01-01T00:00:00Z"` vs `"2030-01-01T00:00:00.000Z"` — near-duplicate variants: `tests/unit/chat-trace.test.ts:16`, `:154` vs `tests/unit/cockpit-auth.test.ts:30` (same instant, two spellings — synthesis should pick one)
- `"list_active_incidents"` — `tests/unit/chat-tree.test.ts:13`, `tests/unit/chat-trace.test.ts:131`, `:139`, `:140`

## R5

No violations found. No machine-dependent paths (`~/`, `/home/`, `/tmp`, `file:///`, `C:\`), no `../..` workspace escapes, no hardcoded absolute paths; all imports are package-relative (`@pims/*`, `vitest`); `https://mock.pims.test` (`adapter.test.ts:15`) is a mock HTTP base URL, not a file path.

## R6

No violations found. No hand-rolled retry/glob/deep-equal/date-math/slugify/validation in the slice: timer control uses native `vi.useFakeTimers`/`runAllTimersAsync`, schema validation uses the ecosystem `ChatResponseSchema.parse` (`chat-trace.test.ts:107`), date handling uses native `Date`/`toISOString`, and the `session()`/`permission()`/`mockResponse()` helpers are plain test-fixture factories with no stdlib/framework-provided alternative.

## Summary

| Rule | Violations |
|------|-----------|
| R1 | 1 |
| R2 | 3 |
| R3 | 0 |
| R4 | 23 (+8 cross-file candidate groups) |
| R5 | 0 |
| R6 | 0 |
| Total | 27 |
