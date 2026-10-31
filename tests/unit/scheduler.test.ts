import {
  awarenessFromIncident,
  computeWeibull,
  hazard,
  limaLocalToUtc,
} from "@pims/agent";
import type { AgentConfig } from "@pims/config";
import type { IncidentOutcome } from "@pims/types/agent.ts";
import {
  WEIBULL_DEFAULT_SCALE_H,
  WEIBULL_DEFAULT_SHAPE,
  WEIBULL_MIN_SAMPLES,
} from "@pims/types/constants.ts";
import { WeibullFitError } from "@pims/types/errors.ts";
import { PimsIncidentSchema } from "@pims/types/pims.ts";
import { describe, expect, it } from "vitest";

const MINIMAL_CONFIG = {
  SLA_HAZARD_WARN_THRESHOLD: 0.75,
} as unknown as AgentConfig;

function incidentFixture(overrides: Record<string, unknown> = {}) {
  return PimsIncidentSchema.parse({
    id: 1,
    incident_code: "INC-001",
    created_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
    is_deleted: false,
    involves_personal_data: true,
    incident_date: "2026-10-01",
    incident_type: "DL",
    status: "P",
    severity: "H",
    impact: "H",
    title: "DL breach dry-walk",
    affected_data_types: ["id_doc", "email"],
    security_measures_adopted: [],
    affected_cid: ["C"],
    ...overrides,
  });
}

function syntheticOutcomes(
  shape: number,
  scaleH: number,
  n: number,
): IncidentOutcome[] {
  const outcomes: IncidentOutcome[] = [];
  for (let index = 1; index <= n; index++) {
    const u = index / (n + 1);
    const durationH = scaleH * (-Math.log(1 - u)) ** (1 / shape);
    const awareness = Date.parse("2026-01-01T00:00:00.000Z");
    outcomes.push({
      incident_code: `INC-${String(index).padStart(3, "0")}`,
      awareness_at_utc: new Date(awareness).toISOString(),
      closed_at_utc: new Date(awareness + durationH * 3_600_000).toISOString(),
      severity: "M",
      review_cycles: 0,
      sla_72h_met: durationH <= 72,
      recorded_at_utc: "2026-03-01T00:00:00.000Z",
    });
  }
  return outcomes;
}

describe("Phase 4 deadline scheduler pure functions (§6.4)", () => {
  it("converts a Lima local detection instant to UTC", () => {
    expect(limaLocalToUtc("2026-10-01", "10:00:00").toISOString()).toBe(
      "2026-10-01T15:00:00.000Z",
    );
    expect(limaLocalToUtc("2026-10-01", "00:00:00").toISOString()).toBe(
      "2026-10-01T05:00:00.000Z",
    );
    expect(limaLocalToUtc("2026-12-31", "23:59:59").toISOString()).toBe(
      "2027-01-01T04:59:59.000Z",
    );
  });

  it("derives awareness from detection date and time, then created_at", () => {
    const withDetection = incidentFixture({
      detection_date: "2026-10-01",
      detection_time: "10:00:00",
    });
    expect(awarenessFromIncident(withDetection).toISOString()).toBe(
      "2026-10-01T15:00:00.000Z",
    );

    const dateOnly = incidentFixture({ detection_date: "2026-10-02" });
    expect(awarenessFromIncident(dateOnly).toISOString()).toBe(
      "2026-10-02T05:00:00.000Z",
    );

    const fallback = incidentFixture();
    expect(awarenessFromIncident(fallback).toISOString()).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  it("returns the fixed parametric model below the sample floor", () => {
    const parameters = computeWeibull(syntheticOutcomes(2, 100, 29));
    expect(parameters.mode).toBe("fixed");
    expect(parameters.samples).toBe(29);
    expect(parameters.shape).toBe(WEIBULL_DEFAULT_SHAPE);
    expect(parameters.scale_h).toBe(WEIBULL_DEFAULT_SCALE_H);
  });

  it("fits shape and scale by MLE once the sample floor is reached", () => {
    const parameters = computeWeibull(
      syntheticOutcomes(2, 100, WEIBULL_MIN_SAMPLES),
    );
    expect(parameters.mode).toBe("fitted");
    expect(parameters.samples).toBe(WEIBULL_MIN_SAMPLES);
    expect(parameters.shape).toBeGreaterThan(1.5);
    expect(parameters.shape).toBeLessThan(2.6);
    expect(parameters.scale_h).toBeGreaterThan(80);
    expect(parameters.scale_h).toBeLessThan(120);
  });

  it("rejects degenerate samples instead of falling back", () => {
    const outcomes = Array.from(
      { length: WEIBULL_MIN_SAMPLES },
      (_, index) => ({
        incident_code: `INC-${index}`,
        awareness_at_utc: "2026-01-01T00:00:00.000Z",
        closed_at_utc: "2026-01-02T00:00:00.000Z",
        severity: "M" as const,
        review_cycles: 0,
        sla_72h_met: true,
        recorded_at_utc: "2026-02-01T00:00:00.000Z",
      }),
    );
    expect(() => computeWeibull(outcomes)).toThrow(WeibullFitError);
    try {
      computeWeibull(outcomes);
    } catch (error: unknown) {
      expect((error as WeibullFitError).code).toBe("WEIBULL_FIT:degenerate");
    }
  });

  it("raises the alert once the hazard crosses the configured threshold", () => {
    const incident = incidentFixture({
      detection_date: "2026-10-01",
      detection_time: "10:00:00",
    });
    const outcomes = syntheticOutcomes(2, 100, WEIBULL_MIN_SAMPLES);
    const early = hazard(
      incident,
      outcomes,
      new Date("2026-10-01T16:00:00.000Z"),
      MINIMAL_CONFIG,
    );
    expect(early.alert).toBe(false);
    expect(early.sla_breach_prob_72h).toBeLessThan(0.75);

    const late = hazard(
      incident,
      outcomes,
      new Date("2026-10-05T12:00:00.000Z"),
      MINIMAL_CONFIG,
      { reviewCycles: 2 },
    );
    expect(late.sla_breach_prob_72h).toBeGreaterThan(0.75);
    expect(late.alert).toBe(true);
    expect(late.review_cycles).toBe(2);
    expect(late.sla_breach_prob_72h).toBeLessThanOrEqual(1);
  });

  it("counts remaining lifecycle stages from the incident status", () => {
    const outcomes = syntheticOutcomes(2, 100, WEIBULL_MIN_SAMPLES);
    const now = new Date("2026-10-01T16:00:00.000Z");

    const open = hazard(
      incidentFixture({ status: "O" }),
      outcomes,
      now,
      MINIMAL_CONFIG,
    );
    const inProgress = hazard(
      incidentFixture({ status: "P" }),
      outcomes,
      now,
      MINIMAL_CONFIG,
    );
    const closed = hazard(
      incidentFixture({ status: "C" }),
      outcomes,
      now,
      MINIMAL_CONFIG,
    );

    expect(open.remaining_stages).toBeGreaterThan(inProgress.remaining_stages);
    expect(inProgress.remaining_stages).toBeGreaterThan(
      closed.remaining_stages,
    );
    expect(closed.remaining_stages).toBe(0);
  });
});
