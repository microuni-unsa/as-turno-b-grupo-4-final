# Phase 6: Production Hardening, Acceptance Verification, and Observability

## Objective
Execute complete end-to-end acceptance verification (A01 through A16), validate all 6 mechanical gates (G1 through G6), run the dry-walk fixture, establish Prometheus metrics and indicator emission, and verify runbook operational runbooks.

## Requirements & Scope
- **Acceptance Criteria Verification (A01–A16)**:
  - A01: Full dry-walk DL breach flow with authority notification within 72h, subject notice gate, corrective action linking, risk signal emission, closure, and indicators.
  - A02: Expedited path for Critical/Very High incidents (4h review SLA).
  - A03: Intake with missing PII flag (exactly one re-prompt, then conservative fallback to true).
  - A04: Non-PII security incident path (bypasses Art 33/34 notices).
  - A05: Blocked notification when zero active recipients are configured (`NOTIFY_NO_RECIPIENTS`).
  - A06: Human veto window parking and expiry auto-send.
  - A07: Post-close evidence arrival triggering `C -> P` reopening with new review IDs.
  - A08–A10: Art 34(3) encryption exemption, disproportionate effort review, and authority override.
  - A11–A13: PIMS 5xx idempotent retry recovery, restart replay, and `OPERATOR_HALT` kill-switch.
  - A14: 10/10 RAG evaluation gate.
  - A15: Risk signal creation and queuing when risk period is closed.
  - A16: Full mechanical gates execution.
- **6 Mechanical Gates Verification (G1–G6)**:
  - G1: Zero scaffolding check (`awk` script across spec ensuring zero TODO/FIXME/placeholder).
  - G2: Provisional tags verification (strictly restricted to §1, §2.4–§2.6, §3.1 E21, §14.4).
  - G3: `core_incident` coverage count ≥ 20.
  - G4: Automated secret scan across repo confirming zero leaked keys or passwords.
  - G5: Spec structure validation (15 sections, 4 mermaid diagrams).
  - G6: Capture completeness (38 JSON files in `docs/incident-agent-capture/`).
- **Observability & Indicator Emitter (`src/indicators/`)**:
  - Indicator emission engine computing MTTD, MTTR, and 72h SLA compliance.
  - Prometheus `/metrics` endpoint with latency histograms, uncertainty metrics, and circuit-breaker states.
  - OpenTelemetry structured tracing with `gen_ai.*` semantic conventions.
- **Production Packaging & Runbooks**:
  - Container build configuration.
  - Verification of runbook handlers for all §12.5 named errors.

## Deliverables
- `tests/acceptance/a01-a16.test.ts`: Automated suite running the 16 acceptance checks.
- `scripts/verify-gates.sh`: Shell script enforcing G1–G6 mechanical gates.
- `src/indicators/indicator-emitter.ts`: Metrics calculator and webhook sender.
- `src/observability/prometheus.ts`: Prometheus metrics collector and exporter.
- `docs/runbooks/`: Operational runbooks corresponding to all named errors.

## Verification & Acceptance
- 100% PASS on A01–A16 test suite.
- G1–G6 mechanical gates script exits with code 0.
- Zero secret scan violations in repository.
