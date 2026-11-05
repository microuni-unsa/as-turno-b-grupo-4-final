# Slice 08 cockpit-backend-chat — Quality Audit

Audited files (line counts), date 2026-11-05:
- `packages/cockpit/src/chat.ts` — 571 lines
- `packages/cockpit/src/chat-tools.ts` — 580 lines
- `packages/cockpit/src/guided-create.ts` — 1075 lines
- `packages/cockpit/src/index.ts` — 5 lines

## R1

- `packages/cockpit/src/chat-tools.ts:369` — `if (row !== null) { draftPacks.push({...}) }` (no `else`) — null `authority`/`subject` pack silently omitted from `draftPacks`; downstream `approved.length === 0` conflates "no packs exist" with "packs pending", state left implicit.
- `packages/cockpit/src/chat-tools.ts:442-446` — `for (const item of checks) { if (item !== null) { decisions.push(...item); } }` (no `else`) — `null` per-incident results (no signal) silently discarded with no counter/state distinguishing "checked, nothing pending" from "skipped".
- `packages/cockpit/src/guided-create.ts:674-681` — `for (const [k, v] of Object.entries(extracted)) { if (typeof v === "string") { ... restore ... } }` (no `else`) — non-string extracted fields silently skipped with no validation/error, leaving unexpected types to flow into `draftObj` casts below.

## R2

- `packages/cockpit/src/chat.ts:95-97` — `if (value === undefined) { return []; }` — silent empty-array default hiding absent model field instead of fail-fast with a named error.
- `packages/cockpit/src/chat.ts:117-119` — `if (value === undefined) { return []; }` — same silent `[]` default for absent `citations_used`-family field.
- `packages/cockpit/src/chat.ts:181` — `errorMessage = err instanceof Error ? err.message : String(err);` — `String(err)` fallback stringification hiding non-Error throw shape.
- `packages/cockpit/src/chat.ts:199` — `const existing = toolStats.get(name) || { calls: 0, errors: 0, ... };` — `|| default` hiding absent stats entry.
- `packages/cockpit/src/chat.ts:233` — `const existing = toolStats.get(name) || { calls: 0, ... };` — same `|| default` on success path.
- `packages/cockpit/src/chat.ts:295` — `const code = request.incident_code ?? extractIncidentCode(request.message);` — `??` fallback chain (explicit code else regex-guessed code) instead of fail-fast on absent code.
- `packages/cockpit/src/chat.ts:299-302` — `let ragCitations = { passages: [], citations: [] };` — silent empty default later overwritten only inside `if (code !== null)`.
- `packages/cockpit/src/chat.ts:385` — `missing_count: res?.missing_mandatory_fields?.length ?? 0,` — `?.` + `?? 0` default hiding absent mutation detail.
- `packages/cockpit/src/chat.ts:405-407` — `contextData.form_mutation = JSON.parse(JSON.stringify(formMutation))` — untyped round-trip clone silently dropping `undefined`/non-JSON values instead of schema-validated copy.
- `packages/cockpit/src/chat.ts:443-452` — `let citation = citationById.get(citationId); if (citation === undefined) { const lower = ...; for (...) { if (key.toLowerCase() === lower) ... } }` — speculative case-insensitive fallback lookup instead of fail-fast on exact-ID miss (real miss only throws at line 453).
- `packages/cockpit/src/chat.ts:465-468` — `const piiHits = extractPii(reply); const iocHits = extractIocs(reply).filter((v) => !/^[0-9a-fA-F]{32,64}$/.test(value));` — silent regex-exclusion filter dropping hex-looking IOCs without surfacing.
- `packages/cockpit/src/chat.ts:481-502` — `if (typeof response.content.reasoning === "string" && ...trim().length > 0) { reasoning = ... } else { const steps = []; steps.push(...); reasoning = steps.join(" "); }` — synthesized fallback `reasoning` narrative instead of fail-fast when model omits reasoning.
- `packages/cockpit/src/chat.ts:519` — `Math.max(0, wallTimeMs - toolTimeMs - modelTimeMs)` — clamping fallback hiding negative/inconsistent timing state.
- `packages/cockpit/src/chat.ts:521-526` — `const tokensEstimate = Math.round((serializedContext.length + reply.length) / 4); const costEstimateUsd = ... (tokensEstimate / 1000) * 0.00015 ...` — magic divisors/rate defaults fabricating cost figures.
- `packages/cockpit/src/chat-tools.ts:37-38` — `severity: incident.severity ?? null, impact: incident.impact ?? null,` — `?? null` hiding absent severity/impact.
- `packages/cockpit/src/chat-tools.ts:41-42` — `detection_date: incident.detection_date ?? null, ...` — `?? null` hiding absent dates.
- `packages/cockpit/src/chat-tools.ts:67-69` — `const actionsCount = incident.actions?.length ?? incident.actions_count; const attachmentsCount = incident.attachments?.length ?? ...;` — `?.length ?? field` fallback chain preferring embedded arrays else count columns.
- `packages/cockpit/src/chat-tools.ts:127-133` — `} catch (err) { if (page > 1) { break; } throw err; }` — swallowing pagination errors on `page > 1` (treats any fetch failure as exhausted pagination) instead of fail-fast with a named error.
- `packages/cockpit/src/chat-tools.ts:142` — `if (res.next === null || res.results.length === 0 || addedCount === 0) { break; }` — chained `||` termination heuristics conflating end-of-pages, empty page, and all-duplicates.
- `packages/cockpit/src/chat-tools.ts:232-234` — `if (raw === null) { return null; }` — silent `null` default for absent watcher state.
- `packages/cockpit/src/chat-tools.ts:303-307` — `const unmetBreach = breached.filter((timer) => timer.timer_type === "T72_AUTHORITY" ? !authoritySent : !subjectTerminal);` — ternary fallback mapping any non-`T72_AUTHORITY` breached timer to subject-terminal check.
- `packages/cockpit/src/chat-tools.ts:323` — `return out.length > 0 ? out : null;` — `null` default hiding "checked, nothing pending".
- `packages/cockpit/src/chat-tools.ts:336` — `state.last_error_code ?? state.blocked_reason ?? "UNKNOWN"` — `??` cascade ending in hardcoded `"UNKNOWN"` sentinel instead of fail-fast.
- `packages/cockpit/src/chat-tools.ts:372-379` — `pack_id: typeof row.payload === "object" && ... ? String(...pack_id) : null,` — nested type-check chain defaulting to `null` on unexpected payload shape.
- `packages/cockpit/src/chat-tools.ts:382-387` — `proposal: typeof row.payload === "object" && ... ? (row.payload as JsonObject) : null,` — same silent-`null` shape fallback.
- `packages/cockpit/src/chat-tools.ts:393` — `draftPacks.find((p) => p.proposal !== null)?.proposal ?? null;` — `?? null` hiding "no active proposal".
- `packages/cockpit/src/chat-tools.ts:411` — `return out.length > 0 ? out : null;` — same silent-`null` default on non-awaiting-approval path.
- `packages/cockpit/src/chat-tools.ts:534` — `{ narrative: message, partial: formContext ?? {} },` — `?? {}` hiding absent form context.
- `packages/cockpit/src/chat-tools.ts:536` — `username ?? "operador",` — hardcoded `"operador"` default hiding absent username.
- `packages/cockpit/src/chat-tools.ts:541-547` — `const prev = (formContext as Record<string, unknown>)[key]; if (JSON.stringify(value) !== JSON.stringify(prev))` — stringify-compare fallback for deep equality (key order / `undefined` blind spots) instead of explicit equality or schema diff.
- `packages/cockpit/src/chat-tools.ts:553-558` — `const isUpdate = formContext !== undefined && ... && Object.keys(formContext).length > 2 && asksToChangeFields; const action = isUpdate ? "update" : "draft";` — heuristic `> 2` keys + keyword cascade defaulting to `"draft"`.
- `packages/cockpit/src/chat-tools.ts:568-571` — `const summary = action === "update" ? "Se actualizaron campos del formulario" : "Borrador de incidente generado...";` — hardcoded summary strings keyed off heuristic action.
- `packages/cockpit/src/guided-create.ts:68-70` — `if (!cleaned) { return { firstName: "", lastNameP: "", lastNameM: null }; }` — empty-string/`null` defaults hiding absent name instead of named error.
- `packages/cockpit/src/guided-create.ts:80` — `return { firstName: words[0] ?? "", lastNameP: "", lastNameM: null };` — `?? ""` hiding missing token.
- `packages/cockpit/src/guided-create.ts:84-86` — `firstName: words[0] ?? "", lastNameP: words[1] ?? "",` — same `?? ""` defaults.
- `packages/cockpit/src/guided-create.ts:128-131` — `firstName: words.slice(0, pIdx).join(" "), ... lastNameM: words.slice(mIdx).join(" ") || null,` — `|| null` hiding empty maternal surname on 5+-word path.
- `packages/cockpit/src/guided-create.ts:154-165` — `if (!text) { return { redactedText: text, spans: [], ... originalUrls: [] }; }` — empty-shape default hiding absent input text.
- `packages/cockpit/src/guided-create.ts:168-179` — `if (spans.length === 0) { return { redactedText: text, spans: [], ... }; }` — same empty-shape default for zero-span analysis.
- `packages/cockpit/src/guided-create.ts:283-291` — `} else { token = \`[DESCRIPCION_${descCount++}]\`; ... }` — catch-all `else` mapping every unlisted `entity_type` to a generic description token instead of fail-fast on unknown entity type.
- `packages/cockpit/src/guided-create.ts:617` — `const narrative = request.narrative?.trim() ?? "";` — `?? ""` hiding absent narrative.
- `packages/cockpit/src/guided-create.ts:618` — `const partialStr = JSON.stringify(request.partial ?? {});` — `?? {}` hiding absent partial.
- `packages/cockpit/src/guided-create.ts:628-630` — `const combined = narrative ? \`${narrative}\n\n[VALORES PARCIALES...]\` : \`[VALORES PARCIALES...]\`;` — ternary fallback synthesizing a partials-only prompt when narrative is empty.
- `packages/cockpit/src/guided-create.ts:643` — `const now = deps.now ? deps.now() : new Date();` — system-clock fallback hiding absent injected clock.
- `packages/cockpit/src/guided-create.ts:659` — `const extracted = (chatResponse.content ?? {}) as JsonObject;` — `?? {}` hiding absent model content plus unchecked cast.
- `packages/cockpit/src/guided-create.ts:663-665` — `if (typeof raw !== "string" || raw.trim() === "") { return null; }` — `null` default hiding non-string/empty extracted values.
- `packages/cockpit/src/guided-create.ts:677-680` — `const restored = restoreTokenString(v); if (restored !== null) { extracted[k] = restored; }` (no `else`) — unrestorable strings silently keep raw placeholder text.
- `packages/cockpit/src/guided-create.ts:688-691` — `if (!extracted.rep_position || typeof extracted.rep_position !== "string") { extracted.rep_position = extracted.rep_last_name_p; } extracted.rep_last_name_p = null;` — silent field move defaulting position from a misclassified surname.
- `packages/cockpit/src/guided-create.ts:702-720` — `if (!extracted.rep_first_name || isPlaceholder(...)) { extracted.rep_first_name = parsed.firstName; } ...` (x3) — `||` fallback chains overwriting missing/placeholder model names with regex-parsed `originalPersons[0]`.
- `packages/cockpit/src/guided-create.ts:727-734` — `if (dpoPerson && (!extracted.dpo_contact_name || (...includes("[REPORTANTE")))) { extracted.dpo_contact_name = dpoPerson.original; }` — positional fallback assigning `originalPersons[1]` as DPO name.
- `packages/cockpit/src/guided-create.ts:746-795` — `if ((!extracted.rep_email || isGenericToken(...)) && originalEmails.length > 0)` (+ phone/ID/URL siblings) — fallback chains substituting first/second original PII items when the model leaves generic tokens; `originalUrls.find((u) => u.original.startsWith("http"))` silently drops non-`http` originals.
- `packages/cockpit/src/guided-create.ts:802-808` — `const incidentType = (INCIDENT_TYPES as readonly string[]).includes(rawIncidentType) ? rawIncidentType : "OT";` — hardcoded `"OT"` default hiding invalid incident type instead of fail-fast.
- `packages/cockpit/src/guided-create.ts:810-814` — `const rawAffectedCid = Array.isArray(partial.affected_cid) ? ... : Array.isArray(extracted.affected_cid) ? ... : [];` — nested-ternary fallback chain ending in `[]`.
- `packages/cockpit/src/guided-create.ts:815-817` — `const affectedCid = rawAffectedCid.filter((c) => (AFFECTED_CID ...).includes(String(c)));` — silent `.filter` dropping non-catalog codes.
- `packages/cockpit/src/guided-create.ts:819-826` — `rawDataTypes` nested ternary + `.filter(...)` — same fallback chain + silent drop of non-catalog data types.
- `packages/cockpit/src/guided-create.ts:828-835` — `rawMeasures` nested ternary + `.filter(...)` — same fallback chain + silent drop of non-catalog measures.
- `packages/cockpit/src/guided-create.ts:837-845` — `const incidentDate = typeof rawIncidentDate === "string" && ... ? rawIncidentDate.slice(0, 10) : typeof extracted.detection_date === "string" && ... ? ...slice(0, 10) : today;` — three-deep date fallback cascade (partial date else detection date else today) hiding absent/invalid incident date.
- `packages/cockpit/src/guided-create.ts:847-981` — `partial.<field> ?? (extracted.<field> as string) ?? <hardcoded>` chains across `draftObj`: `title ?? ... ?? "Incidente reportado"` (849), `description ?? ... ?? null` (850-851), `incident_time ?? ... ?? null` (853-854), `detection_date ?? ... ?? today` (855-856), `involves_personal_data ?? ... false` (860-864), `num_affected_subjects ?? ... null` (866-870), `entity_type ?? ... ?? "U"` (901-902), `entity_name ?? ... ?? "Universidad Nacional de San Agustín"` (904-907), `entity_department/province/district ?? ... ?? "Arequipa"` (914-925), `reported_by: partial.reported_by ?? username` (926), `status ?? ... ?? "O"` (929-932), `severity/impact ?? ... ?? null` (933-944), measures `?? ... ?? null` (947-961), `actions: Array.isArray(partial.actions) ? ... : Array.isArray(extracted.actions) ? ... : []` (964-968) — each a `??`/ternary fallback chain with silent defaults instead of fail-fast on missing mandatory data.
- `packages/cockpit/src/guided-create.ts:1039-1046` — `if (ragResult.citations.length === 0) { return { ..., explanation: "RAG_NO_EVIDENCE", citations: [] }; }` — hardcoded `"RAG_NO_EVIDENCE"` sentinel + `[]` instead of a named error.
- `packages/cockpit/src/guided-create.ts:1062-1067` — `const reply = typeof response.content.reply === "string" ? ... : typeof response.content.explanation === "string" ? ... : "Definición normativa aplicable...";` — nested-ternary fallback ending in a hardcoded generic explanation.

## R3

No violations found.

## R4

Within-slice repeats (same literal 2+ times inside the audited slice):
- `"O"` / `"P"` status codes — `chat-tools.ts:90`, `chat-tools.ts:93`, `chat-tools.ts:261`, `chat-tools.ts:266`, `chat-tools.ts:269`; also `"C"` joins the set at `chat-tools.ts:429-432` and `guided-create.ts:929-932` (`"O" | "P" | "C"`). Must live in a shared status-code constant.
- `"authority"` / `"subject"` pack-type strings — `chat-tools.ts:286` (`getDraftPack(..., "authority")`), `chat-tools.ts:287` (`"subject"`), `chat-tools.ts:366-367` (`["authority", authRow]`, `["subject", subjRow]`). Must live in a shared pack-type constant.
- `4096` (`max_tokens`) — `chat.ts:415`, `chat.ts:421`, `guided-create.ts:655`. Must live in a shared token-budget constant/config.
- `"Arequipa"` — `guided-create.ts:917`, `guided-create.ts:921`, `guided-create.ts:925` (entity department/province/district defaults). Must live in a shared default-locale constant/config.
- `"span-"` span-id prefix — `chat.ts:185` (`` `span-${spans.length + 1}-${name}` ``), `chat.ts:219` (same template). Must live in a shared tracing constant/helper.
- Token placeholder prefixes `[REPORTANTE_`, `[CONTACTO_EMAIL_`, `[CONTACTO_TEL_`, `[ID_`, `[SISTEMA_`, `[DESCRIPCION_` — `guided-create.ts:229`, `guided-create.ts:238`, `guided-create.ts:247`, `guided-create.ts:262`, `guided-create.ts:275`, `guided-create.ts:284`, re-tested as `"[REPORTANTE"` substrings at `guided-create.ts:700`, `guided-create.ts:731`. Must live in shared redaction-token constants.
- `"[CONTACTO]"` / `"[ID]"` / `"[REPORTANTE]"` / `"[SISTEMA]"` / `"[DESCRIPCION]"` generic-token sentinels — `guided-create.ts:740-744` (five literals in one `||` chain). Must live in a shared constant set.
- `MODEL_ROUTE_FAST` — `guided-create.ts:646`, `guided-create.ts:1055` (same-file repeat noted for synthesis; single-use-per-call-site but shared route constant already imported — OK as imported constant, listed for completeness).
- `0.00015` cost-rate / `/ 4` chars-per-token divisor / `1024` explain `max_tokens` / `5000` cache TTL / `100` page size / `50` max pages are single-use local literals — OK, not reported as violations.

Cross-file literal candidates for global synthesis (value + file:line each; other file may be outside this slice):
- `4096` — `packages/cockpit/src/chat.ts:415`, `packages/cockpit/src/chat.ts:421`, `packages/cockpit/src/guided-create.ts:655`.
- `"O"` — `packages/cockpit/src/chat-tools.ts:90`, `packages/cockpit/src/chat-tools.ts:261`, `packages/cockpit/src/chat-tools.ts:266`, `packages/cockpit/src/guided-create.ts:929`.
- `"P"` — `packages/cockpit/src/chat-tools.ts:90`, `packages/cockpit/src/chat-tools.ts:261`, `packages/cockpit/src/chat-tools.ts:266`, `packages/cockpit/src/guided-create.ts:930`.
- `"C"` (status/excerpt) — `packages/cockpit/src/chat-tools.ts:431`, `packages/cockpit/src/guided-create.ts:931`.
- `"operador"` — `packages/cockpit/src/chat-tools.ts:536` (single occurrence in slice; candidate if repeated outside slice).
- `"Universidad Nacional de San Agustín"` — `packages/cockpit/src/guided-create.ts:907` (single occurrence in slice; candidate if repeated outside slice).
- `"Arequipa"` — `packages/cockpit/src/guided-create.ts:917`, `packages/cockpit/src/guided-create.ts:921`, `packages/cockpit/src/guided-create.ts:925`.
- `0.0` temperature (explain call) — `packages/cockpit/src/guided-create.ts:1059` (candidate against other `temperature:` literals outside slice).

## R5

No violations found.

## R6

- `packages/cockpit/src/chat.ts:405` — `JSON.parse(JSON.stringify(formMutation))` hand-rolled deep clone — native alternative: `structuredClone(formMutation)`.
- `packages/cockpit/src/chat.ts:443-452` — hand-rolled case-insensitive scan over every `citationById` entry per miss (`for (const [key, val] of citationById.entries()) { if (key.toLowerCase() === lower) ... }`) — native alternative: normalize keys once at insert (e.g. store `key.toLowerCase()` variants in the `Map`) or a single canonical-key `Map` instead of O(n) per-lookup loop.
- `packages/cockpit/src/chat.ts:459` — hand-rolled dedup scan `!resolved.some((r) => r.chunk_sha256 === citation.chunk_sha256)` — native alternative: a `Set<string>` of seen `chunk_sha256` values.
- `packages/cockpit/src/chat.ts:540` — `` `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` `` hand-rolled trace id — native alternative: `crypto.randomUUID()`.
- `packages/cockpit/src/chat-tools.ts:101-150` — hand-rolled module-level TTL cache (`let incidentCache ... INCIDENT_CACHE_TTL_MS`, manual `at` comparison, manual `[...sorted]` copies) wrapping a hand-rolled `while (page <= MAX_PAGES)` pagination loop — ecosystem alternative: shared cache/memoize helper with TTL plus a shared paginated-list helper instead of bespoke globals.
- `packages/cockpit/src/chat-tools.ts:543` — `JSON.stringify(value) !== JSON.stringify(prev)` hand-rolled deep-equal — native alternative: `node:util` `isDeepStrictEqual(value, prev)`.
- `packages/cockpit/src/chat-tools.ts:503-513` — hand-rolled keyword scanners (`for (const kw of FORM_CREATE_KEYWORDS) { if (lower.includes(kw)) ... }` twice) — ecosystem alternative: a single combined `RegExp` with alternation or `Intl`-aware tokenizer once, instead of O(keywords × messages) `includes` loops in both `detectFormIntent` and `analyzeFormMutation` (`chat-tools.ts:550`).
- `packages/cockpit/src/guided-create.ts:181-203` — hand-rolled overlap resolution (`[...spans].sort(...)` multi-key comparator + `selected.some((existing) => Math.max(...) < Math.min(...))` pairwise scan; comment admits "matching PresidioClient logic") — native/ecosystem alternative: reuse the `PresidioClient` overlap-resolution routine (or a shared interval/sweep helper) instead of duplicating it.
- `packages/cockpit/src/guided-create.ts:225-294` — five near-identical per-entity-type branches each building `{ token, original, entityType }` + `tokenMap.set` + list push — ecosystem alternative: a `Record<string, { prefix: string; counter: () => number; sink?: IndexedSpanToken[] }>` dispatch table instead of a hand-rolled if/else-if ladder.
- `packages/cockpit/src/guided-create.ts:605-610` — hand-rolled `formatTodayDate` (`getFullYear`/`getMonth`/`getDate` + `padStart`) — native alternative: `date.toISOString().slice(0, 10)` (UTC) or `Intl.DateTimeFormat("en-CA", { timeZone })` for local day.
- `packages/cockpit/src/guided-create.ts:662-671` — hand-rolled sequential `str.replaceAll(token, ...)` loop over every token-map entry per field — native alternative: single-pass replacement via one combined `RegExp` with a replacer callback.
- `packages/cockpit/src/index.ts` — no custom utils; pure `export *` barrel, nothing to replace.

## Summary

| Rule | Count |
|------|-------|
| R1 Exhaustive Branching & Explicit State Handling | 3 |
| R2 Zero Fallbacks & Deterministic Control Flow | 56 |
| R3 No Unrequested Legacy Support | 0 |
| R4 No Repeated Cross-File Literals | 8 groups (7 within-slice repeat groups + 1 imported-constant note; 8 cross-file candidates) |
| R5 Strict Path Discipline | 0 |
| R6 Prioritize Native & Ecosystem Solutions | 11 |
| Total | 78 |
