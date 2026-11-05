# Slice 19 models-adapter-ragcore — Quality Audit

Date: 2026-11-05

Audited files (read-only; no source edits made):

| File | Lines |
|---|---|
| packages/models/src/index.ts | 1 |
| packages/models/src/openai-provider.ts | 602 |
| packages/pims-adapter/src/index.ts | 1275 |
| packages/rag/src/index.ts | 11 |
| packages/rag/src/types.ts | 1 |

Note: `packages/models/src/index.ts` (single re-export), `packages/rag/src/index.ts`
(11 re-export lines), and `packages/rag/src/types.ts` (single re-export) contain no
branching, defaults, paths, literals, or hand-rolled logic. All findings below come from
`openai-provider.ts` (prefix **M:**) and `pims-adapter/src/index.ts` (prefix **A:**).

## R1

- A:1072-1076 — `try { parsedBody = rawBody ? JSON.parse(rawBody) : {}; } catch { parsedBody = {}; }` — empty `catch` swallows the JSON parse error and silently substitutes `{}`; the branch manages no error state and the subsequent `bad_authorization_header` check then runs against fabricated data instead of raising a dedicated parse error.
- A:449-451 — `if (this.accessToken) { headers.Authorization = \`Bearer ${this.accessToken}\`; }` — missing `else`: when the token is still null (e.g. `obtainToken()` returned without setting one) the request silently proceeds without an `Authorization` header instead of failing fast with a named auth error.
- A:1241-1243 — `} catch { this.refreshTokenVal = null; }` — bare `catch` discards the refresh failure (no logging, no named error); control flow silently falls through to the credential-login path, hiding the original failure cause.

No other R1 violations found. Evaluated and cleared: `M:` loop `continue` filters
(73-94, 333-334, 337-340) are explicit per-item skip decisions inside numeric-hygiene
loops, not silent state branches; `M:mapError` (204-240) returns for every input class
with a named error; `A:restoreIncident` catch (383-389) handles `PimsNotFoundError`
explicitly and rethrows the rest; `A:uploadIncidentAttachment` (542-552)
array/single/failure outcomes are exhaustive; `A:` probe strategy if/else-if/else chains
(853-862, 906-915) terminate in a named error; `A:` 401 handler (1064-1102) covers
public vs. private, client-bug, retry, and fail-fast branches.

## R2

- M:178 — `this.requestLogprobs = options.requestLogprobs ?? true;` — `??` silent default hides absent config instead of requiring the caller to set it or throwing a named error.
- M:372-374 — `args.image_or_pdf_ref.startsWith("data:") ? args.image_or_pdf_ref : \`data:image/jpeg;base64,${args.image_or_pdf_ref}\`` — non-`data:` input is silently assumed to be JPEG base64 (wrong for PNG/PDF bytes) instead of failing fast with a named validation error.
- A:103 — `this.timeoutMs = config.timeoutMs ?? DEFAULT_PIMS_TIMEOUT_MS;` — `??` silent default for absent operational config.
- A:104 — `this.maxRetries = config.maxRetries ?? DEFAULT_PIMS_MAX_RETRIES;` — same `??`-default clause as above.
- A:105-106 — `config.idempotencyKeyPrefix ?? DEFAULT_IDEMPOTENCY_KEY_PREFIX` — same `??`-default clause.
- A:127-128 — `const user = username ?? this.username; const pass = password ?? this.password;` — parameter-to-instance credential fallback chain; speculative auth cascade (explicit args silently replaced by ambient instance state).
- A:154 — `const token = refreshTokenToUse ?? this.refreshTokenVal;` — same credential-fallback clause: explicit argument silently replaced by ambient instance state.
- A:276 — `incidentCode: overrides?.incidentCode ?? data.incident_code,` — `??` fallback hides which incident-code source was actually used.
- A:311 — `incidentCode: overrides?.incidentCode ?? data.incident_code,` — same clause, second call site.
- A:345 — `evidence: action.evidence ?? null,` — `??` default converts absent evidence to `null` instead of preserving absent state or failing fast.
- A:365 — `...(base.actions ?? []),` — `?? []` hides a missing actions array instead of failing fast on unexpected shape.
- A:412-413 — `overrides?.idempotencyKey ?? \`${prefix}:${overrides?.incidentCode ?? "global"}:...\`` — nested `??` chain with hardcoded `"global"` default hiding absent incident scope.
- A:427 — `(...) ?? fileUrl,` — `??` fallback after URL pathname parsing hides parse failure.
- A:429 — `incident_code: overrides?.incidentCode ?? null,` — `?? null` default hides absent incident code.
- A:850 — `const actions = retrieved.actions ?? [];` — `?? []` hides missing actions array.
- A:903 — `const findings = current?.findings ?? [];` — `?? []` hides missing findings array.
- A:965 — `const attempt = options.attempt ?? 1;` — `??` silent default for retry-attempt state.
- A:968 — `const endpointPath = endpoint.split("?")[0] ?? endpoint;` — `??` fallback hides failed query-strip.
- A:972 — `let recordIdempotencyKey: string | null = options.idempotencyKey ?? null;` — `?? null` default.
- A:983 — `incident_code: options.incidentCode ?? null,` — `?? null` default hides absent incident code.
- A:1018-1021 — `const code = options.incidentCode ?? "global"; idempotencyKey = idempotencyKey ?? \`${prefix}:${code}:...\`;` — chained `??` with hardcoded `"global"` default.
- A:1024 — `recordIdempotencyKey = idempotencyKey ?? null;` — `?? null` default.
- A:1048-1050 — `DEFAULT_RETRY_BACKOFF_MS[attempt - 1] ?? DEFAULT_RETRY_BACKOFF_MS[DEFAULT_RETRY_BACKOFF_MS.length - 1]` — `??` hides out-of-range backoff index instead of failing fast on unexpected attempt count.
- A:1106-1108 — same `??`-masked backoff index expression, 429-retry path (second copy).
- A:1124-1126 — same `??`-masked backoff index expression, 5xx-retry path (third copy).
- A:1175 — `messages[0] ?? \`Validation failed for ${firstField}\`` — `??` default message hides absent server message.
- A:1204-1205 — `const model = match?.[1] ?? "resource"; const id = match?.[2] ?? "unknown";` — `??` defaults fabricate model/id for 404 errors when the endpoint regex does not match, hiding the unparseable endpoint instead of raising a named error.
- A:466 — `await response.text().catch(() => "")` — `.catch(() => "")` swallows body-read failure and substitutes an empty string.
- A:1070 — `await response.text().catch(() => "")` — same swallowed body-read fallback, 401 path.
- A:1121 — `await response.text().catch(() => "")` — same swallowed body-read fallback, 5xx path.
- A:1046-1058 — `} catch (_err) { if (attempt <= this.maxRetries) { ...backoff...; return this.request(...attempt+1); } throw new PimsUnavailableError(...); }` — speculative network-retry cascade: any fetch throw (including aborts and bugs) is retried with backoff instead of failing fast with a named error.
- A:1088-1098 — `if (attempt === 1) { const refreshed = await this.reAuthenticate(); if (refreshed) { ...; return this.request(...attempt+1); } }` — speculative auth/retry cascade: 401 triggers silent re-authentication and an implicit request retry.
- A:1104-1116 — `if (response.status === 429) { if (attempt <= 3) { ...backoff...; return this.request(...); } ... }` — speculative retry cascade on rate limiting with its own hardcoded attempt budget.
- A:1120-1134 — `if (response.status >= 500) { ...; if (attempt <= this.maxRetries) { ...; return this.request(...); } ... }` — speculative retry cascade on server errors.
- A:1236-1254 — `reAuthenticate(): if (this.refreshTokenVal) { try { await this.refreshToken(); return true; } catch { this.refreshTokenVal = null; } } if (this.username && this.password) { await this.login(...); return true; } throw ...` — speculative auth cascade: refresh-token path silently falls back to credential-login path on any refresh error.

Cleared (not violations): `M:319-322` boolean `||` builds a predicate, not a default;
`M:215/221-226` `||`/range checks classify error status, then raise named errors;
`A:220-225,637` independent optional query-param `if`s are additive builders, not fallback
chains; `M:238`/`A:385` `String(...)` coercions feed named-error constructors (fail-fast
preserved); `M:309-317,410-418,450-452,534-536,598-600` catch blocks rethrow or map to a
named error via `mapError` without retry or defaulting.

## R3

No violations found. No backwards-compat shims, polyfills, legacy wrappers,
deprecated-API branches, runtime version sniffing, or `for backwards compat` paths exist
in any of the 5 files. `Buffer`/`Blob`/`FormData`/`AbortController`/`crypto.randomUUID`
usage is current platform API use, not legacy support. The `"replace" | "merge"` probe
methods (`A:817-950`) detect live server semantics; they are not legacy-version support.

## R4

Within-slice repeats (same literal in 2+ places inside these files — must be centralized):

- A:227,273,290,308,328,377,481,500,532,561 — `` `/api/incidents/...` `` path prefixes (10 sites; the `` `/api/incidents/${id}/` `` template alone repeats at 290,308,328,377).
- A:638,657,678 — `"/api/audits/..."` path prefixes (3 sites).
- A:582,604,626 — `"/api/incident-recipients/..."` path prefixes (3 sites).
- A:695,713 — `"/api/risk-evaluations/..."` (2 sites).
- A:1048-1050,1106-1108,1124-1126 — `DEFAULT_RETRY_BACKOFF_MS[attempt - 1] ?? DEFAULT_RETRY_BACKOFF_MS[DEFAULT_RETRY_BACKOFF_MS.length - 1]` backoff expression (3 identical copies).
- A:466,1070,1121 — `response.text().catch(() => "")` (3 copies).
- A:450,1013 (+M:495) — `` `Bearer ${...}` `` auth-scheme literal (2 sites in adapter, 1 in models).
- A:997,1030 (+M:494) — `"application/json"` (2 sites in adapter, 1 in models).
- A:413,1018 — `"global"` incident-scope default (2 sites).
- A:821,829,831,840,843,927,929 — `"2026-01-01"` probe date (7 sites).
- A:828,839 — `"Probe Runner"` (2 sites).
- A:819,926 — `"STARTUP_..._THROWAWAY"` probe titles: `"STARTUP_NESTED_PROBE_THROWAWAY"` (819), `"STARTUP_NULL_CLEAR_PROBE_THROWAWAY"` (926).
- A:447,1022 — `"Idempotency-Key"` header name (2 sites).
- A:446,1007 — `"X-PIMS-Schema"` header name (2 sites).
- A:1052,1128 — `"PIMS_UNAVAILABLE"` error-code string (2 sites).
- A:864,917 — `"NESTED_PROBE:..."` log prefixes: `NESTED_PROBE:${strategy}` (864), `NESTED_PROBE:audit:${strategy}` (917).
- A:245,255 — `"PIMS_FILTER_IGNORED:severity"` / `"PIMS_FILTER_IGNORED:incident_type"` (shared prefix, 2 sites).
- M:284,394,561 — `response_format: { type: "json_object" }` (3 identical copies).
- M:248,366 — `` `max_tokens ${...} exceeds limit ${MAX_CHAT_MAX_TOKENS}` `` message shape (2 sites).
- M:183,186,482 (+A:101) — trailing-slash strip regex `/\/+$/` (3 sites in models, 1 in adapter).

Cross-file literal candidates for global synthesis (value + file:line; counterpart may live
outside this slice):

- `/\/+$/` — M:183, M:186, M:482, A:101.
- `"Bearer "` — M:495, A:450, A:1013.
- `"application/json"` — M:494, A:997, A:1030.
- `"Content-Type"` — M:493, A:1030.
- `401` auth-failure status — M:215, A:1064, A:1091.
- `429` throttle status — M:225 (as `!== 429` exclusion), A:1104, A:1110.
- `>= 500` server-error threshold — M:221-226 range logic, A:458, A:1120.
- `"global"` — A:413, A:1018.
- `"Idempotency-Key"` — A:447, A:1022.
- `"X-PIMS-Schema"` — A:446, A:1007.
- `"resource"` / `"unknown"` 404 fallbacks — A:1204, A:1205.
- `"replace"` / `"merge"` strategy literals — A:97, A:98, A:348, A:853-856, A:906-909.
- `"2026-01-01"` — A:821, A:829, A:831, A:840, A:843, A:927, A:929.
- `crypto.randomUUID()` idempotency-id idiom — A:413, A:1021.
- `response_format: { type: "json_object" }` — M:284, M:394, M:561.
- `3` hardcoded 429 attempt budget — A:1105 (contrasts with shared `DEFAULT_PIMS_MAX_RETRIES` used at A:1047, A:1123).
- Single-use local literals (correctly NOT reported): `TOP_LOGPROBS = 5` (M:54), `"data:image/jpeg;base64,"` (M:374), `/v2/rerank` (M:482), per-endpoint `operation:` names, per-call zod error messages, `204` (A:1140), `409` (A:1209), `"No hay destinatarios"` (A:1165), `"bad_authorization_header"` (A:1079-1080), gate codes `LICENSE_EXPIRED`/`SERVICE_SUSPENDED`/`DOCUMENT_LIMIT_REACHED` (A:1190-1192).

## R5

No violations found. No machine-dependent paths (`~/`, `/home/`, `/tmp`, `file:///`,
`C:\`), no workspace-escaping traversal, and no hardcoded absolute filesystem paths in any
of the 5 files. All `"/api/..."` and `"/business/..."` strings are server-relative API
routes joined onto the configured `baseUrl`; `new URL(fileUrl).pathname` (A:426) parses
a remote attachment URL, not a local file path; no local file I/O occurs in this slice.

## R6

- A:1036-1045 — hand-rolled `AbortController` + `setTimeout(() => controller.abort(), this.timeoutMs)` + manual `clearTimeout` — native alternative: `AbortSignal.timeout(this.timeoutMs)` (already the established pattern in this repo at M:498).
- A:1001-1005 — hand-rolled `Cookie` header via `Object.entries(...).map(...encodeURIComponent...).join("; ")` — ecosystem alternative: a cookie-serialization helper (e.g. the `cookie` package `serialize`) or a fetch cookie-jar; hand-rolled joining risks incorrect delimiter/encoding edge cases.
- A:1046-1062,1104-1118,1123-1134 — hand-rolled retry/backoff (manual attempt counters, `setTimeout` sleeps, recursive `this.request` calls) in three copies — ecosystem alternative: an established retry helper (e.g. `p-retry` with `AbortError` semantics); the OpenAI SDK path in this same slice already delegates retries to the client (`maxRetries`, M:194-202) instead of hand-rolling them.
- A:968 (`endpoint.split("?")[0] ?? endpoint`), A:425-427 (`fileUrl.split("?")[0]`) — hand-rolled query-string stripping — native alternative: `new URL(...).pathname` URL parsing (already used at A:426 for the absolute-URL branch).
- A:781-784 — hand-built query string `` `/api/dashboard/?tab=${encodeURIComponent(tab)}` `` — native alternative: `URLSearchParams` (already the established pattern in this file at A:219, A:636).
- A:1203 — hand-rolled endpoint parsing `endpoint.match(/\/api\/([^/]+)\/(?:(\d+)\/)?/)` to fabricate 404 model/id labels — no stdlib alternative needed; the violation is hand-rolled routing knowledge duplicating the call-site's known resource type — alternative: pass the resource name from the caller instead of reverse-parsing the URL.
- M:490-499 — hand-rolled Cohere `fetch` (manual headers, `JSON.stringify` body, manual `res.ok`/`res.json` handling) while the OpenAI path uses the typed `openai` SDK client — ecosystem alternative: the official `cohere-ai` SDK client, matching the file's own precedent of using a typed SDK per provider.

Cleared (not violations): `M:computeTopLogprobEntropy` (66-109) uses only `Math.log2`/`Math.exp`/`Number.isFinite` — native math with no stdlib entropy equivalent; `M:256-268` role mapping and `M:585-596` passage reattachment are SDK-shape adaptations, not replaceable algorithms; `A:collectPayloadKeys`/`A:errorCodeOf` (1257-1275) are trivial wrappers over `Object.keys`/`FormData.keys`/`instanceof` with no dependency to replace; `A:219-227,636-638` query building already uses native `URLSearchParams`; all zod `safeParse` validation already uses the ecosystem (zod) solution.

## Summary

| Rule | Violations |
|---|---|
| R1 Exhaustive Branching & Explicit State Handling | 3 |
| R2 Zero Fallbacks & Deterministic Control Flow | 36 |
| R3 No Unrequested Legacy Support | 0 |
| R4 Repeated Cross-File Literals (within-slice repeats / cross-file candidates) | 19 / 16 |
| R5 Strict Path Discipline | 0 |
| R6 Native & Ecosystem Solutions | 7 |
| **Total** | **65 + R4 candidate list** |

Highest-density areas: `A:request()` transport core (993-1223) accounts for most R2
findings (retry/auth cascades, `??` backoff-index masking, `.catch(() => "")` body reads);
`A:` constructor/config defaults (103-106) and credential/token `??` chains (127-154);
`A:` probe/log literals and `/api/...` route prefixes for R4 centralization.
