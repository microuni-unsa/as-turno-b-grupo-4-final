import crypto from "node:crypto";
import { PimsAdapter } from "@pims/pims-adapter";
import { CONSTANTS } from "@pims/types/constants.ts";
import { TEST_SCHEMA } from "@tests/helpers/test-constants.ts";
import { describe, expect, it } from "vitest";

const LIVE_BASE_URL =
  process.env.PIMS_LIVE_BASE_URL !== undefined &&
  process.env.PIMS_LIVE_BASE_URL !== ""
    ? process.env.PIMS_LIVE_BASE_URL
    : CONSTANTS.DEFAULT_PIMS_BASE_URL;
const LIVE_USERNAME = process.env.PIMS_USERNAME;
const LIVE_PASSWORD = process.env.PIMS_PASSWORD;
const LIVE_SCHEMA =
  process.env.PIMS_SCHEMA !== undefined && process.env.PIMS_SCHEMA !== ""
    ? process.env.PIMS_SCHEMA
    : TEST_SCHEMA;

const enabled =
  LIVE_USERNAME !== undefined &&
  LIVE_USERNAME !== "" &&
  LIVE_PASSWORD !== undefined &&
  LIVE_PASSWORD !== "";

describe("Live PIMS smoke (no daemon, watcher stopped)", () => {
  it("parses live serializers and walks a throwaway incident O→P→C", async (ctx) => {
    if (!enabled) {
      ctx.skip();
      return;
    } else {
      // Live credentials are provisioned, run smoke test
    }

    const adapter = new PimsAdapter({
      baseUrl: LIVE_BASE_URL,
      schema: LIVE_SCHEMA,
      username: LIVE_USERNAME,
      password: LIVE_PASSWORD,
      timeoutMs: 30000,
    });

    const login = await adapter.login();
    expect(login.access.length).toBeGreaterThan(0);
    const profile = await adapter.getProfile();
    expect(profile.username).toBe(LIVE_USERNAME);

    const page = await adapter.listIncidents({ page_size: 5 });
    expect(Array.isArray(page.results)).toBe(true);
    if (page.results[0] !== undefined) {
      const existing = await adapter.getIncident(page.results[0].id);
      expect(existing.id).toBe(page.results[0].id);
      expect(existing.is_deleted).toBe(false);
      const history = await adapter.getIncidentHistory(existing.id);
      for (const row of history) {
        if (
          row.recipients_snapshot !== null &&
          row.recipients_snapshot !== undefined
        ) {
          expect(Array.isArray(row.recipients_snapshot)).toBe(true);
        } else {
          // Snapshot is empty/null for this history entry
        }
      }
    } else {
      // No incidents present in current tenant
    }

    const title = `LIVE-SMOKE-${crypto.randomUUID()}`;
    const today = new Date().toISOString().slice(0, 10);
    const created = await adapter.createIncident({
      title,
      involves_personal_data: true,
      incident_date: today,
      incident_type: "OT",
      status: "O",
      affected_data_types: [],
      security_measures_adopted: [],
      affected_cid: [],
    });
    expect(created.is_deleted).toBe(false);

    const patched = await adapter.updateIncident(created.id, {
      severity: "L",
      impact: "L",
      affected_cid: ["C"],
    });
    expect(patched.severity).toBe("L");

    const withAction = await adapter.appendIncidentAction(created.id, {
      action_type: "C",
      responsible: "live-smoke",
      action_date: today,
      description: "Live smoke containment action.",
    });
    expect(withAction.actions).toBeDefined();
    const actions = withAction.actions;
    if (!actions) {
      expect.fail("Expected actions to be present on updated incident");
    }
    expect(actions.some((action) => action.action_type === "C")).toBe(true);

    const uploaded = await adapter.uploadIncidentAttachment(
      created.id,
      Buffer.from(JSON.stringify({ smoke: true }), "utf8"),
      CONSTANTS.BUNDLE_ATTACHMENT_NAME,
    );
    expect(uploaded.length).toBeGreaterThan(0);

    const processing = await adapter.updateIncident(created.id, {
      status: "P",
    });
    expect(processing.status).toBe("P");
    const closed = await adapter.updateIncident(created.id, {
      status: "C",
      measure_considered_resolved: "Y",
      resolved_date: today,
    });
    expect(closed.status).toBe("C");
    expect(closed.is_deleted).toBe(false);

    const history = await adapter.getIncidentHistory(created.id);
    expect(history.some((row) => row.event_type === "created")).toBe(true);
    expect(
      history.some(
        (row) =>
          row.event_type === "status_changed" || row.event_type === "updated",
      ),
    ).toBe(true);
    for (const row of history) {
      if (
        row.recipients_snapshot !== null &&
        row.recipients_snapshot !== undefined
      ) {
        expect(Array.isArray(row.recipients_snapshot)).toBe(true);
      } else {
        // Snapshot is empty/null for this history entry
      }
    }
  });
});
