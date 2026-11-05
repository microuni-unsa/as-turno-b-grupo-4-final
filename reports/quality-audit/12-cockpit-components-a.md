# Slice 12 cockpit-components-a — Quality Audit

Audited files (line counts via read):
- packages/cockpit/src/ui/components/DecisionModal.astro — 405 lines
- packages/cockpit/src/ui/components/FloatingChatWidget.astro — 866 lines
- packages/cockpit/src/ui/components/Header.astro — 111 lines
- packages/cockpit/src/ui/components/RagCitation.astro — 105 lines

Date: 2026-11-05

## R1

- DecisionModal.astro:218 — `if (!modalAlert) return;` — guard with no else; non-alert failure path silently drops the message, no dedicated error.
- DecisionModal.astro:237 — `if (!modal) return;` — unopened-modal path returns silently inside event handler, no error raised.
- DecisionModal.astro:239-241 — three `if (formX) ...classList.add("hidden")` with no else — missing-element branches leave form-visibility state implicit.
- DecisionModal.astro:244 — `if (modalTitle) modalTitle.textContent = ...` — no else; missing title element leaves stale title silently.
- DecisionModal.astro:246 — `if (codeSpan) codeSpan.textContent = incidentCode;` — no else; missing span leaves prior incident code displayed.
- DecisionModal.astro:248-304 — `if (previewEl) { ... }` with no else — missing preview element silently skips proposal rendering.
- DecisionModal.astro:250 — `if (prop && typeof prop === "object")` with else that only hides preview (lines 300-303); non-object proposal state is hidden without a dedicated error.
- DecisionModal.astro:252 — `if (prop.item_c_consequences)` with no else — absent field silently omitted from preview.
- DecisionModal.astro:260 — `if (Array.isArray(...) && ...length > 0)` with no else — empty measures silently omitted, no explicit empty-state handling.
- DecisionModal.astro:271 — `if (Array.isArray(...) && ...length > 0)` with no else — same, proposed measures.
- DecisionModal.astro:280 — `if (prop.body_plain)` with no else — absent body silently omitted.
- DecisionModal.astro:288 — `if (Array.isArray(prop.citations) && ...length > 0)` with no else — absent citations silently omitted.
- DecisionModal.astro:306-318 — `if (action === "approve") ... else if (action === "revision") ... else if (action === "exemption")` with no final else — unknown `action` values fall through to `modal.showModal()` with all forms hidden and no error.
- DecisionModal.astro:308-311 — `if (formRevision) { ... }` with no else — missing form element silently skips unhide/reset.
- DecisionModal.astro:314-317 — `if (formExemption) { ... }` with no else — same.
- DecisionModal.astro:332 — `if (btnConfirmApprove)` with no else — missing approve button leaves the approve path dead with no error.
- DecisionModal.astro:353 — `if (formRevision)` with no else — missing revision form means submit handler never attaches, silently.
- DecisionModal.astro:372 — `if (formExemption)` with no else — same for exemption form.
- FloatingChatWidget.astro:341-343 — `if (!container || !fabEl || ...) { return; }` — any missing core element aborts widget init silently, no error.
- FloatingChatWidget.astro:349-353 — `if (isChatPage) { ...hide...; return; }` — chat-page branch returns; non-chat path is implicit fallthrough (no else), state managed only by later lines.
- FloatingChatWidget.astro:356-364 — inner `if (isOnNewPage) ... else ...` present, but outer `if (contextBadge)` has no else — missing badge silently skips.
- FloatingChatWidget.astro:366-372 — outer `if (quickActions)` has no else — missing element silently skips.
- FloatingChatWidget.astro:401-407 — `if (isExpanded()) ... else ...` — complete; noted as compliant.
- FloatingChatWidget.astro:412-414 — `if (headerTitle)` with no else — missing title silently skips.
- FloatingChatWidget.astro:423 — `if (fabPersonaBadge)` with no else — missing badge leaves stale persona label.
- FloatingChatWidget.astro:428 — `if (personaToggleBtn)` with no else — same.
- FloatingChatWidget.astro:447-455 — `if (listening) ... else ...` — complete; compliant.
- FloatingChatWidget.astro:459-487 — `if (speechRecognizer.isListening()) ... else ...` present, but `onError`/`onEnd` callbacks (477-483) only call `setSpeechUi(false)` without affecting control flow or raising — log-less silent branches.
- FloatingChatWidget.astro:471-476 — `if (inputEl)` inside `onResult` with no else — missing input silently drops transcript.
- FloatingChatWidget.astro:484-486 — `if (!started)` with no else-equivalent for the started path — success path leaves state implicit (no confirmation).
- FloatingChatWidget.astro:492 — `if (!inputEl) return;` — guard with no error.
- FloatingChatWidget.astro:499 — `if (!messagesContainer) return;` — guard with no error.
- FloatingChatWidget.astro:502-519 — `if (activeItems.length === 0) { ...; return; }` — empty-chat branch renders placeholder; non-empty path is fallthrough with no else.
- FloatingChatWidget.astro:527/535 — `if (node.sender === "user") ... else ...` — complete; compliant.
- FloatingChatWidget.astro:540 — `if (node.reasoning)` with no else — absent reasoning leaves `reasoningHtml` as implicit "".
- FloatingChatWidget.astro:559 — `if (node.response?.citations && ...length > 0)` with no else — no-citation state implicit.
- FloatingChatWidget.astro:595 — `if (node.form_mutation)` with no else — absent mutation implicit.
- FloatingChatWidget.astro:600 — `if (lbl)` with no else — empty labels silently skipped.
- FloatingChatWidget.astro:646 — `if (node.form_mutation)` with no else — mutation actions block skipped silently when absent.
- FloatingChatWidget.astro:667 — `if (target)` with no else — unmatched field key silently ignored after loop `break` search.
- FloatingChatWidget.astro:686 — `if (!trimmed) return;` — empty submit silently dropped, no user-facing error.
- FloatingChatWidget.astro:688-691 — `if (speechRecognizer.isListening())` with no else — non-listening path implicit.
- FloatingChatWidget.astro:693 — `if (inputEl)` with no else — missing input skips reset silently.
- FloatingChatWidget.astro:702-704 — `if (isOnNew)` with no else — off-`/new` leaves `formContext` as implicit undefined.
- FloatingChatWidget.astro:730-732 — `if (messagesContainer)` with no else — missing container skips scroll silently.
- FloatingChatWidget.astro:750-757 — `if (!res.ok)` throws; success path is implicit fallthrough with no else.
- FloatingChatWidget.astro:764-767 — `if (response.form_mutation && isOnNew)` with no else — mutation ignored off-`/new` with no notice.
- FloatingChatWidget.astro:834 — `quickActions?.querySelectorAll(...).forEach(...)` — optional chain silently no-ops when `quickActions` is null.
- FloatingChatWidget.astro:836-840 — `if (prompt)` with no else — pill without `data-prompt` silently does nothing.
- Header.astro:58 — `if (!statusBadge || !pulseDot || !statusText) return;` — missing elements abort silently, no error.
- Header.astro:59-71 — `if connected ... else if connecting ... else ...` — complete; compliant.
- Header.astro:83-92 — `if (event.type === "scheduler:timer_tick" && urgentTimer && urgentLabel)` with nested `if` and no else anywhere — all non-matching events silently ignored.
- Header.astro:100-106 — `if (breadcrumbLabel)` with no else; inner `if/else-if` chain (`/new`, `/incidents`, `/compliance`, `/security-log`, `/chat`) has no final else — unknown paths leave the breadcrumb label stale with no error.
- RagCitation.astro:95-102 — `if (hash)` with no else — button without hash attribute silently does nothing on click.

## R2

- DecisionModal.astro:215 — `let currentIncidentId = 0;` — silent default (`0`) instead of fail-fast uninitialized/named error before first modal open.
- DecisionModal.astro:234 — `const { action, incidentId, incidentCode } = e.detail;` — unvalidated destructure; absent fields propagate as `undefined` with no named error.
- DecisionModal.astro:298 — `previewEl.innerHTML = contentHtml || "<p class='text-slate-500...` — `||` default masks the all-fields-absent state instead of raising/naming it.
- DecisionModal.astro:344 — `showAlert(err.message || "Error al aprobar", true);` — `||` default hides absent error state.
- DecisionModal.astro:366 — `showAlert(err.message || "Error al solicitar revisión", true);` — same `||` default.
- DecisionModal.astro:379-382 — `.split(",").map((s) => s.trim()).filter(Boolean)` — `filter(Boolean)` silently drops empty evidence entries instead of fail-fast validation error.
- DecisionModal.astro:401 — `showAlert(err.message || "Error al atestiguar exención", true);` — same `||` default.
- FloatingChatWidget.astro:266 — `${sevLabels[String(val)] ?? String(val)}` — `??` default passes unknown severity codes through silently instead of named error.
- FloatingChatWidget.astro:270 — `${impLabels[String(val)] ?? String(val)}` — same for impact codes.
- FloatingChatWidget.astro:413 — `session.title || "Copiloto IA"` — `||` default masks absent session title.
- FloatingChatWidget.astro:464 — `const base = inputEl?.value || "";` — `||` default masks missing input element.
- FloatingChatWidget.astro:579 — `c.dense_score !== null ? ... : "—"` — silent em-dash default instead of fail-fast on absent score.
- FloatingChatWidget.astro:580 — `c.bm25_rank ? ... : "—"` — same for BM25 rank.
- FloatingChatWidget.astro:598 — `Object.entries(mut.fields || {})` — `|| {}` default masks absent mutation fields.
- FloatingChatWidget.astro:614 — ternary `badges.length > 0 ? ... : ""` — empty-badges state silently renders nothing.
- FloatingChatWidget.astro:662 — `Object.keys(mut.fields || {})` — same `|| {}` default (second occurrence).
- FloatingChatWidget.astro:664-666 — `document.querySelector(...) ?? document.querySelector(...)` — speculative selector fallback chain hiding absent-field-target state.
- FloatingChatWidget.astro:751 — `await res.json().catch(() => ({}))` — `catch` fallback swallows JSON parse errors into an empty object.
- FloatingChatWidget.astro:754-756 — `errJson.message ?? \`Error en el servicio de chat (${res.status})\`` — `??` default masks absent error message.
- FloatingChatWidget.astro:773-776 — `err instanceof Error ? err.message : "Error inesperado..."` — fallback message hides non-Error rejection state instead of named error.
- FloatingChatWidget.astro:777-783 — `catch (err) { ... const fallbackResponse ...; chatStore.addAssistantResponse(userNode.id, fallbackResponse, true); }` — `catch { fallback }` chain: failed chat request is replaced with a synthetic `⚠️` assistant message instead of fail-fast with a named error.
- RagCitation.astro:67 — `{denseScore !== null ? denseScore.toFixed(4) : "—"}` — silent em-dash default for absent score.
- RagCitation.astro:73 — `{bm25Rank !== null ? \`#${bm25Rank}\` : "—"}` — same for absent rank.

## R3

No violations found.

## R4

Within-slice repeated literals (same literal in 2+ locations across the 4 files; single-use local literals not reported):
- `1200` (setTimeout reload delay) — DecisionModal.astro:339, DecisionModal.astro:361, DecisionModal.astro:396 — should live in a shared constant/config.
- `"es-PE"` (speech locale) — FloatingChatWidget.astro:166 (indicator label `Escuchando voz (es-PE)...`), FloatingChatWidget.astro:466 (`lang: "es-PE"`) — should live in a shared constant.
- `"/new"` path prefix (+ `"/new/"` variant) — FloatingChatWidget.astro:355, FloatingChatWidget.astro:699-700; Header.astro:101 (`path === "/new"`) — route literal hardcoded in 2 files; should live in shared route constants.
- `"/chat"` path prefix (+ `"/chat/"`, `` `/chat?session=...` ``) — FloatingChatWidget.astro:348, FloatingChatWidget.astro:814; Header.astro:105 (`path.startsWith("/chat")`) — same, shared route constants.
- `toFixed(4)` score precision — RagCitation.astro:67, RagCitation.astro:79, RagCitation.astro:85 — repeated magic precision; should be a shared formatting constant.
- `toFixed(3)` score precision — FloatingChatWidget.astro:579, FloatingChatWidget.astro:581, FloatingChatWidget.astro:582 — same (distinct value from the `toFixed(4)` above, but itself repeated 3x).
- `slice(0, 8)` hash truncation — RagCitation.astro:53 (`chunkSha256.slice(0, 8)`), FloatingChatWidget.astro:573 (`c.chunk_sha256.slice(0, 8)`) — cross-file repeated magic truncation; shared constant.
- `slice(0, 24)` / `slice(0, 20)` label truncation — FloatingChatWidget.astro:283 (`slice(0, 24)`), FloatingChatWidget.astro:285 (`slice(0, 20)`) — repeated magic truncation lengths within one file; shared constants.
- `"hidden"`/`"flex"` class-toggle pair — toggled throughout DecisionModal.astro (239-241, 299, 301, 305, 309, 315), FloatingChatWidget.astro (350, 353, 358-362, 368-370, 381-383, 391-393, 448-454), Header.astro:89-90 — ubiquitous literal pair; candidate for shared show/hide helpers (noted as weak candidate: framework-idiomatic class names, low extraction value).
- Cross-file-literal candidates for global synthesis (literal value + file:line each, other file may be outside this slice):
  - `1200` — DecisionModal.astro:339, DecisionModal.astro:361, DecisionModal.astro:396.
  - `1500` — RagCitation.astro:99 (`setTimeout ..., 1500`).
  - `112` (`Math.min(inputEl.scrollHeight, 112)`) — FloatingChatWidget.astro:494.
  - `12 * 3600 * 1000` (12h threshold) — Header.astro:87.
  - `"/api/chat"` — FloatingChatWidget.astro:742.
  - `"pims_floating_chat_open"` — FloatingChatWidget.astro:217, FloatingChatWidget.astro:377, FloatingChatWidget.astro:384, FloatingChatWidget.astro:394.
  - `"AES-256-GCM"` — DecisionModal.astro:135 (`value="AES-256-GCM"`).
  - `"[0-9a-f]{64}"` — DecisionModal.astro:158 (`pattern="[0-9a-f]{64}"`).
  - `"application/json"` — FloatingChatWidget.astro:745.
  - `"Copiloto IA"` — FloatingChatWidget.astro:28, FloatingChatWidget.astro:62 (title attr), FloatingChatWidget.astro:413 (fallback).
  - `"Auditor"` — FloatingChatWidget.astro:33, FloatingChatWidget.astro:70.

## R5

No violations found. All file/route operations are project-root-relative (`/api/chat`, `/chat?session=...`, `/new`, `/incidents`, `/compliance`, `/security-log`, `/chat` path checks, `#field-...` DOM selectors); no machine-dependent paths (`~/`, `/home/`, `/tmp`, `file:///`, `C:\`), no workspace-escaping traversal, no hardcoded absolute filesystem paths.

## R6

- FloatingChatWidget.astro:219-226 — `function escapeHtml(str)` hand-rolls `&<>"'` replacement — custom HTML-escaping util where the ecosystem provides it (e.g. the `he` package, or DOM-native `textContent` assignment instead of `innerHTML`); name: `he` / native `textContent`.
- FloatingChatWidget.astro:228-259 — `function renderMarkdown(raw)` hand-rolls fenced-code/inline-code/headings/bold/italic/bullet/numbered-list/paragraph rendering via chained regexes — custom markdown engine where an established dependency provides it (e.g. `marked`, `markdown-it` + a sanitizer such as `DOMPurify`); name: `marked` / `markdown-it`.
- FloatingChatWidget.astro:261-287 — `function formatFieldLabel(key, val)` hand-rolls per-field label formatting with inline severity/impact maps and `slice` truncation — custom presentation helper duplicating what shared cockpit format utilities / a schema-driven label map provide; name: shared `@pims/cockpit/ui/lib` format utils or schema-driven labels.
- FloatingChatWidget.astro:491-495 — `function autoResizeInput()` hand-rolls textarea auto-resize via `scrollHeight` clamping — custom behavior where native CSS (`field-sizing: content`) or an established autosize primitive provides it; name: native CSS `field-sizing: content` / `autosize` primitive.
- DecisionModal.astro:248-299 — proposal-preview HTML built by string concatenation + `previewEl.innerHTML = contentHtml` with unescaped interpolations (`${prop.item_c_consequences}`, `${m}`, `${prop.body_plain}`, `${c}`) — hand-rolled templating where the framework (Astro component rendering / a sanitizer + `escapeHtml`-equivalent) already provides safe rendering; name: Astro-templated rendering / `he` + `DOMPurify`-style sanitized helper. (Security-adjacent note: interpolate-and-`innerHTML` without escaping; the sibling file in this slice already carries its own `escapeHtml` at FloatingChatWidget.astro:219.)
- RagCitation.astro:92-104 — `document.querySelectorAll("[data-copy-hash]").forEach(...)` + manual `btn.innerHTML` swap + `setTimeout` revert hand-rolls copy-to-clipboard UX where the platform provides it (`navigator.clipboard.writeText` is already used, but the wiring duplicates per-button listeners instead of a shared clipboard-button primitive/utility); name: shared clipboard-copy utility/component. (Weak candidate: small glue code, low abstraction value.)

## Summary

| Rule | Violations |
|------|-----------|
| R1 Exhaustive Branching & Explicit State Handling | 48 |
| R2 Zero Fallbacks & Deterministic Control Flow | 21 |
| R3 No Unrequested Legacy Support | 0 |
| R4 No Repeated Cross-File Literals | 11 groups (8 within-slice repeats + candidates listed for synthesis) |
| R5 Strict Path Discipline | 0 |
| R6 Prioritize Native & Ecosystem Solutions | 6 |
| Total | 86 (75 line findings + 11 R4 groups) |
