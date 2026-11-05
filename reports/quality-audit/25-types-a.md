# Slice 25 types-a — Quality Audit

Audited files (4 files, 1698 lines total, date 2026-11-05):
- packages/types/src/agent.ts (1218 lines)
- packages/types/src/attachments.ts (81 lines)
- packages/types/src/canonical.ts (18 lines)
- packages/types/src/cockpit.ts (381 lines)

## R1

- packages/types/src/agent.ts:715-724 — `if (normalized === "5_whys" || ...) { return "5-whys"; } if (normalized === "fault_tree") ... if (normalized === "fishbone" ...) ... return value;` — unmatched `normalized` values fall through to `return value` with no error branch; missing `else` raising a dedicated error for unknown method (unhandled case left implicit).
- packages/types/src/agent.ts:731-732 — `return value.filter((entry) => typeof entry === "string").join(" ");` — non-string array entries are silently dropped with no error/else branch (exhaustive branching violated: drop path unhandled).
- packages/types/src/agent.ts:736-748 — `for (const entry of Object.values(value)) { if (typeof entry === "string") { ... continue; } if (Array.isArray(entry)) { ... } }` — entries that are neither strings nor arrays (numbers, booleans, nested objects) hit no branch and are silently ignored; missing `else` raising a dedicated error, state left implicit.
- packages/types/src/agent.ts:742-746 — `for (const item of entry) { if (typeof item === "string") { parts.push(item); } }` — non-string items inside nested arrays silently skipped, no `else`/error branch.

## R2

- packages/types/src/agent.ts:707-725 — `normalizeTotMethod` alias chain (`"five_whys"` → `"5-whys"`, `"ishikawa"` → `"fishbone"`, underscore/dash folding via `.replace`) — fallback chain coercing out-of-schema inputs into valid enum members instead of fail-fast with a named error.
- packages/types/src/agent.ts:727-752 — `normalizeRemediation` coerces arrays/objects to strings via `filter`+`join(" ")`, silently dropping non-string elements — speculative coercion/defaulting hiding absent or mistyped state instead of fail-fast.
- packages/types/src/agent.ts:755 — `method: z.preprocess(normalizeTotMethod, TotMethodSchema)` — `z.preprocess` masks invalid input before validation instead of failing with a named error.
- packages/types/src/agent.ts:759 — `remediation: z.preprocess(normalizeRemediation, z.string().min(1))` — `z.preprocess` coercion fallback hiding invalid shape instead of fail-fast.
- packages/types/src/attachments.ts:22 — `const code = char.codePointAt(0) ?? 0;` — `?? 0` silent default hiding the absent (`undefined`) state instead of an explicit branch/named error.

## R3

No violations found.

## R4

Repeated operational literals WITHIN this slice (same value hardcoded in 2+ files; must live in a shared constant):
- `64` (SHA-256 hex length): packages/types/src/agent.ts:281 (`z.string().length(64)`), packages/types/src/agent.ts:388 (`bytes_ref: z.string().length(64)`), packages/types/src/agent.ts:574 (`sha256: z.string().length(64)`), packages/types/src/agent.ts:777 (`content_sha256: z.string().length(64)`), packages/types/src/agent.ts:823 (`content_sha256: z.string().length(64)`), packages/types/src/cockpit.ts:171 (`chunk_sha256: z.string().length(64)`), packages/types/src/cockpit.ts:266 (`/^[0-9a-f]{64}$/`).
- `255` (file-name max length): packages/types/src/attachments.ts:16 (`.max(255)`), packages/types/src/agent.ts:389 (`.max(255)`), packages/types/src/agent.ts:919 (`.max(255)`).
- `150` (title max length): packages/types/src/agent.ts:335 (`.max(150)`), packages/types/src/agent.ts:929 (`.max(150)`), packages/types/src/cockpit.ts:76 (`.max(150)`).
- `1000` (description max length): packages/types/src/agent.ts:336 (`.max(1000)`), packages/types/src/agent.ts:930 (`.max(1000)`), packages/types/src/cockpit.ts:77 (`.max(1000)`).
- `128` (mime max length): packages/types/src/agent.ts:390 (`.max(128)`), packages/types/src/agent.ts:920 (`.max(128)`).
- `"authority"` / `"subject"` pack-type literals: packages/types/src/agent.ts:185 (`z.enum(["authority", "subject"])`), packages/types/src/agent.ts:258-262 (`NOTICE_PACK_TYPES`), packages/types/src/cockpit.ts:259 (`z.enum(["authority", "subject"])`).
- `"O"` open-status default: packages/types/src/agent.ts:337 (`z.literal("O")`), packages/types/src/cockpit.ts:84 (`.default("O")`).

Cross-file literal candidates for global synthesis (value + file:line in this slice; counterpart file outside slice to be confirmed globally):
- `64` SHA-256 hex length: packages/types/src/agent.ts:281, packages/types/src/agent.ts:388, packages/types/src/agent.ts:574, packages/types/src/agent.ts:777, packages/types/src/agent.ts:823, packages/types/src/cockpit.ts:171, packages/types/src/cockpit.ts:266.
- `255` file-name cap: packages/types/src/attachments.ts:16, packages/types/src/agent.ts:389, packages/types/src/agent.ts:919.
- `150` title cap: packages/types/src/agent.ts:335, packages/types/src/agent.ts:929, packages/types/src/cockpit.ts:76.
- `1000` description cap: packages/types/src/agent.ts:336, packages/types/src/agent.ts:930, packages/types/src/cockpit.ts:77.
- `128` mime cap: packages/types/src/agent.ts:390, packages/types/src/agent.ts:920.
- `"5-whys"` / `"fishbone"` / `"fault-tree"` TOT method literals: packages/types/src/agent.ts:685 (also re-exported `TotMethodSchema` from `@pims/types/evidence.ts` — possible duplicate definition across agent.ts/evidence.ts).
- `"O"` status literal: packages/types/src/agent.ts:337, packages/types/src/cockpit.ts:84.
- `1024 * 1024` byte-conversion factor: packages/types/src/attachments.ts:63 (single use in slice; flag if duplicated outside slice).

## R5

No violations found.

## R6

- packages/types/src/agent.ts:707-725 — `normalizeTotMethod` hand-rolled case-fold + regex slugify (`.toLowerCase().replace(/[^a-z0-9]+/g, "_")...`) plus alias map — custom string normalization where the framework (strict `z.enum` validation, or a single declarative alias `Record` + `zod` transform) already covers it.
- packages/types/src/agent.ts:727-752 — `normalizeRemediation` hand-rolled recursive flatten/filter/join over `unknown` — custom coercion where the ecosystem solution (a `z.union([z.string(), z.array(z.string()), z.record(z.string(), ...)])` with `.transform()`, or `z.coerce.string()`) already provides it.
- packages/types/src/attachments.ts:21-24 — `Array.from(fileName).some((char) => { const code = char.codePointAt(0) ?? 0; return code < 0x20 || code === 0x7f; })` — hand-rolled per-character control-char scan where the native solution (a single `RegExp` test such as `/[\x00-\x1F\x7F]/`) already provides it.

## Summary

| Rule | Violations |
|------|-----------|
| R1 | 4 |
| R2 | 5 |
| R3 | 0 |
| R4 | 7 groups (within-slice) + 8 cross-file candidates |
| R5 | 0 |
| R6 | 3 |
| Total | 19 finding lines (plus R4 candidate list) |
