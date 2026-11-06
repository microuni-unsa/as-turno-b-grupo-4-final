# Pass ordering

The 8 passes are not independent. Order matters because earlier passes change what later passes see.

## Recommended sequential order

| #   | Pass                                | Why this position                                                                                                                                                                                                              |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | AI slop / comments                  | Cheapest. Removes noise that misleads later passes. No semantic changes — comments only.                                                                                                                                       |
| 2   | Legacy / deprecated / fallback      | Removes whole code branches. Doing this before "unused code" lets pass 3 catch the new orphans.                                                                                                                                |
| 3   | Unused code (knip-class)            | After dead branches go, more exports become unreferenced. Catches the second-order garbage.                                                                                                                                    |
| 4   | Circular dependencies (madge-class) | Structural. Run after dead code is gone so cycles aren't being held up by code that's about to be deleted anyway.                                                                                                              |
| 5   | Weak types                          | Now the surviving code is the real surface — typing it is worth the work. Doing this earlier wastes effort on code that gets deleted in passes 2–3.                                                                            |
| 6   | Type consolidation                  | Needs accurate types from pass 5. Duplicates are easier to spot when each definition is concrete, not `any`.                                                                                                                   |
| 7   | Defensive programming               | After types are honest, you can tell which catches actually handle a real failure mode vs which were guarding against an `any` that's now a known type.                                                                        |
| 8   | DRY / dedup                         | Last. Doing this earlier creates abstractions that later passes might invalidate (the duplicated paths might not all survive passes 2–3). DRY is also the most judgment-heavy — wrong abstractions are worse than duplication. |

## Which passes can run in parallel

A few passes are genuinely independent and can be dispatched concurrently _if_ the orchestrator can merge results:

- **1 + 2** — comments and dead-branch removal don't touch the same lines often. Safe in parallel, easy to merge.
- **4** is read-only-ish (small structural moves) and can run concurrent with **1**.
- Everything from **5** onward is sequential. Don't parallelize after pass 4.

If you only have time for one parallel batch: run 1 + 2 + 4 concurrently as the "cleanup wave", merge, then run 3 → 5 → 6 → 7 → 8 sequentially as the "tightening wave".

## Hard constraints

- **Never run two passes that both edit `.ts` / `.py` / `.rs` files concurrently** unless you've sandboxed each in its own worktree. Diff conflicts will eat the work.
- **Always run the full test suite between passes.** If pass N breaks tests, pass N+1 starts on a red baseline and pass 7 (defensive programming) will read the broken state as legitimate failure modes worth keeping.
- **Don't skip passes 1–2 to "save time".** They're the cheapest passes and they de-noise the rest. Skipping them wastes more time on later passes than they cost.

## Single-pass mode

If the user asks for _one specific concern_ ("just find dead code"), run only that pass — don't take the cleanup as a license to do all 8. This skill is invoked deliberately for the full sweep; targeted asks should call passes individually.
