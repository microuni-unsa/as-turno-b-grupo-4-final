# Slice 14 cockpit-shell-pages — Quality Audit

Audited files (line counts), date 2026-11-05:

- `packages/cockpit/src/ui/layouts/AppLayout.astro` — 48 lines
- `packages/cockpit/src/ui/layouts/BaseLayout.astro` — 29 lines
- `packages/cockpit/src/ui/pages/login.astro` — 153 lines
- `packages/cockpit/src/ui/pages/index.astro` — 23 lines

Scope: every line of frontmatter + markup + inline script in the 4 target files, checked against R1–R6. Read-only on sources; this report is the only file created.

## R1

- `packages/cockpit/src/ui/pages/login.astro:107` — `if (noticeEl) {` — no `else`; when `?expired=1` is set but `#login-notice` is absent, the expired-session notice is silently dropped with no error or control-flow effect (missing `else` where state is left implicit).
- `packages/cockpit/src/ui/pages/login.astro:111` — `} else if (getSession()) {` — the `if / else if` chain at lines 105–114 has no final `else`; the fresh-visitor path is handled only by implicit fallthrough to the form-wiring code below, not by an explicit `else` block (missing `else` where state is left implicit).
- `packages/cockpit/src/ui/pages/login.astro:120` — `if (form) {` — no `else`; when `#form-login` is absent, `initLoginPage` silently no-ops and no dedicated error is raised (missing `else` where state is left implicit).
- `packages/cockpit/src/ui/pages/login.astro:123` — `if (errorEl) errorEl.classList.add("hidden");` — no `else`; absent `#login-error` leaves prior error state implicit with no handling.
- `packages/cockpit/src/ui/pages/login.astro:124` — `if (submitBtn) {` — no `else`; absent `#btn-submit` skips the authenticating-state transition silently.
- `packages/cockpit/src/ui/pages/login.astro:137` — `if (errorEl) {` (inside `catch`) — no `else`; when the element is absent the authentication failure has zero control-flow effect — a branch that does nothing but skip (silent `pass`/noop on the error path).
- `packages/cockpit/src/ui/pages/login.astro:142` — `if (submitBtn) {` (inside `finally`) — no `else`; absent button leaves the disabled-button state implicit.

`AppLayout.astro:38` (`if (!session) { …; return; }`, authenticated path continues at lines 42–43) and `index.astro:18–22` (`if (session) … else …`, both branches redirect) were examined and are exhaustive — not listed. `BaseLayout.astro` contains no branching.

## R2

- `packages/cockpit/src/ui/layouts/BaseLayout.astro:8` — `const { title = "Glass-Box Cockpit | UNSA GESTITEL" } = Astro.props;` — destructuring silent default hides the absent-`title` state instead of fail-fast with a named/required contract (`?? default` / `|| default` clause: defaulting instead of fail-fast).
- `packages/cockpit/src/ui/pages/login.astro:129` — `?.value || "").trim();` — `|| ""` hides the absent-`#username`-element state with a silent default instead of raising a named error.
- `packages/cockpit/src/ui/pages/login.astro:130` — `(document.getElementById("password") as … | null)?.value || "";` — same `|| default` hiding the absent-`#password`-element state.
- `packages/cockpit/src/ui/pages/login.astro:138` — `err instanceof Error ? err.message : "Error al autenticar con el servidor PIMS.";` — catch-block fallback string defaults any non-`Error` throwable to a generic message instead of fail-fast with a named error (defaulting instead of fail-fast with a named error).

The `try/catch` at `login.astro:132–140` itself surfaces the failure into `#login-error` (affects control flow, not silent swallowing) and is not listed beyond the two findings above. `AppLayout.astro` and `index.astro` contain no fallback/default operators.

## R3

No violations found.

## R4

Within-slice repeats (each value hardcoded in 2+ files of this slice; must live in a shared constant/config):

- `"/incidents"` — `packages/cockpit/src/ui/pages/login.astro:112` (`window.location.href = "/incidents";`), `packages/cockpit/src/ui/pages/login.astro:135` (same), `packages/cockpit/src/ui/pages/index.astro:19` (same) — route path-prefix literal in 2 files / 3 sites.
- `"/login"` — `packages/cockpit/src/ui/layouts/AppLayout.astro:39` (`window.location.href = "/login";`), `packages/cockpit/src/ui/pages/index.astro:21` (same) — route path literal in 2 files.
- `"astro:page-load"` — `packages/cockpit/src/ui/layouts/AppLayout.astro:46` (`document.addEventListener("astro:page-load", …)`), `packages/cockpit/src/ui/pages/login.astro:151` (same) — framework event-name magic string in 2 files (idiomatic Astro usage; still a shared-literal candidate).
- `"Glass-Box Cockpit"` brand-title fragment — `packages/cockpit/src/ui/layouts/BaseLayout.astro:8` (`"Glass-Box Cockpit | UNSA GESTITEL"`), `packages/cockpit/src/ui/pages/login.astro:6` (`"Iniciar Sesión | Glass-Box Cockpit UNSA"`), `packages/cockpit/src/ui/pages/index.astro:5` (`"Redireccionando... | Glass-Box Cockpit"`) — brand magic string in 3 files.
- `"@pims/cockpit/ui/lib/session.ts"` import specifier — `packages/cockpit/src/ui/layouts/AppLayout.astro:33`, `packages/cockpit/src/ui/pages/login.astro:100`, `packages/cockpit/src/ui/pages/index.astro:15` — module-specifier literal in 3 files (required to repeat by module-system design; listed as candidate per contract).

Cross-file-literal candidates for global synthesis (literal value + file:line each; other file outside this slice):

- `"/incidents"`: `packages/cockpit/src/ui/components/Sidebar.astro:19`, `packages/cockpit/src/ui/components/Sidebar.astro:54`, `packages/cockpit/src/ui/components/Header.astro:102`, `packages/cockpit/src/ui/pages/new.astro:24`, `packages/cockpit/src/ui/pages/new.astro:1004`, `packages/cockpit/src/ui/pages/new.astro:1416`, `packages/cockpit/src/ui/pages/security-log.astro:29`.
- `"/login"` (+ `"expired"` / `"1"` pair): `packages/cockpit/src/ui/components/Sidebar.astro:192`, `packages/cockpit/src/ui/components/SessionExpiredModal.astro:55` (`"/login?expired=1"`), `packages/cockpit/src/ui/lib/api.ts:70` (`"/api/login"`); query-param side: `packages/cockpit/src/ui/pages/login.astro:105` (`urlParams.get("expired") === "1"`).
- `"astro:page-load"`: `packages/cockpit/src/ui/components/Sidebar.astro:197`, `packages/cockpit/src/ui/components/Header.astro:109`, `packages/cockpit/src/ui/components/FloatingChatWidget.astro:856`, `packages/cockpit/src/ui/pages/chat.astro:1662`, `packages/cockpit/src/ui/pages/compliance.astro:578`, `packages/cockpit/src/ui/pages/new.astro:1261`, `packages/cockpit/src/ui/pages/security-log.astro:163`, `packages/cockpit/src/ui/pages/incidents/index.astro:462`.
- `"cockpit:session-expired"` (related session literal just outside slice, pairs with the `expired` flow): `packages/cockpit/src/ui/lib/session.ts:10`, `packages/cockpit/src/ui/lib/sse-client.ts:27`, `packages/cockpit/src/ui/components/SessionExpiredModal.astro:49`.

Single-use local literals (element IDs `form-login`, `login-error`, `login-notice`, `username`, `password`, `btn-submit`; button copy `"Autenticando..."`, `"Acceder a la Consola"`; `transition:persist` names) occur only within one file and are OK — not reported. Tailwind styling classes (e.g. `bg-slate-950`) repeat but are presentation tokens, not operational literals — excluded.

## R5

No violations found.

Checked and clear: no `~/`, `/home/`, hardcoded `/tmp/...`, `file:///`, `C:\`, or `../..`-escaping-workspace strings in any of the 4 files. All navigation targets are project-root-relative (`/login`, `/incidents`). The `https://fonts.googleapis.com` / `https://fonts.gstatic.com` links in `BaseLayout.astro:18–21` are external network resources, not file-system paths. The stylesheet href `/src/ui/styles/starwind.css` (`BaseLayout.astro:24`) is project-root-relative. (Stdlib-tempdir exception not applicable — no tempdir usage.)

## R6

No violations found.

Checked and clear: no hand-rolled retry, glob, deep-equal, date-math, slugify, or validation utilities in the 4 files. `URLSearchParams` (`login.astro:103`) is itself the native API; `ClientRouter` (`BaseLayout.astro:2,17`) is the ecosystem solution for view transitions; `getElementById` value reads (`login.astro:116–130`) use native DOM APIs rather than a custom abstraction (a `FormData`-based alternative exists but the current code introduces no custom util to replace). Named from knowledge; no external lookup performed.

## Summary

| Rule | Violations |
| ---- | ---------: |
| R1 Exhaustive Branching & Explicit State Handling | 7 |
| R2 Zero Fallbacks & Deterministic Control Flow | 4 |
| R3 No Unrequested Legacy Support | 0 |
| R4 No Repeated Cross-File Literals | 5 groups (9 cross-file candidate sites listed) |
| R5 Strict Path Discipline | 0 |
| R6 Prioritize Native & Ecosystem Solutions | 0 |
| **Total** | **16** |

All findings are in `packages/cockpit/src/ui/pages/login.astro` (R1: 7, R2: 3) and `packages/cockpit/src/ui/layouts/BaseLayout.astro` (R2: 1), plus shared-literal groups (R4) spanning `AppLayout.astro`, `BaseLayout.astro`, `login.astro`, and `index.astro`. `index.astro` has no R1/R2/R3/R5/R6 violations; its R4 route/event literals are recorded above.
