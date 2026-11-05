# Slice 34 unit-c — Quality Audit

Audited files (line counts), date 2026-11-05:

- tests/unit/guided-reporting-schema.test.ts — 161 lines
- tests/unit/microcompose-microenv.test.ts — 41 lines
- tests/unit/model-provider.test.ts — 354 lines
- tests/unit/notice-composer.test.ts — 579 lines
- tests/unit/pims-schema.test.ts — 116 lines

## R1

No violations found.

Note (test context): `try { … expect.unreachable(…) } catch (err) { expect(err).toBeInstanceOf(…) … }` at tests/unit/notice-composer.test.ts:98-110, 132-141, 429-441, 444-456, 517-525 — both branches explicitly manage state (try-branch fails the test via `unreachable`, catch-branch asserts error type/fields). Not a silent pass/noop or missing-else.

## R2

No violations found.

Note (test context): optional-chaining property reads without defaults — tests/unit/model-provider.test.ts:260-263 (`res.ranked[0]?.chunk_id`), tests/unit/model-provider.test.ts:310-311 (`fetchSpy.mock.calls[0]?.[1]`, `init?.body`), tests/unit/notice-composer.test.ts:153 (`pack.delay_reasons?.hours_late`) — pure assertions/inspection, no `?? default` / `|| default` / fallback chain hiding absent state. `String(init?.body)` (model-provider.test.ts:311) is test-body introspection, not a production fallback. `catch` blocks above assert named error types, never substitute fallback values.

## R3

No violations found.

## R4

- tests/unit/microcompose-microenv.test.ts:13 + tests/unit/model-provider.test.ts:11,21,31,41 — `"OPENAI_API_KEY"` hardcoded in 2 files — operational literal (auth env key) duplicated cross-file instead of a shared constant (test context).
- Within-slice repeats / cross-file-literal candidates for global synthesis (test context; single-file repeats listed for synthesis even where the paired file is outside this slice):
  - `"https://api.openai.com/v1"` — tests/unit/model-provider.test.ts:10,20,30,40 (candidate: likely also in model/provider source + config).
  - `timeout_ms: 5000` — tests/unit/model-provider.test.ts:12,22,32,42.
  - `max_retries: 2` — tests/unit/model-provider.test.ts:13,23,33,43.
  - `fallback: "none"` — tests/unit/model-provider.test.ts:14,24,34,44.
  - `"gpt-4o"` — tests/unit/model-provider.test.ts:9,19.
  - `"gpt-4o-mini"` — tests/unit/model-provider.test.ts:39,52.
  - `"OPENAI_API_KEY"` — tests/unit/model-provider.test.ts:11,21,31,41 + tests/unit/microcompose-microenv.test.ts:13 (cross-file, reported above).
  - `"2026-11-05"` — tests/unit/guided-reporting-schema.test.ts:51,75,77,111,131,146,150.
  - `"INC-2026-001"` — tests/unit/notice-composer.test.ts:43,175,359.
  - `"2026-10-30T10:00:00.000Z"` — tests/unit/notice-composer.test.ts:178 (via `fixedNow` line 17),43,175.
  - `"dpo-officer"` — tests/unit/notice-composer.test.ts:217,272,317.
  - `"sec-auditor-1"` — tests/unit/notice-composer.test.ts:31,38.
  - `"a@example.com"` — tests/unit/pims-schema.test.ts:50,53,71,73.
  - `"grupob4"` — tests/unit/pims-schema.test.ts:78,96; `"grupob4@unsa.edu.pe"` — tests/unit/pims-schema.test.ts:81,97.
  - `"file:encryption-config-export.json"` — tests/unit/notice-composer.test.ts:385,495.

## R5

No violations found.

Note (test context): `"file:encryption-config-export.json"` (notice-composer.test.ts:385,495) and `"analysis:disproportionate-effort"` (line 476) are fixture evidence-ref strings, not filesystem paths or file ops. No `~/`, `/home/`, `/tmp`, `file:///`, `C:\`, `../`, or hardcoded absolute paths; no file ops at all in these 5 test files.

## R6

No violations found.

## Summary

| Rule | Count |
|------|-------|
| R1 | 0 |
| R2 | 0 |
| R3 | 0 |
| R4 | 1 |
| R5 | 0 |
| R6 | 0 |
| Total | 1 |
