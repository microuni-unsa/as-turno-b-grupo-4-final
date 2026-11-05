import crypto from "node:crypto";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type {
  DueTimer,
  PageAlert,
  SchedulerArmArgs,
  TimerKind,
} from "@pims/types/agent.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  PimsClientBugError,
  PimsValidationError,
  SchedulerDuplicateError,
  SchedulerOverflowError,
  SchedulerPastDueError,
  SchedulerUnknownTimerError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

const LIMA_TIME_ZONE = "America/Lima";

const TIMER_KIND_CLASS: Readonly<Record<TimerKind, "deadline" | "retry">> =
  Object.freeze({
    T72_AUTHORITY: "deadline",
    T_PROCESSOR: "deadline",
    T_SUBJECT: "deadline",
    T_REVIEW_SLA: "deadline",
    T_PERU_ADVISORY: "deadline",
    T_PHASE_FOLLOWUP: "deadline",
    T_RETRY: "retry",
  });

export interface TimerEffects {
  authorityDeadline(incidentCode: string): Promise<"satisfied" | "breached">;
  processorDeadline(incidentCode: string): Promise<"satisfied" | "escalate">;
  subjectDeadline(incidentCode: string): Promise<"satisfied" | "breached">;
  reviewDeadline(incidentCode: string): Promise<"satisfied" | "breached">;
  peruAdvisory(incidentCode: string): Promise<void>;
  phaseFollowup(incidentCode: string, payload: JsonObject): Promise<void>;
  retry(incidentCode: string, payload: JsonObject): Promise<void>;
}

export interface DeadlineSchedulerDeps {
  store: EvidenceStore;
  config: AgentConfig;
  clock: () => Date;
  random?: () => number;
  effects: TimerEffects;
  page: (alert: PageAlert) => void;
}

export interface ArmResult {
  timer_id: string;
  late: boolean;
}

export interface TickResult {
  fired: DueTimer[];
  breached: string[];
}

function limaOffsetMs(instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new PimsClientBugError(
        `Intl.DateTimeFormat missing part '${type}' for ${LIMA_TIME_ZONE}`,
      );
    }
    return Number(part.value);
  };
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

export function limaLocalToUtc(date: string, time: string): Date {
  const dateParts = date.split("-").map((part) => Number(part));
  const timeParts = time.split(":").map((part) => Number(part));
  if (dateParts.length !== 3 || timeParts.length < 2) {
    throw new PimsValidationError(
      "detection_datetime",
      `Invalid Lima local date/time: ${date} ${time}`,
    );
  }
  const [year, month, day] = dateParts as [number, number, number];
  const [hour, minute, second] = timeParts as [number, number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute, second ?? 0);
  const offset = limaOffsetMs(new Date(naive));
  return new Date(naive - offset);
}

export function awarenessFromIncident(incident: PimsIncident): Date {
  const detectionDate = incident.detection_date ?? null;
  const detectionTime = incident.detection_time ?? null;

  if (detectionDate !== null && detectionDate.length > 0) {
    if (detectionTime !== null && detectionTime.length > 0) {
      return limaLocalToUtc(detectionDate, detectionTime);
    }
    return limaLocalToUtc(detectionDate, "00:00:00");
  }

  const createdAt = new Date(incident.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    throw new PimsValidationError(
      "created_at",
      `Incident ${incident.incident_code} has no valid awareness instant`,
    );
  }
  return createdAt;
}

export class DeadlineScheduler {
  private readonly store: EvidenceStore;
  private readonly config: AgentConfig;
  private readonly clock: () => Date;
  private readonly random: () => number;
  private readonly effects: TimerEffects;
  private readonly page: DeadlineSchedulerDeps["page"];

  constructor(deps: DeadlineSchedulerDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.clock = deps.clock;
    this.random = deps.random ?? Math.random;
    this.effects = deps.effects;
    this.page = deps.page;
  }

  async arm(args: SchedulerArmArgs): Promise<ArmResult> {
    const active = await this.store.listActiveTimers();

    if (
      TIMER_KIND_CLASS[args.kind] === "retry" &&
      active.length >= this.config.SCHEDULER_MAX_TIMERS
    ) {
      throw new SchedulerOverflowError(
        `Refusing new ${args.kind} timer: ${active.length} active timers reach SCHEDULER_MAX_TIMERS`,
      );
    }

    const duplicate = active.find(
      (timer) =>
        timer.incident_code === args.incident_code &&
        timer.timer_type === args.kind,
    );
    if (duplicate !== undefined) {
      throw new SchedulerDuplicateError(
        `Timer ${args.kind} already armed for ${args.incident_code}; cancel-then-arm instead`,
      );
    }

    const timerId = `timer:${args.incident_code}:${args.kind}:${crypto.randomUUID()}`;
    const fireAt = new Date(args.fire_at_utc);
    if (Number.isNaN(fireAt.getTime())) {
      throw new PimsValidationError(
        "fire_at_utc",
        `Invalid timer schedule date: ${args.fire_at_utc}`,
      );
    }
    const now = this.clock();
    const isPastDue = fireAt.getTime() <= now.getTime();

    await this.store.armTimer({
      timer_id: timerId,
      incident_code: args.incident_code,
      timer_type: args.kind,
      fire_at_utc: fireAt.toISOString(),
      payload: args.payload,
      fired: false,
      cancelled_reason: null,
    });

    if (!isPastDue) {
      return { timer_id: timerId, late: false };
    }

    await this.dispatch(args.kind, args.incident_code, args.payload);
    await this.store.markTimerFired(timerId, now);
    console.warn(`TIMER_FIRED_LATE:${timerId}`);
    throw new SchedulerPastDueError(timerId, { kind: args.kind });
  }

  async cancel(timerId: string, reason: string): Promise<void> {
    const active = await this.store.listActiveTimers();
    const match = active.find((timer) => timer.timer_id === timerId);
    if (match === undefined) {
      throw new SchedulerUnknownTimerError(timerId);
    }
    await this.store.cancelTimer(timerId, reason);
  }

  async tick(now: Date = this.clock()): Promise<TickResult> {
    const due = await this.store.listDueTimers(
      now,
      this.config.SCHEDULER_MAX_TIMERS,
    );
    const fired: DueTimer[] = [];
    const breached: string[] = [];
    let firstError: unknown = null;

    for (const timer of due) {
      await this.store.markTimerFired(timer.timer_id, now);
      fired.push({ timer, fired_at_utc: now.toISOString() });

      const kind = timer.timer_type as TimerKind;
      const kindClass = TIMER_KIND_CLASS[kind];
      if (kindClass === undefined) {
        throw new PimsClientBugError(
          `Unknown persisted timer kind '${timer.timer_type}' for ${timer.timer_id}`,
        );
      }

      try {
        const outcome = await this.dispatch(
          kind,
          timer.incident_code,
          timer.payload,
        );
        if (outcome === "breached" || outcome === "escalate") {
          breached.push(timer.incident_code);
        }
      } catch (error: unknown) {
        if (kind === "T_RETRY") {
          // A failed retry must not arm another retry: that self-nests
          // payloads and fires forever. Page once and stop the chain.
          this.page({
            incident_code: timer.incident_code,
            kind,
            reason: `RETRY_EXHAUSTED:${timer.timer_id}`,
          });
        } else {
          await this.armRetry(
            timer.incident_code,
            timer.timer_id,
            kind,
            timer.payload,
            now,
          );
        }
        if (firstError === null) {
          firstError = error;
        }
      }
    }

    if (firstError !== null) {
      throw firstError;
    }

    return { fired, breached };
  }

  private async armRetry(
    incidentCode: string,
    failedTimerId: string,
    failedKind: TimerKind,
    payload: JsonObject,
    now: Date,
  ): Promise<void> {
    const active = await this.store.listActiveTimers(incidentCode);
    const existing = active.find(
      (timer) =>
        timer.timer_type === "T_RETRY" &&
        (timer.payload as { failed_kind?: string })?.failed_kind === failedKind,
    );
    if (existing !== undefined) {
      return;
    }
    const backoffMs = CONSTANTS.DEFAULT_RETRY_BACKOFF_MS[0];
    const jittered = Math.round(backoffMs * (1 + this.random() * 0.1));
    const timerId = `timer:${incidentCode}:T_RETRY:${crypto.randomUUID()}`;
    await this.store.armTimer({
      timer_id: timerId,
      incident_code: incidentCode,
      timer_type: "T_RETRY",
      fire_at_utc: new Date(now.getTime() + jittered).toISOString(),
      payload: { retry_of: failedTimerId, failed_kind: failedKind, payload },
      fired: false,
      cancelled_reason: null,
    });
  }

  private async dispatch(
    kind: TimerKind,
    incidentCode: string,
    payload: JsonObject,
  ): Promise<"satisfied" | "breached" | "escalate" | "advisory"> {
    switch (kind) {
      case "T72_AUTHORITY": {
        const outcome = await this.effects.authorityDeadline(incidentCode);
        if (outcome === "breached") {
          this.page({
            incident_code: incidentCode,
            kind,
            reason: "DEADLINE_MISSED_72H",
          });
        }
        return outcome;
      }
      case "T_PROCESSOR": {
        const outcome = await this.effects.processorDeadline(incidentCode);
        if (outcome === "escalate") {
          this.page({
            incident_code: incidentCode,
            kind,
            reason: "PROCESSOR_DEADLINE_ESCALATED",
          });
        }
        return outcome;
      }
      case "T_SUBJECT": {
        const outcome = await this.effects.subjectDeadline(incidentCode);
        if (outcome === "breached") {
          this.page({
            incident_code: incidentCode,
            kind,
            reason: "DEADLINE_MISSED_SUBJECT",
          });
        }
        return outcome;
      }
      case "T_REVIEW_SLA": {
        const outcome = await this.effects.reviewDeadline(incidentCode);
        if (outcome === "breached") {
          this.page({
            incident_code: incidentCode,
            kind,
            reason: "DEADLINE_MISSED_REVIEW_SLA",
          });
        }
        return outcome;
      }
      case "T_PERU_ADVISORY": {
        console.info(`PERU_48H_ADVISORY:${incidentCode}`);
        await this.effects.peruAdvisory(incidentCode);
        return "advisory";
      }
      case "T_PHASE_FOLLOWUP": {
        await this.effects.phaseFollowup(incidentCode, payload);
        return "satisfied";
      }
      case "T_RETRY": {
        await this.effects.retry(incidentCode, payload);
        return "satisfied";
      }
      default: {
        const exhaustiveCheck: never = kind;
        throw new PimsClientBugError(
          `Unhandled timer kind: ${String(exhaustiveCheck)}`,
        );
      }
    }
  }
}
