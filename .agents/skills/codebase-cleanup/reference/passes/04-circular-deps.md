# Pass 4 — Circular dependencies

You are pass 4 of 8. Read `../protocol.md` first.

## Goal

Detect import cycles between modules / packages and untangle them. Cycles cause: undefined-on-import bugs, fragile build/HMR behavior, harder testing, and tight coupling that resists refactoring later.

## What counts as a hit

- Two-module cycle: `A → B → A`
- N-module cycle: `A → B → C → A`
- Inter-package cycles in a monorepo (`pkg-a → pkg-b → pkg-a`)
- Self-edges where they cause real problems (less common; usually benign)

## What to skip (false positives)

- Cycles that exist only between _type-only_ imports in TypeScript (`import type`) — these are erased at runtime and don't cause the usual cycle pathologies. Flag for cleanliness, but lower priority.
- Cycles that the language / module system intentionally permits and resolves cleanly (e.g. mutually-recursive types in Haskell, certain Python lazy imports).
- Cycles confined entirely to a test directory — these are typically intentional shared fixtures and don't cause runtime issues.

## Tools

- **TS/JS**: `madge --circular --extensions ts,tsx,js,jsx <src>`; `dpdm`; ESLint `import/no-cycle` rule
- **Python**: `pylint --enable=cyclic-import`, `pydeps`
- **Rust**: `cargo-modules`, manual inspection of `mod` graph (Rust at the module level usually catches cycles via the compiler; package-level cycles are caught by Cargo)
- **Go**: compiler catches package-level cycles directly; for finer analysis use `goda`

## Refactor strategies (in order of preference)

When a cycle exists, the fix is usually one of these:

1. **Correct ownership** — move logic to the side that owns it, or merge modules
   that form one responsibility and require each other to be understood.
2. **Extract** — share a coherent concept when it hides complexity or enables
   useful reuse. A new generic `shared` file is not automatically an improvement.
3. **Inline** — keep an operation-local detail with its owner when that removes
   an unnecessary dependency.
4. **Type-only-ize** — if the cycle is purely for types (TS), use `import type` to
   break the runtime edge.
5. **Lazy import** — last resort. Defers the problem rather than solving it.
   Only use when the call site is a slow path and refactoring is out of scope.

Avoid: introducing dependency-injection or interfaces _just_ to break a cycle. That's a structural change masquerading as a cleanup.

## High-confidence threshold

Apply a cycle-breaking refactor only when:

1. Tool detects the cycle and you've manually verified it via reading the imports.
2. The fix is one of strategies 1–4 above (no DI scaffolding, no architectural redesign).
3. The change is contained — touches only the modules in the cycle.
4. Tests + typecheck pass after the change.

If the cycle is between domain modules whose refactor would ripple widely, flag it as low-confidence and stop.

## Output shape

Per the protocol. Include a list of all cycles with the fix strategy and confidence per cycle.

## Out-of-scope

- Don't introduce `interfaces/` or `types/` directories as a generic "fix architecture" move. That's a redesign, not a cleanup.
- Do not merge unrelated domains just to remove a graph edge. Merging a single
  scattered responsibility is valid; retain file limits with a documented,
  targeted exception where justified.
- Don't fix the cycle by making one module re-export the other's symbols transitively. Same hiding problem.
