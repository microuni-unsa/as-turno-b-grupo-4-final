---
name: codebase-cleanup
description: >-
  Safely simplify and maintain a codebase without adding features. Use for
  cleanup, dead-code removal, deduplication, stale docs, maintainability work,
  or a comprehensive code-quality audit. Keep narrow requests focused; use the
  eight-pass workflow only for an explicitly broad sweep.
---

# Codebase cleanup

A cleanup makes the requested scope smaller or truer; it is not a feature with
extra polish. Keep the diff limited to the ask, preserve real contracts, and
apply the **Readability and module design** rules from the shared agent
instructions. File count and net deleted lines are evidence, not goals.

## Choose the scope

- **Focused cleanup** is the default for a named issue or concern, such as
  removing one unused export, collapsing a duplicate helper, or correcting
  stale docs. Inspect and change only that scope.
- **Comprehensive audit** is for an explicit codebase-wide cleanup, tech-debt
  pass, or quality sweep. Run the eight passes below in order.
- Keep feature work and bug fixes out of a cleanup unless the user included
  them. Do not expand a narrow request into a broader audit.

## Cleanup workflow

1. **Name the job.** Write one sentence stating what should become smaller or
   truer and what is out of scope. If it describes a feature, this is not a
   cleanup task.
2. **Inventory before editing.** For each candidate, record its path or symbol,
   why it looks unnecessary, consumer-search results, whether it is a contract,
   and the proposed action. Include zero-hit searches.
3. **Verify before removing.** Search callers and old names, then inspect the
   actual code and call sites. Static-analysis tools are clues, not proof:
   check framework peers, dynamic imports, string-keyed lookups, generated
   inputs, and external consumers. Public exports and live infrastructure
   require an explicit contract or live-consumer check.
4. **Apply in risk order.**

   | Risk | Examples | Action |
   | --- | --- | --- |
   | **Safe** | Unused local, failed-edit residue, stale comment | Remove after confirming scope. |
   | **Careful** | Unreferenced file, dependency, or duplicate implementation | Verify consumers and contracts; remove or consolidate, then run targeted checks. |
   | **Risky** | Public exports, framework peers, live bindings/resources, secrets, or ambiguous dynamic use | Verify live consumers and downstream contracts first. If safety is unclear, report it without changing it. |

5. **Keep one honest path.** Prefer an existing library over custom machinery
   when it provides the needed capability. Collapse twins only when they have
   the same owner and contract. Do not add speculative flags, services, or
   forwarding abstractions.
6. **Keep the contract true.** Update or remove docs, comments, commands, and
   catalog entries made false by the cleanup. A search for a retired name
   should find nothing or a concise pointer to its replacement.
7. **Verify narrowly.** Run the relevant tests, lint, or smoke check. Report
   uncertain candidates and skipped checks; do not claim a broader audit or
   verification than was performed.

Do not sync, deploy, push, or otherwise mutate remote systems unless the user
explicitly asks. Removing a stale declaration from source is not permission to
recreate or delete a live resource.

## Comprehensive audit: eight passes

Run these passes in order, sequentially by default. If independent work can be
merged safely, use the limited concurrency described in [pass
ordering](./reference/pass-ordering.md). For a request about one concern, run
only its matching pass rather than treating it as permission for a full sweep.
Each pass uses the [three-phase protocol](./reference/protocol.md).

1. **AI slop and stale comments** — remove generated noise, in-motion-work
   comments, and unhelpful boilerplate.
2. **Legacy and deprecated code** — remove dead branches, deprecated APIs, and
   fallback paths that no longer serve a live use.
3. **Unused code** — find unreferenced exports, files, and dependencies with
   knip-class analysis, then verify every candidate.
4. **Circular dependencies** — identify and untangle real import cycles.
5. **Weak types** — replace weak types with specific types supported by the
   code and relevant API contracts.
6. **Type consolidation** — find duplicated or near-duplicated type
   definitions and unify only when they represent the same contract.
7. **Defensive programming** — remove guards or catches only when they do not
   handle a real input or failure boundary.
8. **DRY and deduplication** — consolidate duplicated logic only when the
   shared abstraction reduces complexity.

Use the protocol's evidence threshold: investigate candidates read-only,
separate high-confidence changes from uncertain findings, implement only
high-confidence recommendations, and verify after each pass. Do not parallelize
edits to overlapping source files.

## Verification checklist

- [ ] The work stayed within the named scope.
- [ ] Each removal has consumer-search evidence and a contract check.
- [ ] Risky resources and public contracts were checked before changes.
- [ ] Retired names and stale documentation were checked.
- [ ] Relevant tests, lint, or smoke checks ran; failures and skipped checks are reported.
- [ ] No remote mutation happened without explicit authorization.

## References

- [protocol.md](./reference/protocol.md) — research, assessment, and implementation phases.
- [pass-ordering.md](./reference/pass-ordering.md) — rationale and constraints for the comprehensive audit.
- [passes/](./reference/passes/) — scope and tooling for each audit pass.
