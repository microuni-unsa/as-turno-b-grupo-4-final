# Slice 20 notices — Quality Audit

Audited files (2026-11-05):

- packages/notices/src/canonical-hasher.ts (36 lines)
- packages/notices/src/exemption-engine.ts (107 lines)
- packages/notices/src/index.ts (4 lines)
- packages/notices/src/notice-composer.ts (292 lines)
- packages/notices/src/plain-language.ts (165 lines)

## R1

No violations found.

## R2

- packages/notices/src/notice-composer.ts:67 — `this.now = options.now ?? (() => new Date());` — `?? default` silently defaults absent `now` instead of fail-fast with a named error.
- packages/notices/src/notice-composer.ts:68 — `this.maxWords = options.maxWords ?? PLAIN_LANGUAGE_MAX_WORDS;` — `?? default` silently defaults absent `maxWords` instead of fail-fast with a named error.
- packages/notices/src/notice-composer.ts:108 — `pack_id: input.pack_id ?? crypto.randomUUID(),` — `?? default` silently generates a default instead of fail-fast on absent `pack_id`.
- packages/notices/src/notice-composer.ts:167 — `const evaluation = params.exemptionEvaluation ?? null;` — `?? default` silently defaults absent evaluation instead of fail-fast with a named error.
- packages/notices/src/notice-composer.ts:168 — `const reviewApprovalId = params.reviewApprovalId ?? null;` — `?? default` silently defaults absent approval id instead of fail-fast with a named error.
- packages/notices/src/notice-composer.ts:169 — `const lang = params.lang ?? "es";` — `?? default` silently defaults absent locale instead of fail-fast with a named error.
- packages/notices/src/notice-composer.ts:170 — `const packId = params.packId ?? crypto.randomUUID();` — `?? default` silently generates a default instead of fail-fast on absent `packId`.
- packages/notices/src/notice-composer.ts:241 — `state = params.state ?? "draft";` — `?? default` silently defaults absent state instead of fail-fast with a named error.
- packages/notices/src/notice-composer.ts:251-254 — `PlainLanguageValidator.validate(params.bodyPlain, { ...params.waivers, locale: lang, maxWords: this.maxWords });` — spread-merge of optional `waivers` over defaults is a fallback chain silently defaulting absent waiver fields.
- packages/notices/src/plain-language.ts:80-83 — `PlainLanguageValidator.validate(text, { ...this.defaultOptions, ...options });` — spread fallback chain silently defaulting absent per-call options from instance defaults.
- packages/notices/src/plain-language.ts:122 — `PlainLanguageValidationOptionsSchema.parse(options ?? {});` — `?? default` silently defaults absent options instead of fail-fast with a named error.
- packages/notices/src/plain-language.ts:123 — `const maxWords = opts.maxWords ?? PLAIN_LANGUAGE_MAX_WORDS;` — `?? default` silently defaults absent `maxWords` instead of fail-fast with a named error.
- packages/notices/src/plain-language.ts:128 — `opts.locale ?? "es",` — `?? default` silently defaults absent locale instead of fail-fast with a named error.
- packages/notices/src/plain-language.ts:149 — `const occurrence = occurrences.get(value) ?? 0;` — `?? default` / `.get(k, default)` silently defaults absent map entry instead of explicit missing-state handling.

## R3

No violations found.

## R4

Repeated WITHIN this slice:

- `"subject"` — packages/notices/src/notice-composer.ts:161,173,180,188,227,233,243,248 (artifact scope discriminator repeated 8× in one file; must live in a shared constant).
- `"authority"` — packages/notices/src/notice-composer.ts:86,96 (artifact scope discriminator repeated 2× in one file; must live in a shared constant).
- `"exempted"` (state value) — packages/notices/src/notice-composer.ts:214,239,242,247; also packages/notices/src/exemption-engine.ts:51,67,87 (as `kind: "exempted"` result kind) — same operational string in 2 files within the slice.
- `"c"` (exemption letter) — packages/notices/src/notice-composer.ts:226,232; packages/notices/src/exemption-engine.ts:82,90 — same operational literal in 2 files within the slice.
- `crypto.randomUUID()` — packages/notices/src/notice-composer.ts:108,170 — same operational call hardcoded twice within one file.
- `"a"` (exemption letter) — packages/notices/src/exemption-engine.ts:46,54 — repeated 2× within one file.
- `"es"` (default locale) — packages/notices/src/notice-composer.ts:169; packages/notices/src/plain-language.ts:86 (default param),128 — same operational literal in 2 files within the slice.

Cross-file-literal candidates for global synthesis (value + file:line each):

- `"sha256"` — packages/notices/src/canonical-hasher.ts:33
- `"utf8"` — packages/notices/src/canonical-hasher.ts:34
- `"hex"` — packages/notices/src/canonical-hasher.ts:35
- `"state"` — packages/notices/src/canonical-hasher.ts:9
- `"review_approval_id"` — packages/notices/src/canonical-hasher.ts:10
- `"submitted_at_utc"` — packages/notices/src/canonical-hasher.ts:11
- `"not_required"` — packages/notices/src/notice-composer.ts:187,204,242
- `"draft"` — packages/notices/src/notice-composer.ts:213,241
- `"exempted"` — packages/notices/src/notice-composer.ts:214,239,242,247; packages/notices/src/exemption-engine.ts:51,67,87
- `"subject"` — packages/notices/src/notice-composer.ts:161,173,180,188,227,233,243,248
- `"authority"` — packages/notices/src/notice-composer.ts:86,96
- `"EU_GDPR"` — packages/notices/src/notice-composer.ts:107
- `"severity:C"` — packages/notices/src/notice-composer.ts:127
- `"impact:V"` — packages/notices/src/notice-composer.ts:130
- `"sensitive_data_types"` — packages/notices/src/notice-composer.ts:133
- `"num_affected_subjects>=100"` — packages/notices/src/notice-composer.ts:139
- `"unencrypted_exfiltration"` — packages/notices/src/notice-composer.ts:142
- `"authority_ordered"` — packages/notices/src/notice-composer.ts:145
- `"AUTHORITY_OVERRIDE"` — packages/notices/src/exemption-engine.ts:28
- `"ENCRYPTION_VERIFIED"` — packages/notices/src/exemption-engine.ts:52
- `"RISK_ELIMINATED"` — packages/notices/src/exemption-engine.ts:68
- `"DISPROPORTIONATE_EFFORT"` — packages/notices/src/exemption-engine.ts:88
- `"NO_EXEMPTION_QUALIFIED"` — packages/notices/src/exemption-engine.ts:100
- `"NUMERIC_CONTENT_UNAPPROVED"` — packages/notices/src/plain-language.ts:160

## R5

No violations found.

## R6

No violations found.

## Summary

| Rule | Count |
|------|-------|
| R1 | 0 |
| R2 | 14 |
| R3 | 0 |
| R4 | 7 within-slice repeats + 24 cross-file candidates |
| R5 | 0 |
| R6 | 0 |
| Total | 14 violations + R4 literal inventory above |
