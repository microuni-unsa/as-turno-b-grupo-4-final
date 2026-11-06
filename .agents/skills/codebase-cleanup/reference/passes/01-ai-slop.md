# Pass 1 — AI slop, stubs, larp, and stale comments

You are pass 1 of 8. Read `../protocol.md` first — you must follow the 3-phase research/assess/implement structure. This file specifies the domain-specific bits.

## Goal

Remove generated noise that nobody would have written by hand: in-motion-work comments, "previously this did X, now it does Y" diff narration, larp ("Production-grade enterprise solution"), unnecessary boilerplate, stub bodies that pretend to be real, and explanatory comments that re-narrate code instead of explaining the _why_.

## What counts as a hit

- Comments that describe the _change_ rather than the code: `// Updated to handle null case`, `// Refactored from foo to bar`, `// New approach: ...`
- Comments that re-narrate code visible right next to them: `// Increment counter` above `counter++`
- Larp adjectives: "robust", "production-grade", "enterprise-ready", "comprehensive", "best-in-class", "world-class" — when they're describing code, not documenting requirements
- Stub bodies: `throw new Error("not implemented")` in functions that callers actually invoke at runtime
- Pseudo-typed stubs: functions whose return type is `any` / `unknown` and whose body just returns `{} as any`
- AI-style decorative comments: section banners (`// ============ Helpers ============`) where the code structure already conveys it
- TODO comments older than the git history of the surrounding code (probably forgotten)
- Comments that explain _what_ well-named identifiers already explain
- "For future use" / "may be needed later" placeholders with no consumer

## What to skip (false positives)

- Comments documenting _why_ a non-obvious decision was made — keep these even if terse
- Comments documenting a workaround for a specific bug / browser quirk / library version — keep, possibly with a link
- Comments above code that _intentionally_ looks wrong (e.g. `// SAFETY:` blocks in unsafe Rust)
- License headers, copyright notices, generated-file markers
- Doc comments (`///`, `/** */`, docstrings) on public APIs — these are documentation, not slop
- Test descriptions in `it(...)` / `describe(...)` / `test(...)` blocks
- Stubs that are explicitly marked WIP and have a tracking issue link

## Tools

- `grep -rn` for known slop phrases: "production-grade", "enterprise", "robust", "world-class", "Refactored", "Previously", "Updated to", "New approach"
- `git log -p` on suspicious comments — if the comment was added in a commit that _only_ added it (not the surrounding code), it's likely slop
- `git blame` — comments far older than the surrounding code that don't match its current behavior are stale
- For stubs: AST search for functions with body matching `throw.*not.implemented` or `return.*as any`

## High-confidence threshold

A comment / stub goes only when:

1. It matches a hit category above with no overlap with the false-positive list.
2. Removing it doesn't change runtime behavior (always true for comments; for stubs, verify no caller).
3. The surrounding code doesn't depend on the comment for any non-obvious reason.

## Output shape

Per the protocol, your assessment lists hits by category with counts and representative file:line samples. Implementation removes only high-confidence hits. Net delta should almost always be negative LoC.

## Out-of-scope

- Don't rewrite comments to be "better" — only remove or, if a comment is redundantly correct but worth keeping, leave it. Rewriting is a different pass.
- Don't add comments. This is a removal pass.
- Don't touch code semantics. Comments and unreachable stub bodies only.
