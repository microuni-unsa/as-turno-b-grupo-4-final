import crypto from "node:crypto";
import type { CloseChecklistResult } from "@pims/agent/lifecycle/close-checklist.ts";
import {
  LIFECYCLE_STAGES,
  type LifecycleRun,
  type LifecycleStage,
} from "@pims/types/agent.ts";
import {
  LoopStepSkippedError,
  TransitionForbiddenError,
} from "@pims/types/errors.ts";
import type { TimerRecord } from "@pims/types/evidence.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

export const FIXED_STEP_ORDER: readonly LifecycleStage[] = LIFECYCLE_STAGES;

export function nextStage(current: LifecycleStage): LifecycleStage | null {
  const index = FIXED_STEP_ORDER.indexOf(current);
  if (index < 0 || index === FIXED_STEP_ORDER.length - 1) {
    return null;
  }
  return FIXED_STEP_ORDER[index + 1] ?? null;
}

export class LifecycleState {
  readonly run_id: string;
  readonly incident_code: string;
  readonly incident_id: number;
  private stageIndex: number;
  private cycles: number;
  private vetoParkedUntilUtc: string | null;
  private vetoedBy: string | null;
  private haltedFlag: boolean;
  private reopenGeneration: number;

  constructor(params: { incident_code: string; incident_id: number }) {
    this.run_id = crypto.randomUUID();
    this.incident_code = params.incident_code;
    this.incident_id = params.incident_id;
    this.stageIndex = -1;
    this.cycles = 0;
    this.vetoParkedUntilUtc = null;
    this.vetoedBy = null;
    this.haltedFlag = false;
    this.reopenGeneration = 0;
  }

  get stage(): LifecycleStage {
    const stage = FIXED_STEP_ORDER[this.stageIndex];
    if (stage === undefined) {
      return "capture";
    }
    return stage;
  }

  get reviewCycles(): number {
    return this.cycles;
  }

  get reopenGenerationValue(): number {
    return this.reopenGeneration;
  }

  advance(to: LifecycleStage): void {
    const expectedIndex = this.stageIndex + 1;
    const expected = FIXED_STEP_ORDER[expectedIndex];
    if (expected === undefined || expected !== to) {
      throw new LoopStepSkippedError(to);
    }
    this.stageIndex = expectedIndex;
  }

  recordReviewCycle(): void {
    this.cycles += 1;
  }

  reopen(): void {
    const investigateIndex = FIXED_STEP_ORDER.indexOf("investigate");
    if (investigateIndex < 0) {
      throw new Error("investigate stage missing from FIXED_STEP_ORDER");
    }
    this.stageIndex = investigateIndex;
    this.reopenGeneration += 1;
    this.cycles = 0;
    this.vetoParkedUntilUtc = null;
    this.vetoedBy = null;
  }

  parkVeto(untilUtc: string | null, operator: string | null): void {
    this.vetoParkedUntilUtc = untilUtc;
    this.vetoedBy = operator;
  }

  setHalted(halted: boolean): void {
    this.haltedFlag = halted;
  }

  snapshot(): LifecycleRun {
    return {
      run_id: this.run_id,
      incident_code: this.incident_code,
      incident_id: this.incident_id,
      stage: this.stage,
      review_cycles: this.cycles,
      veto_parked_until_utc: this.vetoParkedUntilUtc,
      vetoed_by: this.vetoedBy,
      halted: this.haltedFlag,
      reopen_generation: this.reopenGeneration,
    };
  }
}

export function canOtoP(
  incident: PimsIncident,
  activeTimers: TimerRecord[],
): boolean {
  const classified =
    incident.severity !== null &&
    incident.severity !== undefined &&
    incident.impact !== null &&
    incident.impact !== undefined;
  return classified && activeTimers.length > 0;
}

export function canPtoC(checklist: CloseChecklistResult): boolean {
  return (
    checklist.items.length > 0 && checklist.items.every((item) => item.passed)
  );
}

const REOPEN_PATTERN = /^REOPENED:[A-Za-z0-9:_-]+$/;

export function canCtoP(reason: string, evidenceIds: string[]): boolean {
  if (!REOPEN_PATTERN.test(reason)) {
    return false;
  }
  const evidenceId = reason.slice("REOPENED:".length);
  return evidenceIds.includes(evidenceId);
}

export function assertIncidentStatus(
  incident: PimsIncident,
  expected: PimsIncident["status"],
): void {
  if (incident.status !== expected) {
    throw new TransitionForbiddenError(incident.status, expected);
  }
}
