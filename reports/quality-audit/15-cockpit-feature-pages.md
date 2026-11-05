# Slice 15 cockpit-feature-pages — Quality Audit

Audited files (line counts, 2026-11-05):
- `packages/cockpit/src/ui/pages/chat.astro` — 1674 lines
- `packages/cockpit/src/ui/pages/compliance.astro` — 628 lines
- `packages/cockpit/src/ui/pages/incidents/index.astro` — 489 lines
- `packages/cockpit/src/ui/pages/new.astro` — 1423 lines
- `packages/cockpit/src/ui/pages/security-log.astro` — 263 lines

## R1

- `chat.astro:585` — `if (!messagesContainer || !chatForm || !chatInput) return;` — silent early return; page renders a dead form with no error state raised.
- `chat.astro:591` — `if (!btn) return;` — silent per-button skip inside `forEach`; missing button never surfaced.
- `chat.astro:648` — `if (p) { currentPersona = p; ... }` — no `else`; null `data-persona` silently ignored, no error.
- `chat.astro:677` — `if (code !== null) { ... }` — no `else`; prompt-cancel leaves stale incident context implicit.
- `chat.astro:768` — `if (!sessionsContainer) return;` — silent return, sidebar left empty without error.
- `chat.astro:839` — `if (!messagesContainer) return;` — silent return, empty chat state implicit.
- `chat.astro:1420` — `if (!timelineSvg) return;` — silent return, timeline silently absent.
- `chat.astro:1552` — `if (!tbody) return;` — silent return, aggregates table silently unrendered.
- `chat.astro:1509-1513` — `if (!selected) { show empty; return; }` — OK branching, but `renderInspectorPane` has no guard when both `emptyDiv` and `contentDiv` are null (state left implicit).
- `chat.astro:1316-1321` — `if (!trace) { set option; return; }` — trace-missing renders a placeholder option but never raises state; selector failure is silent.
- `chat.astro:1461-1474` — `let laneY = 96; ... if (span.type === "turn") ... else if (span.type === "model") ... else if (span.type === "agent")` — no final `else`; unknown span types (e.g. `tool`) fall through to the Tools default implicitly.
- `chat.astro:1531-1539` — `if (selected.error) ... else if (typeof selected.result === "string") ... else if (selected.result) ... else` — covered, no violation (noted for completeness).
- `compliance.astro:114` — `if (!timersGrid) return;` — silent return, timers section left stale.
- `compliance.astro:126-131` — `let label = timer.timer_type; if (T_AUTHORITY...) ... if (T_INTERNAL_SLA...) ...` (4 more bare `if`s) — no final `else`; unknown `timer_type` leaves raw enum string as the user-facing label (implicit state).
- `compliance.astro:288` — `if (!pendingContainer) return;` — silent return; badge may update while list does not (split state).
- `compliance.astro:439` — `if (!targetId) return;` — silent return inside toggle handler, click swallowed.
- `compliance.astro:441` — `if (targetEl) { ... }` — no `else`; dangling `data-toggle-prop` silently does nothing.
- `compliance.astro:454` — `if (!canChangeIncident) return;` — permission denial swallowed with no error/toast; buttons already `disabled` so the handler path is dead.
- `compliance.astro:510` — `if (!ragContainer || !Array.isArray(records) || records.length === 0) return;` — empty/invalid snapshot silently ignored, placeholder text left in place.
- `compliance.astro:599-609` — `if (idx !== -1) { update } else { push(...) }` — covered (noted); but pushed object fabricates `CockpitTimer` from partial event fields with no validation error path.
- `incidents/index.astro:260` — `if (!tbody) return;` — silent return, table left stale.
- `incidents/index.astro:346` — `if (!statTotal) return;` — silent return; all five metric cards left stale when one node is missing.
- `incidents/index.astro:373` — `if (!drawer) return;` — silent return while `drawerCode/Title/...` each have independent `if` guards, so partial drawer state is possible.
- `incidents/index.astro:334` — `if (found) openDrawer(found);` — no `else`; unknown `data-id` click silently ignored.
- `incidents/index.astro:477` — `if (event.type === "lifecycle:status_change") { ... }` — no `else`; all other agent-event types silently dropped.
- `incidents/index.astro:478` — `if (idx !== -1) { ... }` — no `else`; events for unknown `incident_code` silently dropped.
- `new.astro:1110` — `if (!containerActions) return;` — silent return, action card request dropped.
- `new.astro:1175` — `if (!incidentForm) return;` — silent return in `saveCurrentForm`.
- `new.astro:1181` — `if (!incidentForm) return;` — silent return in `initPage`; no error when the form node is absent.
- `new.astro:1186` — `if (sessionId) { ... }` — no `else`; missing `?session=` leaves draft-source implicit.
- `new.astro:1193` — `if (draft && Object.keys(draft).length > 0) { ... }` — no `else`; empty draft leaves blank form with no explicit "fresh form" state.
- `new.astro:1215` — `if (badge && !badge.classList.contains("hidden")) { ... }` — no `else`; missing badge silently skips provenance update.
- `new.astro:1233` — `if (!incidentForm || isUpdatingFromEvent) return;` — concurrent `cockpit:form-updated` events silently coalesced/dropped, no queue or error.
- `new.astro:1235` — `if (mutation) { ... }` — no `else`; event without `mutation` silently ignored.
- `new.astro:1267` — `if (!field) return;` — silent return, explain click swallowed.
- `new.astro:1282` — `if (!res.ok) { set text; return; }` — error text set but no status propagation; falls out without `else` continuation being explicit.
- `new.astro:1290` — `if (data.type === "enum" && data.options) { ... } else { ... }` — covered (noted for completeness).
- `new.astro:1300-1304` — `if (data.citations && data.citations.length > 0 && modalExplainCitations)` — no `else`; citation-less responses leave the citations container with stale content from a prior field.
- `new.astro:1372` — `if (description) { actions.push(...) }` — no `else`; empty action cards silently skipped (data loss without notice).
- `security-log.astro:143-147` — `if (!hasPermission(...)) { hide; return; }` + unconditional show below — covered (noted for completeness).
- `security-log.astro:191` — `if (!tbody) return;` — silent return, mutation rows silently unrendered.
- `security-log.astro:199-202` — `let methodBadgeClass = "bg-slate-800..."; if (POST) ...; if (PATCH) ...; if (DELETE) ...` — no final `else`; unknown methods (GET/PUT) silently keep the default class.
- `security-log.astro:240` — `if (roleTransitionsCount === 1) roleContainer.innerHTML = "";` — no `else`; clearing logic depends on exact counter value, fragile implicit state.
- `security-log.astro:257-261` — `if (event.type === "tool:mutation") ... else if (event.type === "role:transition")` — no final `else`; all other SSE event types silently dropped.

## R2

- `chat.astro:529` — `chatStore.getPersona() || session?.default_persona || "auditor"` — `||` fallback chain hiding absent persona state instead of fail-fast with a named error.
- `chat.astro:671` — `activeIncidentContext || "Ninguno"` — silent default display string masks absent context.
- `chat.astro:676` — `prompt(..., activeIncidentContext || "")` — `||` default masks undefined.
- `chat.astro:678` — `code.trim() || undefined` — empty string silently coerced to undefined.
- `chat.astro:760` — `lastMutation?.fields ?? activeSession.draftSnapshot ?? loadFormDraft() ?? {}` — 3-level `??` fallback chain across chat mutation / session snapshot / localStorage, ending in silent `{}` default.
- `chat.astro:771` — `(sessionSearch?.value || "").toLowerCase().trim()` — `||` default masks missing input node.
- `chat.astro:781-783` — `query ? sessions.filter(...) : sessions` — empty query silently returns everything (speculative default branch).
- `chat.astro:1023` — `const f = fm.fields || {};` — `.fields` absence hidden by silent `{}`.
- `chat.astro:1050` — `${fm.summary ? ... : ""}` — missing summary silently renders nothing.
- `chat.astro:1051` — `${chips.length > 0 ? ... : ""}` — same silent-empty pattern.
- `chat.astro:1100-1110` — `${node.trace ? ... : ""}` — missing trace silently hides the inspector entry point.
- `chat.astro:995` — `c.dense_score !== null ? ... : "—"` — null score rendered as em-dash instead of fail-fast (display default).
- `chat.astro:1248-1291` — `catch (err) { ... const fallbackTrace: ChatTrace = {...}; chatStore.addAssistantResponse(..., { reply: "Error...", citations: [], ... trace: fallbackTrace }) }` — `catch { fallback }`: synthesizes a fake `trace-err-*` trace and an empty-citations assistant message instead of surfacing a named error state.
- `chat.astro:1341-1343` — `trace.wall_time_ms > 0 ? pct : "0"` (x3) — zero-wall-time division silently defaulted to `"0"`.
- `chat.astro:1354` — `trace.tokens_estimate || 0` — `||` default hides absent token estimate.
- `chat.astro:1355` — `(trace.cost_estimate_usd || 0).toFixed(4)` — same.
- `chat.astro:1519` — `selected.track || "Main"` — `||` default masks missing lane.
- `chat.astro:1526` — `selected.args ? JSON... : "{}"` — missing args defaulted to `"{}"`.
- `chat.astro:1538` — `"Sin datos de retorno"` — missing result defaulted to display string.
- `chat.astro:1543/1546` — `argsEl?.textContent || ""` / `resultEl?.textContent || ""` — `||` defaults on clipboard copy.
- `compliance.astro:209` — `prop.item_a_approx_subjects ?? "Por determinar"` — `??` display default masks absent field.
- `compliance.astro:213` — `prop.item_a_approx_records ?? "Por determinar"` — same.
- `compliance.astro:311` — `item.pack_type || index` — `||` fallback mixes a pack-type string with a numeric index into an element id.
- `compliance.astro:326` — `item.blocked_reason || "UNKNOWN"` — silent default error code.
- `compliance.astro:345` — `item.blocked_reason || "T72_AUTHORITY"` — silent default timer kind.
- `compliance.astro:372` — `item.blocked_reason || "Revisión adversaria superada..."` — silent default justification text.
- `compliance.astro:457` — `btn.getAttribute("data-inc-code") || ""` — `||` default masks missing attribute.
- `compliance.astro:458` — `Number(btn.getAttribute("data-item-idx") || "-1")` — `|| "-1"` sentinel default instead of fail-fast.
- `compliance.astro:489` — `p.dense_score !== null && ... ? ... : "—"` — null-score display default.
- `compliance.astro:493` — `... ? ... : "—"` (bm25_rank) — same.
- `compliance.astro:532` — `Number(el.getAttribute("data-ms") || "0")` — `|| "0"` default masks missing attribute.
- `compliance.astro:553-575` — `try { response = await authenticatedFetch("/api/compliance"); if (response.ok) {...} } catch { // SSE snapshot will hydrate }` — empty `catch` swallows network errors; non-`ok` responses also silently ignored (no `else`/throw), deferring to speculative SSE hydration.
- `compliance.astro:619-623` — `ragContainer.textContent?.includes("Esperando eventos")` branch — placeholder-string sniffing to decide `innerHTML =` vs `insertAdjacentHTML`; speculative content-based control flow.
- `incidents/index.astro:266-268` — `(searchInput?.value || "")`, `filterStatus?.value || "ALL"`, `filterSeverity?.value || "ALL"` — `||` defaults mask missing filter nodes.
- `incidents/index.astro:407-419` — `try { ... if (response.ok) {...} } catch { // SSE snapshot will hydrate }` — empty catch + ignored non-`ok`; speculative SSE-hydration fallback chain.
- `incidents/index.astro:411` — `if (allIncidents.length === 0 && Array.isArray(data.incidents))` — silently refuses to hydrate when local array is non-empty, no staleness signal.
- `incidents/index.astro:442-456` — refresh handler `try { fetch; if ok render } catch { const snap = ...; if (snap) render }` — `catch { fallback }` to SSE snapshot; non-`ok` refresh silently keeps stale table.
- `incidents/index.astro:427` — `complianceBtn.onclick = () => { window.location.href = "/compliance"; }` — unconditional navigation fallback regardless of selected incident.
- `new.astro:1118-1119` — `initialData?.action_date || new Date().toISOString().slice(0, 10)` — `||` default masks missing date.
- `new.astro:1139/1147/1151` — `initialData?.responsible || ""`, `initialData?.description || ""`, `initialData?.evidence || ""` — `|| ""` defaults mask absent fields.
- `new.astro:1210-1212` — `(el as HTMLInputElement).name || (el.id ? el.id.replace(...) : "")` — `||` chain guessing the field name.
- `new.astro:1234` — `e.detail?.mutation` + `if (mutation)` — event without mutation silently ignored (no fail-fast).
- `new.astro:1284-1285` — `"No se pudo obtener la explicación del campo."` — fetch-failure display fallback, status discarded.
- `new.astro:1293` — `${opt.description ? ... : ""}` — missing option description silently omitted.
- `new.astro:1299` — `modalExplainContent.textContent = data.explanation;` — no validation; `undefined` explanation silently rendered.
- `new.astro:1307` — `c.text.slice(0, 150)` — long citation silently truncated with `"..."` fallback.
- `new.astro:1312-1315` — `catch (e) { ... "Error al conectar con el servicio de explicación." }` — `catch { fallback text }`, original error discarded.
- `new.astro:1344-1350` — `body[key] = value === "true"`, `value ? Number(value) : null`, `body[key] = value || null` — silent type-coercion defaults; empty string becomes `null` instead of a validation error.
- `new.astro:1353-1355` — `if (!body.affected_cid) body.affected_cid = [];` (x3) — silent empty-array defaults instead of required-field errors.
- `new.astro:1374-1378` — `typeEl?.value || "C"`, `respEl?.value.trim() || "operador"`, `dateEl?.value || new Date()...`, `evidEl?.value.trim() || null` — `||` defaults fabricate action metadata.
- `new.astro:1394` — `errorData.message || errorData.error` — `||` chain masks absent error shape; both-absent yields `undefined` alert text.
- `new.astro:1395-1400` — `if (errorData.details && Array.isArray(...)) errorMsg += ...` — non-array `details` silently ignored.
- `new.astro:1417-1420` — `catch (err) { alert("Error de red..."); reset button }` — `catch { generic alert }`, original error discarded.
- `security-log.astro:153` — `eventStore.getEvents().slice().reverse()` — reverses full history as the render order fallback instead of querying in order.
- `security-log.astro:154-159` — `if (evt.type === "tool:mutation") ... else if (evt.type === "role:transition")` with no `else` — unknown stored event types silently skipped (catch-all drop).
- `security-log.astro:178` — `m.duration_ms || 0` — `||` default masks missing duration.
- `security-log.astro:179` — `Math.round(totalDuration / mutations.length)` — no zero-guard branch; reached only because `addMutation` always pushes first (implicit invariant, division-by-zero hidden).
- `security-log.astro:182-183` — `m.status >= 200 && m.status < 400`, `(successCount / mutations.length) * 100` — non-numeric `status` silently counted as failure.
- `security-log.astro:207` — `${m.incident_code || "—"}` — `||` display default.
- `security-log.astro:218` — `${m.idempotency_key ? ...slice(0,16)... : "—"}` — missing key silently dashed.
- `security-log.astro:246` — `${event.previous_role || "none"}` — `||` default masks absent role.

## R3

No violations found.

## R4

Single-use local literals are not reported. Repeated-within-slice literals first, then cross-file candidates for global synthesis.
- Within-slice: `chat.astro:763` + `chat.astro:1153` — `` `/new?session=${encodeURIComponent(activeSessionId)}` `` (same operational route + query param, 2 files-lines in one file).
- Within-slice: `incidents/index.astro:408` + `incidents/index.astro:443` — `"/api/incidents"` (same endpoint string twice in one file).
- Within-slice: `chat.astro:735` (`.slice(0, 8)`) / `chat.astro:989` (`.slice(0, 10)`) / `compliance.astro:481` (`.slice(0, 12)`) / `security-log.astro:218` (`.slice(0, 16)`) / `new.astro:1307` (`.slice(0, 150)`) — repeated ad-hoc `chunk_sha256`/text truncation widths; magic truncation lengths with no shared constant.
- Within-slice: `chat.astro:1336-1339` (`/ 1000).toFixed(2)` x4), `chat.astro:1396-1397`, `chat.astro:1521-1522` — repeated ms→s scaling (`/ 1000`) + `toFixed(2/1/3)` formatting literals.
- Within-slice: `new.astro:1119` + `new.astro:1376` — `new Date().toISOString().slice(0, 10)` (same today-date expression twice).
- Cross-file candidates (literal + file:line each):
  - `"astro:page-load"` — `chat.astro:1662`, `compliance.astro:578`, `incidents/index.astro:462`, `new.astro:1261`, `security-log.astro:163`.
  - `"cockpit:snapshot"` — `chat.astro:1665`, `compliance.astro:584`, `incidents/index.astro:468`.
  - `"cockpit:agent-event"` — `compliance.astro:595`, `incidents/index.astro:475`, `security-log.astro:255`.
  - `"/api/incidents"` — `incidents/index.astro:408`, `incidents/index.astro:443`, `new.astro:1387`.
  - `"change_incident"` — `compliance.astro:102`, `incidents/index.astro:396`.
  - `"view_securitylog"` — `security-log.astro:25`, `security-log.astro:143`.
  - `"/new?session="` route prefix — `chat.astro:763`, `chat.astro:1153`.
  - `"/compliance"` — `incidents/index.astro:428` (only other refs are component imports, not route strings; single route use noted for synthesis).
  - `"/incidents"` — `new.astro:1416` (single route use noted for synthesis).
  - `"es-PE"` / `"es-ES"` locale tags — `compliance.astro:148` (`"es-PE"`), `chat.astro:807` (`"es-ES"`); divergent literals for the same operational concern (locale).
  - `12 * 3600 * 1000` (12h warning threshold) — `compliance.astro:168` (only literal occurrence in slice; candidate for shared threshold constant).
  - `1000` tick interval — `compliance.astro:539` (`setInterval(..., 1000)`), `compliance.astro:534` (`ms - 1000`); same-file pair plus chat ms-scaling `1000`s above.
  - `200` slow-span threshold — `chat.astro:1396` (`span.duration_ms > 200`); single occurrence in slice, candidate.
  - `100` mutation cap — `security-log.astro:168` (`mutations.length > 100`); single occurrence in slice, candidate.
  - `maxlength="1000"` — `new.astro:539`; single occurrence in slice, candidate.

## R5

No violations found. (`http://www.w3.org/2000/svg` at `chat.astro:1437/1446` is an SVG namespace URI, not a file path. No `~/`, `/home/`, `/tmp`, `file:///`, `C:\`, workspace-escaping `../..`, or hardcoded absolute paths in any of the 5 files; `localStorage`/store access goes through `chat-store`/`form-draft-bus` wrappers.)

## R6

- `chat.astro:1629-1636` — hand-rolled `escapeHtml` (5x `.replace`) instead of the ecosystem HTML-escaping utility (e.g. the shared `escapeHtml`/`he`/`hast` helper or Astro's built-in expression escaping; the file already escapes via `{...}` in markup but re-implements it for injected HTML strings).
- `chat.astro:807` — `new Date(s.updatedAt).toLocaleDateString("es-ES", {...})` — hand-rolled date formatting while `incidents/index.astro` uses the shared `formatDateTime` from `@pims/cockpit/ui/lib/utils.ts`; should reuse the shared formatter (also note `compliance.astro:148` `toLocaleString("es-PE")` and `security-log.astro:206` `toLocaleTimeString()` — three ad-hoc date/time formatters instead of one shared util).
- `chat.astro:1336-1355` — hand-rolled ms→s division + `toFixed` percent math inline (wall/model/tool/idle) instead of a shared duration/percent formatter (cf. `formatRemainingTime` already imported in `compliance.astro`).
- `chat.astro:1465-1474` — hand-rolled span-type→lane/color `if/else` map (duplicated again at `chat.astro:1382-1388` `typeColors`) instead of a shared lookup table/constant.
- `chat.astro:1576-1584` — hand-rolled active-tab class toggling via full `className` string reassignment instead of `classList.toggle/add/remove` or a shared tab-state helper.
- `compliance.astro:529-539` — hand-rolled `setInterval` countdown ticker that mutates `data-ms` attributes and re-renders text every second instead of the framework/SSE `scheduler:timer_tick` event stream already consumed at `compliance.astro:597` (duplicate time sources).
- `compliance.astro:520-524` + `618-623` — hand-rolled "placeholder sniffing" (`textContent?.includes("Esperando eventos")`) to choose replace-vs-prepend instead of an explicit container-state flag.
- `security-log.astro:178-183` — hand-rolled `reduce` sum + `Math.round` average + success-rate percent inline instead of shared telemetry/aggregate helpers (cf. `renderAggregatesTable` in `chat.astro:1550`, which hand-rolls the same table math a second time).
- `new.astro:1336-1351` — hand-rolled `FormData.forEach` multi-value accumulation (`if (!body[key]) body[key] = []`) + boolean/number coercion instead of a schema-driven form parser/validator (e.g. `zod` form schema, the established validation dependency).
- `new.astro:1395-1400` — hand-rolled `errorData.details.map((d) => ... d.path.join("."))` error flattening instead of the shared API-error formatter.
- `new.astro:1306-1309` — hand-rolled citation HTML string concatenation loop instead of reusing the shared `RagCitation` component already used by `compliance.astro:5`.

## Summary

| Rule | chat.astro | compliance.astro | incidents/index.astro | new.astro | security-log.astro | Total |
|------|-----------|------------------|----------------------|-----------|-------------------|-------|
| R1 | 13 | 9 | 6 | 12 | 5 | 45 |
| R2 | 19 | 13 | 7 | 22 | 9 | 70 |
| R3 | 0 | 0 | 0 | 0 | 0 | 0 |
| R4 | 4 within + candidates | 1 within + candidates | 1 within + candidates | 1 within + candidates | 1 within + candidates | 8 within-slice + 13 candidate groups |
| R5 | 0 | 0 | 0 | 0 | 0 | 0 |
| R6 | 5 | 2 | 0 | 3 | 1 | 11 |
| **Total** | **41** | **25** | **14** | **38** | **15** | **133** |
