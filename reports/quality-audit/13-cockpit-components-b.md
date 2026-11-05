# Slice 13 cockpit-components-b — Quality Audit

Audited files (date 2026-11-05):

- `packages/cockpit/src/ui/components/SessionExpiredModal.astro` — 58 lines
- `packages/cockpit/src/ui/components/Sidebar.astro` — 199 lines
- `packages/cockpit/src/ui/components/TimerCard.astro` — 107 lines

## R1

- SessionExpiredModal.astro:44 — `if (!modal) return;` — guard clause silently returns with no `else`, no error raised, and no caller-visible signal when the modal element is absent; state left implicit, violates explicit-state-handling clause.
- SessionExpiredModal.astro:43-47 — `function showExpiredModal(reason?: string)` accepts `reason` but never reads it (L50 passes `e.detail?.reason` into a void); the event-supplied state is silently discarded with no branch acting on it.
- SessionExpiredModal.astro:53 — `if (btnLogin) {` with no `else` — if `#btn-re-login` is missing, no listener is attached and no error is raised; failure state left implicit.
- Sidebar.astro:146 — `if (session) {` with no `else` — when `getSession()` returns nullish (expired/cleared session), avatar/name/role-badge keep stale placeholder state (`U` / `Cargando...` / `Operador`) and nav links are never re-filtered; missing `else` leaves UI state implicit.
- Sidebar.astro:151 — `if (avatar) avatar.textContent = ...` — no `else`; missing `#user-avatar` element is a silent noop with no error.
- Sidebar.astro:152 — `if (nameEl) nameEl.textContent = ...` — no `else`; same silent-noop violation.
- Sidebar.astro:153 — `if (roleBadge) roleBadge.textContent = ...` — no `else`; same silent-noop violation.
- Sidebar.astro:180 — `if (icon) icon.className = ...` (inside `if (isActive)` branch) — no `else`; missing `svg` silently skips icon sync.
- Sidebar.astro:184 — `if (icon) icon.className = ...` (inside `else` branch) — no `else`; same silent-noop violation.
- Sidebar.astro:189 — `if (logoutBtn) {` with no `else` — if `#btn-logout` is missing, logout is silently unwired with no error.
- TimerCard.astro:46 — `Vence: {new Date(fireAtUtc).toLocaleString("es-PE")}` — unvalidated date construction; an invalid `fireAtUtc` renders `Invalid Date` with no branch handling the invalid-date state and no dedicated error.
- TimerCard.astro:99 — `if (event.type === "scheduler:timer_tick") {` with no `else` — all other `cockpit:agent-event` types are silently ignored; unhandled event cases with no log/error branch.
- TimerCard.astro:97-98 — `const event = e.detail; if (event.type ...)` — no nullish guard on `e.detail`; a detail-less event throws an unhandled `TypeError` instead of an explicit state check with a dedicated error.
- TimerCard.astro:101 — `if (el) {` with no `else` — timer-tick for an unknown/absent `timer_id` is a silent noop; missing-element state left implicit.

## R2

- SessionExpiredModal.astro:50 — `showExpiredModal(e.detail?.reason)` — `?.` hides absent `detail` state and the callee then ignores the value entirely; absent event payload is defaulted away instead of fail-fast with a named error.
- Sidebar.astro:15 — `const { currentPath = Astro.url.pathname } = Astro.props;` — destructuring default silently substitutes server-rendered pathname when the `currentPath` prop is absent, hiding absent caller state instead of fail-fast with a named error.
- Sidebar.astro:159 — `if (permission && !hasPermission(session, permission)) { ... } else {` — when `data-permission` is absent (`permission` nullish), the `&&` short-circuit falls into `else` and shows the link: fail-open default that hides absent permission state instead of fail-fast with a named error.
- TimerCard.astro:26 — `default: return kind;` — unknown `timerKind` is passed through raw as display text instead of fail-fast with a named error; speculative catch-all default hiding an unhandled state.
- TimerCard.astro:72 — `Number(el.getAttribute("data-remaining-ms") || "0")` — `|| "0"` fallback hides the absent-attribute state; a missing `data-remaining-ms` silently becomes `0` (immediately rendering the expired style) instead of fail-fast with a named error.

## R3

No violations found.

## R4

Within-slice repeats observed (literal + locations):

- Permission magic strings in Sidebar.astro — `"view_incident"` at Sidebar.astro:23, Sidebar.astro:34, Sidebar.astro:46 (3x, same file); `"change_incident"` (Sidebar.astro:28), `"view_securitylog"` (Sidebar.astro:40) are single-use within slice but same family — all are cross-file-literal candidates if permission strings appear elsewhere.
- Active-link class block in Sidebar.astro — `"w-full flex items-center space-x-3 rounded-lg text-sm font-medium transition-all duration-150 px-3 py-2.5 bg-blue-600 text-white shadow-sm shadow-blue-600/30"` (base + active classes) at Sidebar.astro:90-93 (via `class:list`) vs Sidebar.astro:178-179 (via `className` overwrite) vs base portion again at Sidebar.astro:182-183 — same literal class list hardcoded 3x in one file instead of a shared constant.
- Countdown class prefix in TimerCard.astro — `"text-xl font-bold font-mono tracking-tight text-..."` full className strings at TimerCard.astro:81, TimerCard.astro:83, TimerCard.astro:85, TimerCard.astro:87 (4x, differing only in color suffix) instead of a shared constant.
- Millisecond math in TimerCard.astro — `1000` at TimerCard.astro:74 (`- 1000`), TimerCard.astro:82 (`4 * 3600 * 1000`), TimerCard.astro:84 (`12 * 3600 * 1000`), TimerCard.astro:94 (`setInterval(..., 1000)`); `3600 * 1000` hour factor at TimerCard.astro:82 and TimerCard.astro:84; `4`-hour threshold also embedded in display string at TimerCard.astro:20 (`SLA de Revisión Interna DPO (4 Horas)`).

Cross-file-literal candidates for global synthesis (literal value + file:line each; counterpart may live outside this slice):

- `"/login?expired=1"` — SessionExpiredModal.astro:55; vs `"/login"` — Sidebar.astro:192 (same login path prefix, divergent literals).
- `"/incidents"` — Sidebar.astro:18 (nav item) and Sidebar.astro:54 (brand link); candidate if route strings repeat in other files.
- `"view_incident"` — Sidebar.astro:23, Sidebar.astro:34, Sidebar.astro:46; `"change_incident"` — Sidebar.astro:28; `"view_securitylog"` — Sidebar.astro:40 (candidate if permission strings repeat outside this slice).
- `"cockpit:session-expired"` — SessionExpiredModal.astro:49; `"cockpit:agent-event"` — TimerCard.astro:97; `"scheduler:timer_tick"` — TimerCard.astro:99; `"astro:page-load"` — Sidebar.astro:197 (event-name literals; candidates if re-emitted/listened elsewhere).
- `"es-PE"` — TimerCard.astro:46 (locale literal; candidate if repeated elsewhere).
- `"data-remaining-ms"` — TimerCard.astro:72, TimerCard.astro:75, TimerCard.astro:102; `"data-remaining-display"` — TimerCard.astro:70, TimerCard.astro:100 (attribute-name literals repeated; candidates if accessed outside this slice).

## R5

No violations found. (No machine-dependent paths, absolute paths, `../..` escapes, or hardcoded `/tmp/...` strings in any of the 3 files. `data-*` attribute selectors and `@pims/cockpit/ui/lib/...` package imports are project-relative, not filesystem paths.)

## R6

- Sidebar.astro:177-185 — hand-rolled active-state styling via full `link.className = "..."` overwrites (two near-identical literal class strings) instead of the ecosystem mechanism: `link.classList.toggle("bg-blue-600", isActive)` / `classList.toggle` with force parameter, or per-class toggles; wholesale `className` replacement also risks clobbering classes set elsewhere.
- Sidebar.astro:151 — `session.username.charAt(0).toUpperCase()` hand-rolled avatar-initial derivation inline in DOM sync code instead of a shared format helper (e.g. a `getInitials`/`getAvatarLabel` util in the session/ui lib); duplicated ad hoc wherever avatars render.
- TimerCard.astro:69-90 — hand-rolled countdown date math: decrementing a DOM-stored millisecond counter by a fixed `1000` per `setInterval` tick (accumulates drift, throttled timers in background tabs compound it) instead of deriving remaining time natively from the `fireAtUtc` timestamp via `Date.now()` difference on each tick.

## Summary

| Rule | Violations |
| ---- | ---------- |
| R1 Exhaustive Branching & Explicit State Handling | 14 |
| R2 Zero Fallbacks & Deterministic Control Flow | 5 |
| R3 No Unrequested Legacy Support | 0 |
| R4 Repeated Cross-File Literals (within-slice repeats + candidates) | 4 within-slice groups + 6 candidate literals |
| R5 Strict Path Discipline | 0 |
| R6 Native & Ecosystem Solutions | 3 |
| Total | 26 violations + R4 literal groups above |
