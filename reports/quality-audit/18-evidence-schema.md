# Slice 18 evidence-schema — Quality Audit

Audited files (date 2026-11-05):
- `packages/evidence/src/schema.ts` (176 lines)
- `packages/evidence/src/forensic-patterns.ts` (167 lines)
- `packages/evidence/src/index.ts` (5 lines)
- `packages/evidence/src/word-extractor.d.ts` (9 lines)

## R1

- `packages/evidence/src/forensic-patterns.ts:48` — `if (prefix === undefined) { return false; }` — no `else`; false path falls through implicitly to `number = ...` assignment rather than an explicit `else` branch.
- `packages/evidence/src/forensic-patterns.ts:72` — `if (net.isIP(match[0]) !== 0) { found.add(match[0]); }` — no `else`; non-IP candidates silently skipped with no explicit state handling or dedicated error for the false branch.
- `packages/evidence/src/forensic-patterns.ts:80-81` — `const index = match.index; if (text[index - 1] === "@" || isInsideSpan(index, emailSpans)) { continue; }` — no `else`, and `match.index` (`number | undefined`) is used without an explicit undefined check, leaving absent-index state implicit; false path falls through implicitly to `parseDomain`.
- `packages/evidence/src/forensic-patterns.ts:89` — `if (parsed.hostname !== null && parsed.isIp === false && (...)) { found.add(...); }` — no `else`; rejected domain candidates silently dropped with no explicit state handling for the false branch.
- `packages/evidence/src/forensic-patterns.ts:102` — `if (ACCEPTED_HASH_LENGTHS.has(candidate.length) && Buffer.from(...).length === ...) { found.add(...); }` — no `else`; non-hash candidates silently skipped, false branch implicit.
- `packages/evidence/src/forensic-patterns.ts:117` — `if (EMAIL_SCHEMA.safeParse(match[0]).success) { found.add(match[0]); }` — no `else`; failed email parses silently dropped, false branch implicit.
- `packages/evidence/src/forensic-patterns.ts:123` — `if (isValidSpanishId(match[0])) { found.add(...); }` — no `else`; invalid IDs silently dropped, false branch implicit.
- `packages/evidence/src/forensic-patterns.ts:131` — `.filter((span) => net.isIP(span[0]) !== 0)` — predicate-false path implicitly discards the span with no explicit branch.
- `packages/evidence/src/forensic-patterns.ts:140` — `if (!overlapsIp && match.number.isValid()) { found.add(...); }` — no `else`; overlapping/invalid phone matches silently dropped, false branch implicit.
- `packages/evidence/src/forensic-patterns.ts:163` — `if (decoded.includes("\u0000")) { throw new AttachmentRejectedError("binary_txt"); }` — no explicit `else`; clean path is implicit fall-through to `return decoded` (guard style, noted for exhaustiveness).
- Reviewed and compliant (not counted): `schema.ts`, `index.ts`, `word-extractor.d.ts` contain no `if/else`, `switch`, or pattern-match branches at all. `forensic-patterns.ts:39-55` (`if/else if/else` on DNI vs NIE vs neither) handles every branch explicitly including `else { return false; }`. `forensic-patterns.ts:157-162` (`catch` with `if (error instanceof TypeError) { throw ...; } throw error;`) explicitly rethrows on all paths — no swallowed branch.

## R2

No violations found.
- `forensic-patterns.ts:39,43-45` uses `?.` only inside explicit `!== undefined` comparisons (fail-fast style conditions), never `?? default` / `|| default`.
- `forensic-patterns.ts:153-162` `try/catch` rethrows on every path (`AttachmentRejectedError` for `TypeError`, bare `throw error` otherwise) — no `catch { fallback }`, no swallowed errors.
- `forensic-patterns.ts:47-50` fails fast with `return false` on absent `NIE_PREFIX_DIGITS` entry instead of defaulting.
- `schema.ts` `.default("evidence-collector")` (`:30-32`), `.default(1)` (`:43`), `.default("draft")` (`:47`), `.default(false)` (`:81,:92`), and `.defaultNow()` are declarative Drizzle column definitions (the native schema mechanism for DB defaults), not `?? default` / `|| default` / `.get(k, default)` control-flow fallbacks hiding absent runtime state.
- No chained `if exists(p1) ... elif exists(p2)`, no speculative auth/retry cascades in any of the 4 files.

## R3

No violations found.
- No backwards-compat shims, polyfills, legacy wrappers, deprecated-API support, version sniffing, or `// for backwards compat` paths in any of the 4 files. `word-extractor.d.ts` is a minimal ambient declaration for the current `word-extractor` API, not a legacy wrapper.

## R4

Within-slice repeats observed (all occurrences listed; single-use local literals are not reported):
- `"incident_code"` column-name literal repeated 10x in `schema.ts:21,41,57,67,77,97,116,127,142,154,163` (11 occurrences across 11 tables; `varchar("incident_code", { length: 64 })` identical call shape each time) — same operational string hardcoded in N places instead of a shared constant/config.
- `varchar` length `64` repeated in `schema.ts:21,23,41,45,46,57,58,64,67,68,77,78,99,107,116,118,119,126,127,129,163,166` — same magic number hardcoded across tables instead of a shared constant.
- `varchar` length `32` repeated in `schema.ts:42,47,89,99,128` (`pack_type`, `state`, `incident_date`, `status` plus `128`/`255` siblings) — same magic number in 5 places.
- `varchar` length `128` repeated in `schema.ts:25,30,68,76,122,134,171` (`mime`, `uploader`, `holder_id`, `timer_id`, `idempotency_key`, `consumed_by`, `key`) — same magic number in 7 places.
- `varchar` length `255` repeated in `schema.ts:22,82,88,90,121` (`file_name`, `cancelled_reason`, `title_normalized`, `system_or_url`, `result_ref`) — same magic number in 5 places.
- `{ withTimezone: true }` timestamp-option literal repeated in `schema.ts:33,48,51,61,69,72,79,100,109,117,130,147,156,164,173` — same config literal in 15 places.
- `"hex"` encoding literal repeated 2x within slice in `forensic-patterns.ts:25` (`.digest("hex")`) and `forensic-patterns.ts:104` (`Buffer.from(candidate, "hex")`) — same operational string in 2 places.
- Cross-file-literal candidates for global synthesis (literal value + file:line each; other file may be outside this slice):
  - `64`: `schema.ts:21,23,41,45,46,57,58,64,67,68,77,78,99,107,116,118,119,126,127,129,163,166` + `forensic-patterns.ts:15` (`{32,64}` in `HASH_CANDIDATE`), `forensic-patterns.ts:20` (`new Set([32, 40, 64])`) — note: different domains (varchar length vs hash hex length); listed for synthesis, likely coincidental.
  - `32`: `schema.ts:42,47,89,99,128` + `forensic-patterns.ts:15,20` (hash length 32) — same caveat, different domains.
  - `"sha256"` family: `schema.ts:23` (`"sha256"`), `schema.ts:45,129` (`"content_sha256"`), `schema.ts:58` (`"seal_sha256"`) + `forensic-patterns.ts:24-25` (`sha256HexBytes`, `createHash("sha256")`) — related but not identical literals; listed for synthesis.
  - `"evidence"`: `schema.ts:15` (`pgSchema("evidence")`) — single use in slice; candidate in case another slice hardcodes the schema name.

## R5

No violations found.
- No machine-dependent paths (`~/`, `/home/`, `/tmp`, `file:///`, `C:\`), no `../` traversal, no hardcoded absolute paths in any of the 4 files. All regexes/patterns operate on in-memory text; no file ops at all.

## R6

- `packages/evidence/src/forensic-patterns.ts:28` — `function collectAll(pattern: RegExp, text: string): RegExpExecArray[] { return Array.from(text.matchAll(new RegExp(pattern.source, "g"))); }` — hand-rolled match-all helper where the stdlib natively provides it; native alternative is declaring each candidate pattern with the `g` flag once and calling `Array.from(text.matchAll(PATTERN))` directly (rebuilding a `RegExp` from `pattern.source` on every call also discards flags and recompiles needlessly).
- Compliant (not counted): IP validation via stdlib `node:net` (`net.isIP`), hashing via stdlib `node:crypto`, email validation via `zod`, phone parsing via `libphonenumber-js`, domain parsing via `tldts` — all native/ecosystem solutions correctly preferred. `isValidSpanishId` and `isInsideSpan` are domain-specific checks with no stdlib/framework equivalent. `decodeUtf8` uses native `TextDecoder` with `fatal: true`.

## Summary

| Rule | Findings |
| ---- | -------- |
| R1 Exhaustive Branching | 10 |
| R2 Zero Fallbacks | 0 |
| R3 No Legacy Support | 0 |
| R4 Repeated Literals | 7 repeat groups (+ 4 cross-file candidates) |
| R5 Path Discipline | 0 |
| R6 Native Solutions | 1 |
| Total | 18 findings (+ 4 candidates) |
