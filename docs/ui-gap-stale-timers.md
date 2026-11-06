# UI gap: stale regulatory timers shown as active countdowns

## Symptom
After both packs for an incident are `sent`, the compliance page keeps showing
`T_SUBJECT` / `T_REVIEW_SLA` countdown cards as "Activo" until they lapse.
Observed on INC-011: packs sent 10:55, but 14:56 `T_SUBJECT` + `T_REVIEW_SLA`
cards counted down as if obligations were still open. Confusing: the operator
cannot tell whether action is still required.

## Root cause
`notifyApprovedPacks` cancels only the timers that are active **at send time**.
A later re-draft re-arms `T_SUBJECT` / `T_REVIEW_SLA` via `armTimerIfAbsent`,
and nothing cancels the re-armed rows once the obligation is already satisfied.
When they fire, the effects correctly return `satisfied` (subject pack `sent`;
human authorizations exist), so this is display-only — but the countdown,
urgent styling, and header banner all suggest pending work.

## Fix direction
- `armTimerIfAbsent` (and the draft-pipeline call sites) should treat an
  already-`sent`/`exempted`/`not_required` pack as satisfied and refuse to arm
  (or immediately cancel) its `T_SUBJECT` / `T_REVIEW_SLA` rows; or
- `getRegulatoryTimers` / `checkPendingDecisions` should filter out timers
  whose obligation is already discharged (same `satisfied` predicate the
  scheduler effects use), so the countdown lists only genuinely open items.

## Acceptance
- After both packs reach terminal state, no `T_SUBJECT` / `T_REVIEW_SLA`
  cards render for the incident (only genuinely pending items like
  `T_PHASE_FOLLOWUP` remain).
- Firing behavior unchanged: already-satisfied timers still resolve silent.
