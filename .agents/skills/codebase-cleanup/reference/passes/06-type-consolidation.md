# Pass 6 — Type consolidation

You are pass 6 of 8. Read `../protocol.md` first.

## Goal

Find duplicated and near-duplicated type / interface / struct / class definitions and unify them where unification reduces complexity. Keep duplicates where they describe genuinely different things that happen to share shape.

## What counts as a hit

- Two types with identical shape and identical semantic meaning (e.g. two `User` types with the same fields, both representing the same domain user)
- Types that are subsets of each other where the subset is artificially distinct (and `Pick` / `Omit` / language equivalent would express the relationship correctly)
- Types where one is a stale copy that's drifted from the canonical version (and the canonical version is now correct)
- Types defined in N places that all originated from a copy-paste of one source-of-truth (e.g. an API response shape duplicated across services that should import from a shared package)
- Branded / nominal type wrappers around the same primitive that mean the same thing (`type UserId = string & { __brand: 'UserId' }` defined in two files)

## What to skip (false positives)

- **Coincidentally identical shapes** that mean different things (e.g. a `Point2D` for a chart and a `Point2D` for a map UI — same `{x, y}`, but unifying couples two unrelated concerns)
- **Public API contracts** — a library's exported type and a consumer's local type may have the same shape today and intentionally diverge tomorrow
- **Versioned schemas** — `UserV1` and `UserV2` with the same fields are still distinct if they exist for migration reasons
- **DTOs vs domain models** — `UserDTO` (wire shape) and `User` (in-memory shape) often have the same fields but different invariants and lifecycles
- **Generated types** — types produced by codegen (Prisma, OpenAPI, GraphQL) shouldn't be hand-edited; if a duplicate exists by hand, the hand-written one is the candidate, not the generated one

## Tools

- **TS**: `dtslint` rules, `ts-morph` AST query, `jscpd` (works on text but catches type-text duplication)
- **Cross-package similarity**: `git grep` for distinctive field names; manually compare the candidates
- For drift detection: read the most recent edits in each definition's git history — if one was edited recently and the other wasn't, the unedited one is probably stale

## Consolidation strategy

When you find duplicates that should unify:

1. **Pick the canonical home** — the domain that owns the concept. Import count
   or proximity to a database does not establish ownership; investigate if unclear.
2. **Keep the contract together** — colocate a schema and its inferred type.
   Reuse an existing generated or library contract when it fits.
3. **Expose deliberately** — use explicit public package entries for consumers,
   without chains of internal barrels or old-location forwarding modules.
4. **Update imports** — change consumers to the owning module or public entry.
5. **Delete the duplicates.**

Avoid creating a `types/` mega-package as a generic dumping ground for all shared types. Each type should live in the package that owns its concept.

## High-confidence threshold

Unify only when:

1. The two types are _semantically_ the same, not just structurally — verified by reading the code that produces and consumes each.
2. There's a clear canonical home.
3. All callsites can use the unified type without a cast or wrapper.
4. Typecheck and tests pass after consolidation.

If two types look the same but you can't verify the semantic equivalence (different teams own them, no docstrings, ambiguous usage), flag as low-confidence.

## Output shape

Per the protocol. List each duplicate group with: the chosen canonical, the duplicates removed, and the consumers updated.

## Out-of-scope

- Don't rename types to be "more consistent" across the codebase. Naming is judgment-heavy and not in scope here.
- Don't introduce `Pick<T, K>` / `Omit<T, K>` chains to express relationships if they're not already idiomatic in the codebase.
- Don't merge types that are _different concepts_ with the same shape — even if it would reduce LoC. That's anti-DRY.
