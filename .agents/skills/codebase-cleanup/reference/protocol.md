# 3-phase protocol

Every pass in this skill follows this exact protocol. The pass-specific files at `passes/*.md` only specify the domain-specific bits — what to look for, which tools to run, what counts as a "hit". The phasing and confidence rules below are universal.

## Shared design rules

Use the **Readability and module design** rules from the shared agent
instructions when evaluating every pass. Keep related operations and private
helpers with their owner. Preserve public contracts, error propagation,
completion, and cleanup. Test those behaviors through the interface when
`when-to-write-tests` says a test is needed; do not add a test per moved helper.

Retain configured line limits. Split coherent responsibilities, or document a
targeted increase when splitting would scatter one implementation. A smaller
file or shorter diff alone does not prove a readability improvement.

## Phase 1 — research (read-only)

Goal: build a complete, evidence-backed picture of the problem in this codebase. No edits.

- Read the relevant tooling output (linter, AST query, grep). Don't trust a single tool.
- For each candidate hit, verify it's real by reading the actual code and the actual call sites.
- For each candidate, note: file path, line range, evidence (what tool flagged it, why), risk-of-removal (can this break runtime / tests / public API / downstream packages?).

Stop and report rather than guessing when:

- The tool output is ambiguous and you can't disambiguate from the code alone.
- The change would touch a public API surface (exported symbols, schema, DB shape).
- The codebase has reflection / dynamic dispatch / string-keyed lookups that defeat static analysis.

## Phase 2 — critical assessment (read-only)

Produce a markdown document with three sections:

```
# <pass-name> — assessment for <repo>

## Findings
<one bullet per category of hit, with counts and representative file:line examples>

## High-confidence recommendations
<numbered list of changes you would make if invoked. Each has:
 - file:line
 - one-line diff sketch
 - why it's safe (what proves removing/changing this won't break things)>

## Low-confidence findings (NOT actioning)
<changes that look like wins but where you can't prove safety. These get reported, not done.>

## Out-of-scope but noticed
<things that belong to a *different* pass — do not implement, just flag>
```

The "high-confidence" bar is high. A finding is high-confidence only when:

1. The evidence is from at least two independent signals (tool + code-read, or tool + test-run, etc.).
2. You've verified there are no callers / no dynamic references / no external consumers depending on it.
3. The change is local — doesn't ripple across module boundaries unpredictably.
4. If a test exists for this code, the test will keep passing (or the test was itself testing the dead thing, in which case the test goes too).

If you can't meet all four, it's low-confidence — report it, don't action it.

## Phase 3 — implementation (high-confidence only)

For each high-confidence recommendation:

- Make the change.
- Run typecheck + test suite if they exist.
- If anything breaks, revert that specific change and demote it to low-confidence in the assessment.
- Don't bundle unrelated fixes into the same edit.
- Don't expand scope into other passes' territory — flag it in "out-of-scope" and stop.

End with:

```
# <pass-name> — implementation report
- Applied: <count> high-confidence changes
- Reverted: <count> (with reason)
- Test status: <pass|fail|n/a>
- Readability effect: <knowledge hidden, navigation removed, or ownership clarified>
- Net LoC delta: <+X/-Y, descriptive only>
```

## Stop conditions

A pass stops early (does not proceed to Phase 3) if:

- Phase 1 surfaces zero candidates → trivially done.
- Phase 2 produces zero high-confidence recommendations → emit assessment, skip implementation.
- Tests are broken before the pass starts → report and stop; the pass is unsafe on a red baseline.
- The codebase has no working build / typecheck → report and stop; can't verify safety.
