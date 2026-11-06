# Pass 8 — DRY / dedup

You are pass 8 of 8. Read `../protocol.md` first.

This is the most judgment-heavy pass. The bar for a high-confidence finding here is the highest of any pass.

## Goal

Consolidate duplicated logic _only_ where the consolidation reduces complexity. Three identical lines is sometimes the right code. A premature abstraction is always the wrong code. Your job is to find the cases where unification clearly wins and to leave everything else alone.

## What counts as a hit

- Two or more places implementing the _same operation_ on the _same domain_ with the _same edge cases_ — and where a single function would naturally name what they're doing
- Repeated boilerplate that has no semantic value (`if (!user) throw new Error('unauthenticated')` at the top of N handlers — middleware, not a helper)
- Copy-paste blocks (literally character-for-character identical) of >5 lines, where the duplication wasn't intentional
- Repeated type-narrowing patterns that already have a natural helper name (`assertIsUser(x)` vs inline `if (!x.id || !x.email) throw`)
- N implementations of the same algorithm where one is correct and the others are stale

## What to skip — and this is most of the apparent duplication

- **Code that looks similar but means different things**. Two functions that both do `total += item.price` aren't duplicates if one is summing line items and the other is summing taxes — even if the code is identical, they'll evolve in different directions.
- **Premature abstraction candidates**. Call count alone does not justify an
  abstraction. It should hide complexity or enable useful reuse, without making
  callers understand a generic mechanism.
- **Test code**. Test repetition is often _the point_ — explicit, self-contained tests are easier to read than a DRY test framework. Don't DRY tests unless the duplication is mechanical setup that's clearly orthogonal to what's being tested.
- **Configuration values**. Two configs with the same fields are not duplicates; configs are data, not logic.
- **Boilerplate that the language requires**. Constructor argument lists, getter/setter pairs, etc. — language-imposed, not real duplication.
- **Code intentionally kept separate for blast-radius reasons** — service A and service B both compute hashes the same way, but unifying them creates a deploy-coupling neither team wants.

The rule: code is duplicated if and only if changes to one _should_ always be made to the other. If they'd evolve independently, they're not duplicates — they're parallel.

## Process per candidate

1. Read all candidate occurrences. Are they really doing the same thing semantically, not just textually?
2. If you abstracted them, what would the function be called? If the name is honest and obvious (`computeShippingCost`), good sign. If the name is generic (`processItem`, `handleData`, `doThing`), the duplication is probably superficial.
3. Would the abstraction make the call sites _easier or harder_ to read? If callers now need to understand a generic helper to know what's happening locally, the abstraction loses.
4. Is the proposed abstraction stable? Do the callsites all want the same parameters today? Will they tomorrow?
5. If you can't answer #2 with a clean name, walk away.

## Tools

- `jscpd` (TS/JS/many languages) — finds character-level duplicate blocks
- `pmd-cpd` (Java/multi-lang)
- `simian` (cross-language)
- Manual: search for distinctive lines / comments and see if they appear elsewhere

Use these tools to _find candidates_. They cannot tell you whether deduplication is the right answer.

## High-confidence threshold

Consolidate only when:

1. The duplication is semantic (not just textual).
2. The abstraction has an obvious, honest name.
3. The unified callsite is at least as readable as the duplicated version.
4. The callsites share a responsibility and benefit from maintaining it together;
   there is no minimum call count that substitutes for this judgment.
5. No callsite needs a special-case parameter or flag to fit the abstraction (if it does, your abstraction is wrong — back out).
6. Tests pass after consolidation.

If you're unsure, leave it duplicated. The cost of a missed dedup is low. The cost of a wrong abstraction is high — every reader has to learn an unnecessary indirection, and future changes pay the abstraction tax forever.

## Output shape

Per the protocol. In your assessment, include a "considered but rejected" section with at least as many entries as your "applied" section — DRY is the pass where saying _no_ is most of the work, and showing your reasoning is the value-add.

## Out-of-scope

- Don't introduce inheritance hierarchies, mixins, or higher-order helpers to chase 2-line wins.
- Do not create a shared grab-bag package. Cross-package reuse needs a clear
  domain owner and a public interface; a local helper may remain with one caller
  when its name hides meaningful complexity.
- Don't deduplicate types — that was pass 6.
- Don't deduplicate identical-looking error messages — they're usually fine duplicated; centralizing them tends to drift from what each callsite actually wants to say.
