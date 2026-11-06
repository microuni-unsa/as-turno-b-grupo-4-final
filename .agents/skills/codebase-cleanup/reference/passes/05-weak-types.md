# Pass 5 — Weak types

You are pass 5 of 8. Read `../protocol.md` first.

## Goal

Replace weak / escape-hatch types with strong, accurate ones. The goal is correctness, not type-system purism — every replacement must be a type that's actually true at runtime, verified by reading the code that produces / consumes the value.

## What counts as a hit

- TypeScript: `any`, `unknown` (where the actual type is knowable), `Function`, `Object`, `{}`, `as any` casts, `// @ts-ignore` / `// @ts-expect-error` without a tracking comment
- TypeScript: index signatures (`{ [key: string]: any }`) where the keys are actually a finite known set
- Python: `Any`, missing annotations on public functions, `dict` / `list` without type parameters
- Rust: `Box<dyn Any>` where the concrete type is knowable, overuse of `String` where `&str` or an enum is correct
- Go: `interface{}` / `any` in places where a concrete type or a small interface would do
- Java/Kotlin: `Object` parameters/returns, raw generic types
- C#: `object`, `dynamic` (when used to hide poor design rather than for genuine dynamism)

## What to skip (false positives)

- **Genuinely dynamic data at the boundary** — JSON from external APIs, user input, plugin payloads. The right type there _is_ `unknown` (TS) or `Any` (Python) until validated. Replacing it with a concrete type is a lie that causes bugs.
- **Type-erased generics in language designs that require it** (e.g. some reflection-heavy frameworks)
- **Library escape hatches** intentionally typed as `any` for ergonomics on the caller side
- **`unknown` after a parsing step** where the next operation is the validation — leave it for the validator to narrow
- **External library types** that cannot be changed locally — keep the external
  type honest, and validate unknown values before they enter the domain

If you can't prove the value's actual shape from the code, the type was right to be weak. Don't fabricate a strong type.

## Research process

For each weak type:

1. Read where the value comes from. Trace it back to its source.
2. Read where the value goes. What operations are done on it? Those operations imply structure.
3. If the value crosses a boundary (API, DB, file, IPC), read the schema / SDK / wire format. The strong type lives there.
4. Reuse the owning schema's inferred type or an accurate library contract. A
   handwritten interface or query generic alone does not validate external data.
5. Look at related packages / SDKs — they often export the right type.

## Tools

- **TS**: `tsc --noImplicitAny --strict`, ESLint `@typescript-eslint/no-explicit-any`, `no-unsafe-*` rules
- **Python**: `mypy --strict`, `pyright`
- **Rust**: clippy lints
- **Go**: `staticcheck`, `golangci-lint`
- AST search for `as any`, `: any`, `interface{}`, `Any` annotations

## High-confidence threshold

Replace only when:

1. You've traced the value's actual shape from real code (production path, not test).
2. The new type is provably accurate — every operation done on the value is a valid operation on the new type.
3. The replacement doesn't widen _somewhere else_ (e.g. forcing a callsite to add `as any` to compile).
4. Typecheck passes after the change.

If the type is "knowable in principle" but the trace requires understanding behavior in 5+ files, flag as low-confidence.

## Output shape

Per the protocol. Per-finding, include the source-of-truth you used to derive the strong type (e.g. "OpenAPI schema for `/users/{id}`", "exported `User` from `@app/db`").

## Out-of-scope

- Don't refactor data shapes to make typing easier. The type follows the data, not the other way.
- Don't introduce a heavy schema-validation library where one isn't already used. That's a separate architectural decision.
- Don't unify duplicated types you discover here — that's pass 6.
