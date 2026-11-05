# Slice 23 rag-loaders-a — Quality Audit

Audited files (line counts via `wc -l`), date 2026-11-05:

- `packages/rag/src/loaders/chunker.ts` — 144 lines
- `packages/rag/src/loaders/markdown.ts` — 98 lines
- `packages/rag/src/loaders/text.ts` — 102 lines
- `packages/rag/src/loaders/text-utils.ts` — 108 lines

## R1

No violations found.

## R2

- `packages/rag/src/loaders/chunker.ts:81` — `if (first === undefined) { break; }` — `first = pseudos[start]` is provably defined under the enclosing `while (start < pseudos.length)` guard, so the `undefined` arm is unreachable; silently `break`ing truncates output to partial windows instead of fail-fast with a named error (repo precedent for this exact class throws `RagIndexError`, cf. `markdown.ts:75-77`).
- `packages/rag/src/loaders/chunker.ts:88` — `if (candidate === undefined) { break; }` — same as above for `pseudos[end]` under `while (end < pseudos.length)`; silent truncation instead of fail-fast with `RagIndexError`.
- `packages/rag/src/loaders/chunker.ts:123` — `if (window.length === 0 || firstPseudo === undefined || ...` / `continue;` — `packWindows` never yields an empty window (each starts as `[first]`), so the arm is unreachable; silently dropping the window instead of fail-fast with a named error masks a logic bug.
- `packages/rag/src/loaders/markdown.ts:38` — `if (child !== undefined && child.type === "heading") {` — `children[i]` under `i < children.length` is provably defined; the `!== undefined` conjunct silently skips on impossible-`undefined` instead of fail-fast with `RagIndexError` (same function throws for the same class at line 75).
- `packages/rag/src/loaders/markdown.ts:61` — `if (first !== undefined && first.startLine > 1) {` — after the `headings.length === 0` early return, `headings[0]` is provably defined; silent skip drops the preamble section instead of fail-fast with a named error.
- `packages/rag/src/loaders/text-utils.ts:101` — `(lines[start] ?? "").trim()` — `start < end` bounds-checks the index so `undefined` is impossible; `?? ""` coerces a would-be out-of-bounds bug into "blank line" (loop keeps scanning) instead of fail-fast with a named error.
- `packages/rag/src/loaders/text-utils.ts:104` — `(lines[end - 1] ?? "").trim()` — same as above for the `end > start` bounds-checked index.

## R3

No violations found.

## R4

- `packages/rag/src/loaders/text.ts:98` + `packages/rag/src/loaders/markdown.ts:97` — `buffer.toString("utf-8")` in both files — same operational literal (`"utf-8"` encoding name) hardcoded in 2 files; must live in a shared constant/config.

Within-slice repeats noted for synthesis (single-file or primitive; not violations per the 2+ files clause):

- `"\n"` — `chunker.ts:91` (`.join("\n")`), `chunker.ts:130` (`.join("\n")`), `markdown.ts:63` (`.join("\n")`), `text.ts:56` (`.join("\n")`), `text-utils.ts:15` (`.replaceAll("\r\n", "\n")` / `.replaceAll("\r", "\n")`) — cross-file line-separator primitive; centralizing is a judgment call (universal primitive, not config).
- `" "` — `chunker.ts:39` (template `` `${current.join(" ")} ${word}` ``), `chunker.ts:41` (`.join(" ")`), `chunker.ts:44` (`.join(" ")`), `chunker.ts:49` (`.join(" ")`) — repeated within one file only.
- `""` — ubiquitous empty-string init/comparison (`chunker.ts:51`; `markdown.ts:18,21,50,63,84`; `text.ts:27,79`; `text-utils.ts:39,47,55,85,86,101,104`) — universal primitive, not operational.
- `1.3` token heuristic — `text-utils.ts:30` only, single use.
- `section ${index + 1}` (`text.ts:86`) vs `` `section line ${start}` `` (`markdown.ts:84`) — similar prefix but distinct literals, not the same literal.
- `".md"` / `".markdown"` (`markdown.ts:96`), `".txt"` / `".text"` (`text.ts:95`), `"document"` / `"preamble"` (`markdown.ts:55,66`) — each single-use within slice.

Cross-file-literal candidates where the other file is outside this slice: none observed — repo-wide grep for `"utf-8"` under `packages/rag/src` hits only the two files above; no other operational literal in these 4 files recurs elsewhere in the slice.

## R5

No violations found.

## R6

- `packages/rag/src/loaders/markdown.ts:16` — `function collectText(node: RootContent | Root | unknown): string {` (hand-rolled recursive mdast text extraction, lines 16-28) — ecosystem alternative: `mdast-util-to-string` from the remark/mdast ecosystem already in use (`remark`, `mdast` imports in the same file).
- `packages/rag/src/loaders/text-utils.ts:53` — `export function slugifyStem(stem: string): string {` (hand-rolled slugifier, lines 53-89) — ecosystem alternatives: `slugify` / `github-slugger`.

Considered but not violations: `countApproxTokens` / `splitWords` char-scanner loops (allocation-free by design; regex `split(/\s+)/` alternatives allocate intermediate arrays and differ on ASCII-vs-Unicode whitespace semantics); `normalizeLines` (no stdlib line-normalizer; trivial composition, not a library reinvention); `trimBlankEdges` (no direct stdlib/ecosystem equivalent for blank-edge trimming of a line array); `packWindows` / `expandSection` / `splitLongLine` (bespoke domain chunking logic); zod schemas (already the ecosystem solution, not hand-rolled validation).

## Summary

| Rule | Violations |
| ---- | ---------- |
| R1 Exhaustive Branching | 0 |
| R2 Zero Fallbacks | 7 |
| R3 No Unrequested Legacy Support | 0 |
| R4 No Repeated Cross-File Literals | 1 |
| R5 Strict Path Discipline | 0 |
| R6 Native & Ecosystem Solutions | 2 |
| **Total** | **10** |
