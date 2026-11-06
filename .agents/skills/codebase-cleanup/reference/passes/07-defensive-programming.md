# Pass 7 — Defensive programming

You are pass 7 of 8. Read `../protocol.md` first.

## Goal

Remove try/catch, null-guards, fallback returns, and other defensive scaffolding that doesn't serve a real purpose. Keep validation at genuine input boundaries and retain handling for reachable
failures, ordering, and resource cleanup inside the operation that owns them.
Internal code can have real failure and lifecycle responsibilities.

## What counts as a hit

- `try { ... } catch (e) { console.log(e) }` — catching to log and swallow, hiding real failures
- `try { ... } catch { return null }` / `return undefined` / `return defaultValue` — silent failure that breaks the type contract
- `try { ... } catch { /* ignore */ }` — explicit error hiding, no documentation of why it's safe
- Null-guards on values the type system already proves are non-null
- Null-guards immediately after a constructor that can't return null
- `if (!foo) return` defensive checks on parameters that callers always pass
- Recursive optional chaining (`a?.b?.c?.d?.e`) where the type proves earlier links can't be null
- Re-throwing wrapped errors (`catch (e) { throw new Error('failed: ' + e.message) }`) that lose the stack trace and add no information
- "Just in case" `Array.isArray(x) ? x : []` on values typed as arrays
- Default parameters / fallback values that mask programmer errors instead of reporting them

## What to skip (false positives — keep these)

- **Boundary catches**: anything that wraps `fetch`, `JSON.parse`, file I/O, child-process invocation, network calls, FFI, parsing user input
- **Catches that classify and re-route**: `catch (e) { if (e instanceof RetryableError) retry(); else throw }` — that's real handling
- **Catches with logging that propagates the error**: `catch (e) { logger.error(e); throw }` — observability + propagation, both real
- **Resource cleanup**: `try { ... } finally { close() }` or Effect scopes and
  finalizers — preserve cleanup on success, failure, and interruption
- **Completion and ordering**: waiting for writes, supervising owned tasks, and
  reporting delivery failures — do not replace these with detached work
- **Catches that handle a documented, reachable failure mode** — even if the handling is just emitting a metric and returning a sentinel — _if_ the contract documents the sentinel
- **Null-guards at API boundaries** where the type system can't reach (untyped callers, dynamic input)
- **Defensive checks in code that has been bitten by the failure mode before** — git blame / commit message will mention the incident

Trace the failure and completion paths. Git history can explain an invariant,
but a generic commit message does not prove that handling is unnecessary.
Retain meaningful handling when the code or its contract demonstrates the need.

## Process per finding

For each candidate try/catch or guard:

1. Identify the failure mode it claims to handle.
2. Verify the failure mode can actually happen given the surrounding types and call paths.
3. Check whether the handling is doing something useful (route, classify, observe, clean up) or just hiding.
4. If hiding without purpose → remove. The error should propagate.
5. If the failure mode can't happen → remove the guard.
6. If real handling → keep, but consider whether the catch is too broad (catching `Error` when only `NetworkError` is real).

## Tools

- AST search for `try {` blocks; classify each
- ESLint: `no-empty-catch`, `prefer-promise-reject-errors`, `@typescript-eslint/no-non-null-assertion`
- `grep -rn 'catch.*ignore\|catch.*log.*flush'` for known anti-patterns
- Git blame on each catch you're about to remove — read the introducing commit message

## High-confidence threshold

Remove a guard / catch only when:

1. The failure mode it claims to handle can't reach this code path (verified by tracing types and callers).
2. Or it's hiding without serving (logging-and-swallowing, returning-default, etc.) — and removing it lets a real error propagate to a real handler.
3. Tests pass after removal — particularly any test that exercises the would-be failure path.
4. There's no commit-message evidence that this guard exists because of a specific past incident.

If git history shows the guard was added in response to an incident, keep it (and consider documenting it).

## Output shape

Per the protocol. Be specific about what failure mode each removed guard claimed to handle and why it's no longer needed.

## Out-of-scope

- Don't introduce a new error type hierarchy. Removal pass only.
- Don't refactor error handling to use `Result<T, E>` / Either / similar patterns that aren't already idiomatic in this codebase. That's a redesign.
- Don't add `assert` calls to replace removed guards. If the removed guard was redundant, no replacement is needed; if it wasn't redundant, you shouldn't have removed it.
