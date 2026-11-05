import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DeadlineScheduler,
  type TimerEffects,
} from "@pims/agent/orchestrator/scheduler.ts";
import type { AgentConfig } from "@pims/config";
import { EvidenceStore } from "@pims/evidence";
import type { JsonObject, PageAlert, TimerKind } from "@pims/types";
import { PimsBaseError } from "@pims/types";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  TEST_DATE_2026_10_01,
  TEST_PGVECTOR_IMAGE,
} from "@tests/helpers/test-constants.ts";
import postgres, { type Sql } from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const INCIDENT_PREFIX = "INC-SCHED";
const TEST_ANCHOR_ISO = `${TEST_DATE_2026_10_01}T12:00:00.000Z`;
const TIMER_T72_AUTHORITY: TimerKind = "T72_AUTHORITY";
const TIMER_T_PROCESSOR: TimerKind = "T_PROCESSOR";
const TIMER_T_SUBJECT: TimerKind = "T_SUBJECT";
const TIMER_T_RETRY: TimerKind = "T_RETRY";
const TIMER_T_REVIEW_SLA: TimerKind = "T_REVIEW_SLA";
const RETRY_OF_KEY = "retry_of";

interface PayloadRecord {
  incident_code: string;
  payload: JsonObject;
}

const config = {
  SCHEDULER_MAX_TIMERS: 3,
} as unknown as AgentConfig;

const storageDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "pims-scheduler-evidence-"),
);
const keyHex =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let container: StartedPostgreSqlContainer;
let store: EvidenceStore;
let sql: Sql;
let scheduler: DeadlineScheduler;
let now = new Date(TEST_ANCHOR_ISO);

const calls = {
  authority: [] as string[],
  processor: [] as string[],
  subject: [] as string[],
  review: [] as string[],
  peru: [] as string[],
  phase: [] as PayloadRecord[],
  retry: [] as PayloadRecord[],
};

const outcomes = {
  authority: "satisfied" as "satisfied" | "breached",
  processor: "satisfied" as "satisfied" | "escalate",
  subject: "satisfied" as "satisfied" | "breached",
  review: "satisfied" as "satisfied" | "breached",
};

let reviewFailure: Error | null = null;
const pages: PageAlert[] = [];

const effects: TimerEffects = {
  async authorityDeadline(incidentCode) {
    calls.authority.push(incidentCode);
    return outcomes.authority;
  },
  async processorDeadline(incidentCode) {
    calls.processor.push(incidentCode);
    return outcomes.processor;
  },
  async subjectDeadline(incidentCode) {
    calls.subject.push(incidentCode);
    return outcomes.subject;
  },
  async reviewDeadline(incidentCode) {
    calls.review.push(incidentCode);
    if (reviewFailure !== null) {
      throw reviewFailure;
    } else {
      return outcomes.review;
    }
  },
  async peruAdvisory(incidentCode) {
    calls.peru.push(incidentCode);
  },
  async phaseFollowup(incidentCode, payload) {
    calls.phase.push({ incident_code: incidentCode, payload });
  },
  async retry(incidentCode, payload) {
    calls.retry.push({ incident_code: incidentCode, payload });
  },
};

function buildScheduler(): DeadlineScheduler {
  return new DeadlineScheduler({
    store,
    config,
    clock: () => now,
    effects,
    page: (alert) => {
      pages.push(alert);
    },
  });
}

function futureIso(offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

async function captureError(
  run: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error: unknown) {
    if (!(error instanceof PimsBaseError)) {
      throw error;
    } else {
      return { code: error.code, message: error.message };
    }
  }
  expect.fail("Expected the scheduler call to fail but it resolved");
}

describe("DeadlineScheduler integration (Testcontainers PostgreSQL)", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer(TEST_PGVECTOR_IMAGE).start();
    sql = postgres(container.getConnectionUri());
    store = new EvidenceStore({
      connectionUri: container.getConnectionUri(),
      keyHex,
      baseStorageDir: storageDir,
    });
    await store.init();
  });

  afterAll(async () => {
    if (store) {
      await store.close();
    } else {
      expect(store).toBeUndefined();
    }
    if (sql) {
      await sql.end();
    } else {
      expect(sql).toBeUndefined();
    }
    if (container) {
      await container.stop();
    } else {
      expect(container).toBeUndefined();
    }
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    now = new Date(TEST_ANCHOR_ISO);
    calls.authority.length = 0;
    calls.processor.length = 0;
    calls.subject.length = 0;
    calls.review.length = 0;
    calls.peru.length = 0;
    calls.phase.length = 0;
    calls.retry.length = 0;
    pages.length = 0;
    outcomes.authority = "satisfied";
    outcomes.processor = "satisfied";
    outcomes.subject = "satisfied";
    outcomes.review = "satisfied";
    reviewFailure = null;
    await sql`DELETE FROM evidence.timers`;
    scheduler = buildScheduler();
  });

  it("arms a timer and persists it for the incident", async () => {
    const fireAt = futureIso(CONSTANTS.MS_PER_HOUR);
    const result = await scheduler.arm({
      incident_code: `${INCIDENT_PREFIX}-001`,
      kind: TIMER_T72_AUTHORITY,
      fire_at_utc: fireAt,
      payload: { stage: "triage" },
    });

    expect(result.late).toBe(false);
    expect(result.timer_id).toContain("timer:INC-SCHED-001:T72_AUTHORITY:");

    const active = await store.listActiveTimers(`${INCIDENT_PREFIX}-001`);
    expect(active).toHaveLength(1);
    expect(active[0]?.timer_id).toBe(result.timer_id);
    expect(active[0]?.timer_type).toBe(TIMER_T72_AUTHORITY);
    expect(active[0]?.fire_at_utc).toBe(fireAt);
    expect(active[0]?.payload).toEqual({ stage: "triage" });
  });

  it("rejects a second active timer for the same incident and kind", async () => {
    const code = `${INCIDENT_PREFIX}-002`;
    await scheduler.arm({
      incident_code: code,
      kind: TIMER_T72_AUTHORITY,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });

    const duplicate = await captureError(() =>
      scheduler.arm({
        incident_code: code,
        kind: TIMER_T72_AUTHORITY,
        fire_at_utc: futureIso(2 * CONSTANTS.MS_PER_HOUR),
        payload: {},
      }),
    );

    expect(duplicate.code).toBe("SCHEDULER_DUPLICATE");
    expect(await store.listActiveTimers(code)).toHaveLength(1);
  });

  it("refuses retry timers at SCHEDULER_MAX_TIMERS but admits deadline timers", async () => {
    const codes = ["003", "004", "005"].map(
      (suffix) => `${INCIDENT_PREFIX}-${suffix}`,
    );
    const kinds: TimerKind[] = [
      TIMER_T72_AUTHORITY,
      TIMER_T_PROCESSOR,
      TIMER_T_SUBJECT,
    ];
    for (let index = 0; index < codes.length; index++) {
      await scheduler.arm({
        incident_code: codes[index] as string,
        kind: kinds[index] as TimerKind,
        fire_at_utc: futureIso((index + 1) * CONSTANTS.MS_PER_HOUR),
        payload: {},
      });
    }
    expect(await store.listActiveTimers()).toHaveLength(3);

    const overflow = await captureError(() =>
      scheduler.arm({
        incident_code: `${INCIDENT_PREFIX}-006`,
        kind: TIMER_T_RETRY,
        fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
        payload: { [RETRY_OF_KEY]: "timer:x:T72_AUTHORITY:y" },
      }),
    );
    expect(overflow.code).toBe("SCHEDULER_OVERFLOW");
    expect(await store.listActiveTimers()).toHaveLength(3);

    const admitted = await scheduler.arm({
      incident_code: `${INCIDENT_PREFIX}-007`,
      kind: TIMER_T72_AUTHORITY,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });
    expect(admitted.late).toBe(false);
    const active = await store.listActiveTimers();
    expect(active).toHaveLength(4);
    expect(active.some((timer) => timer.timer_id === admitted.timer_id)).toBe(
      true,
    );
  });

  it("fires a past-due timer immediately and still reports SCHEDULER_PAST_DUE", async () => {
    const code = `${INCIDENT_PREFIX}-008`;
    const result = await captureError(() =>
      scheduler.arm({
        incident_code: code,
        kind: TIMER_T72_AUTHORITY,
        fire_at_utc: new Date(now.getTime() - 1000).toISOString(),
        payload: {},
      }),
    );

    expect(result.code).toBe("SCHEDULER_PAST_DUE");
    expect(calls.authority).toEqual([code]);
    expect(await store.listActiveTimers(code)).toHaveLength(0);

    const rows = await sql<{ fired: boolean }[]>`
      SELECT fired FROM evidence.timers WHERE incident_code = ${code}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fired).toBe(true);
  });

  it("cancels a live timer and rejects unknown timer ids", async () => {
    const unknown = await captureError(() =>
      scheduler.cancel("timer:does-not-exist", "cleanup"),
    );
    expect(unknown.code).toBe("SCHEDULER_UNKNOWN_TIMER");

    const code = `${INCIDENT_PREFIX}-009`;
    const armed = await scheduler.arm({
      incident_code: code,
      kind: TIMER_T_SUBJECT,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });
    await scheduler.cancel(armed.timer_id, "incident closed");

    expect(await store.listActiveTimers(code)).toHaveLength(0);
    const rows = await sql<{ cancelled_reason: string | null }[]>`
      SELECT cancelled_reason FROM evidence.timers
      WHERE timer_id = ${armed.timer_id}
    `;
    expect(rows[0]?.cancelled_reason).toBe("incident closed");
  });

  it("dispatches every due timer once and reports breached incidents", async () => {
    outcomes.authority = "satisfied";
    outcomes.processor = "escalate";
    outcomes.subject = "breached";

    const authorityCode = `${INCIDENT_PREFIX}-010`;
    const processorCode = `${INCIDENT_PREFIX}-011`;
    const subjectCode = `${INCIDENT_PREFIX}-012`;
    await scheduler.arm({
      incident_code: authorityCode,
      kind: TIMER_T72_AUTHORITY,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });
    await scheduler.arm({
      incident_code: processorCode,
      kind: TIMER_T_PROCESSOR,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });
    await scheduler.arm({
      incident_code: subjectCode,
      kind: TIMER_T_SUBJECT,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });

    const tickAt = new Date(now.getTime() + 2 * CONSTANTS.MS_PER_HOUR);
    now = tickAt;
    const result = await scheduler.tick(tickAt);

    expect(result.fired).toHaveLength(3);
    expect(result.fired.map((entry) => entry.timer.timer_type).sort()).toEqual([
      TIMER_T72_AUTHORITY,
      TIMER_T_PROCESSOR,
      TIMER_T_SUBJECT,
    ]);
    for (const entry of result.fired) {
      expect(entry.fired_at_utc).toBe(tickAt.toISOString());
    }

    expect(calls.authority).toEqual([authorityCode]);
    expect(calls.processor).toEqual([processorCode]);
    expect(calls.subject).toEqual([subjectCode]);
    expect(result.breached.sort()).toEqual([processorCode, subjectCode].sort());
    expect(await store.listActiveTimers()).toHaveLength(0);
  });

  it("never pages or breaches for the Peru advisory timer", async () => {
    const code = `${INCIDENT_PREFIX}-013`;
    await scheduler.arm({
      incident_code: code,
      kind: "T_PERU_ADVISORY",
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });

    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    try {
      const tickAt = new Date(now.getTime() + 2 * CONSTANTS.MS_PER_HOUR);
      now = tickAt;
      const result = await scheduler.tick(tickAt);

      expect(result.fired).toHaveLength(1);
      expect(result.breached).toEqual([]);
      expect(calls.peru).toEqual([code]);
      expect(pages).toHaveLength(0);
      expect(infoSpy).toHaveBeenCalledWith(`PERU_48H_ADVISORY:${code}`);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("pages with DEADLINE_MISSED_72H when the authority deadline breaches", async () => {
    outcomes.authority = "breached";
    const code = `${INCIDENT_PREFIX}-014`;
    await scheduler.arm({
      incident_code: code,
      kind: TIMER_T72_AUTHORITY,
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: {},
    });

    const tickAt = new Date(now.getTime() + 2 * CONSTANTS.MS_PER_HOUR);
    now = tickAt;
    const result = await scheduler.tick(tickAt);

    expect(result.breached).toEqual([code]);
    expect(pages).toEqual([
      {
        incident_code: code,
        kind: TIMER_T72_AUTHORITY,
        reason: "DEADLINE_MISSED_72H",
      },
    ]);
  });

  it("fires timers armed by a previous scheduler instance", async () => {
    const code = `${INCIDENT_PREFIX}-015`;
    const armed = await scheduler.arm({
      incident_code: code,
      kind: "T_PHASE_FOLLOWUP",
      fire_at_utc: futureIso(CONSTANTS.MS_PER_HOUR),
      payload: { pack_type: "authority", phase: 2 },
    });

    const restarted = buildScheduler();
    expect(await store.listActiveTimers(code)).toHaveLength(1);

    const tickAt = new Date(now.getTime() + 2 * CONSTANTS.MS_PER_HOUR);
    now = tickAt;
    const result = await restarted.tick(tickAt);

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]?.timer.timer_id).toBe(armed.timer_id);
    expect(calls.phase).toEqual([
      {
        incident_code: code,
        payload: { pack_type: "authority", phase: 2 },
      },
    ]);
    expect(await store.listActiveTimers(code)).toHaveLength(0);
  });

  it("arms a retry timer and rethrows when an effect fails", async () => {
    const code = `${INCIDENT_PREFIX}-016`;
    reviewFailure = new Error("review effect exploded");
    const armed = await scheduler.arm({
      incident_code: code,
      kind: TIMER_T_REVIEW_SLA,
      fire_at_utc: futureIso(30 * CONSTANTS.MS_PER_MINUTE),
      payload: { incidence: "review" },
    });

    const tickAt = new Date(now.getTime() + CONSTANTS.MS_PER_HOUR);
    now = tickAt;

    await expect(scheduler.tick(tickAt)).rejects.toThrow(
      "review effect exploded",
    );

    expect(calls.review).toEqual([code]);
    const active = await store.listActiveTimers(code);
    expect(active).toHaveLength(1);
    expect(active[0]?.timer_type).toBe(TIMER_T_RETRY);
    expect(active[0]?.payload[RETRY_OF_KEY]).toBe(armed.timer_id);
    expect(active[0]?.payload.failed_kind).toBe(TIMER_T_REVIEW_SLA);
  });
});
