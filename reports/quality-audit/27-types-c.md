# Slice 27 types-c — Quality Audit

Audited files (2026-11-05):
- packages/types/src/models.ts (135 lines)
- packages/types/src/notices.ts (274 lines)
- packages/types/src/pims.ts (774 lines)
- packages/types/src/rag.ts (119 lines)
- packages/types/src/validation.ts (10 lines)

## R1
No violations found.

## R2
- packages/types/src/pims.ts:132 — `.transform((value) => value ?? false)` — `??` silent default coerces absent/null `is_deleted` to `false` instead of fail-fast with a named error.
- packages/types/src/pims.ts:274-288 — `.transform((value) => { if (value === undefined) ... if (value === null) ... if (Array.isArray(value)) ... return value.split(",").map(...).filter(...) })` — silent coercion/defaulting: comma-string quietly converted to array and empty entries dropped via `.filter` instead of rejecting malformed input with a named error.
- packages/types/src/pims.ts:302 — `z.boolean().optional().default(true)` — silent default (`is_active` defaults to `true`) instead of fail-fast.
- packages/types/src/rag.ts:31 — `z.number().int().positive().default(DEFAULT_CHUNK_MAX_TOKENS)` — silent default instead of fail-fast with a named error.
- packages/types/src/rag.ts:32 — `z.number().int().nonnegative().default(DEFAULT_CHUNK_OVERLAP)` — silent default instead of fail-fast with a named error.
- packages/types/src/rag.ts:33 — `z.boolean().default(true)` — silent default instead of fail-fast with a named error.
- packages/types/src/notices.ts:164 — `z.array(NumericApprovalSchema).default([])` — silent default (`[]`) hiding absent state instead of fail-fast with a named error.

## R3
No violations found.

## R4
Within-slice repeated operational literals:
- `64` (sha256 hex length): packages/types/src/rag.ts:17, packages/types/src/rag.ts:61, packages/types/src/notices.ts:174
- `"es", "en"` locale enum members: packages/types/src/notices.ts:162, packages/types/src/notices.ts:262
- `.uuid()` string constraint (operational format literal): packages/types/src/notices.ts (lines 41, 61, 123, 149, 155, 182, 195, 205, 260, 271), packages/types/src/pims.ts (none — no uuid usage)
- `z.string().min(1)` required-string constraint repeated ~40x within slice (representative: packages/types/src/notices.ts:12, packages/types/src/notices.ts:42, packages/types/src/pims.ts:368, packages/types/src/pims.ts:477)

Cross-file literal candidates for global synthesis (other file may be outside this slice):
- `64` — packages/types/src/rag.ts:17, packages/types/src/rag.ts:61, packages/types/src/notices.ts:174
- `"es"` — packages/types/src/notices.ts:162, packages/types/src/notices.ts:262
- `"en"` — packages/types/src/notices.ts:162, packages/types/src/notices.ts:262
- `"incident_code"` / `incident_code` field name — packages/types/src/pims.ts:307, packages/types/src/pims.ts:373, packages/types/src/notices.ts:261, packages/types/src/rag.ts:74, packages/types/src/rag.ts:87, packages/types/src/notices.ts:173
- `"review_approval_id"` field name — packages/types/src/notices.ts:61, packages/types/src/notices.ts:182, packages/types/src/notices.ts:195, packages/types/src/notices.ts:205, packages/types/src/notices.ts:271
- `.datetime()` constraint — packages/types/src/pims.ts:216, packages/types/src/notices.ts:44, packages/types/src/notices.ts:45, packages/types/src/rag.ts:90

## R5
No violations found.

## R6
- packages/types/src/validation.ts:4-10 — `zodIssuesToDetails(error) { return error.issues.map((issue) => ({ path: issue.path.join("."), ... })) }` — hand-rolled Zod error mapping where zod natively provides `error.flatten()` / `error.format()` for structured issue output.

## Summary
| Rule | Count |
|------|-------|
| R1 | 0 |
| R2 | 7 |
| R3 | 0 |
| R4 | 6 groups listed (informational candidates) |
| R5 | 0 |
| R6 | 1 |
| Total | 8 (excl. R4 candidates) |
