# Phase 4: Multi-Role Orchestration, Skills/Tools, and Autonomous Lifecycle

## Objective
Implement the 8 agent roles, 10 skills, 19 tools, single-prompt root-cause analysis, countdown scheduler, single-pass challenge review, and the autonomous incident response lifecycle loop.

## Requirements & Scope
- **Agent Roles & Governance (`packages/agent/src/orchestrator/roles.ts`)**:
  - Implementation of the 8 roles: `orchestrator`, `intake`, `triage`, `investigator`, `drafter`, `compliance_reviewer`, `notifier`, `monitor`.
  - Versioned system prompts with SHA-256 recording for compliance auditing.
  - Strict enforcement of tool allowlists and denylists; violations raise `ROLE_TOOL_DENIED`.
- **Skills Catalog & Tool Manifest (`packages/agent/src/tools/registry.ts`)**:
  - Implementation of the 19 tools with strict Zod argument validation and error mapping.
  - Sequencing enforcement for incident actions: `C* -> A+ -> R` (minimum 1 Analysis action before Resolution; Resolution actions strictly require `review_approval_id`).
- **Single-Prompt Root-Cause Analysis (`packages/agent/src/orchestrator/orchestrator.ts`)**:
  - One `REASONING_MODEL` call produces the `RootCause` shape `{method, cause, evidence_refs, systemic, remediation, root_cause_unproven}`; the method selector stays 5-Whys for a single causal chain, Fishbone for multi-factor, and Fault-Tree for system/availability failure.
  - Persisted via `evidenceStore.saveRootCause` in the `root_causes` table; the `A` action description is `Root cause (<method>): <cause>` and `root_cause_unproven:true` appends `ROOT_CAUSE_UNPROVEN`.
- **Corrective Action & Risk Linkage**:
  - Automatic creation of `core_auditfinding` (`classification=N`) and `core_auditactionplan` rows for qualifying high-severity incidents.
  - Risk feedback: emission of `core_riskevaluation` drafts into active risk periods; queued upon closed periods (`RISK_PERIOD_CLOSED`).
- **Deadline Scheduler (`packages/agent/src/orchestrator/scheduler.ts`)**:
  - Timers: GDPR 72h authority clock, processor immediacy SLA, high-risk subject notification SLA, expedited 4h review SLA, Peru 48h provisional advisory clock.
  - Countdown timers persisted in the evidence store (`timers` table) with 60s tick + jitter; overdue timers fire idempotently.
- **Single-Pass Challenge Review (`packages/agent/src/review/reviewer.ts`)**:
  - One adversarial `REASONING_MODEL` challenge call on the pack (any `severity: "high"` challenge blocks approval).
  - Deterministic checks, run before the model call: legal completeness (authority/subject body + citations + DPO contacts), citation existence (`validateCitation(..., true)`), plain-language validation, PII scan, and close-checklist completeness/duplicates for resolution reviews.
  - Single-use UUID `review_approval_id` generation linked to canonical content hash.
- **Closed-Loop Lifecycle State Machine**:
  - States: `O` (Open) -> `P` (In Process) -> `C` (Closed).
  - Reopening transition: `C -> P` requiring `REOPENED:<evidence_id>`.
  - Comprehensive 8-point closure checklist enforcement (§9.6).

## Deliverables
- `packages/agent/src/orchestrator/orchestrator.ts`: Central execution engine and autonomous loop.
- `packages/agent/src/orchestrator/roles.ts`: Role definitions, prompts, and policy enforcement.
- `packages/agent/src/tools/registry.ts`: Tool execution engine with input validation.
- `packages/agent/src/orchestrator/scheduler.ts`: Countdown deadline scheduler.
- `packages/agent/src/review/reviewer.ts`: Single-pass challenge review with deterministic legal-completeness, citation, plain-language, PII, and close-checklist checks.
- `packages/types/src/agent.ts`: Phase-4 contract surface (roles, tools, timers, root cause/review, lifecycle, indicators).
- `tests/integration/lifecycle-loop.test.ts`: End-to-end integration test of incident transitions.

## Verification & Acceptance
- Full lifecycle walk from Intake -> Triage -> Investigation -> Drafting -> Review -> Notification -> Closure passes deterministically.
- Actions strictly enforce `C* -> A+ -> R` sequencing.
- Veto window (`HUMAN_VETO_WINDOW_MIN`) correctly parks notification without stalling other steps.
