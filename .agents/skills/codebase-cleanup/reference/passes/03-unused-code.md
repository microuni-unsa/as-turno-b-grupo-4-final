# Pass 3 — Unused code

You are pass 3 of 8. Read `../protocol.md` first.

## Goal

Remove code that is verifiably not referenced anywhere — exports nothing imports, files nothing references, dependencies nothing uses, dead variables / parameters / branches.

## What counts as a hit

- Exported symbols (functions, classes, types, constants) with zero imports across the workspace
- Internal symbols defined but never referenced
- Whole files imported by nothing
- `package.json` dependencies / devDependencies not actually imported
- Function parameters that are unused (not a hit if they're there to satisfy a callback shape — verify)
- Local variables assigned and never read
- Unreachable branches: `if (false) { ... }`, code after unconditional `return` / `throw`
- Test fixtures / helpers used by zero tests
- Generated types for endpoints / schemas that no longer exist

## What to skip (false positives)

- **Public API exports** — even with zero internal callers, they may be the package's reason to exist. Cross-reference against the package's `main` / `exports` / index entry point and any consumer listed in workspace dependencies.
- **Dynamic imports / reflection** — `require(name)` where `name` is a string variable, `import()` with computed paths, dependency injection containers, RPC routers that register handlers by name
- **String-keyed lookups** — `obj[key]` where keys are runtime strings, often from a config or schema
- **Test-only entry points** — code only run by `bun test` / `vitest` / `pytest` won't show up in a production-mode static analysis
- **CLI bin scripts** referenced from `package.json` `bin` — won't appear in source imports
- **Plugins / hooks discovered by convention** — Next.js pages, Webpack plugins, Vite plugins, ESLint rules
- **Side-effect-only modules** — imports that exist purely to register globals or run setup
- **Codegen targets / templates** — files emitted or consumed by a build step

For dynamically-resolved code, you cannot rely on tools alone. Read the resolver code and trace what it can pull in.

## Tools

- **TypeScript / JavaScript**: `knip`, `ts-prune`, `unimported`, `depcheck` (deps), `eslint --rule no-unused-vars`
- **Python**: `vulture`, `pyflakes`, `pip-autoremove` (deps)
- **Rust**: `cargo +nightly udeps`, compiler dead-code warnings (`#![warn(dead_code)]`)
- **Go**: `staticcheck` (U1000 for unused), `unused` from honnef.co
- Cross-reference any "unused" finding against `git grep -F '<symbolName>'` to catch string-key references the AST tools miss

## High-confidence threshold

Remove only when:

1. At least two independent tools flag it (or one tool + a manual `git grep` for the symbol in strings, configs, generated files, and downstream packages).
2. It's not part of the public API surface.
3. It's not in a dynamic-resolution code path you've checked.
4. Tests pass after removal.

For dependencies specifically: also check Dockerfile / CI scripts / runtime config that might use them.

## Output shape

Per the protocol. Be especially explicit in "Low-confidence findings" — unused-code analysis has a long tail of false positives, and the value of _flagging_ a suspicious item for human review is high even when you don't action it.

## Out-of-scope

- Don't refactor "unused but should be used" code (e.g. an exported helper that callers should be using but aren't). Flag it; don't act.
- Don't merge two near-duplicate functions even if one is unused — that's pass 8.
