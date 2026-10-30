# Phase 4: Multi-Role Orchestration, Skills/Tools, and Autonomous Lifecycle

## Objective
Implement the 8 agent roles, 11 skills, 21 tools, the autonomous incident response lifecycle loop, Tree-of-Thoughts neuro-symbolic root-cause analysis, deadline scheduler, and the adversarial red-team constitutional review rubric.

## Requirements & Scope
- **Agent Roles & Governance (`src/orchestrator/roles.ts`)**:
  - Implementation of the 8 roles: `orchestrator`, `intake`, `triage`, `investigator`, `drafter`, `compliance_reviewer`, `notifier`, `monitor`.
  - Versioned system prompts with SHA-256 recording for compliance auditing.
  - Strict enforcement of tool allowlists and denylists; violations raise `ROLE_TOOL_DENIED`.
- **Skills Catalog & Tool Manifest (`src/tools/index.ts`)**:
  - Implementation of the 21 tools with strict Zod argument validation and error mapping.
  - Sequencing enforcement for incident actions: `C* -> A+ -> R` (minimum 1 Analysis action before Resolution; Resolution actions strictly require `review_approval_id`).
- **Neuro-Symbolic Root-Cause Analysis (`src/investigation/root-cause.ts`)**:
  - Tree-of-Thoughts (ToT) candidate hypothesis generation with Bayesian posterior likelihood scoring over evidence and IOCs.
  - Method selector:
    - Single causal chain: 5-Whys (exactly 5 falsifiable levels).
    - Multi-factor: Fishbone diagram (People, Process, Technology, Data, Suppliers, Environment).
    - System failure / availability: Fault-Tree Analysis (AND/OR gates).
  - Minimal cut-set counterfactual control simulation across adopted security measures and Annex A controls.
- **Corrective Action & Risk Linkage**:
  - Automatic creation of `core_auditfinding` (`classification=N`) and `core_auditactionplan` rows for qualifying high-severity incidents.
  - Risk feedback: emission of `core_riskevaluation` drafts into active risk periods; queued upon closed periods (`RISK_PERIOD_CLOSED`).
- **Deadline Scheduler (`src/orchestrator/scheduler.ts`)**:
  - Timers: GDPR 72h authority clock, processor immediacy SLA, high-risk subject notification SLA, expedited 4h review SLA, Peru 48h provisional advisory clock.
  - Weibull survival hazard forecasting to detect and alert on deadline overrun risks.
- **Adversarial Red-Team & 4-Judge Constitutional Review**:
  - Adversarial prosecutor challenge on notice packs and closure criteria.
  - 4-Judge Constitutional Rubric:
    1. Legal Completeness Judge.
    2. Citation NLI Entailment Judge (min score 0.85).
    3. Plain-Language Readability Judge (Flesch-Kincaid & sentence length ≤25 words).
    4. Zero-Trust PII & Semantic Entropy Scanner (entropy ≤0.65).
  - Single-use UUID `review_approval_id` generation linked to canonical content hash.
- **Closed-Loop Lifecycle State Machine**:
  - States: `O` (Open) -> `P` (In Process) -> `C` (Closed).
  - Reopening transition: `C -> P` requiring `REOPENED:<evidence_id>`.
  - Comprehensive 8-point closure checklist enforcement (§9.6).

## Deliverables
- `src/orchestrator/orchestrator.ts`: Central execution engine and autonomous loop.
- `src/orchestrator/roles.ts`: Role definitions, prompts, and policy enforcement.
- `src/tools/registry.ts`: Tool execution engine with input validation.
- `src/investigation/tot-analyzer.ts`: Neuro-symbolic root-cause analyzer.
- `src/orchestrator/scheduler.ts`: Deadline scheduler with Weibull hazard model.
- `src/review/constitutional-judges.ts`: Adversarial review and 4-judge rubric.
- `tests/integration/lifecycle-loop.test.ts`: End-to-end integration test of incident transitions.
- `tests/unit/root-cause.test.ts`: Unit tests for ToT and counterfactual simulation.

## Verification & Acceptance
- Full lifecycle walk from Intake -> Triage -> Investigation -> Drafting -> Review -> Notification -> Closure passes deterministically.
- Actions strictly enforce `C* -> A+ -> R` sequencing.
- Veto window (`HUMAN_VETO_WINDOW_MIN`) correctly parks notification without stalling other steps.
