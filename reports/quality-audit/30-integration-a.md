# Slice 30 Integration-A — Quality Audit

Audited files (5 files, 2577 lines total), date 2026-11-05:

- `tests/integration/bundle-sealer.test.ts` (263 lines)
- `tests/integration/cockpit.test.ts` (539 lines)
- `tests/integration/evidence-store.test.ts` (650 lines)
- `tests/integration/lifecycle-loop.test.ts` (985 lines)
- `tests/integration/live-pims-smoke.test.ts` (140 lines)

All findings are in test context: reported fully, never suppressed.

## R1

- bundle-sealer.test.ts:34 — `if (fs.existsSync(storageRootDir)) {` — `if` without `else`; absent-path state left implicit (test context).
- bundle-sealer.test.ts:50 — `if (store) {` — `if` without `else`; un-closed state implicit (test context).
- bundle-sealer.test.ts:53 — `if (container) {` — `if` without `else`; un-stopped state implicit (test context).
- bundle-sealer.test.ts:56 — `if (fs.existsSync(storageRootDir)) {` — `if` without `else` in teardown (test context).
- cockpit.test.ts:26 — `if (done) { return accumulated; }` — early return with no `else`; loop-exit state handled only by fall-through (test context).
- cockpit.test.ts:30 — `if (matcher(accumulated)) { return accumulated; }` — `if` without `else`; non-match state implicit (test context).
- cockpit.test.ts:34 — `throw new Error(\`SSE read timed out; ...\`)` — generic `Error`, not a dedicated error class (test context).
- cockpit.test.ts:52 — `if (!isCockpitPersona) { return null; }` — `if` without `else`; non-persona state returns null sentinel instead of raising (test context).
- cockpit.test.ts:80 — `if (firstCitation === null) {` (regex re-extract attempt) — `if` without `else`; still-null state falls through implicitly (test context).
- cockpit.test.ts:84 — `if (match?.[1]) { firstCitation = match[1]; }` — `if` without `else`; no-match state implicit (test context).
- cockpit.test.ts:89 — `if (chatMode === "fabricated") { return {...} }` — chained mode branch, no final `else`; exhaustiveness relies on fall-through to later `if`s (test context).
- cockpit.test.ts:96 — `if (chatMode === "pii") { return {...} }` — same chained-branch fall-through (test context).
- cockpit.test.ts:103 — `if (firstCitation === null) { return {...} }` — `if` without `else`; fall-through is the implicit else (test context).
- cockpit.test.ts:121 — `if (!recipients.results.some(...)) { await harness.callTool(...) }` — `if` without `else`; recipient-exists state implicit (test context).
- cockpit.test.ts:144 — `if (harness) { await harness.stop(); }` — `if` without `else`; missing-harness state implicit (test context).
- cockpit.test.ts:214 — `if (reader === undefined) { throw new Error("SSE body missing"); }` — generic `Error`, not dedicated; no `else` (test context).
- cockpit.test.ts:378 — `if (okResponse.status !== 200) { throw new Error(\`CHAT_FAILED:...\`) }` — generic `Error`, not dedicated error class (test context).
- cockpit.test.ts:485 — `if (reader === undefined) { throw new Error("SSE body missing"); }` — duplicate of :214; generic `Error` (test context).
- evidence-store.test.ts:39 — `if (fs.existsSync(storageRootDir)) {` — `if` without `else` (test context).
- evidence-store.test.ts:54 — `if (store) {` / :57 `if (container) {` / :60 `if (fs.existsSync(...)) {` — `if`s without `else` in teardown (test context).
- evidence-store.test.ts:285 — `if (!row) { throw new Error("Expected draft pack row...") }` — generic `Error`, not dedicated error (test context).
- evidence-store.test.ts:426 — `if (rejection?.status !== "rejected") { throw new Error("Expected exactly one...") }` — generic `Error` (test context).
- evidence-store.test.ts:435 — `if (holder === undefined) { throw new Error("Expected a lease holder row") }` — generic `Error` (test context).
- lifecycle-loop.test.ts:218 — `if (authorityChunk === undefined) { throw new Error("Corpus index produced no chunks") }` — generic `Error`, not dedicated (test context).
- lifecycle-loop.test.ts:426 — `if (rejection?.status !== "rejected")` — (same pattern via afterAll guards :424–438 `if (server)`, `if (store)`, `if (dbClient)`, `if (container)`, `if (storageDir)`) — `if`s without `else`; missing-resource state implicit (test context).
- lifecycle-loop.test.ts:455 — `if (recipients.results.some(...)) { return; }` — `if` without `else`; fall-through is implicit else (test context).
- lifecycle-loop.test.ts:535 — `if (auditLink === null) { throw new Error("expected an audit link") }` — generic `Error` (test context).
- lifecycle-loop.test.ts:826 — `if (code === undefined) { throw new Error("no incidents created") }` — generic `Error` (test context).
- live-pims-smoke.test.ts:22 — `if (!enabled) { console.log("LIVE_PIMS_SMOKE_SKIPPED"); return; }` — branch that only logs plus bare return; skip state signaled via `console.log` string, not a managed state or dedicated skip error (test context).
- live-pims-smoke.test.ts:42 — `if (page.results[0] !== undefined) {` — `if` without `else`; empty-page state implicit (test context).
- live-pims-smoke.test.ts:48 — `if (row.recipients_snapshot !== null && row.recipients_snapshot !== undefined) {` — `if` without `else`; null-snapshot state implicit (test context).
- live-pims-smoke.test.ts:97 — `if (error instanceof AttachmentRejectedError || error instanceof PimsValidationError) { jsonAttachmentAccepted = false; console.warn(...) } else { throw error; }` — `if` branch only flips a boolean flag and logs (`console.warn` without affecting control flow beyond the flag); tri-state outcome collapsed into a flag (test context).
- live-pims-smoke.test.ts:132 — `if (row.recipients_snapshot !== null && ...) {` — duplicate of :48; `if` without `else` (test context).

## R2

- bundle-sealer.test.ts: No violations found.
- cockpit.test.ts:49 — `args.system.includes("compliance auditor assistant") || args.system.includes("executive incident-response assistant") || args.system.includes("Data Protection Officer assistant")` — chained `||` speculative persona sniffing; defaults to treating any non-match as non-cockpit instead of fail-fast on unknown persona (test context).
- cockpit.test.ts:57 — `JSON.parse(args.messages[0]?.content ?? "{}")` — `?? "{}"` default hiding absent message content (test context).
- cockpit.test.ts:58 — `} catch {` (outer) — `catch` falls back to regex-sanitize + re-parse instead of failing fast with a named error (test context).
- cockpit.test.ts:59 — `(args.messages[0]?.content ?? "{}").replace(...)` — second `?? "{}"` default on the same absent state (test context).
- cockpit.test.ts:65 — `} catch { context = {}; }` — nested `catch { fallback }`; swallows parse error into silent `{}` default (test context).
- cockpit.test.ts:69 — `Array.isArray(context.citations) ? context.citations : []` — ternary defaulting non-array citations to `[]`, hiding malformed state (test context).
- cockpit.test.ts:81 — `(args.messages[0]?.content ?? "").match(...)` — `?? ""` default hiding absent content (test context).
- evidence-store.test.ts: No violations found. (`?.` chains at :167–173, :186–190, :288–298, :460–464, :524–537, :580–584 feed `expect()` assertions that fail fast on `undefined`; `if (!row)/if (holder === undefined) throw` at :285, :435 fail fast; no `??`/`||` defaults, no `try/except` swallowing, no chained `exists(p1)/exists(p2)`.)
- lifecycle-loop.test.ts:216 — `indexer.getAllChunks().find((chunk) => chunk.doc_id === "gdpr-full") ?? indexer.getAllChunks()[0]` — `??` fallback chain: silently substitutes an arbitrary first chunk when the `gdpr-full` chunk is absent (test context).
- lifecycle-loop.test.ts:240 — `args.messages[0]?.content ?? ""` — `?? ""` default hiding absent prompt (test context).
- lifecycle-loop.test.ts:241 — `prompt.includes('"involves_personal_data":false') || prompt.includes('"incident_type":"OT"') || prompt.includes("Port scan") || prompt.includes("edge-router")` — chained `||` speculative fixture sniffing instead of an explicit fixture tag (test context).
- lifecycle-loop.test.ts:247 — `args.system.startsWith(TRIAGE_SYSTEM) || args.system.includes("triage classifier")` (and repeated `||` dual-match at :265, :280, :292, :307, :315, :339, :359, :370) — chained speculative match cascades; unknown system prompt only fails at the terminal `throw` (:378) after 9 speculative branches (test context).
- lifecycle-loop.test.ts:519 — `investigation.incident.actions ?? []` — `?? []` default hiding absent actions (test context).
- lifecycle-loop.test.ts:540 — `(audit?.findings ?? []).find(...)` — `?? []` default hiding absent findings (test context).
- lifecycle-loop.test.ts:592 — `afterNotify.evidence_refs ?? ""` (also :609, :623, :704, :772, :799, :800, :802) — repeated `?? ""` defaults hiding absent `evidence_refs` (test context).
- lifecycle-loop.test.ts:600 — `(row.recipients_snapshot ?? []).length > 0` (also :663) — `?? []` default hiding absent snapshot (test context).
- live-pims-smoke.test.ts:10 — `process.env.PIMS_LIVE_BASE_URL ?? "https://unsa.27k.pe"` — `??` default hiding absent env config (test context).
- live-pims-smoke.test.ts:29 — `process.env.PIMS_SCHEMA ?? "unsa"` — `??` default hiding absent env config (test context).
- live-pims-smoke.test.ts:85 — `(withAction.actions ?? []).some(...)` — `?? []` default hiding absent actions (test context).
- live-pims-smoke.test.ts:89 — `try { ...uploaded... } catch (error: unknown) { if (...) { jsonAttachmentAccepted = false; console.warn(...) } else { throw error; } }` — `try/except` swallowing two error types into a boolean flag + `console.warn`, then `expect(jsonAttachmentAccepted).toBe(true)` at :109; swallows instead of fail-fast with a named error (test context).

## R3

- bundle-sealer.test.ts: No violations found.
- cockpit.test.ts: No violations found.
- evidence-store.test.ts: No violations found.
- lifecycle-loop.test.ts: No violations found. (`nestedActionMode: "replace"` at :146 and `fallback: "none"` at :176 are current-mode selections, not legacy shims; `as unknown as` casts are type-level, not runtime compat paths.)
- live-pims-smoke.test.ts: No violations found.

## R4

Single-use local literals are OK and are not listed. Only literals repeated within this slice, plus cross-file candidates for global synthesis, are listed.

Within-slice repeats:

- bundle-sealer.test.ts:27 — `"bundle-sealer-test"` in `path.resolve(process.cwd(), "bundle-sealer-test")` + reused via `storageRootDir` (operational path literal; also cross-file candidate with evidence-store's `"evidence-test"` pattern).
- bundle-sealer.test.ts:29 — `"0123456789abcdef..."` (64-hex key) reused at :41; same-concept literal as evidence-store's `testKeyHex` and lifecycle's `"a1".repeat(32)` (different values, same operational slot — global-synthesis candidate).
- bundle-sealer.test.ts:32,37 — `"postgres:16-alpine"` image string; cross-file candidate (evidence-store.test.ts:37 identical; lifecycle uses `"pgvector/pgvector:pg16"` — near-duplicate image slot).
- bundle-sealer.test.ts:22 — `120_000` suite timeout; cross-file exact duplicate (evidence-store.test.ts:25 `120_000`).
- bundle-sealer.test.ts:61,100,110,127,141+ — `"INC-001"` (~8 occurrences); cross-file candidate (evidence-store many; cockpit :242, :510).
- bundle-sealer.test.ts:100,110,160 — `"public"` storage-root segment (~7 occurrences); cross-file candidate (evidence-store same `"public"` segment throughout).
- bundle-sealer.test.ts:104,114,164,175 — `"text/plain"` (~5 occurrences); cross-file candidate (evidence-store ~6; lifecycle :751, :761).
- bundle-sealer.test.ts:106,116,166 — `"security-analyst"` uploader (~4 occurrences).
- bundle-sealer.test.ts:159,169 — `"INC-NO-PIMS"` (2 occurrences).
- bundle-sealer.test.ts:230,236 — `"2026-10-30T08:00:00.000Z"` / `"2026-10-30T08:00:00"` date stems (also :67–68 `2026-10-30` stems; lifecycle uses `2026-10-01` stems — same hardcoded-date operational pattern).
- bundle-sealer.test.ts:205,209 — `"incident_code"` allowlist key (2 occurrences).
- cockpit.test.ts:37 — `240_000` suite timeout; cross-file exact duplicate (lifecycle-loop.test.ts:105 `240_000`).
- cockpit.test.ts:20 — `5000` (`timeoutMs = 5000`); cross-file candidate (live 5 in `page_size: 5` is a different slot — not the same literal use; lifecycle `RAG` numbers differ; single-use here otherwise — listed as candidate only for the timeout slot).
- cockpit.test.ts:48–51 — `"compliance auditor assistant"` / `"executive incident-response assistant"` / `"Data Protection Officer assistant"` persona substrings (each single-use within file; cross-file candidate — same persona strings drive lifecycle's `DRAFT_AUTHORITY_SYSTEM`-style mocks).
- cockpit.test.ts:121–127 — `"dpo@example.test"` (2 occurrences: :121 check, :124 create); cross-file exact duplicate (lifecycle :67, :84, :100, :455, :460).
- cockpit.test.ts:242,510 — `"INC-001"` (2 occurrences); cross-file candidate (see bundle above).
- cockpit.test.ts:225–238,493–506 — `"tool:mutation"` (3 occurrences), `"role:transition"` (2 occurrences at :240, :508) event-type literals.
- cockpit.test.ts:446–477 — `"lector-token"` (3 occurrences), `"Lector"` / `"view_incident"` role literals, `"COCKPIT_PERMISSION_DENIED"` (1 occurrence — single-use, candidate only).
- cockpit.test.ts:150–152,189,209+ — `"/api/session"`, `"/api/stream"`, `"/api/chat"`, `"/api/compliance"`, `"/api/login"` route literals (each 2–3 occurrences: `/api/stream` at :209, :480; `/api/chat` at :367, :413, :428, :466).
- cockpit.test.ts:155,450 — `"unsa"` schema (2 occurrences); cross-file candidate (lifecycle :155, :385; live :29 default).
- cockpit.test.ts:177 — `"Administrador"`; :178 `"executive"`; single-use each, listed as cross-file candidates only.
- evidence-store.test.ts:25 — `120_000` (cross-file duplicate with bundle-sealer :22).
- evidence-store.test.ts:29 — `"evidence-test"` root dir (same `path.resolve(process.cwd(), ...)` pattern as bundle-sealer :27 — same operational pattern, different value).
- evidence-store.test.ts:37 — `"postgres:16-alpine"` (exact cross-file duplicate with bundle-sealer :32).
- evidence-store.test.ts:101,137,180+ — `"INC-001"` (~10 occurrences); `"public"` (~12 occurrences); `"text/plain"` (~6 occurrences); `"evidence-collector"` (~7 occurrences).
- evidence-store.test.ts:334,338,353,360,634+ — `"INC-DRAFT-002"` (3 occurrences), `"INC-CORRUPT-DRAFT"` (3), `"INC-CORRUPT-SCAN"` (3), `"INC-LEASE-01"` (7), `"INC-LEASE-02"` (3), `"INC-LEASE-RACE"` (4), `"INC-RETENTION"` (3), `"INC-RAG-1"` (4), `"INC-REPLACE-1"` (4).
- evidence-store.test.ts:375,380,384,391,394,401,405,414,415 — `60` lease-TTL seconds (~9 occurrences); `120` at :384 (single-use).
- evidence-store.test.ts:449,461 — `72` / `"T72_AUTHORITY"` / `"timer-t72-art33-inc001"` timer literals (each 2–4 occurrences).
- evidence-store.test.ts:245,281,360,388,431,586,643 — raw SQL table literals `"evidence.staged_attachments"`, `"evidence.draft_packs"` (2 occurrences each), `"evidence.leases"`, `"evidence.rag_retrievals"`.
- evidence-store.test.ts:241,356 — `"{not-json"` corrupt-payload literal (2 occurrences).
- evidence-store.test.ts:543,567,575 — `"gdpr-full:0001"` / `"gdpr-full:gdpr-full:0001:2171-2175"` citation literals (2–3 occurrences each).
- lifecycle-loop.test.ts:105 — `240_000` (exact cross-file duplicate with cockpit :37).
- lifecycle-loop.test.ts:129 — `"pgvector/pgvector:pg16"` image (near-duplicate slot of `"postgres:16-alpine"` cross-file).
- lifecycle-loop.test.ts:133,138 — `"/docker-entrypoint-initdb.d/01-gestitel.sql"` / `"02-seed.sql"` mount targets; `"ro"` mode (2 occurrences).
- lifecycle-loop.test.ts:155,385 — `"unsa"` (2 occurrences + `config.PIMS_SCHEMA` uses); cross-file candidate (cockpit, live).
- lifecycle-loop.test.ts:156,387 — `"admin"` username (2 occurrences); cross-file candidate (cockpit :154 `"admin"` login).
- lifecycle-loop.test.ts:157,388,401 — `"a1".repeat(32)` key (3 occurrences: :164 `keyHex`, :400 `EVIDENCE_KEY`); same-slot candidate with the two 64-hex `testKeyHex` literals cross-file.
- lifecycle-loop.test.ts:158,389 — `15000` adapter timeout (2 occurrences: code :158, env string at loadConfig; distinct from `timeoutMs: 15000` slot — same value twice).
- lifecycle-loop.test.ts:170–177,390–399 — `"openai"` provider (5 occurrences), `"https://api.openai.com/v1"` endpoint (6 occurrences), `"OPENAI_API_KEY"` (6 occurrences), `"20000,0,fallback:none"` / `20000` + `0` + `fallback:none` model-spec components (5 occurrences each), `"gpt-4o-mini"` (2), `"text-embedding-3-small"` (2), `"lifecycle-loop-test-key"` (2: :185, :389).
- lifecycle-loop.test.ts:213,226–229,402–405 — RAG numerals `24`/`"24"`, `6`/`"6"`, `0.35`/`"0.35"`, `30000`/`"30000"` each appearing twice (once as `RAGService` config, once as `loadConfig` env strings) — same operational values in two representations.
- lifecycle-loop.test.ts:202–205 — `"corpus"` dirPath + `projectRoot` loader pattern (single-use; candidate for corpus-path constant).
- lifecycle-loop.test.ts:67,84,100,455,460 — `"dpo@example.test"` (5 occurrences); exact cross-file duplicate (cockpit :121).
- lifecycle-loop.test.ts:459,462,470,473 — `"test-op"` operator sub (4 occurrences).
- lifecycle-loop.test.ts:83,633,673,730 — `"admissions-portal"` (5 occurrences: fixture :83 + three `scenarioFixture` systems + :150 asset rename).
- lifecycle-loop.test.ts:58–86 — `"2026-10-01"`, `"10:00:00"`, `"DL"`, `"id_doc"`, `"email"`, `"encrypt_rest"` fixture literals (each 2–6 occurrences across FIXTURE/scenarioFixture/NON_PII_FIXTURE).
- lifecycle-loop.test.ts:854,879,899,926,949,971 — `"a".repeat(64)` content-sha (6 occurrences); `"We detected a breach and notified the supervisory authority."` (3 occurrences: :856, :881, :928); `"Reviewer ..."` titles single-use each.
- lifecycle-loop.test.ts:977 — `CLOSE_CHECKLIST_ITEMS` spread + :954 `"analysis_action"` (single-use candidates).
- live-pims-smoke.test.ts:60–67 — `"OT"`, `"O"`, `"L"`, `"C"`, `"P"`, `"Y"` PIMS enum literals: `"C"` action_type (:79) + status `"C"` (:119) + `affected_cid: ["C"]` (:74) (3 occurrences of `"C"` in distinct slots); `"L"` severity (:72) + impact `"L"` (:73) (2 occurrences).
- live-pims-smoke.test.ts:32 — `30000` adapter timeout; cross-file candidate (lifecycle `RAG_TIMEOUT_MS` 30000 — same numeric value, different slot; listed for synthesis, not counted as shared constant).

Cross-file literal candidates for global synthesis (value + file:line each):

- `"postgres:16-alpine"` — bundle-sealer.test.ts:32, evidence-store.test.ts:37 (exact duplicate; lifecycle-loop.test.ts:129 uses `"pgvector/pgvector:pg16"` in the same slot).
- `120_000` suite timeout — bundle-sealer.test.ts:22, evidence-store.test.ts:25.
- `240_000` suite timeout — cockpit.test.ts:37, lifecycle-loop.test.ts:105.
- `"dpo@example.test"` — cockpit.test.ts:121,124; lifecycle-loop.test.ts:67,84,100,455,460.
- `"admin"` PIMS user — cockpit.test.ts:154; lifecycle-loop.test.ts:156,387.
- `"unsa"` schema — cockpit.test.ts:178,450; lifecycle-loop.test.ts:155,385; live-pims-smoke.test.ts:29 (as `??` default).
- `"public"` storage segment — bundle-sealer.test.ts:100,110,160,193+; evidence-store.test.ts:130,177,194+.
- `"text/plain"` mime — bundle-sealer.test.ts:104,114,164; evidence-store.test.ts:135,181,198+; lifecycle-loop.test.ts:751,761.
- `"INC-001"` incident code — bundle-sealer.test.ts:61,100+; evidence-store.test.ts:132,142+; cockpit.test.ts:242,510.
- `PIMS_TEST_SEED_PASSWORD` import — cockpit.test.ts:4,155; lifecycle-loop.test.ts:37,157,387.
- `path.resolve(process.cwd(), <dir>)` storage-root pattern — bundle-sealer.test.ts:27 (`"bundle-sealer-test"`); evidence-store.test.ts:29 (`"evidence-test"`); lifecycle-loop.test.ts:123–127 (`"data/gestitel_base_de_datos.sql"`, `"data/02-init-unsa-seed.sql"`).
- `"a1".repeat(32)` / 64-hex `testKeyHex` — bundle-sealer.test.ts:28–29; evidence-store.test.ts:30–31; lifecycle-loop.test.ts:164,400 (same operational slot, differing values — flag for a shared test-key constant).
- `"evidence-collector"` / `"security-analyst"` uploader roles — bundle-sealer.test.ts:106,116; evidence-store.test.ts:136,183 (same slot, differing values).
- `"dpo@example.test"` recipient label `"DPO"` — cockpit.test.ts:125; lifecycle-loop.test.ts:461 (exact `"label": "DPO"` duplicate).

## R5

- bundle-sealer.test.ts: No violations found. (`path.resolve(process.cwd(), "bundle-sealer-test")` at :27 is project-root-relative; no `~/`, `/home/`, `/tmp`, `file:///`, `C:\`, or `../..` escapes.)
- cockpit.test.ts: No violations found. (No filesystem paths constructed at all.)
- evidence-store.test.ts: No violations found. (`path.resolve(process.cwd(), "evidence-test")` at :29 and `path.join(storageRootDir, ...)` throughout are project-root-relative; traversal strings at :67–87 are attack-payload arguments to `assertSafePath`, not file ops — test context.)
- lifecycle-loop.test.ts: No violations found. (`storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "pims-agent-loop-"))` at :161 uses the stdlib tempdir API, which the contract explicitly allows; `path.resolve(projectRoot, "data/...")` at :123–127 is project-root-relative; no hardcoded `/tmp/...` strings.)
- live-pims-smoke.test.ts: No violations found. (No filesystem paths.)

## R6

- bundle-sealer.test.ts:174 — `const preimage = { ...sealResult.manifest, seal_sha256: null }; const expected = crypto.createHash("sha256").update(canonicalizeJson(preimage), "utf8").digest("hex")` — hand-rolled reimplementation of the seal-digest algorithm inside the test; ecosystem alternative is to expose/reuse a shared `computeSealDigest`/seal-helper from `@pims/types` or `@pims/evidence` (alongside the already-imported `canonicalizeJson`) instead of duplicating the hash preimage construction (test-oracle context, still a duplicated algorithm).
- cockpit.test.ts:15 — `async function readSseUntil(reader, decoder, text, matcher, timeoutMs = 5000)` (:15–35) — hand-rolled SSE polling loop with a manual `Date.now()` deadline; ecosystem alternatives: `EventSource` client, `fetch-event-source`, or `AbortSignal.timeout()` for the deadline (test context).
- cockpit.test.ts:59 — `content.replace(/(:\s*)(\[[A-Z0-9_]+\])/g, '$1"$2"')` — hand-rolled regex JSON repair for unquoted `[PLACEHOLDER]` tokens; ecosystem alternative: a tolerant parser or a `zod` schema with a preprocess step shared with production chat parsing (test context).
- cockpit.test.ts:69 — `const citations = Array.isArray(context.citations) ? ... : []; const first = citations[0]; typeof first === "object" && ... typeof (first as JsonObject).citation_id === "string" ? ...` — hand-rolled structural validation of the citation payload; ecosystem alternative: a `zod` schema (`z.object({ citations: z.array(z.object({ citation_id: z.string() })) })`) or the shared chat-context type guard (test context).
- evidence-store.test.ts: No violations found. (`sha256Of` at :33–34 is a two-line thin wrapper over the stdlib `node:crypto` hash it directly uses — not a reimplemented algorithm; raw `store.sql.unsafe(...)` statements at :244, :281, :359, :387, :431, :586, :642 are deliberate fault-injection setup with no store-API equivalent, test context.)
- lifecycle-loop.test.ts:189 — `vi.spyOn(provider, "embed").mockImplementation(async ({ texts }) => ({ vectors: texts.map((text) => generateSpanAwareEmbedding(text)) }))` — custom span-geometry embedding math via `tests/helpers/span-geometry.ts` (`generateSpanAwareEmbedding`, `buildGdprTextAxes` at :207); ecosystem alternative for deterministic tests: fixed fixture vectors or a seeded PRNG stub instead of bespoke geometry math (test context).
- lifecycle-loop.test.ts:234 — 150-line `vi.spyOn(provider, "chat_json").mockImplementation` with a 9-branch `args.system.startsWith(...) || args.system.includes(...)` dispatch chain (:247–377) — hand-rolled prompt router; ecosystem alternative: a table-driven mock (`Map<RegExp, handler>` or a shared `mockChatRouter` fixture factory / `vi.mock` module mock) (test context).
- live-pims-smoke.test.ts: No violations found. (`crypto.randomUUID()` at :57 and `new Date().toISOString().slice(0, 10)` at :58 use stdlib APIs directly; no custom algorithm reimplemented.)

## Summary

| Rule | bundle-sealer | cockpit | evidence-store | lifecycle-loop | live-pims-smoke | Total |
|------|---------------|---------|----------------|----------------|-----------------|-------|
| R1 Branching/state | 4 | 15 | 6 | 7 | 5 | 37 |
| R2 Fallbacks | 0 | 6 | 0 | 8 | 4 | 18 |
| R3 Legacy support | 0 | 0 | 0 | 0 | 0 | 0 |
| R4 Repeated literals | 10 | 11 | 12 | 15 | 2 | 50 |
| R5 Path discipline | 0 | 0 | 0 | 0 | 0 | 0 |
| R6 Native/ecosystem | 1 | 3 | 0 | 2 | 0 | 6 |
| **Total** | **15** | **35** | **18** | **32** | **11** | **111** |

R4 counts are within-slice literal groups (plus 14 cross-file candidates for global synthesis); R3 and R5 are clean across all five files. The densest violation clusters are R1 missing-`else`/generic-`Error` guards in teardown and test helpers, R2 `??`/`||`/catch-fallback defaults in the cockpit chat stub and lifecycle mock router, and R4 operational literals (`"INC-001"`, `"public"`, `"text/plain"`, `"dpo@example.test"`, `"unsa"`, `"admin"`, container images, suite timeouts, lease TTL `60`, RAG numerals) hardcoded across 2+ files instead of shared test constants.
