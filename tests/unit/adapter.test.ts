import { PimsAdapter } from "@pims/pims-adapter";
import {
  PimsClientBugError,
  PimsGateBlockedError,
  PimsThrottledError,
} from "@pims/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("PIMS Adapter Unit & Resilience Suite", () => {
  let adapter: PimsAdapter;

  beforeEach(() => {
    adapter = new PimsAdapter({
      baseUrl: "https://mock.pims.test",
      schema: "unsa",
      username: "admin",
      password: "secretpassword",
      timeoutMs: 5000,
      maxRetries: 2,
    });
    adapter.setTokens("mock-access-token", "mock-refresh-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends identical Idempotency-Key on retries of a mutation", async () => {
    const keysSent: string[] = [];
    vi.useFakeTimers();

    let attempts = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        attempts++;
        const headers = init?.headers as Record<string, string>;
        if (headers["Idempotency-Key"]) {
          keysSent.push(headers["Idempotency-Key"]);
        }

        if (attempts === 1) {
          // Simulate 500 error
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            id: 123,
            incident_code: "INC-123",
            created_at: "2026-10-29T10:00:00Z",
            updated_at: "2026-10-29T10:00:00Z",
            is_deleted: false,
            involves_personal_data: false,
            incident_date: "2026-10-29",
            incident_type: "OT",
            status: "O",
            title: "Test Incident",
            affected_data_types: [],
            security_measures_adopted: [],
            affected_cid: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });

    const createPromise = adapter.createIncident({
      title: "Test Incident",
      involves_personal_data: false,
      incident_date: "2026-10-29",
      incident_type: "OT",
      status: "O",
    });

    await vi.runAllTimersAsync();
    const res = await createPromise;

    expect(res.id).toBe(123);
    expect(keysSent.length).toBe(2);
    expect(keysSent[0]).toBe(keysSent[1]);
    expect(keysSent[0]).toMatch(/^agi1:global:create_incident:/);

    fetchSpy.mockRestore();
  });

  it("retries on 429 and throws PimsThrottledError after exhausting attempts", async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ detail: "Too Many Requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    });

    const listPromise = adapter.listIncidents();
    const expectation =
      expect(listPromise).rejects.toThrowError(PimsThrottledError);

    await vi.runAllTimersAsync();
    await expectation;
  });

  it("throws PimsClientBugError immediately on 401 bad_authorization_header without retry", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        return new Response(
          JSON.stringify({ detail: "bad_authorization_header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

    await expect(adapter.getIncident(1)).rejects.toThrowError(
      PimsClientBugError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maps 403 DOCUMENT_LIMIT_REACHED to PimsGateBlockedError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ detail: "DOCUMENT_LIMIT_REACHED" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    await expect(adapter.getIncident(1)).rejects.toThrowError(
      PimsGateBlockedError,
    );
  });

  it("client-side filters when backend ignores filter and logs PIMS_FILTER_IGNORED", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          count: 2,
          next: null,
          previous: null,
          results: [
            {
              id: 1,
              incident_code: "INC-001",
              created_at: "2026-10-29T10:00:00Z",
              updated_at: "2026-10-29T10:00:00Z",
              is_deleted: false,
              involves_personal_data: false,
              incident_date: "2026-10-29",
              incident_type: "OT",
              status: "O",
              severity: "H",
              title: "Incident High",
              affected_data_types: [],
              security_measures_adopted: [],
              affected_cid: [],
            },
            {
              id: 2,
              incident_code: "INC-002",
              created_at: "2026-10-29T10:00:00Z",
              updated_at: "2026-10-29T10:00:00Z",
              is_deleted: false,
              involves_personal_data: false,
              incident_date: "2026-10-29",
              incident_type: "OT",
              status: "O",
              severity: "L",
              title: "Incident Low",
              affected_data_types: [],
              security_measures_adopted: [],
              affected_cid: [],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const list = await adapter.listIncidents({ severity: "H" });
    expect(list.count).toBe(1);
    expect(list.results[0]?.id).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith("PIMS_FILTER_IGNORED:severity");
  });
});
