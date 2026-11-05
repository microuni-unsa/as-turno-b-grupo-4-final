# Slice 17 evidence-store — Quality Audit

Audited files (2026-11-05):
- `packages/evidence/src/evidence-store.ts` — 1795 lines
- `packages/evidence/src/bundle-sealer.ts` — 191 lines
- `packages/evidence/src/crypto.ts` — 71 lines

## R1

- `packages/evidence/src/evidence-store.ts:1231` — `if (manifests.length === 0) {` … prune … `}` (no `else`) — loop iteration with a sealed manifest falls through silently with no state change or error; missing `else` where the sealed/retained case is left implicit.
- `packages/evidence/src/evidence-store.ts:1519` — `void firedAt;` — `markTimerFired(timerId, firedAt)` explicitly discards caller-supplied state (`firedAt` never persisted, only `fired: true` is written); state left unmanaged without a dedicated error or comment branch.
- `packages/evidence/src/evidence-store.ts:1791` — `if (this.ownsSql) { await this.sql.end(); }` (no `else`) — `close()` on a non-owning instance is a silent noop; the not-owner state leaves resources/consumers implicit instead of an explicit no-op branch or error.

## R2

- `packages/evidence/src/evidence-store.ts:387` — `const piiTags = scan?.visual_pii ?? [];` — `??` silent default hides absent `visual_pii` instead of fail-fast with a named error.
- `packages/evidence/src/evidence-store.ts:400` — `pims_attachment_id: pimsAttachmentId ?? null,` — `??` default (`null`) hides absent optional instead of explicit fail-fast branch.
- `packages/evidence/src/evidence-store.ts:693` — `review_approval_id: reviewApprovalId ?? null,` — `??` default (`null`) hides absent value instead of fail-fast.
- `packages/evidence/src/evidence-store.ts:723` — `review_approval_id: reviewApprovalId ?? null,` — same `?? null` silent default (second call site).
- `packages/evidence/src/evidence-store.ts:927` — `cancelled_reason: record.cancelled_reason ?? null,` — `??` default hides absent field instead of named error.
- `packages/evidence/src/evidence-store.ts:937` — `cancelled_reason: record.cancelled_reason ?? null,` — same `?? null` silent default (upsert path).
- `packages/evidence/src/evidence-store.ts:1146` — `const effectiveSeal = sealSha256 ?? parsed.data.seal_sha256 ?? null;` — chained `??` fallback chain (`arg ?? body ?? null`) instead of one explicit source or a fail-fast named error.
- `packages/evidence/src/evidence-store.ts:1664` — `return rows[0]?.count ?? 0;` — `?.` + `?? 0` silent default (`0`) hides absent count row instead of fail-fast with a named error.
- `packages/evidence/src/bundle-sealer.ts:54` — `const field = issue ? issue.path.join(".") : "manifest";` — ternary silent default (`"manifest"`) hides absent first issue instead of fail-fast.
- `packages/evidence/src/bundle-sealer.ts:185` — `const field = issue ? issue.path.join(".") : "audit-trail";` — same ternary silent default (`"audit-trail"`) hiding absent issue.

## R3

- `packages/evidence/src/evidence-store.ts:261-262` — `ALTER TABLE evidence.dedupe_index ADD COLUMN IF NOT EXISTS pims_incident_id INTEGER;` — in-`init()` legacy-schema migration shim that keeps old databases working instead of a versioned migration; backwards-compat path.

## R4

Within-slice repeated operational literals (each occurs 2+ times inside this slice and MUST live in a shared constant/config):
- `"sha256"` — `evidence-store.ts:373`, `evidence-store.ts:464`, `bundle-sealer.ts:105`.
- `"hex"` — `evidence-store.ts:373`, `evidence-store.ts:467`, `bundle-sealer.ts:107`, `crypto.ts:33`, `crypto.ts:60`.
- `"base64"` — `evidence-store.ts:385`, `evidence-store.ts:488`, `evidence-store.ts:569`, `evidence-store.ts:614`, `evidence-store.ts:765`, `evidence-store.ts:1185`.
- `"utf8"` — `evidence-store.ts:492`, `evidence-store.ts:618`, `evidence-store.ts:769`, `evidence-store.ts:1191`, `crypto.ts:30`.
- `"aes-256-gcm"` (via `AES_256_GCM_ALGORITHM`) — `crypto.ts:34`, `crypto.ts:63` (already centralized in-file; still a cross-file candidate if any other file names the algorithm).
- `* 1000` (seconds-to-ms factor) — `evidence-store.ts:836`, `evidence-store.ts:881`.
- `{ max: 10 }` (pool size) — `evidence-store.ts:161`, `evidence-store.ts:182`.
- `= 20` (retrieval limit default) — `evidence-store.ts:589`, `evidence-store.ts:595`.
- `"queued"` (risk-queue status) — `evidence-store.ts:268` (DDL `DEFAULT 'queued'`), `evidence-store.ts:1550` (code `status: "queued"`).
- `"draft"` (pack state) — `evidence-store.ts:221` (DDL `DEFAULT 'draft'`), `evidence-store.ts:635` (default param), `evidence-store.ts:1212` (`eq(..., "draft")`).
- `"BUNDLE_SEALED:"` (marker prefix) — `bundle-sealer.ts:122`, `bundle-sealer.ts:142`.
- `/^[0-9a-f]{64}$/`-family SHA-256-hex pattern — `evidence-store.ts:645`, `crypto.ts:14` (`/^[0-9a-fA-F]{64}$/` plus `EXPECTED_KEY_HEX_LENGTH = 64` at `crypto.ts:5`).
- `"keyHex is required"` — `evidence-store.ts:163`, `evidence-store.ts:171`.
- `"sha256 VARCHAR(64)"`-family DDL size `64`/`VARCHAR(64)` repeated across `evidence-store.ts:200-307` column definitions (noted as DDL-only candidate; single shared constant not yet evaluated for global synthesis).

Cross-file-literal candidates for global synthesis (literal + every file:line in this slice; orchestrator to match against other slices):
- `"sha256"` — `evidence-store.ts:373`, `evidence-store.ts:464`, `bundle-sealer.ts:105`.
- `"hex"` — `evidence-store.ts:373`, `evidence-store.ts:467`, `bundle-sealer.ts:107`, `crypto.ts:33`, `crypto.ts:60`.
- `"base64"` — `evidence-store.ts:385`, `evidence-store.ts:488`, `evidence-store.ts:569`, `evidence-store.ts:614`, `evidence-store.ts:765`, `evidence-store.ts:1185`.
- `"utf8"` — `evidence-store.ts:492`, `evidence-store.ts:618`, `evidence-store.ts:769`, `evidence-store.ts:1191`, `crypto.ts:30`.
- `"aes-256-gcm"` — `crypto.ts:34`, `crypto.ts:63`.
- `12` / `16` (`IV_LENGTH_BYTES` / `AUTH_TAG_LENGTH_BYTES`) — `crypto.ts:6`, `crypto.ts:7` (centralized here; flag if `12`/`16` appear as raw literals elsewhere).
- `64` (`EXPECTED_KEY_HEX_LENGTH` / SHA-256 hex length) — `crypto.ts:5`, `crypto.ts:14`, `evidence-store.ts:645`.
- `"evidence-bundle"` — `bundle-sealer.ts:39`, `bundle-sealer.ts:55`, `bundle-sealer.ts:137`.
- `"audit-trail"` — `bundle-sealer.ts:186` (single use in slice; flag if repeated outside slice).
- `"1.0"` (`export_version`) — `bundle-sealer.ts:174` (single use in slice; flag if repeated outside slice).

## R5

No violations found.

## R6

- `packages/evidence/src/crypto.ts:10-20` — `function validateKeyHex(keyHex: string): void { if (typeof … || !/^[0-9a-fA-F]{64}$/ …) throw … }` — hand-rolled string-length + regex validation where the ecosystem alternative (zod, already used throughout `evidence-store.ts`, e.g. `z.string().length(64).regex(/…/)` or a shared hex schema) already provides it.
- `packages/evidence/src/evidence-store.ts:102-110` — `function resolveBaseStorageDir(value: string | undefined): string { if (value === undefined || value.trim().length === 0) throw … }` — hand-rolled required-nonempty-string validation where the ecosystem alternative (zod `z.string().trim().min(1)`) already provides it.
- `packages/evidence/src/evidence-store.ts:598` — `if (!Number.isInteger(limit) || limit <= 0) throw new PimsValidationError(…)` — hand-rolled positive-integer guard where the ecosystem alternative (zod `z.number().int().positive()`) already provides it.
- `packages/evidence/src/evidence-store.ts:645` — `if (!/^[0-9a-f]{64}$/.test(contentSha256)) throw …` — hand-rolled SHA-256-hex validation where the ecosystem alternative (zod regex schema or a shared `sha256Hex` schema, same family as `validateKeyHex` in `crypto.ts`) already provides it.

## Summary

| Rule | Count |
|------|-------|
| R1 | 3 |
| R2 | 10 |
| R3 | 1 |
| R4 | 14 within-slice groups (10 cross-file candidates) |
| R5 | 0 |
| R6 | 4 |
| Total | 32 (+ R4 literal groups counted once each) |
