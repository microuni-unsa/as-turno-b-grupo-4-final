# Slice 09 cockpit-config-lib — Quality Audit

Audited files (line counts) — date 2026-11-05:
- `packages/cockpit/astro.config.mjs` — 39 lines
- `packages/cockpit/src/ui/lib/api.ts` — 185 lines
- `packages/cockpit/src/ui/lib/utils.ts` — 118 lines

## R1

No violations found.

All `if` branches explicitly manage state or raise: `api.ts` session-null and 401 branches both call `notifySessionExpired` **and** `throw new SessionExpiredError` (not log-only); every `if (!response.ok)` branch throws. All six `switch` statements (`utils.ts` lines 43, 57, 72, 88, 105) have explicit `default` branches that return a value. No silent `pass`/noop, no empty branches, no missing `else` leaving state implicit.

## R2

- `packages/cockpit/src/ui/lib/api.ts:78` — `(await response.json().catch(() => ({})))` — speculative catch-all swallowing parse errors + silent `{}` default hiding absent/error state.
- `packages/cockpit/src/ui/lib/api.ts:82` — `errorJson.message ?? \`Error de inicio de sesión (${response.status})\`` — `?? default` hiding absent `message` instead of fail-fast with a named error.
- `packages/cockpit/src/ui/lib/api.ts:101` — `(await response.json().catch(() => ({})))` — same catch-all + silent `{}` default (approveIncident).
- `packages/cockpit/src/ui/lib/api.ts:105` — `err.message ?? \`Error al aprobar incidente (${response.status})\`` — `?? default` hiding absent state.
- `packages/cockpit/src/ui/lib/api.ts:126` — `(await response.json().catch(() => ({})))` — same catch-all + silent `{}` default (requestRevision).
- `packages/cockpit/src/ui/lib/api.ts:130` — `err.message ?? \`Error al solicitar revisión (${response.status})\`` — `?? default` hiding absent state.
- `packages/cockpit/src/ui/lib/api.ts:151` — `(await response.json().catch(() => ({})))` — same catch-all + silent `{}` default (attestExemption).
- `packages/cockpit/src/ui/lib/api.ts:155` — `err.message ?? \`Error al atestiguar exención (${response.status})\`` — `?? default` hiding absent state.
- `packages/cockpit/src/ui/lib/api.ts:179` — `(await response.json().catch(() => ({})))` — same catch-all + silent `{}` default (sendChat).
- `packages/cockpit/src/ui/lib/api.ts:182` — `err.message ?? \`Error en el chat (${response.status})\`` — `?? default` hiding absent state.
- `packages/cockpit/src/ui/lib/utils.ts:21` — `return "—";` (null/undefined/empty `iso` input) — silent placeholder default instead of fail-fast with a named error.
- `packages/cockpit/src/ui/lib/utils.ts:34-35` — `} catch { return iso; }` — bare `catch` swallowing the parse/format error and echoing the input as a fallback instead of raising a named error.
- `packages/cockpit/src/ui/lib/utils.ts:50` — `return status;` (getStatusLabel `default`) — echoing unknown input as its own label instead of fail-fast with a named error.
- `packages/cockpit/src/ui/lib/utils.ts:65` — `return "bg-slate-800 text-slate-300 border-slate-700";` (getStatusBadgeClasses `default`) — silent default styling for unknown status instead of fail-fast.
- `packages/cockpit/src/ui/lib/utils.ts:82` — `return "No asignada";` (getSeverityLabel `default`) — silent default hiding unknown/absent severity instead of fail-fast.
- `packages/cockpit/src/ui/lib/utils.ts:99` — `return "bg-slate-850 text-slate-400 border-slate-800";` (getSeverityBadgeClasses `default`) — silent default styling for unknown severity instead of fail-fast.
- `packages/cockpit/src/ui/lib/utils.ts:116` — `return "No asignado";` (getImpactLabel `default`) — silent default hiding unknown/absent impact instead of fail-fast.

## R3

No violations found.

No backwards-compat shims, polyfills, legacy wrappers, deprecated-API support, version sniffing, or `for backwards compat` paths in any of the three files. `fileURLToPath(new URL(...))` in `astro.config.mjs:33-34` is current native ESM practice, not a legacy path shim.

## R4

Within-slice repeats (each violates — must live in a shared constant/config):
- `packages/cockpit/astro.config.mjs:16,22,26` — `"http://localhost:3000"` hardcoded 3× (one per proxy entry `/api`, `/healthz`, `/readyz`).
- `packages/cockpit/src/ui/lib/api.ts:56,73,96,120,145,174` — `"application/json"` hardcoded 6× (1× `Accept` + 5× `Content-Type`).
- `packages/cockpit/src/ui/lib/api.ts:73,96,120,145,174` — `"Content-Type"` header-name literal hardcoded 5×.
- `packages/cockpit/src/ui/lib/api.ts:78,101,126,151,179` — `.catch(() => ({}))` empty-object default literal hardcoded 5×.
- `packages/cockpit/src/ui/lib/utils.ts:65,91` — `"bg-slate-800 text-slate-300 border-slate-700"` badge-class literal hardcoded 2× (status default + severity `"B"` case).

Cross-file literal candidates (value + file:line each; other file outside slice):
- `"application/json"` — `packages/cockpit/src/ui/lib/api.ts:56,73,96,120,145,174` + `packages/cockpit/src/ui/components/FloatingChatWidget.astro:745`.
- `"es-PE"` — `packages/cockpit/src/ui/lib/utils.ts:25` + `packages/cockpit/src/ui/components/FloatingChatWidget.astro:466` + `packages/cockpit/src/ui/lib/speech-recognition.ts:96`.
- `"bg-slate-800 text-slate-300 border-slate-700"` — `packages/cockpit/src/ui/lib/utils.ts:65,91` + `packages/cockpit/src/ui/components/FloatingChatWidget.astro:311`.
- `"http://localhost:3000"` — `packages/cockpit/astro.config.mjs:16,22,26` (no second file observed in slice-adjacent grep; candidate for global synthesis to confirm backend port constant sharing).

Single-use local literals (NOT reported per contract): `"./src/ui"`, `"./dist/client"`, `"/api"`, `"/healthz"`, `"/readyz"`, port `4321`, `timeout: 0`, `"00:00:00 (Vencido)"`, `"2-digit"`, `"numeric"`, per-endpoint URL templates (each used once), per-case label/badge strings (each used once except as listed above).

## R5

No violations found.

No machine-dependent paths (`~/`, `/home/`, `/tmp`, `file:///`, `C:\`), no `../..` escaping the workspace, no hardcoded absolute paths. `astro.config.mjs` paths (`./src/ui`, `./dist/client`, `./src`, `../types/src`) are all project-root-relative (the `../types/src` alias stays inside the monorepo workspace). No file ops with absolute paths in `api.ts`/`utils.ts` (network + string formatting only).

## R6

No violations found.

No hand-rolled utils where a framework/stdlib/ecosystem solution exists: `fetch`/`Headers` are native; `String(n).padStart(2, "0")` and `Date.prototype.toLocaleString("es-PE", {...})` already use the native APIs (manual hours/min/sec decomposition is duration math, for which `Intl` provides no duration formatter); `switch`-based label/badge maps are plain lookups, not custom algorithms (no custom retry/glob/deep-equal/date-math/slugify/validation to replace with an ecosystem alternative).

## Summary

| Rule | Violations |
|------|-----------|
| R1 Exhaustive Branching | 0 |
| R2 Zero Fallbacks | 17 |
| R3 No Unrequested Legacy Support | 0 |
| R4 Repeated Cross-File Literals | 5 within-slice groups (16 occurrences) + 4 cross-file candidates |
| R5 Strict Path Discipline | 0 |
| R6 Native & Ecosystem Solutions | 0 |
| **Total** | **17 + R4 groups above** |
