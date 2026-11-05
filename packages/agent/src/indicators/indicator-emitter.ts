import crypto from "node:crypto";
import {
  awarenessFromIncident,
  limaLocalToUtc,
} from "@pims/agent/orchestrator/scheduler.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import {
  type AgentRole,
  type IndicatorEvent,
  IndicatorEventSchema,
} from "@pims/types/agent.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  ArtifactIncompleteError,
  ConfigError,
  PimsUnavailableError,
  PimsValidationError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

export interface IndicatorEmitterDeps {
  store: EvidenceStore;
  config: AgentConfig;
  clock: () => Date;
  fetchImpl?: typeof fetch;
}

export class IndicatorEmitter {
  private readonly store: EvidenceStore;
  private readonly config: AgentConfig;
  private readonly clock: () => Date;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: IndicatorEmitterDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.clock = deps.clock;
    if (deps.fetchImpl !== undefined) {
      this.fetchImpl = deps.fetchImpl;
    } else {
      this.fetchImpl = fetch;
    }
  }

  async emit(
    event: IndicatorEvent,
  ): Promise<{ accepted: true } | { spooled: true }> {
    const parsed = IndicatorEventSchema.parse(event);

    if (parsed.event === "incident_closed") {
      if (!Number.isFinite(parsed.attrs.mttd_hours)) {
        throw new ArtifactIncompleteError(
          "indicator:incident_closed",
          "mttd_hours",
        );
      } else if (!Number.isFinite(parsed.attrs.mttr_hours)) {
        throw new ArtifactIncompleteError(
          "indicator:incident_closed",
          "mttr_hours",
        );
      }
    }

    const payload: JsonObject = structuredClone(
      parsed,
    ) as unknown as JsonObject;

    const url = this.config.INDICATOR_WEBHOOK_URL;
    if (url === undefined || url.trim() === "") {
      await this.spool(parsed.event, payload);
      console.info(CONSTANTS.INDICATOR_SPOOL_ONLY);
      return { spooled: true };
    } else {
      const secret = this.resolveSecret();
      const body = JSON.stringify(parsed);
      const delivered = await this.post(url, secret, body);
      if (delivered) {
        return { accepted: true };
      } else {
        await this.spool(parsed.event, payload);
        return { spooled: true };
      }
    }
  }

  async flush(): Promise<{ delivered: number; remaining: number }> {
    const records = await this.store.listIndicatorSpool();
    const url = this.config.INDICATOR_WEBHOOK_URL;
    if (url === undefined || url.trim() === "") {
      return { delivered: 0, remaining: records.length };
    } else {
      const secret = this.resolveSecret();
      const deliveredIds: number[] = [];
      const undeliveredIds: number[] = [];
      for (const record of records) {
        const body = JSON.stringify(record.payload);
        const delivered = await this.post(url, secret, body);
        if (delivered) {
          deliveredIds.push(record.id);
        } else {
          undeliveredIds.push(record.id);
        }
      }

      await this.store.deleteIndicatorSpool(deliveredIds);
      return {
        delivered: deliveredIds.length,
        remaining: records.length - deliveredIds.length,
      };
    }
  }

  async emitTransition(
    event: {
      event: IndicatorEvent["event"];
      attrs: IndicatorEvent["attrs"];
      incident_code: string;
      actor_role: AgentRole;
    },
    incident: PimsIncident,
  ): Promise<{ accepted: true } | { spooled: true }> {
    const awareness = awarenessFromIncident(incident);
    const now = this.clock();
    const occurrence = limaLocalToUtc(
      incident.incident_date,
      CONSTANTS.START_OF_DAY_TIME,
    );
    const mttdDiffMs = awareness.getTime() - occurrence.getTime();
    if (mttdDiffMs < 0) {
      throw new PimsValidationError(
        "Invalid incident timeline: awareness timestamp precedes occurrence timestamp",
        "TIMELINE:INVALID_MTTD",
        {
          awareness: awareness.toISOString(),
          occurrence: occurrence.toISOString(),
        },
      );
    }
    const mttrDiffMs = now.getTime() - awareness.getTime();
    if (mttrDiffMs < 0) {
      throw new PimsValidationError(
        "Invalid incident timeline: current timestamp precedes awareness timestamp",
        "TIMELINE:INVALID_MTTR",
        {
          now: now.toISOString(),
          awareness: awareness.toISOString(),
        },
      );
    }
    const mttd_hours = mttdDiffMs / CONSTANTS.MS_PER_HOUR;
    const mttr_hours = mttrDiffMs / CONSTANTS.MS_PER_HOUR;

    const parsed = IndicatorEventSchema.parse({
      event: event.event,
      incident_code: incident.incident_code,
      at_utc: now.toISOString(),
      actor_role: event.actor_role,
      attrs: { ...event.attrs, mttd_hours, mttr_hours },
    });

    return this.emit(parsed);
  }

  private resolveSecret(): string {
    const secretEnv = this.config.INDICATOR_WEBHOOK_SECRET_ENV;
    const secret =
      secretEnv === undefined || secretEnv.trim() === ""
        ? undefined
        : process.env[secretEnv];
    if (secret === undefined || secret === "") {
      throw new ConfigError(
        "INDICATOR_WEBHOOK_SECRET_ENV is required when INDICATOR_WEBHOOK_URL is set",
        "CONFIG_MISSING:INDICATOR_WEBHOOK_SECRET_ENV",
      );
    }
    return secret;
  }

  private async post(
    url: string,
    secret: string,
    body: string,
  ): Promise<boolean> {
    const hmac = crypto
      .createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": CONSTANTS.MIME_APPLICATION_JSON,
          "X-PIMS-Signature": `sha256=${hmac}`,
        },
        body,
      });
      if (response.ok) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      throw new PimsUnavailableError(
        `Indicator webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async spool(eventType: string, payload: JsonObject): Promise<void> {
    const count = await this.store.countIndicatorSpool();
    let droppedCount = 0;
    if (count >= this.config.INDICATOR_SPOOL_MAX) {
      droppedCount = await this.store.dropOldestIndicatorSpool(
        count - this.config.INDICATOR_SPOOL_MAX + 1,
      );
      console.warn(`${CONSTANTS.INDICATOR_SPOOL_FULL_PREFIX}${droppedCount}`);
    } else {
      droppedCount = 0;
    }
    await this.store.spoolIndicator(eventType, payload);
  }
}
