# Slice 29 harness-acceptance — Quality Audit

Audited files (2026-11-05):
- tests/helpers/integration-harness.ts (454 lines)
- tests/helpers/span-geometry.ts (197 lines)
- tests/acceptance/guided-creation.test.ts (416 lines)
- tests/acceptance/presidio-redaction.test.ts (251 lines)

## R1

- tests/acceptance/guided-creation.test.ts:187 — `if (res.status !== 200) { console.error("DRAFT ERROR BODY:", ...); }` — branch only logs without affecting control flow; no fail-fast throw or state change follows (test context).
- tests/acceptance/guided-creation.test.ts:231 — `if (res.status !== 200) { console.error("DRAFT ERROR BODY:", ...); }` — same log-only branch, execution continues to `expect(res.status).toBe(200)` regardless (test context).
- tests/acceptance/guided-creation.test.ts:161 — `if (presidioContainer) { await presidioContainer.stop(); }` — missing `else`; when the probe-reuse path left the variable unassigned, teardown state is left implicit (test context).
- tests/acceptance/guided-creation.test.ts:164 — `if (harness) { await harness.stop(); }` — missing `else`; failed `beforeAll` leaves teardown implicit (test context).
- tests/acceptance/presidio-redaction.test.ts:71 — `if (presidioContainer) { await presidioContainer.stop(); }` — missing `else`, teardown state implicit (test context).
- tests/acceptance/presidio-redaction.test.ts:74 — `if (harness) { await harness.stop(); }` — missing `else`, teardown state implicit (test context).
- tests/helpers/span-geometry.ts:124 — `if (!map.has(chunk.text)) { map.set(chunk.text, axes); }` — missing `else`; duplicate chunk text silently keeps first-wins axes with no error or merge, state left implicit.

## R2

- tests/helpers/integration-harness.ts:120 — `const connectionUri = stackEnv.EVIDENCE_DB_URL ?? process.env.EVIDENCE_DB_URL;` — `??` default chain hiding absent stack state instead of fail-fast with a named error.
- tests/helpers/integration-harness.ts:203 — `indexer.getAllChunks().find(...) ?? indexer.getAllChunks()[0];` — `??` fallback to an arbitrary first chunk when the `gdpr-full` chunk is absent instead of fail-fast.
- tests/helpers/integration-harness.ts:227 — `const prompt = args.messages[0]?.content ?? "";` — `?? ""` silent default hiding absent message state.
- tests/helpers/integration-harness.ts:404 — `PRESIDIO_URL: options?.presidioUrl ?? "http://127.0.0.1:3001",` — `??` default hiding absent option instead of fail-fast.
- tests/helpers/integration-harness.ts:402 — `AUTO_NOTIFY: options?.autoNotify === true ? "true" : "false",` — absent flag silently defaults to `"false"` instead of fail-fast with a named error.
- tests/helpers/span-geometry.ts:10 — `clean.match(/[a-z0-9_.]+/g) ?? []` — `??` default hiding no-match state.
- tests/helpers/span-geometry.ts:19 — `const prev = vec[idx] ?? 0;` — `??` default hiding absent index state.
- tests/helpers/span-geometry.ts:25 — `(vec[i] ?? 0) * (vec[i] ?? 0)` — `??` defaults hiding absent vector slots.
- tests/helpers/span-geometry.ts:34 — `((vec[i] ?? 0) / norm)` — `??` default hiding absent slot.
- tests/helpers/span-geometry.ts:88 — `(bounds[i + 1]?.line ?? lines.length + 1) - 1` — `??` default hiding absent next-bound state.
- tests/helpers/span-geometry.ts:135 — `lower.match(...) ?? []` — `??` default hiding no-match state.
- tests/helpers/span-geometry.ts:142 — `lower.match(/[ab]\.\d+\.\d+/g) ?? []` — `??` default hiding no-match state.
- tests/helpers/span-geometry.ts:149 — `lower.match(/\d+(?:\.\d+)+/g) ?? []` — `??` default hiding no-match state.
- tests/helpers/span-geometry.ts:173 — `return registry.get(text) ?? [];` — `??` default hiding cache-miss state instead of fail-fast (contrast with the throw on missing registry two lines above).
- tests/helpers/span-geometry.ts:188 — `(vec[axisDim] ?? 0) + SPAN_WEIGHT` — `??` default hiding absent slot.
- tests/acceptance/guided-creation.test.ts:38 — `process.env.PRESIDIO_URL ?? "http://127.0.0.1:3001"` — `??` default hiding absent env state.
- tests/acceptance/guided-creation.test.ts:48 — `} catch { isAlreadyUp = false; }` — `try/except` swallowing the fetch error (no logging, no assertion) (test context).
- tests/acceptance/guided-creation.test.ts:52 — `if (!isAlreadyUp) { presidioContainer = await new GenericContainer(...).start(); }` — speculative probe-then-start fallback cascade: silently switches to a second Presidio provisioning path instead of fail-fast with a named error (test context).

## R3

No violations found.

## R4

Single-use local literals are OK and are not reported. Repeated operational literals within this slice (each needs a shared constant/config):

- `"admissions-portal"` — tests/helpers/integration-harness.ts:96,137; tests/acceptance/guided-creation.test.ts:95,171,201,238,311,355,384 (cross-file candidate).
- `"http://127.0.0.1:3001"` — tests/helpers/integration-harness.ts:404; tests/acceptance/guided-creation.test.ts:38 (cross-file candidate).
- `"https://api.openai.com/v1"` — tests/helpers/integration-harness.ts:161,174,385,387,389,391,393 (within-slice repeat; cross-file candidate with value below).
- `"https://api.openai.com/v1"` as `endpoint` — tests/acceptance/presidio-redaction.test.ts:160 (modelConfig) (cross-file candidate with above).
- `"gpt-4o-mini"` — tests/helpers/integration-harness.ts:169,172,387,393; tests/acceptance/presidio-redaction.test.ts:157 (cross-file candidate).
- `"gpt-4o"` (incl. as substring of `"gpt-4o-mini"`) — tests/helpers/integration-harness.ts:160,169,172,385,387,389,393 (within-slice repeat).
- `"text-embedding-3-small"` — tests/helpers/integration-harness.ts:171,391 (within-slice repeat).
- `"OPENAI_API_KEY"` — tests/helpers/integration-harness.ts:163,385,387,389,391,393; tests/acceptance/presidio-redaction.test.ts:162 (cross-file candidate).
- `"openai,gpt-4o,https://api.openai.com/v1,OPENAI_API_KEY,20000,0,fallback:none"`-family model-spec strings — tests/helpers/integration-harness.ts:385,387,389,391,393 (within-slice repeat of endpoint/auth/timeout/retry/fallback segments).
- `5000` (Presidio `timeoutMs` / `PRESIDIO_TIMEOUT_MS`) — tests/helpers/integration-harness.ts:405; tests/acceptance/guided-creation.test.ts:68; tests/acceptance/presidio-redaction.test.ts:56 (cross-file candidate).
- `3000` (container exposed port / mapped port / `/health` wait port) — tests/acceptance/guided-creation.test.ts:56,62; tests/acceptance/presidio-redaction.test.ts:44,49 (cross-file candidate).
- `"/health"` — tests/acceptance/guided-creation.test.ts:41,57; tests/acceptance/presidio-redaction.test.ts:45 (cross-file candidate).
- `60_000` (`.withStartupTimeout`) — tests/acceptance/guided-creation.test.ts:58; tests/acceptance/presidio-redaction.test.ts:46 (cross-file candidate).
- `0.5` (`minScore`) — tests/acceptance/guided-creation.test.ts:69; tests/acceptance/presidio-redaction.test.ts:57,133,147 (cross-file candidate).
- `"presidio-analyzer:2.2.x-es"` (container image) — tests/acceptance/guided-creation.test.ts:54; tests/acceptance/presidio-redaction.test.ts:43 (cross-file candidate).
- `"http://127.0.0.1:19999"` (dead-sidecar URL) — tests/acceptance/presidio-redaction.test.ts:133,147,196 (within-slice repeat).
- `500` (dead-client `timeoutMs`) — tests/acceptance/presidio-redaction.test.ts:134,148,197 (within-slice repeat).
- `20000` (`timeout_ms`) — tests/helpers/integration-harness.ts:163,385,387,389,391,393; tests/acceptance/presidio-redaction.test.ts:161 (cross-file candidate).
- `"30000"` / `30000` (`RAG_TIMEOUT_MS`) — tests/helpers/integration-harness.ts:218,399 (within-slice repeat).
- `24` / `"24"` (`RAG_TOP_K`) — tests/helpers/integration-harness.ts:214,396 (within-slice repeat).
- `6` / `"6"` (`RAG_RERANK_K`) — tests/helpers/integration-harness.ts:215,397 (within-slice repeat).
- `0.35` / `"0.35"` (`RAG_MIN_SCORE`) — tests/helpers/integration-harness.ts:216,398 (within-slice repeat).
- `"gdpr-full"` — tests/helpers/integration-harness.ts:203; tests/helpers/span-geometry.ts:109,166 (cross-file candidate).
- `"corpus"` path segment — tests/helpers/integration-harness.ts:191 (`dirPath: "corpus"`); tests/helpers/span-geometry.ts:73 (`"corpus/gdpr-full.txt"`) (cross-file candidate).
- `1024` (embedding `dim` default) — tests/helpers/span-geometry.ts:6,178 (within-slice repeat).
- `.toFixed(6)` — tests/helpers/span-geometry.ts:34,196 (within-slice repeat).
- `"a1".repeat(32)` (evidence key) — tests/helpers/integration-harness.ts:152,395 (within-slice repeat).
- `"unsa"` (schema) — tests/helpers/integration-harness.ts:141,377 (within-slice repeat).
- `"admin"` (PIMS username) — tests/helpers/integration-harness.ts:143,379 (within-slice repeat).
- `"integration-test-key"` vs `"test-key"` — related credential literals in tests/helpers/integration-harness.ts:173,382 and tests/acceptance/presidio-redaction.test.ts:166 (cross-file candidate family; values differ but serve the same operational slot).
- `180_000` (vitest `beforeAll` timeout) — tests/acceptance/guided-creation.test.ts:158; tests/acceptance/presidio-redaction.test.ts:68 (cross-file candidate).
- `240_000` describe timeout vs `180_000` describe timeout — distinct values, not a repeat; noted only so synthesis does not merge them.

## R5

No violations found. File access is project-root-relative (`process.cwd()` in tests/helpers/integration-harness.ts:116, tests/helpers/span-geometry.ts:73, tests/acceptance/presidio-redaction.test.ts:59; `dirPath: "corpus"` in tests/helpers/integration-harness.ts:191). Temporary storage uses stdlib APIs (`os.tmpdir()` + `fs.mkdtempSync` in tests/helpers/integration-harness.ts:148-150), which the contract explicitly allows. Loopback/container URLs (`http://127.0.0.1:3001`, `http://127.0.0.1:19999`, `https://api.openai.com/v1`, fixture URLs) are network endpoints, not machine-dependent file paths, and are reported under R4 instead.

## R6

- tests/helpers/span-geometry.ts:11-20 — hand-rolled FNV-1a hash loop (`h ^= ...; Math.imul(h, 16777619)`) with manual `Math.abs(h) % dim` bucketing — custom hashing where the stdlib `node:crypto` (`createHash("sha256")`/`randomUUID`-family digest → int) already provides it.
- tests/helpers/span-geometry.ts:23-35,191-196 — hand-rolled L2-normalization loops (manual `norm += v*v`, `Math.sqrt`, per-element divide + `toFixed(6)`) duplicated in both `generateDeterministicEmbedding` and `generateSpanAwareEmbedding` — custom vector math with no shared helper; ecosystem alternative is a shared normalize helper or an established vector/text-embedding utility instead of two copies (test context: deterministic mock, but duplication is still hand-rolled).
- tests/helpers/span-geometry.ts:150-162 — hand-rolled longest-suffix matcher over `isoSuffixes` (sort by length, nested `startsWith` loop) — custom trie/prefix matching where a single anchored regex alternation or an established matcher utility already provides it.

## Summary

| Rule | Count |
| ---- | ----- |
| R1 | 7 |
| R2 | 18 |
| R3 | 0 |
| R4 | 26 literal families |
| R5 | 0 |
| R6 | 3 |
| Total | 54 (28 line findings + 26 R4 families) |
