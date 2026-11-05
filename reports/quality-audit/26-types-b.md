# Slice 26 types-b — Quality Audit

Audited files (date 2026-11-05):

- `packages/types/src/constants.ts` — 126 lines
- `packages/types/src/errors.ts` — 1003 lines
- `packages/types/src/evidence.ts` — 167 lines
- `packages/types/src/index.ts` — 12 lines

## R1

No violations found.

(All four files are declarative: constant declarations, error-class constructors with no `if/else`/`switch`/pattern-match statements, zod schema builders, and barrel re-exports. There are no branches whose state handling could be implicit. `??` default expressions in `errors.ts` are covered under R2, not R1, per the contract's branch wording.)

## R2

- `packages/types/src/errors.ts:39` — `const errorDetails = details ?? fields;` — `??` fallback chain hiding absent state: silently prefers `details`, else `fields`, else `undefined`, with no fail-fast or named error when both are absent and no record of which source won.
- `packages/types/src/errors.ts:191` — `details ?? { rawBody: rawBody ?? "" },` — nested `??` fallback chain with silent default: absent `rawBody` becomes `""` inside a synthesized object, hiding the absent-vs-empty distinction instead of fail-fast with a named error.

Notes (deliberately NOT reported as violations): optional constructor message defaults of the form `message = "..."` (e.g. `errors.ts:22,49,58,104,113,122` and ~30 similar) and `message ?? ...` message fallbacks (e.g. `errors.ts:40,69,79,95,133,147,208,279,290`) supply a documented display string for an explicitly optional parameter of a dedicated named error class; they do not mask operational state or continue control flow past a failure. `maxWords = PLAIN_LANGUAGE_MAX_WORDS` (`errors.ts:482`) defaults to a named shared constant, not a silent literal.

## R3

No violations found.

(No backwards-compat shims, polyfills, legacy wrappers, deprecated-API support, version sniffing, or `// for backwards compat` paths in any of the four files.)

## R4

Within-slice repeats (same literal hardcoded 2+ times inside this slice):

- `packages/types/src/constants.ts:13,26` — `"jpg"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_VISUAL_EXTENSIONS`
- `packages/types/src/constants.ts:14,27` — `"jpeg"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_VISUAL_EXTENSIONS`
- `packages/types/src/constants.ts:15,28` — `"png"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_VISUAL_EXTENSIONS`
- `packages/types/src/constants.ts:16,29` — `"tif"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_VISUAL_EXTENSIONS`
- `packages/types/src/constants.ts:17,30` — `"bmp"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_VISUAL_EXTENSIONS`
- `packages/types/src/constants.ts:18,31` — `"pdf"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_VISUAL_EXTENSIONS`
- `packages/types/src/constants.ts:19,35` — `"doc"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_WORD_EXTENSIONS`
- `packages/types/src/constants.ts:20,36` — `"docx"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_WORD_EXTENSIONS`
- `packages/types/src/constants.ts:21,33` — `"txt"` in `ATTACHMENT_EXTENSIONS` and `ATTACHMENT_TEXT_EXTENSIONS`
- `packages/types/src/constants.ts:61,83` — `5000` as `DEFAULT_RAG_TIMEOUT_MS` and `DEFAULT_WATCHER_POLL_INTERVAL_MS`
- `packages/types/src/constants.ts:113` + `packages/types/src/evidence.ts:87` — `"1.0"` as `ROLE_PROMPT_VERSION` and `z.literal("1.0")` export version
- `packages/types/src/evidence.ts:18,65` — `64` as `.length(64)` sha256 length in `EvidenceAttachmentSchema` and `EvidenceBundleManifestSchema`
- `packages/types/src/evidence.ts:multiple` — `1` as `.min(1)` lower bound repeated ~30x across schemas (e.g. lines 17,18,20,23,25,30,52,54,63,77,78,79,81,82,88,97,98,105,106,107,116,118,119,120,132,136,137,138,140,148,156,157,165)
- `packages/types/src/errors.ts:778,871,991` — `","` separator in `candidates.join(",")` (line 777-778, twice on adjacent lines), `fields.join(",")` (lines 871, 991)

Cross-file-literal candidates for global synthesis (literal + each location in this slice; orchestrator to confirm the other file outside the slice):

- `"https://api.openai.com/v1"` — `packages/types/src/constants.ts:56`
- `"https://api.cohere.com"` — `packages/types/src/constants.ts:73`
- `"https://unsa.27k.pe"` — `packages/types/src/constants.ts:3`
- `"unsa"` — `packages/types/src/constants.ts:4`
- `"agi1"` — `packages/types/src/constants.ts:7`
- `"rerank-v3.5"` — `packages/types/src/constants.ts:74`
- `"corpus"` — `packages/types/src/constants.ts:82`
- `"bundle.json.txt"` — `packages/types/src/constants.ts:88`
- `"[DOC:"` — `packages/types/src/constants.ts:109`
- `"1.0.0"` — `packages/types/src/constants.ts:111`
- `"password123"` — `packages/types/src/constants.ts:63`
- `15000` — `packages/types/src/constants.ts:5`
- `3` — `packages/types/src/constants.ts:6`
- `10` — `packages/types/src/constants.ts:9`
- `1000` — `packages/types/src/constants.ts:10,117`
- `100` — `packages/types/src/constants.ts:39,116`
- `25` — `packages/types/src/constants.ts:40,80`
- `1024` — `packages/types/src/constants.ts:57`
- `8` — `packages/types/src/constants.ts:58`
- `4` — `packages/types/src/constants.ts:59`
- `0.35` — `packages/types/src/constants.ts:60`
- `450` — `packages/types/src/constants.ts:64`
- `60` — `packages/types/src/constants.ts:75`
- `1.0` / `1.2` — `packages/types/src/constants.ts:76,77`
- `30` / `80` — `packages/types/src/constants.ts:78,79`
- `2` — `packages/types/src/constants.ts:81`
- `4096` — `packages/types/src/constants.ts:110`
- `3600` — `packages/types/src/constants.ts:112`
- `0.1` — `packages/types/src/constants.ts:114`
- `20` — `packages/types/src/constants.ts:115`
- `48` — `packages/types/src/constants.ts:118`
- `"evidence-bundle"` — `packages/types/src/evidence.ts:62`
- `"queued"`, `"sent"`, `"failed"` — `packages/types/src/evidence.ts:150`
- `"5-whys"`, `"fishbone"`, `"fault-tree"` — `packages/types/src/evidence.ts:4`
- `"72H"`, `"SUBJECT"`, `"REVIEW_SLA"` — `packages/types/src/errors.ts:915`
- `"M"`, `"A"`, `"T"`, `"E"` — `packages/types/src/evidence.ts:126`

## R5

No violations found.

(No machine-dependent paths, `../..` escapes, `file:///` URLs, drive-letter paths, or hardcoded `/tmp/...` strings. `DEFAULT_CORPUS_DIR = "corpus"` in `constants.ts:82` is a project-root-relative name. HTTP(S) base URLs in `constants.ts:3,56,73` are service endpoints, not filesystem paths.)

## R6

No violations found.

(No hand-rolled retry/glob/deep-equal/date-math/slugify/validation utilities in these files. `formatCorpusHeader` in `constants.ts:120-126` is a one-line domain-specific template literal, not a reimplementation of a stdlib/framework helper. `new Set([...])` in `constants.ts:25-37`, `Array.prototype.join` in `errors.ts:777-778,871,991`, and zod schema builders in `evidence.ts` all use the native/ecosystem-provided facility directly. `Object.setPrototypeOf(this, new.target.prototype)` in `errors.ts:15` is the standard native pattern for extending `Error`, not a custom utility.)

## Summary

| Rule | Count |
| ---- | ----- |
| R1 | 0 |
| R2 | 2 |
| R3 | 0 |
| R4 | 14 within-slice repeat groups (+27 cross-file candidates for synthesis) |
| R5 | 0 |
| R6 | 0 |
| Total | 16 confirmed violation entries |
