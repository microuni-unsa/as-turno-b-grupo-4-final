# Slice 03 agent-llm-review — Quality Audit

Audited files (line counts via `wc -l`), date 2026-11-05:

- `packages/agent/src/llm/presidio-client.ts` — 151 lines
- `packages/agent/src/llm/safe-prompt.ts` — 229 lines
- `packages/agent/src/review/draft-service.ts` — 731 lines
- `packages/agent/src/review/reviewer.ts` — 368 lines

## R1

- `packages/agent/src/llm/safe-prompt.ts:100-102` — `} catch { // ignore }` (inside `for (const region of PII_PHONE_REGIONS)`) — empty catch branch: comment-only, no state update, no rethrow, loop just continues to the next region; silent/empty branch with no explicit state handling.
- `packages/agent/src/review/draft-service.ts:320-323` — `const byId = allowed[index]; if (byId !== undefined) { resolved.push(byId); } continue;` — missing `else`: an out-of-range `C<n>` reference falls through to `continue` with nothing pushed and no error; the unresolvable citation is silently discarded, state left implicit.
- `packages/agent/src/review/draft-service.ts:339-345` — `if (matches[0] !== undefined) { resolved.push(matches[0]); continue; } if (parts.length >= 3 && /^\d+-\d+$/.test(...)) { resolved.push(normalized); }` — missing terminal `else`/error: when fuzzy matching and the `d+-d+` shape check both fail, control falls off the loop body and the citation is silently dropped instead of raising a dedicated fabrication/validation error.
- `packages/agent/src/review/draft-service.ts:682-685` — `const rag = await this.ragService.query("corrective action ...", { normative_only: true, ... });` (no `passages.length === 0` guard, unlike `draftAuthority:426` and `draftSubject:612-616`) — missing branch: empty-evidence state is left implicit and drafting proceeds with an empty allowlist instead of raising `RagNoEvidenceError`.

No other R1 violations found (`presidio-client.ts` and `reviewer.ts`: no silent/empty/log-only branches; all guards early-return/throw and both sides of every state-deciding conditional are explicit).

## R2

- `packages/agent/src/llm/presidio-client.ts:29` — `return ENTITY_TOKEN_MAP[entityType] ?? "[DESCRIPCION]";` — `?? default` hiding absent state: unknown entity type is silently relabeled instead of fail-fast with a named error.
- `packages/agent/src/llm/presidio-client.ts:39` — `this.timeoutMs = options.timeoutMs ?? 1500;` — `?? default`: absent timeout silently defaulted instead of fail-fast with a named error.
- `packages/agent/src/llm/presidio-client.ts:40` — `this.minScore = options.minScore ?? 0.5;` — `?? default`: absent score threshold silently defaulted instead of fail-fast with a named error.
- `packages/agent/src/llm/presidio-client.ts:50-51` — `} catch { return false; }` (`isHealthy`) — `try/except` swallowing errors: any fetch/AbortSignal failure is converted into a `false` fallback, hiding the underlying failure instead of surfacing a named error.
- `packages/agent/src/llm/presidio-client.ts:76` — `` `Presidio analyze returned HTTP ${response.status}: ${await response.text().catch(() => "")}` `` — `catch { fallback }`: body-read failure is replaced with `""`, hiding the read error inside the thrown message.
- `packages/agent/src/llm/safe-prompt.ts:100-102` — `} catch { // ignore }` (per-region `findPhoneNumbersInText`) — `try/except` swallowing errors: a throwing region's phone matches are silently skipped, hiding detector failure instead of fail-fast with a named error.
- `packages/agent/src/review/draft-service.ts:282` — `` `Severidad: ${incident.severity ?? "desconocida"}` `` — `?? default` hiding absent severity instead of fail-fast with a named error.
- `packages/agent/src/review/draft-service.ts:283` — `` `Impacto: ${incident.impact ?? "desconocido"}` `` — `?? default` hiding absent impact instead of fail-fast with a named error.
- `packages/agent/src/review/draft-service.ts:299-304` — `incident.num_affected_subjects === null || ... === undefined ? "desconocido" : String(...)` — ternary default hiding absent subject count instead of fail-fast with a named error.
- `packages/agent/src/review/draft-service.ts:330` — `const sequence = parts[parts.length - 1] ?? "";` — `?? default` feeding the fuzzy citation matcher instead of validating citation shape fail-fast.
- `packages/agent/src/review/draft-service.ts:335` — `(entry.startsWith(`${parts[0] ?? ""}:`) && ...` — `?? default` feeding the fuzzy citation matcher instead of validating citation shape fail-fast.
- `packages/agent/src/review/draft-service.ts:348` — `return unique.length > 0 ? unique : allowed.slice(0, 3);` — silent default fallback: when zero citations resolve, the first 3 allowlist entries are returned instead of fail-fast with a named (fabrication/validation) error.
- `packages/agent/src/review/draft-service.ts:492-493` — `` `${row.event_type ?? "event"} at ${row.changed_at}: ${row.description ?? ""}` `` — `?? default` hiding absent history fields inside delay-reason evidence strings instead of fail-fast with a named error.
- `packages/agent/src/review/draft-service.ts:498` — `reasons: reasons.length > 0 ? reasons : ["history_unavailable"]` — ternary default hiding absent history instead of fail-fast with a named error.
- `packages/agent/src/review/reviewer.ts:152` — `counts.set(item, (counts.get(item) ?? 0) + 1);` — `.get(k, default)` hiding absent map state (listed clause verbatim).
- `packages/agent/src/review/reviewer.ts:155` — `const count = counts.get(item) ?? 0;` — `.get(k, default)` hiding absent map state (listed clause verbatim).

Not flagged (deliberately, fail-fast preserved): `client ?? globalPresidioClient` (`safe-prompt.ts:58,158`) and `(messages ?? [])` (`safe-prompt.ts:86`) — total absence still throws `PiiRedactionUnavailableError` / iterates neutrally; `?? null` normalizations immediately followed by explicit missing-field throws (`draft-service.ts:371-372,384`; `reviewer.ts:93,101,123,131` length checks returning rejections).

## R3

No violations found. No backwards-compat shims, polyfills, legacy wrappers, deprecated-API support, version sniffing, or `for backwards compat` paths in any of the 4 files (the `C1..Cn` citation-identifier protocol is the current model contract, not legacy support).

## R4

Cross-file literal candidates (same operational literal hardcoded in 2+ files — must live in a shared constant/config):

- `"[REPORTANTE]"` — `presidio-client.ts:15`; `safe-prompt.ts:25`
- `"[CONTACTO]"` — `presidio-client.ts:16,17`; `safe-prompt.ts:26`
- `"[ID]"` — `presidio-client.ts:18,19,20,21,22`; `safe-prompt.ts:27`
- `"[SISTEMA]"` — `presidio-client.ts:23,24,25`; `safe-prompt.ts:28`
- `"[DESCRIPCION]"` — `presidio-client.ts:29`; `safe-prompt.ts:29`
- `"es"` (language/locale/lang) — `presidio-client.ts:68` (`language: "es"`); `safe-prompt.ts:217` (`locale: "es"`); `draft-service.ts:557,584,647` (`lang: "es"`)
- `"authority"` — `draft-service.ts:449,503,531`; `reviewer.ts:78,251`
- `"subject"` — `draft-service.ts:552,563-577,597-605,635,662-669`; `reviewer.ts:112`
- `"resolution"` — `draft-service.ts:703`; `reviewer.ts:330`
- `2500` (max tokens) — `draft-service.ts:44` (`RESOLUTION_MAX_TOKENS`); `reviewer.ts:296` (`max_tokens: 2500`)
- `"not_required"` — `draft-service.ts:567,576`; `reviewer.ts:339,347`
- `"exempted"` — `draft-service.ts:594,603`; `reviewer.ts:339,347`
- `"\n"` (join/separator) — `safe-prompt.ts:87`; `draft-service.ts:306,437,623,691`
- `"citations"` — `draft-service.ts:161,171,179` + `draft.citations` uses; `reviewer.ts:262`
- `"user"` (message role) — `safe-prompt.ts:200,214,223`; `reviewer.ts:257`
- `additionalProperties: false` (JSON-schema literal) — `draft-service.ts:186,209,233,260`; `reviewer.ts:289,294`

Repeated WITHIN the slice (single-file repeats, listed for global synthesis):

- `draft-service.ts:93,152,188,200,513` etc. — authority field names (`item_a_nature`, `item_a_unknown`, …) duplicated across `AUTHORITY_TEXT_FIELDS`/`AUTHORITY_ARRAY_FIELDS`, Zod schema, JSON schema, and compose params; same pattern for subject (`body_plain`, `item_c_consequences`, `item_d_measures`, `recommendations`) and resolution (`summary`, `remediation`) fields.
- `draft-service.ts:224,251,269` — `"^[^:]+:[^:]+:.+$"` citation pattern ×3.
- `draft-service.ts:226,253,271` — `"Exact doc_id:chunk_id:lines citation copied from the allowed citation list"` ×3.
- `draft-service.ts:437,623,691` — `` `C${index + 1} = ${citation}` `` mapping template + `"Allowed normative citations (return citations[] using ONLY the identifiers C1..Cn; never invent):"` prompt prefix ×3.
- `draft-service.ts:623,691` — `"write ... in Spanish; every sentence must have at most 20 words; do not include digits or numeric literals"` constraint text ×2.
- `draft-service.ts:47,50` — `"Ground every legal statement in the supplied RAG citations."` identical sentence in both draft system prompts.
- `draft-service.ts:474,497` — `3600000` (ms-per-hour) ×2.
- `draft-service.ts:296,297,298,691` — `", "` join separator ×4.
- `draft-service.ts:282,283,302` — `"desconocida"`/`"desconocido"` display defaults ×3.
- `draft-service.ts:423,609,684` — `normative_only: true` RAG option ×3.
- `draft-service.ts:470,471` — identical `"CONFIG_TYPE:JURISDICTION_DEADLINES_JSON.EU_GDPR.authority_h"` string passed as both `ConfigError` args.
- `draft-service.ts:525,536,668` — `"draft"` pack state ×3.
- `reviewer.ts:81,89,96,104,117,124,132,145,157,165,173,205,230,316` — `"reviewer"` judge literal ×14.
- `reviewer.ts:97,105,125,133` — `"dpo_contact_name"`/`"dpo_contact_email"` ×2 each.
- `reviewer.ts:270,293,300,309,364` — `"challenges"` key ×5; `reviewer.ts:273-281` vs `286-288` — `target`/`challenge`/`severity`/`evidence_required` schema keys duplicated in `required` array.
- `reviewer.ts:279,312` — `"high"` severity ×2.

Single-use local literals (not reported per contract): `/health`, `/analyze`, `"GET"`, `"POST"`, `"Content-Type"`, `"application/json"`, `1500`, `2000`, `0.5`, `300000`, `3500`, `3000`, `"127.0.0.1"`, `"0.0.0.0"`, DNI/RUC regexes, `"PACK_STALE_RETRY"`, `"pii_leakage"`, `"bundle_sealed"`, `"reviewer rubric passed"`, `"history_unavailable"`, `"dpo"`. `MODEL_ROUTE_REASONING` is already a shared-constant import (correct pattern, not a violation).

## R5

No violations found. No machine-dependent paths (`~/`, `/home/`, hardcoded `/tmp`, `file:///`, `C:\`), no workspace-escaping traversal, no hardcoded absolute file paths in any of the 4 files (Presidio URLs derive from runtime `baseUrl` config; no file-system ops present).

## R6

- `packages/agent/src/llm/safe-prompt.ts:106-141` — `const words = combined.split(/[\s,;"'()<>[\]{}]+/); for (const word of words) { ... }` hand-rolled word tokenizer plus hand-rolled PII classifiers, notably `/^\d{8}$/` (`:135`, DNI) and `/^(10|15|17|20)\d{9}$/` (`:138`, RUC) — custom validation loop where the ecosystem already covers the neighbors (`z.string().email()` at `:78`, `net.isIP` at `:119`, `tldts.parse` at `:126`); native/ecosystem alternative: `validator.js` (`isEmail`/`isIP`/numeric checks) or zod refinements (`z.string().regex` with named schemas) over the same token stream instead of bespoke per-word regex checks.
- `packages/agent/src/review/draft-service.ts:309-349` — `canonicalizeCitations` hand-rolled fuzzy citation resolver (`C<n>` index mapping, `endsWith`/`startsWith`/`includes` heuristics at `:331-338`, `/^\d+-\d+$/` shape test at `:343`) — custom matching algorithm where strict validation suffices; alternative: exact-match against the allowlist via `Set.has` (plus `z.enum`-style schema) with fail-fast `CitationFabricatedError`/`CitationInvalidError` instead of fuzzy guessing.
- `packages/agent/src/review/draft-service.ts:474-499` — hand-rolled date math with magic `3600000` (`new Date(awareness.getTime() + authorityHours * 3600000)`, `Math.ceil((nowMs - deadlineMs) / 3600000)`) — custom date arithmetic; alternative: `date-fns` (`addHours`, `differenceInHours`, `isAfter`) already the idiomatic ecosystem choice.
- `packages/agent/src/review/reviewer.ts:150-179` — hand-rolled checklist multiset validation (`new Map<string, number>()` counting loop at `:151-153`, missing-check loop at `:154-170`, unknown-item loop at `:171-179`) — custom set-equality algorithm; alternative: `Set`-based comparison (`new Set(checklist)` vs `new Set(CLOSE_CHECKLIST_ITEMS)` with size/membership checks) or a zod schema (`z.array(z.enum(CLOSE_CHECKLIST_ITEMS)).length(...).refine(unique)`).

No R6 violations in `presidio-client.ts` (span sort/greedy de-overlap and right-to-left splice use native `Array.sort`/`slice`; no stdlib interval de-overlapper exists) and none for `flattenModelText`/`flattenModelTextArray` (`draft-service.ts:64-91`, no direct stdlib/ecosystem equivalent for normalizing arbitrary nested model output).

## Summary

| Rule | presidio-client.ts | safe-prompt.ts | draft-service.ts | reviewer.ts | Total |
| ---- | --- | --- | --- | --- | --- |
| R1 Exhaustive Branching | 0 | 1 | 3 | 0 | 4 |
| R2 Zero Fallbacks | 5 | 1 | 7 | 2 | 15 |
| R3 No Legacy Support | 0 | 0 | 0 | 0 | 0 |
| R4 Repeated Literals (cross-file candidates) | — | — | — | — | 16 |
| R5 Path Discipline | 0 | 0 | 0 | 0 | 0 |
| R6 Native Solutions | 0 | 1 | 2 | 1 | 4 |
| **Total** | **5** | **3** | **12** | **3** | **39** |
