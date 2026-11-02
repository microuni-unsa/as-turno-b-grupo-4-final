import { awarenessFromIncident, limaLocalToUtc } from "@pims/agent";
import { PimsIncidentSchema } from "@pims/types/pims.ts";
import { describe, expect, it } from "vitest";

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
});
