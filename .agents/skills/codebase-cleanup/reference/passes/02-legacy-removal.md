# Pass 2 — Legacy, deprecated, and fallback code

You are pass 2 of 8. Read `../protocol.md` first.

## Goal

Remove code paths that exist only for compatibility with a state of the world that no longer applies: deprecated APIs no caller still uses, fallback branches whose primary path is universally available now, version-detection forks where one branch is dead, feature flags that have been fully rolled out (or fully rolled back).

## What counts as a hit

- Functions / methods marked `@deprecated` (or equivalent) with no remaining callers in the repo
- Fallback branches: `if (typeof Promise === 'undefined') { /* old impl */ }` — Promises are universal now
- Version-gating logic for runtimes / browsers / libraries the project no longer supports
- Feature flags that are 100% on or 100% off in all environments and have been for a while
- Dual implementations behind `if (USE_NEW_X)` flags where one side is dead
- "Old" / "legacy" / "v1" suffixes on functions / classes / files that have a "new" / "v2" version which has fully replaced them
- Compatibility shims for languages versions / platform versions older than what the project now supports
- Polyfills for features now in the language baseline

## What to skip (false positives)

- Deprecated APIs still referenced by tests, examples, or docs (those callers are real)
- Fallbacks for genuinely-still-needed scenarios (e.g. browser support for a still-supported old browser)
- Feature flags that look fully-on but actually gate a kill-switch the team relies on for incidents
- Backwards-compat shims explicitly required by the project's stated support matrix
- Code that _looks_ legacy by name but is actively maintained — names lie

Always check: package's stated support matrix, downstream consumers, and the project's release notes / CHANGELOG before deleting "legacy" code.

## Tools

- Linter rules: `@typescript-eslint/no-deprecated`, `eslint-plugin-deprecation`, language equivalents
- `grep -rn '@deprecated'` (and language-equivalents like `// Deprecated`, `[Obsolete]`, `Deprecated`)
- `grep -rn 'legacy\|Legacy\|v1\|old_\|_old'` for naming clues — investigate, don't auto-delete
- `git log` on a feature-flag definition: if the flag value hasn't been touched in 12+ months and ships the same value everywhere, it's a candidate
- For library-version forks: check the package.json / pyproject / Cargo.toml minimum versions and cross-reference

## High-confidence threshold

Remove only when:

1. There are zero references to the deprecated symbol (in src, tests, examples, docs).
2. The fallback branch's "needed" condition is provably false in all supported environments.
3. The feature flag's fallback is provably unreachable (fully rolled out, or fully rolled back AND the rollback isn't a kill-switch).
4. Removing the legacy version doesn't break a public API contract this project commits to.

## Output shape

Per the protocol. Note in your assessment which legacy items you considered but rejected as still-needed, with reason — this is valuable signal even when you don't act.

## Out-of-scope

- Don't rename "legacy"-named things to "current" names. Renaming is a different pass.
- Don't delete code that's just _unused_ but not legacy — that's pass 3.
- Don't unify duplicated code paths even if both look legacy — that's pass 8.
