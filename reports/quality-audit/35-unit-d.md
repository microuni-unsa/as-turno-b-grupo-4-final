# Slice 35 unit-d — Quality Audit

Audited files (line counts), date 2026-11-05:

- `tests/unit/plain-language.test.ts` — 228 lines
- `tests/unit/rag.test.ts` — 728 lines
- `tests/unit/roles.test.ts` — 179 lines
- `tests/unit/scheduler.test.ts` — 58 lines

## R1

No violations found.

## R2

- `tests/unit/plain-language.test.ts:12` — `occurrence = 0): NumericApproval => ({` — default parameter value hiding an absent argument instead of fail-fast with a named error (test context).
- `tests/unit/rag.test.ts:236` — `expect(Object.keys(windows[0] ?? {}).sort()).toEqual(` — `??` default masking absent element instead of asserting presence / fail-fast with a named error (test context).
- `tests/unit/rag.test.ts:496` — `return Promise.resolve([]);` — catch-all default return for any unmatched query text in the `sql` stub, hiding absent/unexpected state instead of failing fast (test context).
- `tests/unit/scheduler.test.ts:5` — `overrides: Record<string, unknown> = {}) {` — default `{}` hiding an absent argument instead of fail-fast with a named error (test context).

## R3

No violations found.

## R4

Repeated operational literals within this slice (must live in a shared constant/config):

- `tests/unit/rag.test.ts:48,81,208` — `dirPath: "corpus"` — path-prefix literal `"corpus"` hardcoded 3×.
- `tests/unit/rag.test.ts:102,148,186` — `dirPath: "."` — path literal `"."` hardcoded 3×.
- `tests/unit/rag.test.ts:91,128,173` — `path.join(os.tmpdir(), "pims-rag-test-")` — tmp prefix `"pims-rag-test-"` hardcoded 3×.
- `tests/unit/rag.test.ts:53,61` + `tests/unit/roles.test.ts:21,36,99` — `/^[a-f0-9]{64}$/` vs `HEX64 = /^[0-9a-f]{64}$/` — same hex-64 pattern hardcoded in 2 files (test context).
- `tests/unit/rag.test.ts:274,285,374,522,573,623,694` — `"a".repeat(64)` / `"c".repeat(64)` / `"d".repeat(64)` / `"e".repeat(64)` / `"f".repeat(64)` + `419` `"b".repeat(64)` — fake-sha256 magic length `64` hardcoded 8×.
- `tests/unit/rag.test.ts:64,85,267,272,310-339,423-451,514-529,562-593,614-666,683-716` — `"gdpr-full"` doc-id magic string hardcoded ~20×.
- `tests/unit/rag.test.ts:268,270,272,310-316,330-337,423-429,443-449,514-521,545-553,565-572` — `"art33"` clause magic string hardcoded ~12×.
- `tests/unit/rag.test.ts:267-283,309-319,366-375,421-432,513-523,563-574,614-624,685-695` — `"1-10"` / `"1-5"` / `"11-20"` / `"2171-2175"` / `"100-110"` line-range magic strings, each hardcoded 2–6×.
- `tests/unit/rag.test.ts:270,272,281,283,316,372,429,520,571,621,692` — `"[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]"` (and `iso27701` variants) header magic strings hardcoded ~12×.
- `tests/unit/rag.test.ts:289,321` — `"v1"` corpus-version literal hardcoded 2×.
- `tests/unit/rag.test.ts:73,85,278` — `"iso27701"` doc-id magic string hardcoded 3× (plus `65,87` key variants).
- `tests/unit/plain-language.test.ts:155,172,173` — `"El incidente afectó a 500 personas."` + `approvalFor("500")` — subject-count magic string `"500"` hardcoded 3× (test context).
- `tests/unit/plain-language.test.ts:180,181,188,191` — `"10,000"` / `"10 000"` grouped-number magic strings hardcoded 4× (test context).
- `tests/unit/plain-language.test.ts:197,200,206` — `"3"` in `"Revisamos 3 servidores…"` + `approvalFor("3", 0)` / `approvalFor("3", 1)` — magic string `"3"` hardcoded 4× (test context).
- `tests/unit/plain-language.test.ts:106,114,115` — `toBe(25)` / `toBeGreaterThan(25)` — word-limit threshold `25` hardcoded 3× (test context).
- `tests/unit/plain-language.test.ts:136,139` — `toBe(6)` / `{ maxWords: 6 }` — threshold `6` hardcoded 2× (test context).
- `tests/unit/plain-language.test.ts:143,147` — `{ maxWords: 5 }` / `toBe(5)` — threshold `5` hardcoded 2× (test context).
- `tests/unit/roles.test.ts:139-150,151-156,163-170` — `"pims_get_incident"` tool-name magic string hardcoded in 5 role entries; `"pims_list_incidents"` in 4; `"pims_update_incident"` in 4; `"pims_get_history"` in 5; `"rag_query"` in 5 (test context).
- `tests/unit/roles.test.ts:43,44,56,58` — `"investigator"` role magic string hardcoded 4× (test context).
- `tests/unit/roles.test.ts:96,97,98` — `"triage"` role magic string hardcoded 3× (test context).
- `tests/unit/roles.test.ts:56,71,115` — `"pims_notify"` / `"pims_notify"` tool-name magic string hardcoded 3× (test context).
- `tests/unit/scheduler.test.ts:9,10,13,28,31,41,45,53` — `"2026-10-01"` date literal hardcoded 8×; `"12:00:00.000Z"` at `:9,10,54` 3×; `"05:00:00.000Z"` at `:32,50` 2×; `"15:00:00.000Z"` at `:29,45` 2× (test context).

Cross-file literal candidates for global synthesis (value + file:line each):

- `"INC-001"`: `tests/unit/scheduler.test.ts:8`, `tests/unit/rag.test.ts:465,481`.
- Hex-64 regex: `tests/unit/rag.test.ts:53,61`, `tests/unit/roles.test.ts:21`.
- `"corpus"`: `tests/unit/rag.test.ts:48,81,208` (other-file occurrences outside slice unknown).
- `"gdpr-full"`: `tests/unit/rag.test.ts:64,85,267,310,423,514,565,599,614,686,706` (other-file occurrences outside slice unknown).
- `"pims-rag-test-"`: `tests/unit/rag.test.ts:91,128,173` (other-file occurrences outside slice unknown).
- `"reviewed by DPO"`: `tests/unit/plain-language.test.ts:15` (single use in slice; candidate only).
- `"https://api.openai.com/v1"`: `tests/unit/rag.test.ts:21` (single use in slice; candidate only).
- `"OPENAI_API_KEY"`: `tests/unit/rag.test.ts:22` (single use in slice; candidate only).
- `5000` (`timeout_ms`): `tests/unit/rag.test.ts:23` (single use in slice; candidate only).
- `30000` (`RAG_TIMEOUT_MS`): `tests/unit/rag.test.ts:32` (single use in slice; candidate only).
- `24`/`6`/`0.35` (`RAG_TOP_K`/`RAG_RERANK_K`/`RAG_MIN_SCORE`): `tests/unit/rag.test.ts:29,30,31` (single use each in slice; candidates only).

## R5

No violations found. (`fs.mkdtempSync(path.join(os.tmpdir(), …))` tempdirs via stdlib APIs are OK per contract; no hardcoded `/tmp/…`, `~/`, `/home/`, `file:///`, `C:\`, or workspace-escaping `../..` strings anywhere in the 4 files.)

## R6

No violations found.

## Summary

| Rule | Violations |
| ---- | ---------- |
| R1 Exhaustive Branching | 0 |
| R2 Zero Fallbacks | 4 |
| R3 No Unrequested Legacy Support | 0 |
| R4 Repeated Cross-File Literals | 22 |
| R5 Strict Path Discipline | 0 |
| R6 Native & Ecosystem Solutions | 0 |
| **Total** | **26** |
