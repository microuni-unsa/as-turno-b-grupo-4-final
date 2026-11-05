# Slice 10 Cockpit Stores — Quality Audit

Audited files (line counts, date 2026-11-05):
- `packages/cockpit/src/ui/lib/chat-store.ts` — 556 lines
- `packages/cockpit/src/ui/lib/event-store.ts` — 34 lines
- `packages/cockpit/src/ui/lib/trace-store.ts` — 225 lines
- `packages/cockpit/src/ui/lib/form-draft-bus.ts` — 347 lines

## R1

- chat-store.ts:9 — `if (typeof window === "undefined")` guard in `EventStore`/`ChatStore.loadFromStorage` context (line 60) has no `else` branch comment; non-browser path relies on implicit skip of `localStorage` read — state (sessions) left to downstream `initDefaultSession`, missing explicit else.
- chat-store.ts:67 — `if (rawV2) {` with no `else`; when key absent state falls through implicitly to legacy check.
- chat-store.ts:73 — `if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {` with no `else`; invalid/empty payload silently falls through to legacy path.
- chat-store.ts:84 — `if (rawLegacy) {` with no `else`; absent legacy key silently falls through to `initDefaultSession`.
- chat-store.ts:98 — `if (Array.isArray(parsedLegacy.messages) && ...length > 0) {` with no `else`; malformed legacy payload silently discarded, falls to `initDefaultSession` without dedicated error.
- chat-store.ts:195 — `if (parentNode) { parentNode.childrenIds.push(nodeId); }` — missing `else`; orphan link when `lastId` absent from map is silently dropped, no error.
- chat-store.ts:207 — `if (typeof window === "undefined") return;` in `saveToStorage` with no `else`; non-browser save is silent noop without error.
- chat-store.ts:268 — `if (exists && this.activeSessionId !== sessionId) {` with no `else`; unknown `sessionId` silently ignored, no dedicated error.
- chat-store.ts:311 — `if (s && title.trim()) {` with no `else`; unknown id or blank title silently ignored, no error.
- chat-store.ts:363 — `} else if (session.nodes[parentId]) {` — missing final `else`; non-null `parentId` absent from map leaves node orphaned with no error.
- chat-store.ts:411 — `if (parentNode) {` (addAssistantResponse) with no `else`; unknown `parentUserNodeId` silently unlinked, no error.
- chat-store.ts:454 — `if (parentNode) { parentNode.childrenIds.push(newNodeId); }` inside `else` (editUserMessage) with no inner `else`; same orphan-drop without error.
- chat-store.ts:468 — `if (!session.nodes[nodeId]) return;` — silent early return on unknown id, no dedicated error.
- chat-store.ts:474 — `if (!children || children.length === 0) break;` — silent `break` without error/state update.
- chat-store.ts:476 — `if (!nextId) break;` — silent `break` on undefined child id, no error.
- event-store.ts:9 — `if (typeof window !== "undefined") { window.addEventListener(...); }` with no `else`; SSR path leaves listener unregistered with state implicit.
- trace-store.ts:20 — `if (typeof window !== "undefined") { window.addEventListener(...); }` with no `else`; same implicit no-listener state on SSR.
- trace-store.ts:53 — `if (makeActive || this.activeTraceId === null) {` with no `else`; inactive-add path leaves `activeTraceId`/`selectedSpanId` implicit.
- trace-store.ts:74 — `if (this.activeTraceId !== id) {` with no `else`; same-id call is silent noop.
- trace-store.ts:90 — `if (this.selectedSpanId !== spanId) {` with no `else`; same-value call is silent noop.
- trace-store.ts:101 — `if (this.axisMode !== mode) {` with no `else`; same-value call is silent noop.
- trace-store.ts:112 — `if (this.compressIdle !== compress) {` with no `else`; same-value call is silent noop.
- trace-store.ts:162 — `if (event.type === "tool:mutation") { ... } else if (event.type === "rag:retrieval") { ... } else if (event.type === "role:transition") { ... }` — missing final `else`; all other `event.type` values fall through leaving `spanType="agent"`/`track="Main"` implicit, unhandled cases not enumerated.
- form-draft-bus.ts:18 — `if (!form) { return {}; }` — empty-object return without error; absent-form state implicit.
- form-draft-bus.ts:35 — `if (!name) continue;` — unnamed elements silently skipped, no error/count.
- form-draft-bus.ts:51 — `} else if (isSelect) {` — missing final `else`; array field that is neither checkbox nor select silently ignored then `continue`.
- form-draft-bus.ts:62 — `if (inputType === "radio") {` inside `name === "involves_personal_data"` with no `else`; non-radio widget with that name silently skipped.
- form-draft-bus.ts:64 — `if (radioEl.checked) {` with no `else`; unchecked radio leaves `result.involves_personal_data` implicit.
- form-draft-bus.ts:74 — `if (radioEl.checked && radioEl.value.trim() !== "") {` with no `else`; unchecked/empty radio silently skipped.
- form-draft-bus.ts:82 — `if (checkEl.checked) {` with no `else`; unchecked checkbox silently skipped.
- form-draft-bus.ts:90 — `if (val !== "") {` (`num_affected_subjects`) with no `else`; empty string leaves field implicit.
- form-draft-bus.ts:98 — `if (val !== "") {` (generic text) with no `else`; empty values silently dropped.
- form-draft-bus.ts:125 — `if (description) {` with no `else`; action cards with empty description silently dropped.
- form-draft-bus.ts:147 — `if (typeof window === "undefined") return;` with no `else`; SSR emit is silent noop.
- form-draft-bus.ts:166 — `if (!root) { return []; }` — silent empty-array return on missing root/document, no error.
- form-draft-bus.ts:174 — `if (val === undefined) continue;` — undefined mutation fields silently skipped.
- form-draft-bus.ts:191 — `if (radios.length > 0) applied = true;` with no `else`; zero-radio case leaves `applied=false` implicit, key later silently dropped.
- form-draft-bus.ts:201 — `if (checkboxes.length > 0 && Array.isArray(val)) {` with no `else`; non-array `val` or zero checkboxes silently ignored.
- form-draft-bus.ts:210 — `if (select && Array.isArray(val)) {` with no `else`; missing select or non-array `val` silently ignored.
- form-draft-bus.ts:228 — `if (input && input.type !== "radio" && ...) { } else if (input && input.type === "radio") { }` — missing final `else`; missing input / checkbox type / unmatched radio silently leaves `applied=false`, key dropped at line 246 without error.
- form-draft-bus.ts:237 — `if (radio) {` with no `else`; unmatched `value` selector silently ignored.
- form-draft-bus.ts:246 — `if (applied) {` with no `else`; unapplied keys silently excluded from `updatedKeys` with no error.
- form-draft-bus.ts:256 — `if (container) {` with no `else`; missing container silently skips highlight.
- form-draft-bus.ts:274 — `if (badge) {` with no `else`; missing badge silently skips provenance update.
- form-draft-bus.ts:317 — `if (typeof window === "undefined" || !window.sessionStorage) return;` — silent noop, no error.
- form-draft-bus.ts:329 — `if (typeof window === "undefined" || !window.sessionStorage) return null;` — silent null, no error.
- form-draft-bus.ts:341 — `if (typeof window === "undefined" || !window.sessionStorage) return;` — silent noop, no error.

## R2

- chat-store.ts:66 — `const rawV2 = localStorage.getItem(STORAGE_KEY_V2); if (rawV2) {...}` + fallthrough to legacy check + `catch` → `initDefaultSession()`: chained `if exists(v2) ... if exists(legacy) ... else default` fallback cascade instead of fail-fast with named error.
- chat-store.ts:76 — `parsed.activeSessionId || parsed.sessions[0]?.id || ""` — `||` defaults hiding absent/empty session id.
- chat-store.ts:77 — `parsed.persona || "auditor"` — `||` default hiding absent persona.
- chat-store.ts:104 — `parsedLegacy.persona ?? "auditor"` — `??` default hiding absent persona.
- chat-store.ts:108 — `parsedLegacy.persona ?? "auditor"` — same `??` default (second occurrence).
- chat-store.ts:113 — `catch (err) { console.warn(...); }` then `initDefaultSession()` — `try/except` swallowing parse/storage errors into silent fresh-session fallback.
- chat-store.ts:169 — `msg.id ?? \`node-...\`` — `??` generated-id fallback hiding absent id.
- chat-store.ts:177 — `msg.persona ?? persona` — `??` default hiding absent per-message persona.
- chat-store.ts:179 — `reasoning: msg.response?.reasoning` — `?.` silently yields `undefined` for absent response (implicit default).
- chat-store.ts:180 — `trace: msg.response?.trace` — same `?.` silent default.
- chat-store.ts:183 — `msg.timestamp ?? new Date().toLocaleTimeString(...)` — `??` fallback hiding absent timestamp.
- chat-store.ts:217 — `catch (err) { console.warn("Storage quota exceeded..."); }` — swallowed save error, execution continues to `notify()` as if saved.
- chat-store.ts:240 — `return [...this.sessions].sort(...)` returns sorted copy with no error on empty store instead of fail-fast (silent default `[]` path downstream).
- chat-store.ts:281 — `title || "Nueva Consulta"` — `||` default hiding absent/empty title.
- chat-store.ts:282 — `persona || this.currentPersona || "auditor"` — chained `||` fallback cascade for persona.
- chat-store.ts:355 — `persona || this.currentPersona` — `||` default hiding absent persona.
- chat-store.ts:447 — `formContext ?? targetNode.formContext` — `??` fallback hiding absent context.
- chat-store.ts:472 — `(session.nodes[currentId]?.childrenIds.length ?? 0) > 0` — `?.` + `?? 0` hiding missing node.
- chat-store.ts:473 — `session.nodes[currentId]?.childrenIds` — `?.` hiding missing node.
- chat-store.ts:475 — `children[children.length - 1]` with `if (!nextId) break;` — undefined-index fallback handled by silent break instead of named error.
- chat-store.ts:494 — `session.nodes[session.activeLeafId] ?? null` — `?? null` hiding absent leaf.
- chat-store.ts:498 — `session.nodes[current.parentId] ?? null` — `?? null` hiding absent parent.
- chat-store.ts:509 — `parent ? parent.childrenIds : [node.id]` — ternary synthetic single-element default hiding absent parent.
- chat-store.ts:515 — `siblings.length > 0 ? siblings.length : 1` — hardcoded `1` default hiding empty-sibling state.
- trace-store.ts:56 — `trace.spans[0]?.id ?? null` — `?.` + `?? null` hiding absent first span.
- trace-store.ts:68 — `this.traces[0] ?? null` — `?? null` hiding empty-trace-list state (silent null instead of named error).
- trace-store.ts:70 — `this.traces.find(...) ?? null` — `?? null` hiding unknown `activeTraceId`.
- trace-store.ts:78 — `t.spans[0]?.id ?? null` — same optional-chain default.
- trace-store.ts:86 — `trace.spans.find(...) ?? null` — `?? null` hiding unknown span id.
- trace-store.ts:133 — `(event as { incident_code?: string }).incident_code || "AGENT-LOOP"` — `||` default hiding absent incident code.
- trace-store.ts:198 — `toolMap.get(span.name) || { calls: 0, ... }` — `||`/`get`-with-default hiding absent map entry (`.get(k, default)` pattern).
- form-draft-bus.ts:13 — `formEl ?? (typeof document !== "undefined" ? document.getElementById(...) : null)` — `??` parameter-to-DOM-lookup fallback chain.
- form-draft-bus.ts:34 — `el.name || (el.id ? el.id.replace(/^field-/, "") : "")` — `||` fallback chain for field name.
- form-draft-bus.ts:45 — `((result as Record<string, unknown>)[name] as string[]) || []` — `|| []` hiding absent array entry.
- form-draft-bus.ts:92 — `Number.isNaN(num) ? null : num` — silent `null` default for unparsable number instead of named error.
- form-draft-bus.ts:128 — `rawType === "A" || rawType === "R" || rawType === "C" ? rawType : "C"` — speculative `"C"` default hiding invalid action type.
- form-draft-bus.ts:131 — `respEl?.value.trim() || "operador"` — `?.` + `||` default hiding absent responsible.
- form-draft-bus.ts:132 — `dateEl?.value || new Date().toISOString().slice(0, 10)` — `||` today-date default hiding absent date.
- form-draft-bus.ts:134 — `evidEl?.value.trim() || null` — `|| null` hiding absent/empty evidence.
- form-draft-bus.ts:160 — `formEl ?? (typeof document ... ?? document)` — `??` + `??` fallback chain (explicit form → `#incident-form` → whole `document`).
- form-draft-bus.ts:220 — `` `#field-${key}` `` query `??` `` `[name="${key}"]` `` — `??` selector fallback chain (two occurrences: lines 220–226 and 250–252).
- form-draft-bus.ts:229 — `val === null ? "" : String(val)` — silent `""` coercion hiding null value.
- form-draft-bus.ts:255 — `inputEl?.closest(".form-field, .form-group, div") ?? inputEl` — `?.` + `??` fallback hiding missing container.
- form-draft-bus.ts:269 — `root.querySelector(...) ?? (typeof document !== "undefined" ? document.getElementById(...) : null)` — `??` scoped-to-global fallback chain for badge.
- form-draft-bus.ts:318 — `try { sessionStorage.setItem(...) } catch (err) { console.warn(...); }` — swallowed save error, silent noop fallback.
- form-draft-bus.ts:330 — `try { getItem...; if (!raw) return null; JSON.parse } catch { warn; return null; }` — `catch { fallback null }` + absent-key `null` hiding corrupt/missing draft instead of named error.
- form-draft-bus.ts:342 — `try { removeItem } catch (err) { console.warn(...); }` — swallowed clear error.

## R3

- chat-store.ts:47 — `const LEGACY_STORAGE_KEY = "pims_cockpit_chat";` — legacy storage key shim constant.
- chat-store.ts:82 — `// Check legacy format` + lines 83–112 `localStorage.getItem(LEGACY_STORAGE_KEY)` / `createSessionFromLegacy(...)` / `saveToStorage()` — backwards-compat migration path for old chat payload.
- chat-store.ts:152 — `private createSessionFromLegacy(...)` (lines 152–204) — legacy wrapper converting old message array into node graph.
- chat-store.ts:521 — `// Backward compatibility methods for existing code` + lines 522–544 `getMessages()` — deprecated-API adapter mapping branch messages back to legacy flat shape.
- event-store.ts — No violations found.
- trace-store.ts — No violations found.
- form-draft-bus.ts — No violations found.

## R4

Within-slice repeated literals (same value hardcoded 2+ times inside the 4-file slice):
- `"auditor"` — chat-store.ts:52,77,82(via `?? "auditor"` at 104,108,282) — default persona repeated ~6×; must be shared constant/config.
- `` `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` `` (id prefix `msg-` + `toString(36)` + `slice(2, 7)`) — chat-store.ts:341,388,432 — same id-minting literal triple-repeated.
- `"es-ES"` + `{ hour: "2-digit", minute: "2-digit" }` locale/options — chat-store.ts:184,342,389,433 — repeated 4×.
- `"Nueva Conversación"` (line 125) / `"Nueva Consulta"` (line 281) / `"Conversación previa"` (line 164) — near-duplicate title literals (3 distinct but operationally same default-title role).
- `36` in `text.length > 36 ? \`${text.slice(0, 36)}…\`` — chat-store.ts:375 — paired duplicate within one expression (threshold + slice end).
- `new Date().toISOString()` — chat-store.ts:138,313,330,368,416,461,481,551 (8×) + trace-store.ts:141 + form-draft-bus.ts:132 — repeated timestamp literal pattern.
- `50` (trace cap/span quantum) — trace-store.ts:48 (`length > 50`), trace-store.ts:181,182,205 (`+ 50`, `duration_ms: 50`) — same numeric literal reused for two operational meanings.
- `"cockpit:agent-event"` — event-store.ts:10 + trace-store.ts:21 — same event-name string in 2 files.
- `typeof window !== "undefined"` — chat-store.ts:60,207 + event-store.ts:9 + trace-store.ts:20 + form-draft-bus.ts:147,317,329,341 — same guard string in 4 files (7 occurrences).
- `typeof document !== "undefined"` — form-draft-bus.ts:14,161,270 — repeated 3× within one file.
- `"incident-form"` (`getElementById("incident-form")`) — form-draft-bus.ts:15,162 — repeated 2×.
- `"input, select, textarea"` selector — form-draft-bus.ts:31 (single use in slice; counterpart selector strings `#field-${key}` / `[name="${key}"]` repeated at 209,220–226,234,250–252,269 — `#field-` prefix ×5, `[name="..."]` ×4 within file).
- `new Event("input", { bubbles: true })` / `new Event("change", { bubbles: true })` — form-draft-bus.ts:188,189,204,205,214,215,230,231,239,240 — `input`/`change` event-type literals repeated ~5× each.
- `"field-highlight-pulse"` / `"field-updated-highlight"` — form-draft-bus.ts:257,258,262,263 — repeated add/remove pair.
- `"hidden"` / `"provenance-narrative"` / `"provenance-partial"` / `"provenance-default"` — form-draft-bus.ts:276–279 (remove) + 290,294,298 (add) — provenance class literals repeated.
- `"IA: Asistido"` — form-draft-bus.ts:291,299 — repeated 2×.
- `"involves_personal_data"` — form-draft-bus.ts:61,179–181 — repeated 3×.
- `"affected_cid"` / `"affected_data_types"` / `"security_measures_adopted"` — form-draft-bus.ts:24–26 (Set definition) + 193–195 (branch condition) + 199,209 (selectors) — each repeated 2–3×.
- `"cookie"`-style storage keys: `"pims_cockpit_sessions_v2"` (46,66,210), `"pims_cockpit_chat"` (47,83), `"pims_incident_form_draft"` (7,320,331,343 — via `STORAGE_KEY_FORM_DRAFT` constant uses, definition single; the two cockpit keys are distinct values but same operational family).

Cross-file literal candidates for global synthesis (value + file:line each, other file may be outside slice):
- `"cockpit:agent-event"` — event-store.ts:10; trace-store.ts:21.
- `typeof window !== "undefined"` — chat-store.ts:60; chat-store.ts:207; event-store.ts:9; trace-store.ts:20; form-draft-bus.ts:147; form-draft-bus.ts:317; form-draft-bus.ts:329; form-draft-bus.ts:341.
- `new Date().toISOString()` — chat-store.ts:138; chat-store.ts:313; chat-store.ts:330; chat-store.ts:368; chat-store.ts:416; chat-store.ts:461; chat-store.ts:481; chat-store.ts:551; trace-store.ts:141; form-draft-bus.ts:132.
- `"auditor"` — chat-store.ts:52; chat-store.ts:77; chat-store.ts:104; chat-store.ts:108; chat-store.ts:282 (candidate if persona default also appears outside slice).
- `"cockpit:form-updated"` — form-draft-bus.ts:148 (single in slice; candidate if dispatched/listened elsewhere outside slice).
- `MAX_BUFFER_SIZE = 100` (event-store.ts:3) vs `traces.length > 50` (trace-store.ts:48) — same operational family (buffer caps) with divergent magic numbers; candidate for shared cap config.

## R5

- No violations found.

## R6

- chat-store.ts:140 — `` `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` `` (also 168–170, 341, 388, 432 `msg-`/`node-` variants) — hand-rolled random id generator; native alternative: `crypto.randomUUID()`.
- chat-store.ts:240 — `[...this.sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())` — hand-rolled date-compare sort; native/ecosystem alternative: `Intl.Collator` is wrong tool — correct native is `Date.parse` comparator or `luxon`/`date-fns compareDesc`; at minimum the repeated `new Date(...).getTime()` coercion should use `Date.parse()`.
- chat-store.ts:184 / 342 / 389 / 433 — `new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })` ×4 — hand-rolled repeated formatting; native alternative: single shared `Intl.DateTimeFormat("es-ES", {...})` instance.
- trace-store.ts:155 — `((now - this.liveAgentStartTime) / 1000).toFixed(2)` + `Number(...)` + `relStart * 1000` — hand-rolled ms↔s round-trip math; native alternative: keep times in ms (`performance.now()`/`Date.now()` delta) and format only at render via `Intl.NumberFormat`.
- trace-store.ts:158 — `` event.type.replace(/[^a-zA-Z0-9]/g, "_") `` — hand-rolled slugify for span ids; ecosystem alternative: a shared `slugify` util (or `encodeURIComponent`-based id) instead of inline regex.
- trace-store.ts:193 — `const toolMap = new Map<...>(); for (...) {...} liveTrace.aggregates = Array.from(...)` — hand-rolled group-by/count/sum/max aggregation; native alternative: `Map.groupBy` (ES2024) or `Object.groupBy`, or `d3-array`/`lodash.groupBy` if already a dependency.
- form-draft-bus.ts:9 — `extractCurrentFormValues` hand-rolls full form serialization via `querySelectorAll("input, select, textarea")` + per-type branching; native alternative: `FormData` API (`new FormData(form)` + `getAll()` for multi-value fields).
- form-draft-bus.ts:249 — `container.classList.add(...); setTimeout(() => container.classList.remove(...), 2000);` — hand-rolled timed highlight; native alternative: CSS animation (`animation` + `animationend` event) or the Web Animations API (`element.animate()`).
- form-draft-bus.ts:281 — `const prov: GuidedProvenance | undefined = mutation.provenance?.[key];` + manual `badge.classList`/`textContent` mapping (lines 274–305) — hand-rolled provenance→badge validation/mapping; ecosystem alternative: a schema-driven mapper (e.g. `zod` enum + record of badge props) instead of inline if/else chain.

## Summary

| Rule | Violations |
|------|-----------|
| R1 Exhaustive Branching & Explicit State Handling | 45 |
| R2 Zero Fallbacks & Deterministic Control Flow | 44 |
| R3 No Unrequested Legacy Support | 4 |
| R4 No Repeated Cross-File Literals | 19 groups (6 cross-file candidates) |
| R5 Strict Path Discipline | 0 |
| R6 Prioritize Native & Ecosystem Solutions | 9 |
| Total | 121 |
