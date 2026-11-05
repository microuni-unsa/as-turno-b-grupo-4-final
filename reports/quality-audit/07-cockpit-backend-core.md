# Slice 07 cockpit-backend-core — Quality Audit

Audited files (line counts via read):
- `packages/cockpit/src/app.ts` — 694 lines
- `packages/cockpit/src/auth.ts` — 246 lines
- `packages/cockpit/src/event-hub.ts` — 138 lines
- `packages/cockpit/src/server.ts` — 226 lines

Date: 2026-11-05. Read-only audit; no source edits.

## R1
No violations found.

## R2
- `packages/cockpit/src/app.ts:187` — `const clock = deps.clock ?? (() => new Date());` — `?? default` hides absent `clock` instead of fail-fast with a named error.
- `packages/cockpit/src/app.ts:188` — `const hub = deps.hub ?? new CockpitEventHub(deps.events);` — `?? default` silently substitutes a hub instead of fail-fast.
- `packages/cockpit/src/app.ts:203` — `await c.req.json().catch(() => ({}))` — `catch { fallback }` swallows body-parse errors with empty-object default.
- `packages/cockpit/src/app.ts:261` — `await c.req.json().catch(() => ({}))` — same `catch { fallback }` swallow.
- `packages/cockpit/src/app.ts:280` — `await c.req.json().catch(() => ({}))` — same.
- `packages/cockpit/src/app.ts:295` — `await c.req.json().catch(() => ({}))` — same.
- `packages/cockpit/src/app.ts:303` — `description: request.description ?? undefined,` — `?? default` converts absent optional to `undefined` instead of explicit absent-state handling.
- `packages/cockpit/src/app.ts:305` — `incident_time: request.incident_time ?? undefined,` — same clause.
- `packages/cockpit/src/app.ts:306` — `detection_date: request.detection_date ?? undefined,` — same.
- `packages/cockpit/src/app.ts:306` — `detection_time: request.detection_time ?? undefined,` — same (line 306 second field).
- `packages/cockpit/src/app.ts:311` — `num_affected_subjects: request.num_affected_subjects ?? undefined,` — same.
- `packages/cockpit/src/app.ts:312` — `compromised_system: request.compromised_system ?? undefined,` — same.
- `packages/cockpit/src/app.ts:313` — `affected_url: request.affected_url ?? undefined,` — same.
- `packages/cockpit/src/app.ts:314` — `status: request.status ?? undefined,` — same.
- `packages/cockpit/src/app.ts:315` — `severity: request.severity ?? undefined,` — same.
- `packages/cockpit/src/app.ts:316` — `impact: request.impact ?? undefined,` — same.
- `packages/cockpit/src/app.ts:317` — `reported_by: request.reported_by ?? undefined,` — same.
- `packages/cockpit/src/app.ts:318` — `assigned_to: request.assigned_to ?? undefined,` — same.
- `packages/cockpit/src/app.ts:319` — `affected_treatment: request.affected_treatment ?? undefined,` — same.
- `packages/cockpit/src/app.ts:320` — `evidence_refs: request.evidence_refs ?? undefined,` — same.
- `packages/cockpit/src/app.ts:321` — `measure_updated_registry: request.measure_updated_registry ?? undefined,` — same.
- `packages/cockpit/src/app.ts:322` — `measure_new_security: request.measure_new_security ?? undefined,` — same.
- `packages/cockpit/src/app.ts:323` — `measure_improved_policies: request.measure_improved_policies ?? undefined,` — same.
- `packages/cockpit/src/app.ts:324-325` — `request.measure_considered_resolved ?? undefined,` — same.
- `packages/cockpit/src/app.ts:326-327` — `request.measure_reported_authorities ?? undefined,` — same.
- `packages/cockpit/src/app.ts:328` — `resolved_date: request.resolved_date ?? undefined,` — same.
- `packages/cockpit/src/app.ts:329` — `actions: request.actions.length > 0 ? request.actions : undefined,` — silent empty-to-absent default instead of explicit empty-state handling.
- `packages/cockpit/src/app.ts:331` — `request.rep_document_number || request.rep_first_name` — `|| default` chain deciding reporter presence, absent state collapsed to `undefined` below.
- `packages/cockpit/src/app.ts:333-340` — `document_number: request.rep_document_number ?? undefined,` (+ 7 following `?? undefined` fields through line 340) — `?? default` per optional reporter field.
- `packages/cockpit/src/app.ts:344` — `request.entity_ruc || request.entity_name` — `|| default` presence chain as above.
- `packages/cockpit/src/app.ts:346-353` — `request.entity_ruc ?? undefined,` et al. (ruc/name/phone/extension/department/province/district) — `?? default` per field.
- `packages/cockpit/src/app.ts:357` — `request.dpo_contact_email || request.dpo_contact_name` — `|| default` presence chain.
- `packages/cockpit/src/app.ts:359-361` — `request.dpo_contact_name ?? undefined,` et al. — `?? default` per field.
- `packages/cockpit/src/app.ts:373` — `marker: isDedupe ? "DEDUPE_MERGED:cockpit_guided" : undefined,` — absent marker defaulted to `undefined` silently.
- `packages/cockpit/src/app.ts:385` — `deps.store.listRecentRagRetrievals(15).catch(() => [])` — `catch { fallback }` swallows store errors with empty-list default.
- `packages/cockpit/src/app.ts:402` — `deps.store.getRootCause(incident.incident_code).catch(() => null)` — `catch { fallback }` swallows error with `null` default.
- `packages/cockpit/src/app.ts:434-436` — `.catch((err) => { console.error("SSE_WRITE_FAILED:", err); })` — `try/except`-style swallow: logs without affecting control flow or surfacing a named error.
- `packages/cockpit/src/app.ts:470-477` — `} catch (error) { console.error("BUILD_SNAPSHOT_FATAL_ERROR:", error); snapshot = { incidents: [], ... }; }` — `catch { fallback }` with empty snapshot default.
- `packages/cockpit/src/app.ts:517` — `await c.req.json().catch(() => ({}))` — `catch { fallback }` as above.
- `packages/cockpit/src/app.ts:545` — `await c.req.json().catch(() => ({}))` — same.
- `packages/cockpit/src/app.ts:609` — `await c.req.json().catch(() => ({}))` — same.
- `packages/cockpit/src/app.ts:637-642` — `try { await deps.store.sql`SELECT 1`; database = true; } catch { database = false; }` — swallow with boolean default (plus identical PIMS `644-648` and presidio `649-653` blocks) — speculative catch-all hiding absent/failing state instead of named error.
- `packages/cockpit/src/app.ts:687` — `details: error instanceof ZodError ? error.issues : undefined,` — ternary default collapses absent details to `undefined`.
- `packages/cockpit/src/auth.ts:62-63` — `if (raw === null || raw === undefined || raw.trim() === "") { return "Operador"; }` — defaults missing/blank role to `"Operador"` instead of fail-fast with a named error.
- `packages/cockpit/src/auth.ts:202` — `platform_role: login.user.platform_role ?? null,` — `?? default` hides absent role.
- `packages/cockpit/src/auth.ts:207` — `platform_role: profile.platform_role ?? null,` — same.
- `packages/cockpit/src/auth.ts:209` — `const loginRawRole = login.user.platform_role ?? null;` — same.
- `packages/cockpit/src/auth.ts:210` — `const profileRawRole = profile.platform_role ?? null;` — same.
- `packages/cockpit/src/auth.ts:227-232` — `nativeRole === "Editor" ? "dpo" : nativeRole === "Lector" ? "auditor" : "executive";` — chained ternary with speculative `"executive"` catch-all default instead of explicit mapping/fail-fast.
- `packages/cockpit/src/event-hub.ts:100-104` — `try { incidents = await listAllIncidents(adapter); } catch (error) { console.error("BUILD_SNAPSHOT_INCIDENTS_ERROR:", error); }` — `catch { fallback }`: keeps `[]` default, logs without affecting control flow.
- `packages/cockpit/src/event-hub.ts:107-111` — `try { timers = await getRegulatoryTimers(store, clock); } catch ...` — same empty-default swallow.
- `packages/cockpit/src/event-hub.ts:113-123` — `try { pendingDecisions = await checkPendingDecisions(...); } catch ...` — same.
- `packages/cockpit/src/event-hub.ts:126-130` — `try { recentRagRetrievals = await store.listRecentRagRetrievals(15); } catch ...` — same.
- `packages/cockpit/src/server.ts:159-161` — `void agent.orchestrator.tick().catch((error: unknown) => { console.error("SCHEDULER_TICK_FAILED", error); });` — swallow: logs without affecting control flow or raising a named error.
- `packages/cockpit/src/server.ts:184-186` — `})().catch((error: unknown) => { console.error("TIMER_TICK_FAILED", error); });` — same swallow.

## R3
No violations found.

## R4
Within-slice repeated operational literals (each used 2+ times inside the 4 target files; single-use locals not reported):
- `"view_incident"` — `packages/cockpit/src/app.ts:253,279,381,395,408(cross-check: 415,608)`, `packages/cockpit/src/event-hub.ts:28` — permission string hardcoded in 2 files; must live in a shared constant/config.
- `"change_incident"` — `packages/cockpit/src/app.ts:260,294,500,515,543` (5× single file) — repeated operational literal; cross-file candidate if the same string appears outside the slice (auth/permissions modules).
- `"Bearer "` — `packages/cockpit/src/app.ts:220` (`startsWith("Bearer ")`), `packages/cockpit/src/app.ts:223` (`slice("Bearer ".length)`) — same-file repeat of auth-scheme prefix; candidate for shared constant.
- `15` (RAG retrieval limit) — `packages/cockpit/src/app.ts:385` (`listRecentRagRetrievals(15)`), `packages/cockpit/src/event-hub.ts:127` (`listRecentRagRetrievals(15)`) — numeric limit hardcoded in 2 files.
- `"subject"` (pack type) — `packages/cockpit/src/app.ts:401,554-557,568`, `packages/cockpit/src/app.ts:400` (`"authority"` sibling) — pack-type strings repeated across routes; cross-file candidates with evidence-store/orchestrator pack-type constants outside slice.
- `"authority"` (pack type) — `packages/cockpit/src/app.ts:400` — single use in slice but paired repeat candidate with `"subject"` above; list for global synthesis.
- `"view_securitylog"` — `packages/cockpit/src/app.ts` (none) vs `packages/cockpit/src/event-hub.ts:33` — single use in slice; cross-file candidate (permission constants likely shared with `auth.ts` derivePermissions `"Seguridad"` mapping at `packages/cockpit/src/auth.ts:98`).
- `1000` (ms/s divisor/multiplier) — `packages/cockpit/src/app.ts:236` (`/ 1000`), `packages/cockpit/src/server.ts:162` (`* 1000`) — same magnitude reused as time-unit conversion in 2 files.
- `({})` empty-object JSON fallback — `packages/cockpit/src/app.ts:203,261,280,295,517,545,609` (7×) — repeated fallback literal (also an R2 violation per site).
Cross-file-literal candidates for global synthesis (literal value + file:line each, other file may be outside slice):
- `"view_incident"` — `packages/cockpit/src/app.ts:253`, `packages/cockpit/src/event-hub.ts:28`
- `15` — `packages/cockpit/src/app.ts:385`, `packages/cockpit/src/event-hub.ts:127`
- `1000` — `packages/cockpit/src/app.ts:236`, `packages/cockpit/src/server.ts:162`
- `"subject"` — `packages/cockpit/src/app.ts:401`, `packages/cockpit/src/app.ts:554`, `packages/cockpit/src/app.ts:568`
- `"Seguridad"` / `"Incidentes"` module names — `packages/cockpit/src/auth.ts:94,95,98` — candidates if PIMS module names repeat in adapter/types outside slice.

## R5
No violations found.

## R6
- `packages/cockpit/src/app.ts:178-184` — `function parseIncidentId(raw: string): number { const id = Number(raw); if (!Number.isInteger(id) || id <= 0) throw ...; return id; }` — hand-rolled route-param validation where the ecosystem alternative already in use (zod, cf. `ChatRequestSchema`/`RevisionRequestSchema` parsing at lines 204,518) provides it (`z.coerce.number().int().positive()`).
- `packages/cockpit/src/auth.ts:19-26` — `normalizeRoleLabel` hand-rolled slugify (NFD-strip + lowercase + `[^a-z0-9]` collapse + trim) where an established slugify/normalization helper or a shared role-normalizer should be used instead of per-module string munging.
- `packages/cockpit/src/auth.ts:155-172` — `decodeJwtClaims` hand-rolls JWT decoding (`split(".")`, `Buffer.from(payload, "base64url")`, `JSON.parse`) where an established JWT library (e.g. `jose` decode/verify) already covers base64url + JSON + structure validation.

## Summary

| Rule | Count |
|------|-------|
| R1 Exhaustive Branching | 0 |
| R2 Zero Fallbacks | 51 |
| R3 No Legacy Support | 0 |
| R4 Repeated Literals | 9 groups listed |
| R5 Path Discipline | 0 |
| R6 Native/Ecosystem | 3 |
| Total | 63 (51 + 9 groups + 3; R2 line-site count treats each `?? undefined` field as one finding) |
