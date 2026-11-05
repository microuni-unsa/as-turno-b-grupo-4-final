# Slice 21 pims-mock — Quality Audit

Audited files (line counts), date 2026-11-05:
- `packages/pims-mock/src/db/client.ts` — 24 lines
- `packages/pims-mock/src/db/schema.ts` — 292 lines
- `packages/pims-mock/src/fixtures.ts` — 5 lines
- `packages/pims-mock/src/index.ts` — 4 lines
- `packages/pims-mock/src/server.ts` — 1496 lines

## R1
- `server.ts:446` — `if (inc) { results.push(inc); }` (no `else`) — null row silently dropped with no error/log; state left implicit.
- `server.ts:585` — `const id = Number.parseInt(c.req.param("id"), 10);` (GET incident, also `:718`, `:731`, `:771`, `:807`, `:879`, `:981`) with no `Number.isNaN` guard — unlike `server.ts:1136-1138` audit PATCH which fail-fasts; NaN flows into DB query and surfaces as implicit 404, missing explicit invalid-id error branch.
- `server.ts:1163` — `if (!f) continue;` — sparse/undefined finding silently skipped, no error.
- `server.ts:1176` — `if (findingId && Array.isArray(f.actions)) {` (no `else`) — when insert returns no id or actions absent, action plans silently omitted; no error branch.
- `server.ts:1179` — `if (!a) continue;` — undefined action silently skipped, no error.
- `server.ts:1303` — `if (lastRisks[0]?.risk_code) {` (no `else`) — absent code leaves `nextNum = 1` implicit; no explicit empty-table branch.
- `server.ts:1305` — `if (m?.[1]) {` (no `else`) — regex non-match leaves `nextNum` unchanged silently; unhandled switch/match case.
- `server.ts:1347` — `if (assetId) {` (no `else`) — falsy asset entries silently skipped with no validation error.
- `server.ts:870` — `if (!bytes) { return 404 }` — has explicit branch (not a violation; noted for completeness of `else`-less early returns that do manage state: `:117-119`, `:296`, `:306`, `:365`, `:391`, `:596`, `:602`, `:815`, `:890`, `:945`, `:986`, `:1106`, `:1137`, `:1145`, `:1292`, `:1341`, `:1463` all return/throw explicitly).

## R2
- `server.ts:52` — `issue.path[0] ? String(...) : "detail"` — silent default field name hiding absent path.
- `server.ts:59` — `issue.message || "Valor inválido."` — `||` default hiding absent message.
- `server.ts:82` — `options?.nestedActionMode ?? "replace"` — `??` default instead of fail-fast on absent option.
- `server.ts:83` — `options?.nestedAuditMode ?? "replace"` — same.
- `server.ts:103` — `return rows[0] ?? null` — `??` default.
- `server.ts:168-170` — `parsedEventType.success ? EVENT_TYPE_LABELS[...] : h.event_type` — speculative catch-all: unvalidated event type passed through instead of named error.
- `server.ts:171` — `h.changed_at ? new Date(...).toISOString() : ""` — silent empty-string default.
- `server.ts:216` — `inc.affected_data_types ?? []` — `??` default.
- `server.ts:226` — `inc.security_measures_adopted ?? []` — `??` default.
- `server.ts:228` — `inc.affected_cid ?? []` — `??` default.
- `server.ts:245-247` — `att.uploaded_at ? ...toISOString() : ""` — silent default.
- `server.ts:259` — `inc.deleted_at ? ... : null` — silent null default.
- `server.ts:295` — `await c.req.json().catch(() => ({}))` — swallows JSON parse errors into `{}` (also `server.ts:364`, `server.ts:600`, `server.ts:935`, `server.ts:1066`, `server.ts:1149`, `server.ts:1273` — each independently violates: `try/except` swallowing errors / fallback `{}`).
- `server.ts:334` — `profile?.is_platform_admin ?? false` — `??` default (also `server.ts:348`, `server.ts:349`, `server.ts:350`, `server.ts:404`, `server.ts:405`, `server.ts:407` same pattern).
- `server.ts:333` — `profile?.is_platform_admin ? "Administrador" : null` — silent null default (also `server.ts:409`).
- `server.ts:380` — `client?.name ?? "UNSA"` — `??` default hiding absent tenant row.
- `server.ts:381` — `client?.schema_name ?? "unsa"` — same.
- `server.ts:403` — `user.email ?? "admin@unsa.pe"` — `??` default.
- `server.ts:406` — `profile?.is_platform_admin ?? true` — `??` default (note: defaults to `true`, opposite polarity of `:334`).
- `server.ts:485` — `(countRes[0]?.count ?? 0) + 1` — `??` default (also `server.ts:1075`).
- `server.ts:487` — `body.incident_code || \`INC-...\`` — `||` default code generation instead of fail-fast.
- `server.ts:494-539` — `body.<field> ?? null` / `?? []` mass defaults (`:494-:501`, `:503-509`, `:512-514`, `:517-518`, `:520-539` — each `?? null`/`?? []` hides absent state).
- `server.ts:510` — `Boolean(body.involves_personal_data)` — silent false default.
- `server.ts:568` — `String(act.action_type || "C")` — `||` default.
- `server.ts:569` — `String(act.responsible || "admin")` — `||` default.
- `server.ts:570-572` — `String(act.action_date || now.toISOString().slice(0, 10))` — `||` default.
- `server.ts:573` — `String(act.description || "")` — `||` default.
- `server.ts:574` — `act.evidence ? String(...) : null` — silent null default (also `server.ts:693`, `server.ts:1170`).
- `server.ts:670-671` — `body.deleted_at === null ? null : new Date(...)` — silent coercion default.
- `server.ts:707-709` — `statusChanged ? ... : "Incidente actualizado"` — default description branch.
- `server.ts:761-763` — `parsedEventType.success ? LABELS[...] : h.event_type` — speculative catch-all (history route).
- `server.ts:801` — `a.uploaded_by_name ?? "admin"` — `??` default.
- `server.ts:813` — `await c.req.formData().catch(() => null)` — swallows form-parse errors into `null`.
- `server.ts:959` — `body.is_active !== undefined ? Boolean(...) : true` — silent `true` default.
- `server.ts:1078-1080` — `parsed.data.audit_code || parsed.data.code || \`AUD-...\`` — chained `||` fallback chain for code.
- `server.ts:1090-1095` — `parsed.data.<field> ?? null` series — `??` defaults.
- `server.ts:1182` — `String(a.description || a.action_plan || "")` — chained `||` fallback chain.
- `server.ts:1186` — `a.progress ?? 0` — `??` default.
- `server.ts:1257` — `r.description || "Evaluación de Riesgo"` — `||` default (also `server.ts:1362`).
- `server.ts:1316` — `parsed.data.risk_owner ?? "TI"` — `??` default.
- `server.ts:1317-1330` — `parsed.data.<field> ?? null` / `?? 3` / `?? "M"` / `?? "B"` series (`:1317`, `:1318`, `:1320`, `:1321`, `:1327`, `:1328`, `:1329`, `:1330`) — silent defaults.
- `server.ts:1319` — `parsed.data.description ?? "Evaluación de riesgo"` — `??` default.
- `server.ts:1322-1325` — `(parsed.data.controlled_probability ?? 3) * (parsed.data.controlled_impact ?? 3)` — `??` defaults inside computation.
- `server.ts:1346` — `typeof item === "number" ? item : item.asset` — speculative shape cascade accepting two asset shapes instead of one validated shape.
- `server.ts:1455` — `options?.port ?? 0` — `??` default port.
- `server.ts:819-828` — `try { assertAttachmentMeta } catch { if (AttachmentRejected|PathEscape) return 400; throw }` — explicit rethrow; NOT a violation (named-error fail-fast, noted to avoid misread).

## R3
- `server.ts:1457-1476` — `if (typeof Bun !== "undefined" && typeof Bun.serve === "function") { Bun.serve(...) } return new Promise(serve(...))` — runtime sniffing (`typeof Bun`) to support two runtimes (Bun + Node) in one path; version/runtime-sniffing compatibility shim clause.

## R4
Within-slice repeats (each must live in a shared constant/config):
- `"application/octet-stream"` — `server.ts:244`, `server.ts:798`, `server.ts:857`, `server.ts:874` (4×).
- `1024` (fake `file_size`) — `server.ts:243`, `server.ts:797`, `server.ts:856` (3×).
- `"No Incident matches the given query."` — `server.ts:588`, `server.ts:597`, `server.ts:721`, `server.ts:810`, `server.ts:882` (5×).
- `"admin"` actor/name literal — `server.ts:557`, `server.ts:569`, `server.ts:705`, `server.ts:801`, `server.ts:860`, `server.ts:904` + `server.ts:389` (`eq(username,"admin")`) (7×).
- `created_by_id: 1` / `updated_by_id: 1` / `changed_by_id: 1` / `uploaded_by_id: 1` hardcoded `1` — `server.ts:542`, `server.ts:543`, `server.ts:558`, `server.ts:609`, `server.ts:706`, `server.ts:725` (`deleted_by_id: 1`), `server.ts:841`, `server.ts:905`, `server.ts:1099`, `server.ts:1100`, `server.ts:1335`, `server.ts:1336`, `server.ts:1429`, `server.ts:1431` (14×).
- `count(*)::int` raw SQL — `server.ts:483`, `server.ts:1073` (2×).
- `10` pool options — `client.ts:15` (`max: 10`), `client.ts:16` (`idle_timeout: 10`) (2×).
- `next: null, previous: null` pagination envelope — `server.ts:453-454`, `server.ts:922-923`, `server.ts:1059-1060`, `server.ts:1252-1253`, `server.ts:1390-1391`, `server.ts:1410-1411` (6×).
- HTTP status literals reused as control values — `400` (×15+), `404` (×10+), `201` (`:581`, `:862`, `:976`, `:1130`, `:1374`), `200` (`:714`, `:911`), `204` (`:727`, `:995`), `500` (`:550`, `:966`, `:1107`, `:1342`) — repeated operational literals.
- Route path prefixes — `/api/incidents/` (`:413`, `:459`, `:584`, `:593`, `:717`, `:730`, `:770`, `:806`, `:878`), `/api/incident-recipients/` (`:914`, `:934`, `:980`), `/api/audits/` (`:998`, `:1065`, `:1134`), `/api/risk-evaluations/` (`:1243`, `:1272`, `:1378`, `:1382`), `/api/assets/` (`:1402`), `/business/login/` (`:272`, `:294`), `/business/token/refresh/` (`:273`, `:363`) — repeated path-prefix literals.
Cross-file-literal candidates (value + file:line each; other file may be outside slice):
- `"unsa"` — `client.ts:19` (search_path), `server.ts:332` (jwt schema), `server.ts:377`, `server.ts:381`.
- `"demo"` — `client.ts:19` (search_path), `server.ts:287` (schema allowlist).
- `"application/octet-stream"` — `server.ts:244,798,857,874` (candidate for global synthesis).
- `"No Incident matches the given query."` — `server.ts:588,597,721,810,882` (candidate).
- `1024` — `server.ts:243,797,856` (candidate).
- `http://localhost:` URL prefix — `server.ts:1466`, `server.ts:1483` (2×, candidate).
- `count(*)::int` — `server.ts:483,1073` (candidate).
- Single-use local literals (e.g. `client.ts:17` `connect_timeout: 30`, `server.ts:328` `3600`, `server.ts:15-17` schema column lengths in `schema.ts`) are OK and NOT reported per contract.

## R5
No violations found.

## R6
- `server.ts:322-336` — hand-rolled JWT (`Buffer.from(JSON.stringify({alg:"none"...})).toString("base64url")` + unsigned `.signature` suffix) — use ecosystem `jose` (`new jose.SignJWT(...).sign(key)`) or `jsonwebtoken` instead of custom token minting.
- `server.ts:425-441` — hand-rolled in-memory filtering (`filtered.filter(...)` for search/status/severity/incident_type after full-table select) — use `drizzle-orm` `and(eq(...), ilike(...))` where-clauses instead of custom filter cascade.
- `server.ts:443-449` — hand-rolled N+1 fan-out (`for (const row of filtered) { await getFullIncident(row.id) }`) — use batched join/`Promise.all` (or drizzle relational query) instead of sequential custom loop.
- `server.ts:49-63` — hand-rolled Zod error formatter (`formatDrfErrors`) — use `zod-validation-error` (`fromZodError`) or a shared ecosystem formatter instead of custom issue-mapping util.
- `server.ts:1302-1309` — hand-rolled sequence parsing (`match(/R-(\d+)/)` + `parseInt + 1` + `padStart`) — use DB sequence/serial or `drizzle-orm` ordered insert-returning instead of custom regex counter.
- `server.ts:1076` — `new Date().getFullYear()` year-prefix codegen + `server.ts:571` `toISOString().slice(0, 10)` date truncation — use `date-fns` (`format`/`getYear`) instead of hand-rolled date math (minor).
- `schema.ts`, `client.ts`, `fixtures.ts`, `index.ts` — no hand-rolled utils; declarative drizzle schema / re-exports only. No violations in those files under R6.

## Summary

| Rule | Count |
|------|-------|
| R1 | 8 |
| R2 | 60+ (each `??`/`\|\|`/ternary-default/`catch`-default site listed above) |
| R3 | 1 |
| R4 | 12 within-slice groups + 7 cross-file candidates |
| R5 | 0 |
| R6 | 6 |
| Total | ~87+ |
