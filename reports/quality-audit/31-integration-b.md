# Slice 31 integration-b — Quality Audit

Audited files (date 2026-11-05):
- `tests/integration/pims-adapter.test.ts` (694 lines)
- `tests/integration/rag-eval-gate.test.ts` (264 lines)
- `tests/integration/scheduler.test.ts` (452 lines)
- `tests/integration/tools.test.ts` (842 lines)
- `tests/integration/watcher-daemon.test.ts` (198 lines)

## R1

- `tests/integration/pims-adapter.test.ts:39` — `if (!fs.existsSync(dumpPath) || !fs.existsSync(seedPath)) { throw ... }` with no `else` — guard style: the files-exist path falls through implicitly rather than an explicit `else` branch (test context).
- `tests/integration/pims-adapter.test.ts:76` — `if (serverInstance) { await serverInstance.stop(); }` with no `else` — undefined instance silently skips `stop()` with no assertion/error (test context).
- `tests/integration/pims-adapter.test.ts:79` — `if (dbClient) { await dbClient.sql.end(); }` with no `else` — undefined client silently skips `sql.end()` (test context).
- `tests/integration/pims-adapter.test.ts:82` — `if (container) { await container.stop(); }` with no `else` — undefined container silently skips `stop()` (test context).
- `tests/integration/pims-adapter.test.ts:639` — `if (attachment === undefined) { throw new Error("upload returned no attachment"); }` with no `else` — guard style; defined path is implicit fall-through (test context).
- `tests/integration/rag-eval-gate.test.ts:168` — `if (textLower.includes(w)) { matches++; }` with no `else` — non-matching word leaves `matches` unchanged implicitly inside the mock rerank scorer (test context).
- `tests/integration/rag-eval-gate.test.ts:217` — `if (sql) { await sql.end(); }` with no `else` — undefined `sql` silently skips `sql.end()` (test context).
- `tests/integration/rag-eval-gate.test.ts:220` — `if (container) { await container.stop(); }` with no `else` — undefined container silently skips `stop()` (test context).
- `tests/integration/scheduler.test.ts:85` — `if (reviewFailure !== null) { throw reviewFailure; }` with no `else` — guard style; the `null` path falls through implicitly to `return outcomes.review` (test context).
- `tests/integration/scheduler.test.ts:123` — `if (!(error instanceof PimsBaseError)) { throw error; }` with no `else` — non-`PimsBaseError` rethrows, `PimsBaseError` path falls through implicitly to `return { code, message }` (test context).
- `tests/integration/scheduler.test.ts:144` — `if (store) { await store.close(); }` with no `else` — undefined store silently skips `close()` (test context).
- `tests/integration/scheduler.test.ts:147` — `if (sql) { await sql.end(); }` with no `else` — undefined `sql` silently skips `end()` (test context).
- `tests/integration/scheduler.test.ts:150` — `if (container) { await container.stop(); }` with no `else` — undefined container silently skips `stop()` (test context).
- `tests/integration/tools.test.ts:331` — `if (store) { await store.sql.end(); }` with no `else` — silently skips `store.sql.end()` (test context).
- `tests/integration/tools.test.ts:334` — `if (serverInstance) { await serverInstance.stop(); }` with no `else` — silently skips `stop()` (test context).
- `tests/integration/tools.test.ts:337` — `if (dbClient) { await dbClient.sql.end(); }` with no `else` — silently skips `sql.end()` (test context).
- `tests/integration/tools.test.ts:340` — `if (container) { await container.stop(); }` with no `else` — silently skips `stop()` (test context).
- `tests/integration/tools.test.ts:343` — `if (storageDir) { fs.rmSync(storageDir, ...); }` with no `else` — silently skips evidence-dir cleanup (test context).
- `tests/integration/watcher-daemon.test.ts:24` — `if (harness) { await harness.stop(); }` with no `else` — undefined harness silently skips `stop()` (test context).
- `tests/integration/watcher-daemon.test.ts:33` — `if (!recipients.results.some((row) => row.email === "dpo@example.test")) { ...create... }` with no `else` — recipient-already-exists path leaves setup state implicit with no assertion/log (test context).
- `tests/integration/watcher-daemon.test.ts:170` — `if (sealed === null || sealed.seal_sha256 === null) { throw new Error("sealed manifest missing"); }` with no `else` — guard style; sealed-present path is implicit fall-through (test context).
- `tests/integration/watcher-daemon.test.ts:175` — `if (firstBundle === undefined) { throw new Error("bundle attachment missing"); }` with no `else` — guard style; defined path is implicit fall-through (test context).

## R2

- `tests/integration/pims-adapter.test.ts:617` — `expect(restored.deleted_at ?? null).toBeNull();` — `?? default` hiding absent state: `undefined` coerced to `null` so the assertion passes instead of fail-fast on a missing field (test context).
- `tests/integration/rag-eval-gate.test.ts:163` — `query.toLowerCase().match(/[a-z0-9_.]+/g) ?? []` — `?? default` hiding absent state: `match` returning `null` (zero tokens) silently becomes `[]` instead of a named error (test context mock scorer).
- `tests/integration/rag-eval-gate.test.ts:172-173` — `queryWords.length > 0 ? matches / queryWords.length : 0.5` — silent `0.5` default score when there are zero query words instead of fail-fast with a named error (test context mock scorer).
- `tests/integration/tools.test.ts:567` — `action_count: afterResolution.actions?.length ?? 0,` — `?? default` hiding absent state: missing `actions` silently recorded as `0` (test context).
- `tests/integration/tools.test.ts:824` — `(audit?.findings ?? []).filter((finding) => ...)` — `?? default` hiding absent state: missing `findings` silently becomes `[]` (test context).
- `tests/integration/watcher-daemon.test.ts:156` — `const actions = closed.actions ?? [];` — `?? default` hiding absent state: missing `actions` silently becomes `[]` (test context).

## R3

No violations found.

## R4

Within-slice repeats (same operational literal hardcoded 2+ times inside the slice; must live in a shared constant/config):
- `tests/integration/pims-adapter.test.ts:45` + `tests/integration/tools.test.ts:179` — `"postgres:16-alpine"` container image hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:133` + `tests/integration/scheduler.test.ts:133` — `"pgvector/pgvector:pg16"` container image hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:35` + `tests/integration/tools.test.ts:175` — `"data/gestitel_base_de_datos.sql"` seed dump path segment hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:37` + `tests/integration/tools.test.ts:177` — `"data/02-init-unsa-seed.sql"` seed path segment hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:49` + `tests/integration/tools.test.ts:183` — `"/docker-entrypoint-initdb.d/01-gestitel.sql"` container mount target hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:54` + `tests/integration/tools.test.ts:188` — `"/docker-entrypoint-initdb.d/02-seed.sql"` container mount target hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:68,564,653` + `tests/integration/tools.test.ts:50,200,593` — `"unsa"` schema hardcoded in 2 files (plus intra-file repeats).
- `tests/integration/pims-adapter.test.ts:69,92,112,223,516,565,654` + `tests/integration/tools.test.ts:201` — `"admin"` username hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:139,153` + `tests/integration/tools.test.ts:217,230` — `"https://api.openai.com/v1"` endpoint URL hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:138` + `tests/integration/tools.test.ts:216` — `"gpt-4o"` model name hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:148,151` + `tests/integration/tools.test.ts:225,228` — `"gpt-4o-mini"` model name hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:150` + `tests/integration/tools.test.ts:227` — `"text-embedding-3-small"` model name hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:137` + `tests/integration/tools.test.ts:215` — `"openai"` provider hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:140` + `tests/integration/tools.test.ts:218` — `"OPENAI_API_KEY"` env-key literal hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:143` + `tests/integration/tools.test.ts:221` — `fallback: "none"` hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:142` + `tests/integration/tools.test.ts:220` — `max_retries: 3` retry count hardcoded in 2 files.
- `tests/integration/rag-eval-gate.test.ts:141` + `tests/integration/tools.test.ts:219` — `timeout_ms: 20000` / `20_000` (same value) hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:71,656` + `tests/integration/tools.test.ts:203` — `timeoutMs: 15000` / `15_000` (same value) hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:73` + `tests/integration/tools.test.ts:346` — `120_000` vitest timeout hardcoded in 2 files.
- `tests/integration/tools.test.ts:121,328` + `tests/integration/watcher-daemon.test.ts:16` — `240_000` vitest timeout hardcoded in 2 files.
- `tests/integration/tools.test.ts:101,673,679,692` + `tests/integration/watcher-daemon.test.ts:33,36` — `"dpo@example.test"` fixture email hardcoded in 2 files.
- `tests/integration/scheduler.test.ts:199,224,245,262,312,335,382,395` + `tests/integration/tools.test.ts:160,162` — `"T72_AUTHORITY"` timer-kind literal in 2 files (8× intra-file in scheduler).
- `tests/integration/scheduler.test.ts:221,319,336` — `"T_PROCESSOR"` timer-kind literal 3× in one file (test context).
- `tests/integration/scheduler.test.ts:221,288,325,337` — `"T_SUBJECT"` timer-kind literal 4× in one file (test context).
- `tests/integration/scheduler.test.ts:235,448` — `"T_RETRY"` timer-kind literal 2× in one file (test context).
- `tests/integration/scheduler.test.ts:433,450` — `"T_REVIEW_SLA"` timer-kind literal 2× in one file (test context).
- `tests/integration/tools.test.ts:237` + `tests/integration/scheduler.test.ts:449` — `"retry_of"` retry-payload key hardcoded in 2 files.
- `tests/integration/pims-adapter.test.ts:532,540,572,581,604,626,677` + `tests/integration/tools.test.ts:68` — `"2026-10-01"` fixture date hardcoded in 2 files (plus 7× intra-file in adapter).
- `tests/integration/scheduler.test.ts:48,157` — `"2026-10-01T12:00:00.000Z"` clock anchor 2× in one file (test context).
- `tests/integration/rag-eval-gate.test.ts:210,235` — `0.35` threshold duplicated: config `RAG_MIN_SCORE: 0.35` and assertion `toBeGreaterThanOrEqual(0.35)` (test context).
- `tests/integration/scheduler.test.ts:176,200,208,226,236,244,263,313,319,325,355,383,404,431,438` — `60 * 60 * 1000` duration magic-number expression (and `2 *` multiples) repeated intra-file (test context).
- `tests/integration/pims-adapter.test.ts:318,324,332` — `"dpo-security@unsa.pe"` recipient email 3× in one file (test context).
- `tests/integration/pims-adapter.test.ts:217,221,267` — `"forensics.txt"` fixture filename 3× in one file (test context).
- `tests/integration/pims-adapter.test.ts:234,246` — `"malware.exe"` fixture filename 2× in one file (test context).
- `tests/integration/pims-adapter.test.ts:633,636` — `"round-trip.txt"` fixture filename 2× in one file (test context).
- `tests/integration/pims-adapter.test.ts:506,518` — `"X-Simulate-Error"` header name 2× in one file (test context).
- `tests/integration/pims-adapter.test.ts:506,518` — `"403_LICENSE"` error-simulation marker 2× in one file (test context).
- `tests/integration/tools.test.ts:595,606,617,625` — `"evidence.txt"` staged filename 4× in one file (test context).
- `tests/integration/tools.test.ts:597,607,618` — `"text/plain"` MIME literal 3× in one file (test context).
- `tests/integration/tools.test.ts:393,605` — `"0".repeat(64)` zero-hash literal 2× in one file (test context).
- `tests/integration/tools.test.ts:675,677` — `"test-op"` operator subject 2× in one file (test context).
- `tests/integration/tools.test.ts:802,823` — `"10.2 corrective action for ..."` finding-description prefix 2× in one file (test context).
- `tests/integration/tools.test.ts:831,834,838` — `"AUDIT_LINK:"` evidence-marker prefix 3× in one file (test context).

Cross-file-literal candidates for global synthesis (single-use in slice, verify repo-wide):
- `tests/integration/pims-adapter.test.ts:517` — `"test-password"`.
- `tests/integration/pims-adapter.test.ts:519` — `"sess_123"`.
- `tests/integration/pims-adapter.test.ts:209` — `"Estado: O -> P"`.
- `tests/integration/pims-adapter.test.ts:260` — `"disallowed_extension"`.
- `tests/integration/pims-adapter.test.ts:496` — `999999` (not-found probe id).
- `tests/integration/rag-eval-gate.test.ts:152` — `"eval-gate-test-key"`.
- `tests/integration/tools.test.ts:229` — `"tools-integration-key"`.
- `tests/integration/tools.test.ts:209` — `"a".repeat(64)` (evidence keyHex).
- `tests/integration/scheduler.test.ts:42` — `"0123456789abcdef..."` (64-hex evidence keyHex).
- `tests/integration/tools.test.ts:51` — `"agi1"` (`IDEMPOTENCY_KEY_PREFIX`).
- `tests/integration/tools.test.ts:160` — `` `timer:${incidentCode}:T72_AUTHORITY:test` `` (timer-id format).
- `tests/integration/tools.test.ts:566` — `"REOPEN_BASELINE:..."` (agent-state key prefix).
- `tests/integration/tools.test.ts:249` — `"chunk-1"` / `"gdpr"` / `"tools-test-v1"` (index fixture ids).
- `tests/integration/tools.test.ts:740` — `"AST-001"` (compromised-system fixture).
- `tests/integration/tools.test.ts:750,751` — `"TH10"` / `"VN03"` (threat/vulnerability codes).
- `tests/integration/tools.test.ts:801` — `"A.3.12"` (requirement code).
- `tests/integration/watcher-daemon.test.ts:65` — `` `WATCHER:${code}` `` (agent-state key prefix).
- `tests/integration/watcher-daemon.test.ts:110` — `"watcher-test-token"`.
- `tests/integration/scheduler.test.ts:371` — `` `PERU_48H_ADVISORY:${code}` `` (log marker).
- `tests/integration/scheduler.test.ts:396` — `"DEADLINE_MISSED_72H"` (page reason).
- `tests/integration/scheduler.test.ts:213,240,268,283` — `"SCHEDULER_DUPLICATE"` / `"SCHEDULER_OVERFLOW"` / `"SCHEDULER_PAST_DUE"` / `"SCHEDULER_UNKNOWN_TIMER"` (error codes asserted by value).
- `tests/integration/tools.test.ts:349,357,372,379,386` — `"TOOL_UNKNOWN:..."` / `"TOOL_ARGS_INVALID:..."` / `"ROLE_TOOL_DENIED:..."` (error-code prefixes asserted by value).
- `tests/integration/tools.test.ts:462,484,496,519,536,545,560,585,609,660,734,778` — `"TRANSITION_FORBIDDEN:..."` / `"ACTION_SEQUENCE_VIOLATION"` / `"REVIEW_APPROVAL_MISSING"` / `"REVIEW_APPROVAL_REUSED"` / `"REVIEW_APPROVAL_INVALID"` / `"ATTACHMENT_HASH_MISMATCH"` / `"NOTIFY_NO_RECIPIENTS"` / `"RISK_SIGNAL_NO_ASSET"` (error codes asserted by value).

## R5

No violations found.

## R6

No violations found.

## Summary

| Rule | Count |
|------|-------|
| R1 | 22 |
| R2 | 6 |
| R3 | 0 |
| R4 | 43 within-slice repeats + 23 cross-file candidates |
| R5 | 0 |
| R6 | 0 |
| Total | 71 findings (+ 23 candidates) |
