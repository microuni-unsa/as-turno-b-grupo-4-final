# Slice 28 root-stack-helpers — Quality Audit

Audited files (line counts), date 2026-11-05:

- `src/env-matrix.ts` — 2 lines
- `src/env-schema.ts` — 2 lines
- `src/stack-def.ts` — 2 lines
- `scripts/dev-stack.ts` — 4 lines

## R1

No violations found.

## R2

No violations found.

## R3

- `src/env-matrix.ts:1-2` — `export * from "@pims/config/env-matrix.ts"; / export { default } from "@pims/config/env-matrix.ts";` — pure re-export wrapper with no local logic; backwards-compat shim / legacy wrapper clause.
- `src/env-schema.ts:1-2` — `export * from "@pims/config/env-schema.ts"; / export { default } from "@pims/config/env-schema.ts";` — pure re-export wrapper with no local logic; backwards-compat shim / legacy wrapper clause.
- `src/stack-def.ts:1-2` — `export * from "@pims/config/stack-def.ts"; / export { default } from "@pims/config/stack-def.ts";` — pure re-export wrapper with no local logic; backwards-compat shim / legacy wrapper clause.

## R4

No violations found.

Within-slice repeated literals observed (single file, two lines each — not 2+ files, listed per contract for synthesis):

- `"@pims/config/env-matrix.ts"` — `src/env-matrix.ts:1`, `src/env-matrix.ts:2`
- `"@pims/config/env-schema.ts"` — `src/env-schema.ts:1`, `src/env-schema.ts:2`
- `"@pims/config/stack-def.ts"` — `src/stack-def.ts:1`, `src/stack-def.ts:2`

Cross-file literal candidates for global synthesis (literal value + file:line each):

- `"@pims/config/env-matrix.ts"` — `src/env-matrix.ts:1`, `src/env-matrix.ts:2`
- `"@pims/config/env-schema.ts"` — `src/env-schema.ts:1`, `src/env-schema.ts:2`
- `"@pims/config/stack-def.ts"` — `src/stack-def.ts:1`, `src/stack-def.ts:2`
- `"@microx-technologies/microcompose"` — `scripts/dev-stack.ts:1`
- `"../src/stack-def.ts"` — `scripts/dev-stack.ts:2`
- No identical operational literal (URL, timeout, retry count, threshold, port, path prefix, magic number/string) is hardcoded in 2+ distinct files within this slice. The `@pims/config/` prefix is a shared pattern across three files but the full string literals differ per file.

## R5

No violations found.

## R6

No violations found.

## Summary

| Rule | Count |
|------|-------|
| R1 | 0 |
| R2 | 0 |
| R3 | 3 |
| R4 | 0 |
| R5 | 0 |
| R6 | 0 |
| Total | 3 |
