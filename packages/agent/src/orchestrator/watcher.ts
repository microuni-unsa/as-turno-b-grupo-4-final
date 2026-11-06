import crypto from "node:crypto";
import type { AgentEventEmitter } from "@pims/agent/events/agent-events.ts";
import type { IncidentOrchestrator } from "@pims/agent/orchestrator/orchestrator.ts";
import { toJsonObject } from "@pims/agent/tools/helpers.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type {
  AgentEvent,
  DraftPacksResult,
  PageAlert,
  WatcherStage,
  WatcherState,
} from "@pims/types/agent.ts";
import { WatcherStateSchema } from "@pims/types/agent.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  LeaseHeldError,
  NotifyNoRecipientsError,
  PimsBaseError,
  PimsValidationError,
} from "@pims/types/errors.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

const LEASE_CONFLICT_BACKOFF_MS = 30_000;
const RECIPIENT_RETRY_MS = 60_000;
const TRANSIENT_BACKOFF_MS = [5_000, 15_000, 60_000] as const;
const TERMINAL_PACK_STATES: Readonly<Record<string, true>> = {
  sent: true,
  exempted: true,
  not_required: true,
};
const MAX_STAGE_STEPS = 10;

export function computeIncidentInputHash(incident: PimsIncident): string {
  const payload = {
    status: incident.status,
    severity: incident.severity,
    impact: incident.impact,
    title: incident.title,
    description: incident.description,
    incident_type: incident.incident_type,
    affected_data_types: incident.affected_data_types,
    num_affected_subjects: incident.num_affected_subjects,
    compromised_system: incident.compromised_system,
    affected_url: incident.affected_url,
    evidence_refs: incident.evidence_refs,
    security_measures_adopted: incident.security_measures_adopted,
    affected_cid: incident.affected_cid,
    involves_personal_data: incident.involves_personal_data,
    measure_updated_registry: incident.measure_updated_registry,
    measure_new_security: incident.measure_new_security,
    measure_improved_policies: incident.measure_improved_policies,
    measure_considered_resolved: incident.measure_considered_resolved,
    measure_reported_authorities: incident.measure_reported_authorities,
    resolved_date: incident.resolved_date,
    attachments_count: incident.attachments_count,
    actions_count: incident.actions_count,
    history: incident.history,
  };
  return crypto
    .createHash("sha256")
    .update(canonicalizeJson(payload))
    .digest("hex");
}

export interface IncidentWatcherDeps {
  adapter: PimsAdapter;
  orchestrator: IncidentOrchestrator;
  evidenceStore: EvidenceStore;
  events: AgentEventEmitter;
  config: AgentConfig;
  clock?: () => Date;
  page?: (alert: PageAlert) => void;
}

interface RetryEntry {
  attempt: number;
  next_attempt_at_ms: number;
}

export class IncidentWatcherDaemon {
  private readonly adapter: PimsAdapter;
  private readonly orchestrator: IncidentOrchestrator;
  private readonly evidenceStore: EvidenceStore;
  private readonly events: AgentEventEmitter;
  private readonly config: AgentConfig;
  private readonly clock: () => Date;
  private readonly page: (alert: PageAlert) => void;
  private readonly holderId = `watcher:${crypto.randomUUID()}`;
  private readonly inFlight = new Set<number>();
  private readonly retryByIncident = new Map<number, RetryEntry>();
  private running = false;
  private polling = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: IncidentWatcherDeps) {
    this.adapter = deps.adapter;
    this.orchestrator = deps.orchestrator;
    this.evidenceStore = deps.evidenceStore;
    this.events = deps.events;
    this.config = deps.config;
    this.clock = deps.clock ?? (() => new Date());
    this.page =
      deps.page ??
      ((alert) => {
        console.error(
          `PAGE:${alert.kind}:${alert.incident_code}:${alert.reason}`,
        );
      });
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.runLoop();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const incidents = await this.fetchActiveIncidents();
      for (const incident of incidents) {
        if (this.inFlight.has(incident.id)) {
          continue;
        }
        const retry = this.retryByIncident.get(incident.id);
        if (
          retry !== undefined &&
          retry.next_attempt_at_ms > this.clock().getTime()
        ) {
          continue;
        }
        this.inFlight.add(incident.id);
        try {
          await this.advance(incident);
          this.retryByIncident.delete(incident.id);
        } catch (error: unknown) {
          await this.handleFailure(incident, error);
        } finally {
          this.inFlight.delete(incident.id);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async runLoop(): Promise<void> {
    if (!this.running) {
      return;
    }
    try {
      await this.pollOnce();
    } catch (error: unknown) {
      console.error(
        `WATCHER_POLL_LOOP_ERROR:${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => {
          void this.runLoop();
        }, this.config.WATCHER_POLL_INTERVAL_MS);
      }
    }
  }

  private async fetchActiveIncidents(): Promise<PimsIncident[]> {
    const pageSize = this.config.PIMS_PAGE_SIZE.default;
    const byId = new Map<number, PimsIncident>();

    for (const status of ["O", "P"] as const) {
      const seen = new Set<number>();
      let pageNumber = 1;
      for (;;) {
        const page = await this.adapter.listIncidents({
          status,
          page: pageNumber,
          page_size: pageSize,
        });
        const fresh = page.results.filter((incident) => !seen.has(incident.id));
        for (const incident of fresh) {
          seen.add(incident.id);
          if (incident.status !== "C") {
            byId.set(incident.id, incident);
          }
        }
        if (page.results.length < pageSize || fresh.length === 0) {
          break;
        }
        pageNumber += 1;
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }

  private async advance(incident: PimsIncident): Promise<void> {
    await this.orchestrator.ensureAwarenessTimers(incident);
    let state = await this.loadState(incident);
    for (let step = 0; step < MAX_STAGE_STEPS; step += 1) {
      switch (state.stage) {
        case "detected": {
          this.emitRole(incident.incident_code, "orchestrator");
          await this.orchestrator.triage(incident.id);
          state = await this.saveState(incident, "triaged");
          break;
        }
        case "triaged": {
          await this.orchestrator.investigate(incident.id);
          state = await this.saveState(incident, "investigated");
          break;
        }
        case "investigated": {
          const result = await this.orchestrator.draftPacks(incident.id, {
            phaseDueAtUtc: new Date(
              this.clock().getTime() +
                this.config.PHASE_DUE_HOURS * CONSTANTS.MS_PER_HOUR,
            ).toISOString(),
          });
          state = await this.saveState(incident, "drafted");
          const authPack = await this.evidenceStore.getDraftPack(
            incident.incident_code,
            "authority",
          );
          const freshIncident = await this.adapter.getIncident(incident.id);
          const inputHash = computeIncidentInputHash(freshIncident);
          await this.evidenceStore.setAgentState(
            `PROPOSAL_INPUT_HASH:${incident.incident_code}`,
            toJsonObject({
              hash: inputHash,
              pack_content_sha256: authPack?.contentSha256 ?? null,
              updated_at_utc: this.clock().toISOString(),
            }),
          );
          if (!this.config.AUTO_NOTIFY) {
            state = await this.saveState(incident, "awaiting_approval");
            this.emitDraftApprovalRequests(incident.incident_code, result);
            await this.orchestrator.armReviewSlaTimerIfAbsent(freshIncident);
            return;
          }
          break;
        }
        case "drafted": {
          if (!this.config.AUTO_NOTIFY) {
            state = await this.saveState(incident, "awaiting_approval");
            await this.emitApprovedPackRequests(incident.incident_code);
            await this.orchestrator.armReviewSlaTimerIfAbsent(incident);
            break;
          }
          const result = await this.orchestrator.approveAndNotify(incident.id, {
            vetoWindowMin: this.config.HUMAN_VETO_WINDOW_MIN,
          });
          if (result.parked) {
            state = await this.saveState(incident, "awaiting_approval", {
              parked_until_utc: result.parkedUntilUtc,
            });
          } else {
            state = await this.saveState(incident, "notified");
          }
          break;
        }
        case "awaiting_approval": {
          state = await this.advanceAwaitingApproval(incident, state);
          if (state.stage === "awaiting_approval") {
            return;
          }
          break;
        }
        case "notified": {
          await this.orchestrator.monitor(incident.id);
          await this.orchestrator.close(incident.id);
          state = await this.saveState(incident, "closed");
          break;
        }
        case "closed": {
          return;
        }
        case "blocked": {
          const stored = (await this.evidenceStore.getAgentState(
            `PROPOSAL_INPUT_HASH:${incident.incident_code}`,
          )) as { hash?: string } | null;
          const currentHash = computeIncidentInputHash(incident);

          if (stored !== null && stored.hash === currentHash) {
            return;
          }

          const resume = state.blocked_at_stage;
          if (resume === null) {
            throw new PimsValidationError(
              "watcher_state",
              "BLOCKED_WITHOUT_STAGE",
            );
          }
          state = await this.saveState(incident, resume, {
            blocked_at_stage: null,
            blocked_reason: null,
          });
          break;
        }
        default: {
          const exhaustiveCheck: never = state.stage;
          throw new PimsValidationError(
            "watcher_state",
            `Unhandled watcher stage: ${String(exhaustiveCheck)}`,
          );
        }
      }
    }
    throw new PimsValidationError("watcher_state", "STAGE_LOOP_EXCEEDED");
  }

  private async advanceAwaitingApproval(
    incident: PimsIncident,
    state: WatcherState,
  ): Promise<WatcherState> {
    if (state.blocked_reason === "NOTIFY_NO_RECIPIENTS") {
      const result = await this.orchestrator.approveAndNotify(incident.id, {
        vetoWindowMin: 0,
      });
      if (result.parked) {
        return this.saveState(incident, "awaiting_approval", {
          parked_until_utc: result.parkedUntilUtc,
        });
      }
      return this.saveState(incident, "notified");
    }

    const packs = await this.latestPacks(incident.incident_code);
    if (
      packs.length > 0 &&
      packs.every((pack) => TERMINAL_PACK_STATES[pack.state] === true)
    ) {
      return this.saveState(incident, "notified");
    }

    const stored = (await this.evidenceStore.getAgentState(
      `PROPOSAL_INPUT_HASH:${incident.incident_code}`,
    )) as { hash?: string } | null;
    const currentHash = computeIncidentInputHash(incident);

    if (!stored || stored.hash !== currentHash) {
      return this.saveState(incident, "investigated");
    }

    if (packs.some((pack) => pack.state === "draft")) {
      return state;
    }

    if (this.config.AUTO_NOTIFY && state.parked_until_utc !== null) {
      const parkedUntil = new Date(state.parked_until_utc).getTime();
      if (parkedUntil <= this.clock().getTime()) {
        const result = await this.orchestrator.approveAndNotify(incident.id, {
          vetoWindowMin: 0,
        });
        if (result.parked) {
          return this.saveState(incident, "awaiting_approval", {
            parked_until_utc: result.parkedUntilUtc,
          });
        }
        return this.saveState(incident, "notified");
      }
    }

    return state;
  }

  private async handleFailure(
    incident: PimsIncident,
    error: unknown,
  ): Promise<void> {
    const now = this.clock();
    const code = error instanceof PimsBaseError ? error.code : "UNKNOWN";

    if (error instanceof LeaseHeldError) {
      this.scheduleRetry(incident.id, LEASE_CONFLICT_BACKOFF_MS);
      this.events.emit({
        type: "agent:error",
        at_utc: now.toISOString(),
        incident_code: incident.incident_code,
        code,
        message: error.message,
      });
      return;
    }

    if (error instanceof NotifyNoRecipientsError) {
      await this.saveState(incident, "awaiting_approval", {
        blocked_at_stage: "drafted",
        blocked_reason: "NOTIFY_NO_RECIPIENTS",
        last_error_code: error.code,
      });
      this.events.emit({
        type: "review:approval_requested",
        at_utc: now.toISOString(),
        incident_code: incident.incident_code,
        kind: "recipient_required",
        pack_type: null,
        pack_id: null,
        approval_id: null,
      });
      this.page({
        incident_code: incident.incident_code,
        kind: "T_RETRY",
        reason: "NOTIFY_NO_RECIPIENTS",
      });
      this.scheduleRetry(incident.id, RECIPIENT_RETRY_MS);
      return;
    }

    const rawState = await this.evidenceStore.getAgentState(
      `WATCHER:${incident.incident_code}`,
    );
    const parsedState =
      rawState !== null ? WatcherStateSchema.safeParse(rawState) : null;
    const wasAlreadyBlocked =
      parsedState?.success === true && parsedState.data.stage === "blocked";
    const lastStage =
      parsedState?.success === true
        ? parsedState.data.stage === "blocked"
          ? (parsedState.data.blocked_at_stage ?? "detected")
          : parsedState.data.stage
        : (await this.inferState(incident)).stage;

    await this.saveState(incident, "blocked", {
      blocked_at_stage: lastStage,
      blocked_reason: error instanceof Error ? error.message : String(error),
      last_error_code: code,
    });
    const freshIncident = await this.adapter.getIncident(incident.id);
    const currentHash = computeIncidentInputHash(freshIncident);
    await this.evidenceStore.setAgentState(
      `PROPOSAL_INPUT_HASH:${incident.incident_code}`,
      toJsonObject({
        hash: currentHash,
        pack_content_sha256: null,
        updated_at_utc: now.toISOString(),
      }),
    );
    this.events.emit({
      type: "agent:blocked",
      at_utc: now.toISOString(),
      incident_code: incident.incident_code,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    if (!wasAlreadyBlocked) {
      this.page({
        incident_code: incident.incident_code,
        kind: "T_RETRY",
        reason: code,
      });
    }

    const attempt = this.retryByIncident.get(incident.id)?.attempt ?? 0;
    this.scheduleRetry(incident.id, this.backoffFor(attempt));
  }

  private backoffFor(attempt: number): number {
    const index = Math.min(attempt, TRANSIENT_BACKOFF_MS.length - 1);
    const value = TRANSIENT_BACKOFF_MS[index];
    if (value === undefined) {
      return RECIPIENT_RETRY_MS;
    }
    return value;
  }

  private scheduleRetry(incidentId: number, delayMs: number): void {
    const current = this.retryByIncident.get(incidentId);
    const attempt = (current?.attempt ?? 0) + 1;
    this.retryByIncident.set(incidentId, {
      attempt,
      next_attempt_at_ms: this.clock().getTime() + delayMs,
    });
  }

  private async loadState(incident: PimsIncident): Promise<WatcherState> {
    const raw = await this.evidenceStore.getAgentState(
      `WATCHER:${incident.incident_code}`,
    );
    if (raw !== null) {
      const parsed = WatcherStateSchema.safeParse(raw);
      if (!parsed.success) {
        throw new PimsValidationError("watcher_state", "INVALID_WATCHER_STATE");
      }
      if (parsed.data.incident_id !== incident.id) {
        return this.inferState(incident);
      }
      return parsed.data;
    }
    return this.inferState(incident);
  }

  private async inferState(incident: PimsIncident): Promise<WatcherState> {
    if (incident.status === "O") {
      return this.buildState(incident, "detected");
    }
    if (incident.status === "C") {
      return this.buildState(incident, "closed");
    }

    const manifest = await this.evidenceStore.getBundleManifest(
      incident.incident_code,
    );
    if (manifest !== null && manifest.seal_sha256 !== null) {
      return this.buildState(incident, "closed");
    }

    const packs = await this.latestPacks(incident.incident_code);
    if (packs.length > 0) {
      return this.buildState(
        incident,
        this.config.AUTO_NOTIFY ? "drafted" : "awaiting_approval",
      );
    }

    const rootCause = await this.evidenceStore.getRootCause(
      incident.incident_code,
    );
    const hasAnalysisAction = incident.actions?.some(
      (action) => action.action_type === "A",
    );
    if (rootCause !== null || hasAnalysisAction) {
      return this.buildState(incident, "investigated");
    }

    return this.buildState(incident, "triaged");
  }

  private buildState(
    incident: PimsIncident,
    stage: WatcherStage,
  ): WatcherState {
    return {
      incident_id: incident.id,
      incident_code: incident.incident_code,
      stage,
      blocked_at_stage: null,
      blocked_reason: null,
      parked_until_utc: null,
      last_error_code: null,
      updated_at_utc: this.clock().toISOString(),
    };
  }

  private async saveState(
    incident: PimsIncident,
    stage: WatcherStage,
    overrides?: Partial<WatcherState>,
  ): Promise<WatcherState> {
    const base = this.buildState(incident, stage);
    const state: WatcherState = { ...base, ...overrides };
    await this.evidenceStore.setAgentState(
      `WATCHER:${incident.incident_code}`,
      toJsonObject(state),
    );
    return state;
  }

  private async latestPacks(incidentCode: string): Promise<
    Array<{
      pack_type: "authority" | "subject";
      pack_id: string | null;
      approval_id: string | null;
      state: string;
    }>
  > {
    const out: Array<{
      pack_type: "authority" | "subject";
      pack_id: string | null;
      approval_id: string | null;
      state: string;
    }> = [];
    for (const packType of ["authority", "subject"] as const) {
      const row = await this.evidenceStore.getDraftPack(incidentCode, packType);
      if (row === null) {
        continue;
      }
      out.push({
        pack_type: packType,
        pack_id: readPackId(row.payload),
        approval_id: row.reviewApprovalId,
        state: row.state,
      });
    }
    return out;
  }

  private emitDraftApprovalRequests(
    incidentCode: string,
    result: DraftPacksResult,
  ): void {
    const pairs: Array<{
      pack_type: "authority" | "subject";
      pack_id: string | null;
    }> = [
      { pack_type: "authority", pack_id: result.authority_pack_id },
      { pack_type: "subject", pack_id: result.subject_pack_id },
    ];
    for (const pair of pairs) {
      if (pair.pack_id === null) {
        continue;
      }
      this.emitApproval(incidentCode, pair.pack_type, pair.pack_id, null);
    }
  }

  private async emitApprovedPackRequests(incidentCode: string): Promise<void> {
    const packs = await this.latestPacks(incidentCode);
    for (const pack of packs) {
      if (pack.state !== "approved" || pack.pack_id === null) {
        continue;
      }
      this.emitApproval(
        incidentCode,
        pack.pack_type,
        pack.pack_id,
        pack.approval_id,
      );
    }
  }

  private emitApproval(
    incidentCode: string,
    packType: "authority" | "subject",
    packId: string,
    approvalId: string | null,
  ): void {
    this.events.emit({
      type: "review:approval_requested",
      at_utc: this.clock().toISOString(),
      incident_code: incidentCode,
      kind: "notice_approval",
      pack_type: packType,
      pack_id: packId,
      approval_id: approvalId,
    });
  }

  private emitRole(incidentCode: string, role: "orchestrator"): void {
    const event: AgentEvent = {
      type: "role:transition",
      at_utc: this.clock().toISOString(),
      incident_code: incidentCode,
      role,
      previous_role: null,
      lease_holder: this.holderId,
    };
    this.events.emit(event);
  }
}

function readPackId(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const value = (payload as Record<string, unknown>).pack_id;
  return typeof value === "string" ? value : null;
}
