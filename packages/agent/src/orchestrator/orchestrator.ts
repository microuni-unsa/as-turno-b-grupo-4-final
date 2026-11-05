import crypto from "node:crypto";
import type { AgentEventEmitter } from "@pims/agent/events/agent-events.ts";
import type { IndicatorEmitter } from "@pims/agent/indicators/indicator-emitter.ts";
import type { CloseChecklistVerifier } from "@pims/agent/lifecycle/close-checklist.ts";
import { findDedupeDecision } from "@pims/agent/lifecycle/dedupe.ts";
import {
  appendEvidenceMarker,
  readMarkers,
} from "@pims/agent/lifecycle/markers.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import {
  redactForPrompt,
  redactOptionalForPrompt,
} from "@pims/agent/llm/safe-prompt.ts";
import type { RoleRegistry } from "@pims/agent/orchestrator/roles.ts";
import {
  awarenessFromIncident,
  type DeadlineScheduler,
  limaLocalToUtc,
  type TimerEffects,
} from "@pims/agent/orchestrator/scheduler.ts";
import type { NoticeDraftService } from "@pims/agent/review/draft-service.ts";
import type { NoticeReviewer } from "@pims/agent/review/reviewer.ts";
import { assetIdsForSystem, toJsonObject } from "@pims/agent/tools/helpers.ts";
import type {
  ToolCallContext,
  ToolRegistry,
} from "@pims/agent/tools/registry.ts";
import type { AgentConfig } from "@pims/config";
import type { BundleSealer } from "@pims/evidence/bundle-sealer.ts";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { sha256HexBytes } from "@pims/evidence/forensic-patterns.ts";
import type { ExemptionEngine } from "@pims/notices/exemption-engine.ts";
import type { NoticeComposer } from "@pims/notices/notice-composer.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import {
  type AgentRole,
  type ApproveNotifyResult,
  CLOSE_CHECKLIST_ITEMS,
  type CloseResult,
  type DraftReviewOptions,
  type DraftReviewResult,
  type IndicatorEventAttrs,
  type IntakeCallbacks,
  type IntakePayload,
  type IntakeResult,
  type InvestigationResult,
  type MonitorResult,
  type PageAlert,
  type PimsEmitRiskSignalResult,
  type PimsNotifyResult,
  PimsNotifyResultSchema,
  type ReviewResult,
  RiskCatalogCodesSchema,
  RootCauseSchema,
  SchedulerArmResultSchema,
  type TimerKind,
  TOT_METHODS,
  type ToolName,
  type TotEvidence,
  type TriageCalibrationMode,
  type TriageResult,
} from "@pims/types/agent.ts";
import { assertAttachmentMeta } from "@pims/types/attachments.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import {
  BUNDLE_ATTACHMENT_NAME,
  CONFORMAL_ALPHA,
  CONFORMAL_MIN_SAMPLES,
  MODEL_ROUTE_EMBEDDINGS,
  MODEL_ROUTE_FAST,
  MODEL_ROUTE_REASONING,
  PERU_ADVISORY_H,
} from "@pims/types/constants.ts";
import {
  ArtifactIncompleteError,
  BundleAlreadySealedError,
  BundlePimsMismatchError,
  CloseChecklistFailedError,
  ConfigError,
  DuplicateCreatedError,
  EscalateStuckReviewError,
  EvidenceNotFoundError,
  ExemptionUngroundedError,
  HistoryGapError,
  IntakeDescriptionTooLongError,
  IntakeEmptyError,
  IntakeTitleTooLongError,
  LeaseLostError,
  ModelSchemaViolationError,
  ModelUnavailableError,
  OperatorHaltError,
  PimsBaseError,
  PimsNotFoundError,
  PimsUnknownCodeError,
  PimsValidationError,
  RestoreFailedError,
  TimerMissingError,
  TransitionForbiddenError,
} from "@pims/types/errors.ts";
import type {
  EvidenceBundleIncident,
  EvidenceBundleManifest,
  EvidenceBundleRootCause,
} from "@pims/types/evidence.ts";
import type { JsonObject, JsonValue } from "@pims/types/models.ts";
import type {
  ExemptionEvaluationInput,
  ExemptionEvaluationResult,
  NumericApproval,
} from "@pims/types/notices.ts";
import {
  AFFECTED_CID,
  type AffectedDataType,
  INCIDENT_IMPACTS,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentType,
  type PimsIncident,
  type PimsIncidentHistory,
  PimsIncidentSchema,
} from "@pims/types/pims.ts";
import { z } from "zod";

export const TRIAGE_SYSTEM =
  "You are the triage classifier of a GDPR/ISO 27701 incident-response agent. Classify incident_type, severity, impact and affected CID against the standard enum catalogs, and cite the standard definitions and GDPR risk factors. Return strict JSON only. Never guess enum values outside the supplied catalogs.";

export const ROOT_CAUSE_SYSTEM =
  "You investigate the root cause of a privacy incident. Read the incident, history, actions, evidence and citations. Return one primary cause with supporting evidence refs, the analysis method used (5-whys, fishbone, or fault-tree), whether the cause is systemic, and the remediation. Return strict JSON only.";

export const RISK_CATALOG_SYSTEM =
  "You map one root-cause statement to the live PIMS risk catalogs. Match the threat and vulnerability that the cause exercises. Use ONLY codes present in the supplied threat/vulnerability arrays; when no listed code matches, return null for that field. Return only the requested JSON object.";

export const B3_12_SYSTEM =
  "You are the incident breach-review gate under ISO 27701. Decide whether the observed event is a personal-data breach requiring a response, or a documented non-trigger (ping, scan, failed logon without success). Cite the controlling normative passages. Return strict JSON only.";

export const CONTAINMENT_SYSTEM =
  "You are the containment planner of an incident-response agent. Propose concrete containment actions (isolate system, revoke credentials, block URL/IP, preserve logs). Each action is one sentence with an optional responsible owner and evidence pointer. Return strict JSON only.";

export const TRAINING_SYSTEM =
  "You are the awareness-training advisor. Given a human-error incident whose fishbone People bone carries causes, propose one training topic and one audience. Return strict JSON only.";

const TriageModelSchema = z
  .object({
    incident_type: z.enum(INCIDENT_TYPES),
    candidate_probabilities: z
      .array(
        z
          .object({
            type: z.enum(INCIDENT_TYPES),
            probability: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1),
    severity: z.enum(INCIDENT_SEVERITIES),
    impact: z.enum(INCIDENT_IMPACTS),
    affected_cid: z.array(z.enum(AFFECTED_CID)).min(1),
    rationale: z.array(z.string().min(1)).max(3),
    citations: z.array(z.string().min(1)),
  })
  .strict();

const ContainmentModelSchema = z
  .object({
    actions: z.array(
      z
        .object({
          description: z.string().min(1),
          responsible: z.string().min(1).optional(),
          evidence: z.string().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

const GateModelSchema = z
  .object({
    breach_requiring_response: z.boolean(),
    rationale: z.string().min(1),
    citations: z.array(z.string().min(1)),
  })
  .strict();

const TrainingModelSchema = z
  .object({
    topic: z.string().min(1),
    audience: z.string().min(1),
  })
  .strict();

const ResolutionHashStateSchema = z
  .object({
    content_sha256: z.string().length(64),
    body_text: z.string(),
    citations: z.array(z.string()),
  })
  .strict();

const HaltStateSchema = z
  .object({
    halted: z.boolean(),
    reason: z.string(),
    operator: z.string(),
    at_utc: z.string(),
  })
  .strict();

const ReevaluationSnapshotSchema = z
  .object({
    num_affected_subjects: z.number().nullable(),
    affected_data_types: z.array(z.string()),
  })
  .strict();

export type {
  ApproveNotifyResult,
  CloseResult,
  DraftReviewOptions,
  IntakeCallbacks,
  InvestigationResult,
  MonitorResult,
  PageAlert,
  TriageResult,
} from "@pims/types/agent.ts";

export interface IncidentOrchestratorDeps {
  adapter: PimsAdapter;
  tools: ToolRegistry;
  evidenceStore: EvidenceStore;
  bundleSealer: BundleSealer;
  modelClient: AgentModelClient;
  scheduler: DeadlineScheduler;
  reviewer: NoticeReviewer;
  draftService: NoticeDraftService;
  composer: NoticeComposer;
  exemptionEngine: ExemptionEngine;
  ragService: RAGService;
  closeChecklist: CloseChecklistVerifier;
  config: AgentConfig;
  clock: () => Date;
  roles: RoleRegistry;
  indicator: IndicatorEmitter;
  page: (alert: PageAlert) => void;
  events?: AgentEventEmitter;
}

export class IncidentOrchestrator {
  private readonly deps: IncidentOrchestratorDeps;
  private readonly holderId: string;
  private readonly effects: TimerEffects;
  private readonly leaseDepth = new Map<string, number>();
  private readonly currentRoleByIncident = new Map<string, AgentRole>();

  constructor(deps: IncidentOrchestratorDeps) {
    this.deps = deps;
    this.holderId = `agent:${crypto.randomUUID()}`;
    this.effects = this.buildTimerEffects();
  }

  get timerEffects(): TimerEffects {
    return this.effects;
  }

  async intake(
    payload: IntakePayload,
    callbacks?: IntakeCallbacks,
  ): Promise<IntakeResult> {
    await this.assertNotHalted();
    if (payload.title.trim().length === 0) {
      throw new IntakeEmptyError();
    }

    const now = this.deps.clock();
    const today = limaDate(now);
    const markers: string[] = [];

    const title = truncateAtWordBoundary(
      payload.title,
      150,
      () => new IntakeTitleTooLongError(),
      "TRUNCATED_TITLE",
      markers,
    );
    const description =
      payload.description === undefined
        ? null
        : truncateAtWordBoundary(
            payload.description,
            1000,
            () => new IntakeDescriptionTooLongError(),
            "TRUNCATED_DESCRIPTION",
            markers,
          );

    let incidentDate = payload.incident_date;
    if (incidentDate > today) {
      const corrected = callbacks?.futureDateReprompt
        ? await callbacks.futureDateReprompt()
        : null;
      incidentDate = corrected ?? today;
      markers.push("FUTURE_DATE_CORRECTED");
    }

    let detectionDate = payload.detection_date ?? incidentDate;
    if (detectionDate < incidentDate) {
      detectionDate = incidentDate;
      markers.push("DETECTION_DATE_CORRECTED");
    }

    let involvesPersonalData = payload.involves_personal_data;
    let piiAssumed = false;
    if (involvesPersonalData === null) {
      const answer = callbacks?.piiReprompt
        ? await callbacks.piiReprompt()
        : null;
      if (answer === null) {
        involvesPersonalData = true;
        piiAssumed = true;
        markers.push("assumed_pii:true");
      } else {
        involvesPersonalData = answer;
      }
    }

    const systemOrUrl =
      payload.compromised_system ?? payload.affected_url ?? "";
    const embedding = await this.embedForDedupe(title, systemOrUrl);
    const livePage = await this.deps.adapter.listIncidents({ search: title });
    const index = await this.deps.evidenceStore.listDedupeIndex();

    const decision = findDedupeDecision({
      title,
      incident_date: incidentDate,
      system_or_url: systemOrUrl,
      embedding,
      live: livePage.results,
      index,
      trigramThreshold: this.deps.config.DEDUPE_TRIGRAM_THRESHOLD,
      cosineThreshold: this.deps.config.DEDUPE_COSINE_THRESHOLD,
    });

    if (decision.action === "update" && decision.incident_id !== null) {
      const existing = await this.deps.adapter.getIncident(
        decision.incident_id,
      );
      return this.withLease(existing.incident_code, async () => {
        this.announceRole(existing.incident_code, "intake");
        const merged = await this.appendMarker(
          existing,
          `DEDUPE_MERGED:${payload.channel}`,
        );
        return {
          incident: merged,
          dedupe: decision,
          timer_ids: [],
        };
      });
    }

    if (decision.action === "restore" && decision.incident_code !== null) {
      if (decision.incident_id === null) {
        throw new RestoreFailedError(decision.incident_code);
      }
      const restored = await this.deps.adapter.restoreIncident(
        decision.incident_id,
        { incidentCode: decision.incident_code },
      );
      await this.deps.evidenceStore.indexDedupe({
        incident_code: restored.incident_code,
        pims_incident_id: restored.id,
        title_normalized: title.toLowerCase(),
        incident_date: incidentDate,
        system_or_url: systemOrUrl,
        embedding_vector: embedding,
        is_deleted: false,
      });
      return this.withLease(restored.incident_code, async () => {
        this.announceRole(restored.incident_code, "intake");
        const merged = await this.appendMarker(
          restored,
          `DEDUPE_MERGED:${payload.channel}`,
        );
        return { incident: merged, dedupe: decision, timer_ids: [] };
      });
    }

    const created = await this.createIncidentFromIntake({
      payload,
      title,
      description,
      incidentDate,
      detectionDate,
      involvesPersonalData,
    });

    return this.withLease(created.incident_code, async () => {
      this.announceRole(created.incident_code, "intake");
      let incident = created;
      if (markers.length > 0) {
        for (const marker of markers) {
          incident = await this.appendMarker(incident, marker);
        }
      }

      const survivor = await this.detectPostCreateDuplicate(incident);
      incident = survivor;

      await this.deps.evidenceStore.indexDedupe({
        incident_code: incident.incident_code,
        pims_incident_id: incident.id,
        title_normalized: title.toLowerCase(),
        incident_date: incidentDate,
        system_or_url: systemOrUrl,
        embedding_vector: embedding,
        is_deleted: false,
      });

      await this.stageIntakeSource(incident, payload);
      await this.stageIntakeAttachments(incident, payload);

      const timerIds = await this.armAwarenessTimers(incident, payload.channel);

      if (piiAssumed) {
        await this.emitEvent("pii_assumed", incident, "intake", {
          reason: "INTAKE_MISSING_PII_FLAG",
        });
      }
      await this.emitEvent("incident_opened", incident, "intake", {
        incident_type: incident.incident_type,
        severity: incident.severity ?? undefined,
      });

      return { incident, dedupe: decision, timer_ids: timerIds };
    });
  }

  private async createIncidentFromIntake(params: {
    payload: IntakePayload;
    title: string;
    description: string | null;
    incidentDate: string;
    detectionDate: string;
    involvesPersonalData: boolean;
  }): Promise<PimsIncident> {
    const { payload } = params;
    const assignedTo = await this.pickAssignee();

    const result = await this.callTool(
      "intake",
      "pims_create_incident",
      {
        title: params.title,
        description: params.description,
        involves_personal_data: params.involvesPersonalData,
        incident_date: params.incidentDate,
        incident_time: payload.incident_time ?? null,
        detection_date: params.detectionDate,
        detection_time: payload.detection_time ?? null,
        incident_type: payload.incident_type ?? "OT",
        status: "O",
        affected_data_types: payload.affected_data_types ?? [],
        security_measures_adopted: payload.security_measures_adopted ?? [],
        affected_cid: payload.affected_cid ?? [],
        num_affected_subjects: payload.num_affected_subjects ?? null,
        compromised_system: payload.compromised_system ?? null,
        affected_url: payload.affected_url ?? null,
        assigned_to: assignedTo,
        reported_by: payload.channel,
        dpo_contact_name: payload.dpo?.name ?? null,
        dpo_contact_email: payload.dpo?.email ?? null,
        dpo_contact_phone: payload.dpo?.phone ?? null,
        rep_document_number: payload.reporter?.document_number ?? null,
        rep_document_expiry: payload.reporter?.document_expiry ?? null,
        rep_first_name: payload.reporter?.first_name ?? null,
        rep_last_name_p: payload.reporter?.last_name_p ?? null,
        rep_last_name_m: payload.reporter?.last_name_m ?? null,
        rep_position: payload.reporter?.position ?? null,
        rep_phone: payload.reporter?.phone ?? null,
        rep_email: payload.reporter?.email ?? null,
        entity_type: payload.entity?.type ?? null,
        entity_ruc: payload.entity?.ruc ?? null,
        entity_name: payload.entity?.name ?? null,
        entity_phone: payload.entity?.phone ?? null,
        entity_extension: payload.entity?.extension ?? null,
        entity_department: payload.entity?.department ?? null,
        entity_province: payload.entity?.province ?? null,
        entity_district: payload.entity?.district ?? null,
      },
      { incidentCode: null },
    );

    const created = await this.deps.adapter.getIncident(
      readNumber(result, "id"),
    );
    if (assignedTo === null) {
      return this.appendMarker(created, `UNASSIGNED:${created.incident_code}`);
    }
    return created;
  }

  private async pickAssignee(): Promise<string | null> {
    const assignees = this.deps.config.ASSIGNEES;
    if (assignees.length === 0) {
      return null;
    }
    const open = await this.deps.adapter.listIncidents({ status: "O" });
    const taken = new Set(
      open.results
        .map((incident) => incident.assigned_to)
        .filter((value): value is string => typeof value === "string"),
    );
    const candidate = assignees.find((name) => !taken.has(name));
    return candidate ?? assignees[0] ?? null;
  }

  private async detectPostCreateDuplicate(
    incident: PimsIncident,
  ): Promise<PimsIncident> {
    const page = await this.deps.adapter.listIncidents({
      search: incident.title,
    });
    const sameKey = page.results.filter(
      (candidate) =>
        candidate.id !== incident.id &&
        candidate.incident_date === incident.incident_date &&
        (candidate.compromised_system ?? candidate.affected_url ?? "") ===
          (incident.compromised_system ?? incident.affected_url ?? "") &&
        candidate.title.toLowerCase() === incident.title.toLowerCase(),
    );
    if (sameKey.length === 0) {
      return incident;
    }

    const ordered = [...sameKey, incident].sort((a, b) => a.id - b.id);
    const older = ordered[0];
    const kept = ordered[ordered.length - 1];
    if (older === undefined || kept === undefined) {
      return incident;
    }

    await this.appendMarker(older, `DUPE_OF:${kept.incident_code}`);
    await this.deps.adapter.deleteIncident(older.id, {
      incidentCode: older.incident_code,
    });
    throw new DuplicateCreatedError(
      `Duplicate incident ${older.incident_code} removed in favour of ${kept.incident_code}`,
      { kept: kept.incident_code, deleted: older.incident_code },
    );
  }

  private async embedForDedupe(
    title: string,
    systemOrUrl: string,
  ): Promise<number[]> {
    const response = await this.deps.modelClient.embed({
      texts: [await redactForPrompt(`${title} ${systemOrUrl}`)],
    });
    const vector = response.vectors[0];
    if (vector === undefined) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_EMBEDDINGS,
        "Dedupe embedding returned no vector",
      );
    }
    return vector;
  }

  private async stageIntakeSource(
    incident: PimsIncident,
    payload: IntakePayload,
  ): Promise<void> {
    if (payload.source_payload === undefined) {
      return;
    }
    const body = JSON.stringify({
      channel: payload.channel,
      source_payload: payload.source_payload,
    });
    await this.deps.evidenceStore.stageAttachment(
      this.deps.config.PIMS_SCHEMA,
      incident.incident_code,
      "intake-source.txt",
      Buffer.from(body, "utf8"),
      "text/plain",
      "intake",
      null,
    );
  }

  private async stageIntakeAttachments(
    incident: PimsIncident,
    payload: IntakePayload,
  ): Promise<void> {
    for (const attachment of payload.attachments ?? []) {
      const bytes = Buffer.from(attachment.bytes_base64, "base64");
      assertAttachmentMeta(attachment.file_name, bytes.length);
      await this.deps.evidenceStore.stageAttachment(
        this.deps.config.PIMS_SCHEMA,
        incident.incident_code,
        attachment.file_name,
        bytes,
        attachment.mime,
        "intake",
        null,
      );
    }
  }

  private async armAwarenessTimers(
    incident: PimsIncident,
    channel: IntakePayload["channel"],
  ): Promise<string[]> {
    const timerIds: string[] = [];
    const awareness = awarenessFromIncident(incident);

    if (incident.involves_personal_data) {
      const hours = this.authorityDeadlineHours();
      timerIds.push(
        await this.armTimer(
          "T72_AUTHORITY",
          incident,
          new Date(awareness.getTime() + hours * 3_600_000),
        ),
      );
    }
    timerIds.push(
      await this.armTimer(
        "T_PERU_ADVISORY",
        incident,
        new Date(awareness.getTime() + PERU_ADVISORY_H * 3_600_000),
      ),
    );
    if (channel === "processor_notice") {
      timerIds.push(
        await this.armTimer(
          "T_PROCESSOR",
          incident,
          new Date(
            awareness.getTime() + this.deps.config.SLA_PROCESSOR_H * 3_600_000,
          ),
        ),
      );
    }
    return timerIds;
  }

  private authorityDeadlineHours(): number {
    const raw =
      this.deps.config.JURISDICTION_DEADLINES_JSON.EU_GDPR?.authority_h;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new ConfigError(
        "JURISDICTION_DEADLINES_JSON.EU_GDPR.authority_h must be a finite number",
        "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON.EU_GDPR.authority_h",
      );
    }
    return raw;
  }

  private async armTimer(
    kind: TimerKind,
    incident: PimsIncident,
    fireAt: Date,
    payload: JsonObject = {},
  ): Promise<string> {
    const result = await this.callTool(
      "orchestrator",
      "scheduler_arm",
      {
        incident_code: incident.incident_code,
        kind,
        fire_at_utc: fireAt.toISOString(),
        payload,
      },
      { incidentId: incident.id, incidentCode: incident.incident_code },
    );
    return SchedulerArmResultSchema.parse(result).timer_id;
  }

  private async armTimerIfAbsent(
    kind: TimerKind,
    incident: PimsIncident,
    fireAt: Date,
    payload: JsonObject = {},
  ): Promise<string> {
    const active = await this.deps.evidenceStore.listActiveTimers(
      incident.incident_code,
    );
    const existing = active.find((timer) => timer.timer_type === kind);
    if (existing !== undefined) {
      return existing.timer_id;
    }
    return this.armTimer(kind, incident, fireAt, payload);
  }

  private async ensureAwarenessTimers(incident: PimsIncident): Promise<void> {
    const active = await this.deps.evidenceStore.listActiveTimers(
      incident.incident_code,
    );
    const kinds = new Set(active.map((timer) => timer.timer_type));
    const awareness = awarenessFromIncident(incident);

    if (incident.involves_personal_data && !kinds.has("T72_AUTHORITY")) {
      const hours = this.authorityDeadlineHours();
      await this.armTimer(
        "T72_AUTHORITY",
        incident,
        new Date(awareness.getTime() + hours * 3_600_000),
      );
    }
    if (!kinds.has("T_PERU_ADVISORY")) {
      await this.armTimer(
        "T_PERU_ADVISORY",
        incident,
        new Date(awareness.getTime() + PERU_ADVISORY_H * 3_600_000),
      );
    }
  }

  async triage(incidentId: number): Promise<TriageResult> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);
    this.announceRole(incident.incident_code, "triage");

    const response = await this.deps.modelClient.chat_json({
      route: MODEL_ROUTE_FAST,
      system: TRIAGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            title: redactForPrompt(incident.title),
            description: redactForPrompt(incident.description ?? ""),
            involves_personal_data: incident.involves_personal_data,
            num_affected_subjects: incident.num_affected_subjects ?? null,
            affected_data_types: incident.affected_data_types,
            compromised_system: redactOptionalForPrompt(
              incident.compromised_system,
            ),
            incident_type_catalog: INCIDENT_TYPES,
            severity_catalog: INCIDENT_SEVERITIES,
            impact_catalog: INCIDENT_IMPACTS,
            affected_cid_catalog: AFFECTED_CID,
          }),
        },
      ],
      json_schema: triageJsonSchema(),
      max_tokens: 1200,
      temperature: this.deps.config.TEMP_CLASSIFIER,
    });

    const parsed = TriageModelSchema.safeParse(response.content);
    if (!parsed.success) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_FAST,
        `Triage output violated the classification schema: ${parsed.error.message}`,
      );
    }
    const classification = parsed.data;

    const probabilitySum = classification.candidate_probabilities.reduce(
      (sum, candidate) => sum + candidate.probability,
      0,
    );
    if (!(probabilitySum > 0)) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_FAST,
        "Triage candidate probabilities sum to zero",
      );
    }
    const normalized = classification.candidate_probabilities.map(
      (candidate) => ({
        type: candidate.type,
        probability: candidate.probability / probabilitySum,
      }),
    );

    const predicted = normalized.find(
      (candidate) => candidate.type === classification.incident_type,
    );
    if (predicted === undefined) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_FAST,
        "Predicted incident_type missing from candidate probabilities",
      );
    }

    if (
      (classification.severity === "H" || classification.severity === "C") &&
      classification.citations.length === 0
    ) {
      throw new ArtifactIncompleteError("triage", "severity_citation");
    }

    const calibration = await this.conformalCalibration(
      normalized,
      predicted.probability,
    );

    let citations = classification.citations;
    if (calibration.conformal_set.length > 1) {
      const expanded = await this.deps.ragService.query(
        `incident type discrimination for candidates ${calibration.conformal_set.join(", ")} under GDPR Article 4(12) and associated breach risk criteria`,
        { normative_only: true, incident_code: incident.incident_code },
      );
      citations = Array.from(new Set([...citations, ...expanded.citations]));
    }

    return this.withLease(incident.incident_code, async () => {
      const triagePatch: JsonObject = {
        incident_type: classification.incident_type,
        severity: classification.severity,
        impact: classification.impact,
        affected_cid: classification.affected_cid,
      };
      if (incident.assigned_to !== null && incident.assigned_to !== undefined) {
        triagePatch.assigned_to = incident.assigned_to;
      }

      const updated = await this.callTool(
        "triage",
        "pims_update_incident",
        {
          id: incident.id,
          patch: triagePatch,
        },
        { incidentId: incident.id, incidentCode: incident.incident_code },
      );
      const classified = parseIncident(updated);

      await this.ensureAwarenessTimers(classified);
      await this.callTool(
        "triage",
        "pims_transition_status",
        {
          id: classified.id,
          to: "P",
          reason: `TRIAGE_COMPLETE:${classification.incident_type}`,
        },
        { incidentId: classified.id, incidentCode: classified.incident_code },
      );
      this.emitLifecycleChange(classified.incident_code, "O", "P", "triage");

      if (classification.severity === "C" || classification.impact === "V") {
        await this.armTimer(
          "T_REVIEW_SLA",
          classified,
          new Date(
            this.deps.clock().getTime() +
              this.deps.config.SLA_REVIEW_H * 3_600_000,
          ),
        );
      }

      await this.emitEvent("incident_triaged", classified, "triage", {
        severity: classification.severity,
        incident_type: classification.incident_type,
      });

      const refreshed = await this.deps.adapter.getIncident(classified.id);
      return {
        incident: refreshed,
        classification: {
          incident_type: classification.incident_type,
          conformal_set: calibration.conformal_set,
          nonconformity_score: calibration.nonconformity_score,
          severity: classification.severity,
          impact: classification.impact,
          affected_cid: classification.affected_cid,
          citations,
          calibration_mode: calibration.calibration_mode,
        },
        calibration_mode: calibration.calibration_mode,
      };
    });
  }

  private async conformalCalibration(
    probabilities: Array<{ type: IncidentType; probability: number }>,
    predictedProbability: number,
  ): Promise<{
    conformal_set: IncidentType[];
    nonconformity_score: number;
    calibration_mode: TriageCalibrationMode;
  }> {
    const nonconformity = 1 - predictedProbability;
    const samples = await this.deps.evidenceStore.listTriageCalibration();

    if (samples.length < CONFORMAL_MIN_SAMPLES) {
      return {
        conformal_set: probabilities.map((candidate) => candidate.type),
        nonconformity_score: nonconformity,
        calibration_mode: "cold_start",
      };
    }

    const scores = samples
      .map((sample) => sample.nonconformity_score)
      .sort((a, b) => a - b);
    const rank = Math.min(
      scores.length - 1,
      Math.ceil((samples.length + 1) * (1 - CONFORMAL_ALPHA)) - 1,
    );
    const threshold = scores[rank];
    if (threshold === undefined) {
      throw new PimsValidationError(
        "triage_calibration",
        "Conformal quantile index out of range",
      );
    }

    const conformalSet = probabilities
      .filter((candidate) => 1 - candidate.probability <= threshold)
      .map((candidate) => candidate.type);

    return {
      conformal_set:
        conformalSet.length > 0
          ? conformalSet
          : probabilities.map((candidate) => candidate.type),
      nonconformity_score: nonconformity,
      calibration_mode: "split_conformal",
    };
  }

  async investigate(
    incidentId: number,
    opts?: {
      containmentWaiver?: { reason: string; reviewer_approval_id: string };
    },
  ): Promise<InvestigationResult> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);

    return this.withLease(incident.incident_code, async () => {
      this.announceRole(incident.incident_code, "investigator");

      const storedRootCause = await this.deps.evidenceStore.getRootCause(
        incident.incident_code,
      );
      const existingActions = incident.actions ?? [];
      if (
        storedRootCause !== null &&
        existingActions.some((action) => action.action_type === "A")
      ) {
        const staged = await this.deps.evidenceStore.listStagedAttachments(
          incident.incident_code,
        );
        return {
          incident,
          rootCause: storedRootCause,
          auditLink: null,
          riskSignal: null,
          evidence: staged,
        };
      }

      const history = await this.deps.adapter.getIncidentHistory(incident.id);

      const containment = await this.deps.modelClient.chat_json({
        route: MODEL_ROUTE_REASONING,
        system: CONTAINMENT_SYSTEM,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              incident_code: incident.incident_code,
              title: redactForPrompt(incident.title),
              description: redactForPrompt(incident.description ?? ""),
              compromised_system: redactOptionalForPrompt(
                incident.compromised_system,
              ),
              affected_url: redactOptionalForPrompt(incident.affected_url),
              affected_cid: incident.affected_cid,
            }),
          },
        ],
        json_schema: containmentJsonSchema(),
        max_tokens: 800,
        temperature: this.deps.config.TEMP_REASONING,
      });
      const containmentParsed = ContainmentModelSchema.safeParse(
        containment.content,
      );
      if (!containmentParsed.success) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Containment plan violated its schema: ${containmentParsed.error.message}`,
        );
      }

      let containmentCount = 0;
      for (const action of containmentParsed.data.actions) {
        await this.appendAction(incident, {
          action_type: "C",
          description: action.description,
          responsible: action.responsible,
          evidence: action.evidence ?? null,
        });
        containmentCount += 1;
      }

      if (containmentCount === 0) {
        if (opts?.containmentWaiver === undefined) {
          throw new PimsValidationError("containment", "CONTAINMENT_REQUIRED");
        }
        await this.appendAction(incident, {
          action_type: "A",
          description: `no_containment_needed:${opts.containmentWaiver.reason}`,
          responsible: "investigator",
          evidence: `review_approval:${opts.containmentWaiver.reviewer_approval_id}`,
        });
      }

      const gateRag = await this.deps.ragService.query(
        "personal data breach risk to the rights and freedoms of natural persons under GDPR Article 34 and ISO 27701 B.3.12",
        { normative_only: true, incident_code: incident.incident_code },
      );
      const gateCitations = gateRag.citations;
      const gate = await this.deps.modelClient.chat_json({
        route: MODEL_ROUTE_FAST,
        system: B3_12_SYSTEM,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              incident_code: incident.incident_code,
              title: redactForPrompt(incident.title),
              description: redactForPrompt(incident.description ?? ""),
              involves_personal_data: incident.involves_personal_data,
              affected_cid: incident.affected_cid,
              affected_data_types: incident.affected_data_types,
              retrieval_citations: gateCitations,
              retrieval_passages: gateRag.passages.map((passage) => ({
                citation: `${passage.doc_id}:${passage.chunk_id}:${passage.lines}`,
                text: passage.text,
              })),
              citation_rule:
                "Every citations[] entry MUST be copied verbatim from retrieval_citations; never invent or paraphrase a citation.",
            }),
          },
        ],
        json_schema: gateJsonSchema(),
        max_tokens: 700,
        temperature: this.deps.config.TEMP_CLASSIFIER,
      });
      const gateParsed = GateModelSchema.safeParse(gate.content);
      if (!gateParsed.success) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_FAST,
          `Breach review gate violated its schema: ${gateParsed.error.message}`,
        );
      }
      for (const citation of gateParsed.data.citations) {
        this.deps.ragService.validateCitation(citation, true);
      }

      await this.appendAction(incident, {
        action_type: "A",
        description: `Breach review assessment: breach requiring response: ${gateParsed.data.breach_requiring_response ? "yes" : "no"} — ${gateParsed.data.rationale}`,
        responsible: "investigator",
        evidence: gateParsed.data.citations.join(" "),
      });

      const staged = await this.deps.evidenceStore.listStagedAttachments(
        incident.incident_code,
      );
      for (const attachment of staged) {
        if (attachment.pims_attachment_id !== undefined) {
          continue;
        }
        await this.callTool(
          "investigator",
          "pims_upload_attachment",
          {
            incident_id: incident.id,
            bytes_ref: attachment.sha256,
            file_name: attachment.file_name,
            mime: attachment.mime,
          },
          { incidentId: incident.id, incidentCode: incident.incident_code },
        );
        await this.appendMarker(
          incident,
          `file:${attachment.file_name}:${attachment.sha256.slice(0, 8)}`,
        );
      }

      const catalogs = await this.deps.adapter.getRiskCatalogs();
      const annexAControls = [
        ...(catalogs.applicable_annex_a_controls ?? []),
        ...(catalogs.annex_a_controls ?? []),
      ].map((control) => ({ code: control.code, name: control.name }));

      const current = await this.deps.adapter.getIncident(incident.id);
      const actions = current.actions ?? [];
      const redactedHistory = await Promise.all(
        history.map(async (row) => ({
          ...row,
          description:
            row.description === null || row.description === undefined
              ? row.description
              : await redactForPrompt(row.description),
        })),
      );
      const redactedActions = await Promise.all(
        actions.map(async (row) => ({
          ...row,
          description: await redactForPrompt(row.description),
          evidence:
            row.evidence === null || row.evidence === undefined
              ? row.evidence
              : await redactForPrompt(row.evidence),
        })),
      );
      const evidence: TotEvidence[] = await Promise.all(
        staged.map(async (attachment) => ({
          ref: `file:${attachment.file_name}:${attachment.sha256.slice(0, 8)}`,
          kind: "attachment",
          description: await redactForPrompt(
            `attachment ${attachment.file_name}`,
          ),
        })),
      );

      const rootCauseRaw = await this.deps.modelClient.chat_json({
        system: ROOT_CAUSE_SYSTEM,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              incident: {
                incident_code: current.incident_code,
                incident_type: current.incident_type,
                severity: current.severity ?? null,
                impact: current.impact ?? null,
                title: redactForPrompt(current.title),
                description: current.description
                  ? redactForPrompt(current.description)
                  : null,
                affected_data_types: [...current.affected_data_types],
                compromised_system: redactOptionalForPrompt(
                  current.compromised_system,
                ),
              },
              history: redactedHistory,
              actions: redactedActions,
              evidence,
              adoptedMeasures: current.security_measures_adopted,
              annexAControls,
              ragCitations: gateParsed.data.citations,
            }),
          },
        ],
        route: MODEL_ROUTE_REASONING,
        json_schema: rootCauseJsonSchema(),
        max_tokens: 3000,
        temperature: this.deps.config.TEMP_REASONING,
      });
      const rootCauseParsed = RootCauseSchema.safeParse(rootCauseRaw.content);
      if (!rootCauseParsed.success) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Root cause output violated its schema: ${rootCauseParsed.error.message}`,
        );
      }
      const analysis = rootCauseParsed.data;
      await this.deps.evidenceStore.saveRootCause(
        incident.incident_code,
        analysis,
      );

      await this.appendAction(incident, {
        action_type: "A",
        description: `Root cause (${analysis.method}): ${analysis.cause}`,
        responsible: "investigator",
        evidence: analysis.evidence_refs.join(" "),
      });

      if (analysis.root_cause_unproven) {
        await this.appendMarker(incident, "ROOT_CAUSE_UNPROVEN");
      }

      const registryComplete =
        history.some((row) => row.event_type === "created") &&
        history.some((row) => row.event_type === "updated") &&
        history.some((row) => row.event_type === "status_changed");

      const measurePatch: JsonObject = {
        measure_updated_registry: registryComplete ? "Y" : "N",
        measure_new_security: containmentCount > 0 ? "Y" : "N",
        measure_improved_policies: gateParsed.data.breach_requiring_response
          ? "Y"
          : "U",
      };
      await this.callTool(
        "investigator",
        "pims_update_incident",
        { id: incident.id, patch: measurePatch },
        { incidentId: incident.id, incidentCode: incident.incident_code },
      );

      const qualifying =
        current.severity === "H" ||
        current.severity === "C" ||
        current.impact === "H" ||
        current.impact === "V" ||
        gateParsed.data.breach_requiring_response;

      let auditLink: InvestigationResult["auditLink"] = null;
      if (qualifying) {
        const auditResult = await this.callTool(
          "investigator",
          "pims_create_audit_action",
          {
            classification: "N",
            finding_description: `10.2 corrective action for ${incident.incident_code}: ${analysis.cause}`,
            action_plan: analysis.remediation,
            responsible: current.assigned_to ?? "UNASSIGNED",
            source_requirement_code: "A.3.12",
          },
          { incidentId: incident.id, incidentCode: incident.incident_code },
        );
        auditLink = {
          audit_id: readNumber(auditResult, "audit_id"),
          finding_id: readNumber(auditResult, "finding_id"),
          action_plan_id: readNumber(auditResult, "action_plan_id"),
        };
      } else {
        await this.appendMarker(incident, "audit_link_skipped:not_qualifying");
      }

      let riskSignal: PimsEmitRiskSignalResult | null = null;
      if (analysis.systemic) {
        const codesRaw = await this.deps.modelClient.chat_json({
          system: RISK_CATALOG_SYSTEM,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                cause: redactForPrompt(analysis.cause),
                threats: catalogs.threats,
                vulnerabilities: catalogs.vulnerabilities,
              }),
            },
          ],
          route: MODEL_ROUTE_REASONING,
          json_schema: riskCatalogJsonSchema(),
          max_tokens: 500,
          temperature: this.deps.config.TEMP_REASONING,
        });
        const codesParsed = RiskCatalogCodesSchema.safeParse(codesRaw.content);
        if (!codesParsed.success) {
          throw new ModelSchemaViolationError(
            MODEL_ROUTE_REASONING,
            `Risk catalog output violated its schema: ${codesParsed.error.message}`,
          );
        }
        const codes = codesParsed.data;
        if (
          codes.threat_code !== null &&
          !catalogs.threats.some((t) => t.code === codes.threat_code)
        ) {
          throw new PimsUnknownCodeError("threat", codes.threat_code);
        }
        if (
          codes.vulnerability_code !== null &&
          !catalogs.vulnerabilities.some(
            (v) => v.code === codes.vulnerability_code,
          )
        ) {
          throw new PimsUnknownCodeError(
            "vulnerability",
            codes.vulnerability_code,
          );
        }
        const dimension = catalogs.active_matrix?.dimension ?? 1;
        const level = severityLevel(current.severity);
        const signalArgs: JsonObject = {
          description: `Risk signal from ${incident.incident_code}: ${analysis.cause}`,
          controlled_probability: Math.min(level, dimension),
          controlled_impact: Math.min(level, dimension),
          response_strategy: "M",
          status: "O",
        };
        if (codes.threat_code !== null) {
          signalArgs.threat_code = codes.threat_code;
        }
        if (codes.vulnerability_code !== null) {
          signalArgs.vulnerability_code = codes.vulnerability_code;
        }
        if (current.assigned_to !== null && current.assigned_to !== undefined) {
          signalArgs.risk_owner = current.assigned_to;
        }
        try {
          const signal = await this.callTool(
            "investigator",
            "pims_emit_risk_signal",
            signalArgs,
            { incidentId: incident.id, incidentCode: incident.incident_code },
          );
          riskSignal = parseRiskSignal(signal);
          await this.emitEvent("risk_signalled", incident, "investigator", {
            reason: "RISK_CREATED",
          });
        } catch (error: unknown) {
          if (
            error instanceof PimsBaseError &&
            error.code === "RISK_SIGNAL_NO_ASSET"
          ) {
            await this.emitEvent("risk_signalled", incident, "investigator", {
              reason: "RISK_SIGNAL_NO_ASSET",
            });
          } else if (
            error instanceof PimsBaseError &&
            error.code === "RISK_PERIOD_CLOSED"
          ) {
            await this.emitEvent("risk_signalled", incident, "investigator", {
              reason: "RISK_PERIOD_CLOSED",
            });
          } else {
            throw error;
          }
        }
      } else {
        await this.appendMarker(incident, "systemic:false");
      }

      if (current.incident_type === "HE") {
        const training = await this.deps.modelClient.chat_json({
          route: MODEL_ROUTE_FAST,
          system: TRAINING_SYSTEM,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                incident_code: incident.incident_code,
                people_causes: [redactForPrompt(analysis.cause)],
              }),
            },
          ],
          json_schema: trainingJsonSchema(),
          max_tokens: 400,
          temperature: this.deps.config.TEMP_CLASSIFIER,
        });
        const trainingParsed = TrainingModelSchema.safeParse(training.content);
        if (!trainingParsed.success) {
          throw new ModelSchemaViolationError(
            MODEL_ROUTE_FAST,
            `Training recommendation violated its schema: ${trainingParsed.error.message}`,
          );
        }
        await this.emitEvent("training_recommended", incident, "investigator", {
          topic: trainingParsed.data.topic,
          audience: trainingParsed.data.audience,
        });
      }

      await this.emitEvent("investigation_complete", incident, "investigator", {
        severity: current.severity ?? undefined,
        incident_type: current.incident_type,
      });

      const refreshed = await this.deps.adapter.getIncident(incident.id);
      const finalStaged = await this.deps.evidenceStore.listStagedAttachments(
        incident.incident_code,
      );

      return {
        incident: refreshed,
        rootCause: analysis,
        auditLink,
        riskSignal,
        evidence: finalStaged,
      };
    });
  }

  async draftAndReview(
    incidentId: number,
    opts?: DraftReviewOptions,
  ): Promise<DraftReviewResult> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);
    const code = incident.incident_code;

    return this.withLease(code, async () => {
      this.announceRole(code, "drafter");
      const gate = this.deps.composer.evaluateHighRiskGate({
        severity: incident.severity ?? "M",
        impact: incident.impact ?? "M",
        affectedDataTypes: incident.affected_data_types,
        numAffectedSubjects: incident.num_affected_subjects ?? null,
        unencryptedExfiltration:
          incident.affected_cid.includes("C") &&
          !incident.security_measures_adopted.includes("encrypt_transit"),
        authorityOrdered: false,
        reviewer: "compliance_reviewer",
      });

      const exemption: ExemptionEvaluationResult =
        opts?.exemption === undefined
          ? { kind: "notice_required", reason: "NO_EXEMPTION_QUALIFIED" }
          : this.deps.exemptionEngine.evaluate(opts.exemption);

      let authorityPackId: string | null = null;
      let authorityApprovalId: string | null = null;
      let subjectPackId: string | null = null;
      let subjectApprovalId: string | null = null;

      if (incident.involves_personal_data) {
        const authority = await this.draftServiceWithReview(
          incident,
          exemption,
          opts,
        );
        authorityPackId = authority.packId;
        authorityApprovalId = authority.approvalId;

        if (authority.pack.phased) {
          if (opts?.phaseDueAtUtc === undefined) {
            throw new PimsValidationError("phase_due_at", "PHASE_DUE_REQUIRED");
          }
          await this.armTimerIfAbsent(
            "T_PHASE_FOLLOWUP",
            incident,
            new Date(opts.phaseDueAtUtc),
            { pack_type: "authority", phase: 2 },
          );
        }
      }

      const subject = await this.deps.draftService.draftSubject(
        incident,
        gate,
        exemption,
        opts?.numericApprovals ?? [],
      );
      const subjectReviewed = await this.reviewWithRetries(
        incident,
        {
          pack_type: "subject",
          content_sha256: subject.contentSha,
          body_text: subject.pack.body_plain,
          citations: subject.citations,
          numeric_approvals: opts?.numericApprovals ?? [],
          plain_language_waiver: null,
          checklist: null,
        },
        subject.pack.pack_id,
        subject.contentSha,
        subject.pack,
      );
      subjectPackId = subject.pack.pack_id;
      subjectApprovalId = subjectReviewed;

      if (gate.verdict) {
        await this.armTimerIfAbsent(
          "T_SUBJECT",
          incident,
          new Date(
            this.deps.clock().getTime() +
              this.deps.config.SLA_SUBJECT_H * 3_600_000,
          ),
        );
      }

      if (subject.pack.state === "exempted") {
        await this.emitEvent("notice_exempted", incident, "drafter", {
          exemption: subject.pack.exemption?.letter ?? null,
          reason: "ART34_3_EXEMPTION",
        });
      }

      return {
        authority_pack_id: authorityPackId,
        subject_pack_id: subjectPackId,
        authority_approval_id: authorityApprovalId,
        subject_approval_id: subjectApprovalId,
        high_risk_gate: gate,
        exemption,
      };
    });
  }

  private async draftServiceWithReview(
    incident: PimsIncident,
    exemption: ExemptionEvaluationResult,
    opts?: DraftReviewOptions,
  ): Promise<{
    pack: {
      pack_id: string;
      phased: boolean;
      item_c_consequences: string;
      item_d_measures_taken: string[];
      item_d_measures_proposed: string[];
    };
    packId: string;
    approvalId: string;
  }> {
    const fetchedAt = this.deps.clock();
    const draft = await this.deps.draftService.draftAuthority(incident, {
      fetchedAt,
      exemption,
      phase: 1,
    });
    const bodyText = [
      draft.pack.item_c_consequences,
      ...draft.pack.item_d_measures_taken,
      ...draft.pack.item_d_measures_proposed,
    ].join(" ");

    const approvalId = await this.reviewWithRetries(
      incident,
      {
        pack_type: "authority",
        content_sha256: draft.contentSha,
        body_text: bodyText,
        citations: draft.citations,
        numeric_approvals: opts?.numericApprovals ?? [],
        plain_language_waiver: null,
        checklist: null,
      },
      draft.pack.pack_id,
      draft.contentSha,
      draft.pack,
    );

    return {
      pack: draft.pack,
      packId: draft.pack.pack_id,
      approvalId,
    };
  }

  private async reviewWithRetries(
    incident: PimsIncident,
    ctx: {
      pack_type: "authority" | "subject";
      content_sha256: string;
      body_text: string;
      citations: string[];
      numeric_approvals: NumericApproval[];
      plain_language_waiver: null;
      checklist: null;
    },
    packId: string,
    contentSha: string,
    payload: object,
  ): Promise<string> {
    const code = incident.incident_code;
    this.announceRole(code, "compliance_reviewer");
    for (let cycle = 0; cycle < this.deps.config.MAX_REVIEW_CYCLES; cycle++) {
      const result: ReviewResult = await this.deps.reviewer.review(
        {
          incident_code: code,
          pack_type: ctx.pack_type,
          content_sha256: ctx.content_sha256,
          body_text: ctx.body_text,
          citations: ctx.citations,
          numeric_approvals: ctx.numeric_approvals,
          plain_language_waiver: ctx.plain_language_waiver,
          checklist: ctx.checklist,
        },
        incident,
      );
      if (result.approved && result.approval_id !== null) {
        return result.approval_id;
      }
      await this.deps.evidenceStore.saveDraftPack(
        code,
        ctx.pack_type,
        toJsonObject(payload),
        contentSha,
        null,
        "draft",
      );
      if (cycle === this.deps.config.MAX_REVIEW_CYCLES - 1) {
        throw new EscalateStuckReviewError(
          `Pack ${packId} rejected ${this.deps.config.MAX_REVIEW_CYCLES} times; last rejection ${result.rejection?.judge ?? "unknown"}:${result.rejection?.required_fix ?? "unknown"}`,
        );
      }
    }
    throw new EscalateStuckReviewError(
      `Pack ${packId} never produced an approval`,
    );
  }

  async attestSubjectExemption(
    incidentId: number,
    input: ExemptionEvaluationInput,
  ): Promise<{ pack_id: string; exemption: ExemptionEvaluationResult }> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);
    const code = incident.incident_code;

    return this.withLease(code, async () => {
      this.announceRole(code, "drafter");
      if (!incident.involves_personal_data) {
        throw new PimsValidationError(
          "exemption",
          "SUBJECT_NOTICE_NOT_APPLICABLE",
        );
      }
      if (incident.status !== "P") {
        throw new PimsValidationError(
          "exemption",
          "SUBJECT_NOTICE_NOT_APPLICABLE",
        );
      }

      const latest = await this.deps.evidenceStore.getDraftPack(
        code,
        "subject",
      );
      if (
        latest !== null &&
        (latest.state === "sent" || latest.state === "acknowledged")
      ) {
        throw new PimsValidationError(
          "exemption",
          "SUBJECT_NOTICE_ALREADY_SENT",
        );
      }

      const exemption = this.deps.exemptionEngine.evaluate(input);
      if (exemption.kind !== "exempted") {
        throw new ExemptionUngroundedError("a", exemption.reason);
      }

      const gate = this.deps.composer.evaluateHighRiskGate({
        severity: incident.severity ?? "M",
        impact: incident.impact ?? "M",
        affectedDataTypes: incident.affected_data_types,
        numAffectedSubjects: incident.num_affected_subjects ?? null,
        unencryptedExfiltration:
          incident.affected_cid.includes("C") &&
          !incident.security_measures_adopted.includes("encrypt_transit"),
        authorityOrdered: false,
        reviewer: "compliance_reviewer",
      });
      if (!gate.verdict) {
        throw new PimsValidationError(
          "exemption",
          "SUBJECT_NOTICE_NOT_REQUIRED",
        );
      }

      const draft = await this.deps.draftService.draftSubject(
        incident,
        gate,
        exemption,
        [],
      );

      await this.emitEvent("notice_exempted", incident, "drafter", {
        exemption: exemption.exemption.letter,
        reason: "ART34_3_EXEMPTION",
      });

      return { pack_id: draft.pack.pack_id, exemption };
    });
  }

  async approveAndNotify(
    incidentId: number,
    opts?: { vetoWindowMin?: number },
  ): Promise<ApproveNotifyResult> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);
    const code = incident.incident_code;

    return this.withLease(code, async () => {
      this.announceRole(code, "notifier");
      const actions = incident.actions ?? [];
      const baselineRaw = await this.deps.evidenceStore.getAgentState(
        `REOPEN_BASELINE:${code}`,
      );
      const baselineParsed = z
        .object({ action_count: z.number().int().nonnegative() })
        .safeParse(baselineRaw);
      const epochActions = baselineParsed.success
        ? actions.slice(baselineParsed.data.action_count)
        : actions;
      const hasResolution = epochActions.some(
        (action) => action.action_type === "R",
      );

      if (!hasResolution) {
        const resolution = await this.deps.draftService.draftResolution(
          incident,
          [...CLOSE_CHECKLIST_ITEMS],
        );
        const resolutionReview: ReviewResult =
          await this.deps.reviewer.reviewResolution(
            {
              incident_code: code,
              pack_type: "resolution",
              content_sha256: resolution.contentSha,
              body_text: resolution.bodyText,
              citations: resolution.citations,
              numeric_approvals: [],
              plain_language_waiver: null,
              checklist: [...CLOSE_CHECKLIST_ITEMS],
            },
            incident,
          );
        if (
          !resolutionReview.approved ||
          resolutionReview.approval_id === null
        ) {
          throw new EscalateStuckReviewError(
            `Resolution rejected by ${resolutionReview.rejection?.judge ?? "unknown"}:${resolutionReview.rejection?.required_fix ?? "unknown"}`,
          );
        }

        const resolutionActionArgs: JsonObject = {
          incident_id: incident.id,
          action_type: "R",
          description: resolution.bodyText,
          review_approval_id: resolutionReview.approval_id,
        };
        if (
          incident.assigned_to !== null &&
          incident.assigned_to !== undefined
        ) {
          resolutionActionArgs.responsible = incident.assigned_to;
        }
        await this.callTool(
          "investigator",
          "pims_add_action",
          resolutionActionArgs,
          { incidentId: incident.id, incidentCode: code },
        );

        await this.deps.evidenceStore.setAgentState(`RESOLUTION_HASH:${code}`, {
          content_sha256: resolution.contentSha,
          body_text: resolution.bodyText,
          citations: resolution.citations,
        });
      }

      const storedHash = await this.deps.evidenceStore.getAgentState(
        `RESOLUTION_HASH:${code}`,
      );
      const hashState = ResolutionHashStateSchema.safeParse(storedHash);
      if (!hashState.success) {
        throw new EvidenceNotFoundError("resolution_hash", code);
      }

      const closeMarkers = readMarkers(incident.evidence_refs).filter(
        (marker) => marker.startsWith("CLOSE_APPROVED:"),
      );
      let closeApprovalId: string | null = null;
      const previousCloseMarker = closeMarkers.pop();
      if (previousCloseMarker !== undefined) {
        const previousApproval =
          await this.deps.evidenceStore.getReviewApproval(
            previousCloseMarker.slice("CLOSE_APPROVED:".length),
          );
        if (
          previousApproval !== null &&
          previousApproval.consumed_at_utc === null &&
          previousApproval.content_sha256 === hashState.data.content_sha256
        ) {
          closeApprovalId = previousApproval.approval_id;
        }
      }
      if (closeApprovalId === null) {
        const closeApproval = await this.deps.evidenceStore.mintReviewApproval({
          incidentCode: code,
          packType: "resolution",
          contentSha256: hashState.data.content_sha256,
          note: "resolution close",
        });
        closeApprovalId = closeApproval.approval_id;
      }
      const refreshed = await this.appendMarker(
        await this.deps.adapter.getIncident(incident.id),
        `CLOSE_APPROVED:${closeApprovalId}`,
      );

      const vetoWindowMin = opts?.vetoWindowMin;
      if (vetoWindowMin !== undefined && vetoWindowMin > 0) {
        const parkedUntil = new Date(
          this.deps.clock().getTime() + vetoWindowMin * 60_000,
        );
        const active = await this.deps.evidenceStore.listActiveTimers(code);
        for (const timer of active) {
          if (
            timer.timer_type === "T_RETRY" &&
            timer.payload.kind === "VETO_WINDOW"
          ) {
            await this.callTool(
              "orchestrator",
              "scheduler_cancel",
              { timer_id: timer.timer_id, reason: "VETO_WINDOW_REPARKED" },
              { incidentId: incident.id, incidentCode: code },
            );
          }
        }
        const timerId = await this.armTimer("T_RETRY", refreshed, parkedUntil, {
          kind: "VETO_WINDOW",
          pack_type: "authority",
        });
        await this.deps.evidenceStore.setAgentState(`VETO_PARKED:${code}`, {
          parked_until_utc: parkedUntil.toISOString(),
          timer_id: timerId,
        });
        return {
          parked: true,
          parkedUntilUtc: parkedUntil.toISOString(),
          actions: refreshed.actions ?? [],
          notifies: [],
        };
      }

      const notifies = await this.notifyApprovedPacks(refreshed);
      const after = await this.deps.adapter.getIncident(incident.id);
      return {
        parked: false,
        parkedUntilUtc: null,
        actions: after.actions ?? [],
        notifies,
      };
    });
  }

  private async notifyApprovedPacks(
    incident: PimsIncident,
  ): Promise<PimsNotifyResult[]> {
    const code = incident.incident_code;
    const notifies: PimsNotifyResult[] = [];

    for (const packType of ["authority", "subject"] as const) {
      const row = await this.deps.evidenceStore.getDraftPack(code, packType);
      if (row === null || row.state !== "approved") {
        continue;
      }
      const packId = readPackId(row.payload);
      if (packId === null) {
        throw new ArtifactIncompleteError("draft_pack", "pack_id");
      }
      const approval = await this.deps.evidenceStore.listReviewApprovals(code);
      const usable = approval.find(
        (candidate) =>
          candidate.pack_type === packType &&
          candidate.consumed_at_utc === null &&
          candidate.content_sha256 === row.contentSha256,
      );
      if (usable === undefined) {
        throw new EvidenceNotFoundError(
          "review_approval",
          `${code}:${packType}`,
        );
      }

      const result = await this.callTool(
        "notifier",
        "pims_notify",
        {
          incident_id: incident.id,
          pack_id: packId,
          review_approval_id: usable.approval_id,
        },
        { incidentId: incident.id, incidentCode: code },
      );
      notifies.push(parseNotify(result));
      await this.emitEvent("notice_sent", incident, "notifier", {
        reason: packType,
      });
    }

    return notifies;
  }

  async veto(
    incidentCode: string,
    packType: "authority" | "subject",
    operator: string,
    reason: string,
  ): Promise<void> {
    const incident = await this.findIncidentByCode(incidentCode);
    await this.appendMarker(incident, `VETOED_BY:${operator}:${reason}`);

    const row = await this.deps.evidenceStore.getDraftPack(
      incidentCode,
      packType,
    );
    if (row === null) {
      throw new EvidenceNotFoundError(
        "draft_pack",
        `${incidentCode}:${packType}`,
      );
    }
    await this.deps.evidenceStore.setDraftPackState(
      incidentCode,
      packType,
      "draft",
      null,
    );
    await this.deps.evidenceStore.revokeReviewApprovals(incidentCode, packType);
    await this.deps.evidenceStore.setAgentState(`VETO_PARKED:${incidentCode}`, {
      parked_until_utc: null,
      timer_id: null,
    });
  }

  async processVetoExpiry(now: Date): Promise<number> {
    const active = await this.deps.evidenceStore.listActiveTimers();
    let sent = 0;
    for (const timer of active) {
      if (timer.timer_type !== "T_RETRY") {
        continue;
      }
      if (new Date(timer.fire_at_utc).getTime() > now.getTime()) {
        continue;
      }
      const kind = timer.payload.kind;
      if (kind !== "VETO_WINDOW") {
        continue;
      }
      const incident = await this.findIncidentByCode(timer.incident_code);
      await this.deps.evidenceStore.cancelTimer(
        timer.timer_id,
        "VETO_WINDOW_EXPIRED",
      );
      await this.appendMarker(incident, "VETO_WINDOW_EXPIRED");
      const notifies = await this.notifyApprovedPacks(incident);
      sent += notifies.length;
    }
    return sent;
  }

  async resumeParkedNotifications(): Promise<PimsNotifyResult[]> {
    const all = await this.deps.adapter.listIncidents({ status: "P" });
    const notifies: PimsNotifyResult[] = [];
    for (const incident of all.results) {
      const rows = await Promise.all([
        this.deps.evidenceStore.getDraftPack(
          incident.incident_code,
          "authority",
        ),
        this.deps.evidenceStore.getDraftPack(incident.incident_code, "subject"),
      ]);
      const approved = rows.some(
        (row) => row !== null && row.state === "approved",
      );
      if (!approved) {
        continue;
      }
      const result = await this.notifyApprovedPacks(incident);
      notifies.push(...result);
    }
    return notifies;
  }

  async monitor(incidentId: number): Promise<MonitorResult> {
    const incident = await this.deps.adapter.getIncident(incidentId);
    const code = incident.incident_code;

    return this.withLease(code, async () => {
      this.announceRole(code, "monitor");
      const attachments = await this.deps.adapter.getIncidentAttachments(
        incident.id,
      );
      const manifest = await this.deps.evidenceStore.getBundleManifest(code);
      const known = new Set(
        manifest === null
          ? (await this.deps.evidenceStore.listStagedAttachments(code)).map(
              (item) => item.file_name,
            )
          : manifest.items.map((item) => item.file_name),
      );
      const unseen = attachments.filter(
        (attachment) =>
          attachment.file_name !== undefined &&
          !known.has(attachment.file_name),
      );

      const snapshotRaw = await this.deps.evidenceStore.getAgentState(
        `REEVALUATED:${code}`,
      );
      const snapshot = ReevaluationSnapshotSchema.safeParse(snapshotRaw);
      const scopeGrowth =
        snapshot.success &&
        (snapshot.data.num_affected_subjects !==
          (incident.num_affected_subjects ?? null) ||
          snapshot.data.affected_data_types.length !==
            incident.affected_data_types.length ||
          snapshot.data.affected_data_types.some(
            (type) =>
              !incident.affected_data_types.includes(type as AffectedDataType),
          ));

      const reevaluated: string[] = [];
      if (scopeGrowth) {
        reevaluated.push("scope_growth");
        await this.appendMarker(
          incident,
          "REEVALUATED:scope_growth:gate,phase",
        );
      }
      if (unseen.length > 0) {
        reevaluated.push("new_attachment");
      }

      await this.deps.evidenceStore.setAgentState(`REEVALUATED:${code}`, {
        num_affected_subjects: incident.num_affected_subjects ?? null,
        affected_data_types: incident.affected_data_types,
      });

      if (incident.status === "C" && unseen.length > 0) {
        const first = unseen[0];
        if (first === undefined) {
          return {
            newAttachments: unseen.length,
            scopeGrowth,
            reevaluated,
            closed: true,
          };
        }
        await this.reopen(incident.id, first.id, "new_attachment_post_close");
        return {
          newAttachments: unseen.length,
          scopeGrowth,
          reevaluated,
          closed: false,
        };
      }

      return {
        newAttachments: unseen.length,
        scopeGrowth,
        reevaluated,
        closed: incident.status === "C",
      };
    });
  }

  async close(incidentId: number): Promise<CloseResult> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);
    const code = incident.incident_code;

    if (incident.status === "C") {
      const sealed = await this.deps.bundleSealer.getSealedBundle(code);
      return {
        incident,
        sealSha256: sealed.sealSha256,
        marker: sealed.marker,
      };
    }

    return this.withLease(code, async () => {
      this.announceRole(code, "monitor");
      const today = limaDate(this.deps.clock());
      await this.callTool(
        "monitor",
        "pims_update_incident",
        {
          id: incident.id,
          patch: {
            resolved_date: today,
            measure_considered_resolved: "Y",
          },
        },
        { incidentId: incident.id, incidentCode: code },
      );

      const refreshed = await this.deps.adapter.getIncident(incident.id);
      const preSeal = await this.deps.closeChecklist.verify(refreshed, {
        skip: ["bundle_sealed"],
      });
      const preSealFailure = preSeal.items.find((item) => !item.passed);
      if (preSealFailure !== undefined) {
        throw new CloseChecklistFailedError(preSealFailure.item);
      }

      const analysis = await this.deps.evidenceStore.getRootCause(code);
      if (analysis === null) {
        throw new ArtifactIncompleteError("evidence-bundle", "root_cause");
      }

      const history = await this.deps.adapter.getIncidentHistory(incident.id);
      const facts = buildBundleFacts(refreshed, history);
      const rootCause: EvidenceBundleRootCause = {
        method: analysis.method,
        cause: analysis.cause,
        systemic: analysis.systemic,
        remediation: analysis.remediation,
      };
      const packs = await this.bundlePackRefs(code);
      const citations = await this.bundleCitations(code);

      const existingSealed =
        await this.deps.evidenceStore.getBundleManifest(code);
      let sealed: {
        sealSha256: string;
        marker: string;
        manifest: EvidenceBundleManifest;
      };
      if (existingSealed !== null && existingSealed.seal_sha256 !== null) {
        sealed = await this.deps.bundleSealer.getSealedBundle(code);
      } else {
        await this.deps.bundleSealer.createManifest(
          code,
          facts,
          rootCause,
          citations,
          packs,
        );

        const attachments = await this.deps.adapter.getIncidentAttachments(
          incident.id,
        );
        await this.deps.bundleSealer.reconcileWithPims(
          code,
          attachments.map((attachment) => attachment.id),
        );

        try {
          sealed = await this.deps.bundleSealer.sealBundle(code);
        } catch (error: unknown) {
          if (error instanceof BundleAlreadySealedError) {
            sealed = await this.deps.bundleSealer.getSealedBundle(code);
          } else {
            throw error;
          }
        }
      }
      await this.appendMarker(refreshed, sealed.marker);

      const bundleBytes = Buffer.from(
        canonicalizeJson(sealed.manifest),
        "utf8",
      );
      const bundleSha = sha256HexBytes(bundleBytes);
      const currentAttachments = await this.deps.adapter.getIncidentAttachments(
        incident.id,
      );
      const bundleAttachment = currentAttachments.find(
        (attachment) =>
          attachment.file_name === BUNDLE_ATTACHMENT_NAME ||
          attachment.original_name === BUNDLE_ATTACHMENT_NAME,
      );
      if (bundleAttachment === undefined) {
        await this.deps.evidenceStore.replaceStagedAttachment(
          this.deps.config.PIMS_SCHEMA,
          code,
          BUNDLE_ATTACHMENT_NAME,
          bundleBytes,
          "text/plain",
          "monitor",
        );
        await this.callTool(
          "investigator",
          "pims_upload_attachment",
          {
            incident_id: incident.id,
            bytes_ref: bundleSha,
            file_name: BUNDLE_ATTACHMENT_NAME,
            mime: "text/plain",
          },
          { incidentId: incident.id, incidentCode: code },
        );
        await this.appendMarker(
          refreshed,
          `file:${BUNDLE_ATTACHMENT_NAME}:${bundleSha.slice(0, 8)}`,
        );
      } else {
        const downloaded = await this.deps.adapter.downloadAttachment(
          bundleAttachment.file,
          { incidentCode: code },
        );
        if (sha256HexBytes(downloaded) !== bundleSha) {
          throw new BundlePimsMismatchError(BUNDLE_ATTACHMENT_NAME);
        }
      }

      const sealedIncident = await this.deps.adapter.getIncident(incident.id);
      const full = await this.deps.closeChecklist.verify(sealedIncident);
      const failure = full.items.find((item) => !item.passed);
      if (failure !== undefined) {
        throw new CloseChecklistFailedError(failure.item);
      }

      await this.callTool(
        "monitor",
        "pims_transition_status",
        { id: incident.id, to: "C", reason: `CLOSE:${code}` },
        { incidentId: incident.id, incidentCode: code },
      );
      this.emitLifecycleChange(code, "P", "C", "monitor");

      const approvalMarker = readMarkers(sealedIncident.evidence_refs)
        .filter((marker) => marker.startsWith("CLOSE_APPROVED:"))
        .pop();
      if (approvalMarker !== undefined) {
        const approvalId = approvalMarker.slice("CLOSE_APPROVED:".length);
        const approval =
          await this.deps.evidenceStore.getReviewApproval(approvalId);
        if (approval === null) {
          throw new EvidenceNotFoundError("review_approval", approvalId);
        }
        await this.deps.evidenceStore.consumeReviewApproval(
          approvalId,
          approval.content_sha256,
          "close",
        );
      }

      const active = await this.deps.evidenceStore.listActiveTimers(code);
      for (const timer of active) {
        await this.callTool(
          "orchestrator",
          "scheduler_cancel",
          { timer_id: timer.timer_id, reason: `CLOSED:${code}` },
          { incidentId: incident.id, incidentCode: code },
        );
      }

      const closedAt = this.deps.clock();
      const awareness = awarenessFromIncident(sealedIncident);
      const occurrence = limaLocalToUtc(
        sealedIncident.incident_date,
        "00:00:00",
      );
      const mttdHours = Math.max(
        (awareness.getTime() - occurrence.getTime()) / 3_600_000,
        0,
      );
      const mttrHours = Math.max(
        (closedAt.getTime() - awareness.getTime()) / 3_600_000,
        0,
      );
      const sla72Met =
        closedAt.getTime() - awareness.getTime() <=
        this.authorityDeadlineHours() * 3_600_000;

      await this.deps.evidenceStore.saveTriageCalibration({
        incident_code: code,
        actual_incident_type: sealedIncident.incident_type,
        nonconformity_score: 0,
        recorded_at_utc: closedAt.toISOString(),
      });

      await this.deps.indicator.emit({
        event: "incident_closed",
        incident_code: code,
        at_utc: closedAt.toISOString(),
        actor_role: "monitor",
        attrs: {
          severity: sealedIncident.severity ?? "M",
          incident_type: sealedIncident.incident_type,
          mttd_hours: mttdHours,
          mttr_hours: mttrHours,
          sla_72h_met: sla72Met,
        },
      });

      const closed = await this.deps.adapter.getIncident(incident.id);
      return {
        incident: closed,
        sealSha256: sealed.sealSha256,
        marker: sealed.marker,
      };
    });
  }

  private async bundlePackRefs(code: string): Promise<string[]> {
    const refs: string[] = [];
    for (const packType of ["authority", "subject"] as const) {
      const row = await this.deps.evidenceStore.getDraftPack(code, packType);
      if (row === null) {
        continue;
      }
      const packId = readPackId(row.payload);
      if (packId === null) {
        throw new ArtifactIncompleteError(
          "evidence-bundle",
          `pack:${packType}`,
        );
      }
      refs.push(`pack:${packType}:${packId}.json`);
    }
    return refs;
  }

  private async bundleCitations(code: string): Promise<string[]> {
    const citations = new Set<string>();
    for (const packType of ["authority", "subject"] as const) {
      const row = await this.deps.evidenceStore.getDraftPack(code, packType);
      if (row === null) {
        continue;
      }
      const payload = row.payload;
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)
      ) {
        throw new ArtifactIncompleteError(
          "evidence-bundle",
          `citations:${packType}`,
        );
      }
      const raw = payload.citations;
      if (Array.isArray(raw)) {
        for (const citation of raw) {
          if (typeof citation === "string") {
            citations.add(citation);
          }
        }
      }
    }
    return Array.from(citations);
  }

  async reopen(
    incidentId: number,
    evidenceId: number | string,
    reason: string,
  ): Promise<PimsIncident> {
    await this.assertNotHalted();
    const incident = await this.deps.adapter.getIncident(incidentId);
    if (incident.status !== "C") {
      throw new TransitionForbiddenError(incident.status, "P");
    }
    const attachments = await this.deps.adapter.getIncidentAttachments(
      incident.id,
    );
    if (
      !attachments.some(
        (attachment) => String(attachment.id) === String(evidenceId),
      )
    ) {
      throw new PimsNotFoundError("IncidentAttachment", evidenceId);
    }

    return this.withLease(incident.incident_code, async () => {
      this.announceRole(incident.incident_code, "monitor");
      await this.callTool(
        "monitor",
        "pims_transition_status",
        {
          id: incident.id,
          to: "P",
          reason: `REOPENED:${evidenceId}`,
        },
        { incidentId: incident.id, incidentCode: incident.incident_code },
      );
      this.emitLifecycleChange(incident.incident_code, "C", "P", "monitor");

      await this.deps.evidenceStore.revokeReviewApprovals(
        incident.incident_code,
      );
      const reopened = await this.deps.adapter.getIncident(incident.id);
      await this.deps.evidenceStore.setAgentState(
        `REOPEN_BASELINE:${incident.incident_code}`,
        {
          action_count: reopened.actions?.length ?? 0,
          at_utc: this.deps.clock().toISOString(),
        },
      );
      await this.ensureAwarenessTimers(reopened);
      await this.appendMarker(reopened, `REOPENED:${evidenceId}`);
      await this.emitEvent("incident_reopened", reopened, "monitor", {
        reason,
      });

      return this.deps.adapter.getIncident(incident.id);
    });
  }

  async tick(now?: Date): Promise<void> {
    const at = now ?? this.deps.clock();
    await this.deps.scheduler.tick(at);
    await this.processVetoExpiry(at);
    await this.flushRiskQueue();
    await this.deps.indicator.flush();
  }

  private async flushRiskQueue(): Promise<void> {
    const queued = await this.deps.evidenceStore.listQueuedRiskSignals();
    if (queued.length === 0) {
      return;
    }
    const catalogs = await this.deps.adapter.getRiskCatalogs();
    const period = catalogs.current_period;
    if (period === undefined) {
      return;
    }
    const closed =
      period.status === "C" ||
      period.is_active === false ||
      period.is_locked === true;
    if (closed) {
      return;
    }

    for (const record of queued) {
      let assetIds = record.signal_payload.asset_ids;
      if (record.signal_payload.asset_pending) {
        const incident = await this.findIncidentByCode(record.incident_code);
        assetIds = await assetIdsForSystem(
          this.deps.adapter,
          incident.compromised_system,
        );
        if (assetIds.length === 0) {
          continue;
        }
        await this.deps.evidenceStore.updateRiskSignalPayload(record.id, {
          ...record.signal_payload,
          asset_ids: assetIds,
          asset_pending: false,
          reason: "ASSET_RESOLVED",
        });
      }

      try {
        await this.deps.adapter.createRiskEvaluation({
          description: record.signal_payload.description,
          controlled_probability: record.signal_payload.controlled_probability,
          controlled_impact: record.signal_payload.controlled_impact,
          assets: assetIds.map((assetId) => ({ asset: assetId })),
          threat_code: record.signal_payload.threat_code ?? undefined,
          vulnerability_code:
            record.signal_payload.vulnerability_code ?? undefined,
          risk_owner: record.signal_payload.risk_owner ?? undefined,
          response_strategy:
            record.signal_payload.response_strategy ?? undefined,
          status: "O",
        });
        await this.deps.evidenceStore.markRiskSignalSent(record.id);
      } catch (error: unknown) {
        await this.deps.evidenceStore.markRiskSignalFailed(
          record.id,
          error instanceof PimsBaseError
            ? error.code
            : "RISK_QUEUE_FLUSH_FAILED",
        );
      }
    }
  }

  async setHalted(reason: string, operator: string): Promise<void> {
    await this.deps.evidenceStore.setAgentState("OPERATOR_HALT", {
      halted: true,
      reason,
      operator,
      at_utc: this.deps.clock().toISOString(),
    });
    console.warn(`OPERATOR_HALT:${operator}:${reason}`);
  }

  async resume(operator: string, reason: string): Promise<void> {
    await this.deps.evidenceStore.setAgentState("OPERATOR_HALT", {
      halted: false,
      reason,
      operator,
      at_utc: this.deps.clock().toISOString(),
    });
    console.info(`HALT_LIFTED:${operator}:${reason}`);
  }

  private async assertNotHalted(): Promise<void> {
    const raw = await this.deps.evidenceStore.getAgentState("OPERATOR_HALT");
    const parsed = HaltStateSchema.safeParse(raw);
    if (parsed.success && parsed.data.halted) {
      throw new OperatorHaltError(
        `OPERATOR_HALT engaged by ${parsed.data.operator}: ${parsed.data.reason}`,
      );
    }
  }

  async verifyInvariants(
    incidentId: number,
    before: { historyCount: number; spoolCount: number; stateChanged: boolean },
  ): Promise<void> {
    const history = await this.deps.adapter.getIncidentHistory(incidentId);
    if (history.length <= before.historyCount) {
      throw new HistoryGapError();
    }
    if (before.stateChanged) {
      const spool = await this.deps.evidenceStore.countIndicatorSpool();
      if (spool <= before.spoolCount) {
        throw new PimsValidationError(
          "indicator_spool",
          "INDICATOR_MISSING_FOR_STATE_CHANGE",
        );
      }
    }
    const incident = await this.deps.adapter.getIncident(incidentId);
    if (incident.involves_personal_data && incident.status !== "C") {
      const timers = await this.deps.evidenceStore.listActiveTimers(
        incident.incident_code,
      );
      if (!timers.some((timer) => timer.timer_type === "T72_AUTHORITY")) {
        throw new TimerMissingError();
      }
    }
    const renewed = await this.deps.evidenceStore.renewLease(
      incident.incident_code,
      this.holderId,
      this.deps.config.LEASE_TTL_S,
    );
    if (!renewed) {
      throw new LeaseLostError(incident.incident_code);
    }
  }

  private buildTimerEffects(): TimerEffects {
    return {
      authorityDeadline: async (incidentCode) => {
        const incident = await this.findIncidentByCode(incidentCode);
        const row = await this.deps.evidenceStore.getDraftPack(
          incidentCode,
          "authority",
        );
        if (row !== null && row.state === "sent") {
          return "satisfied";
        }
        await this.emitEvent("deadline_missed", incident, "orchestrator", {
          deadline_kind: "T72_AUTHORITY",
          reason: "DEADLINE_MISSED_72H",
        });
        await this.appendMarker(incident, "DEADLINE_MISSED_72H");
        await this.callTool(
          "investigator",
          "pims_create_audit_action",
          {
            classification: "N",
            finding_description: `10.2 corrective action for ${incidentCode}: authority notification deadline missed`,
            action_plan:
              "Send authority notification with Art 33(1) delay reasons; review notification delay root cause",
            source_requirement_code: "A.3.12",
          },
          { incidentId: incident.id, incidentCode },
        );
        return "breached";
      },
      processorDeadline: async (incidentCode) => {
        const incident = await this.findIncidentByCode(incidentCode);
        await this.emitEvent("deadline_missed", incident, "orchestrator", {
          deadline_kind: "T_PROCESSOR",
          reason: "PROCESSOR_DEADLINE_ESCALATED",
        });
        return "escalate";
      },
      subjectDeadline: async (incidentCode) => {
        const incident = await this.findIncidentByCode(incidentCode);
        const row = await this.deps.evidenceStore.getDraftPack(
          incidentCode,
          "subject",
        );
        if (
          row !== null &&
          (row.state === "sent" ||
            row.state === "exempted" ||
            row.state === "not_required")
        ) {
          return "satisfied";
        }
        await this.emitEvent("deadline_missed", incident, "orchestrator", {
          deadline_kind: "T_SUBJECT",
          reason: "DEADLINE_MISSED_SUBJECT",
        });
        await this.appendMarker(incident, "DEADLINE_MISSED_SUBJECT");
        return "breached";
      },
      reviewDeadline: async (incidentCode) => {
        const incident = await this.findIncidentByCode(incidentCode);
        const approvals =
          await this.deps.evidenceStore.listReviewApprovals(incidentCode);
        if (approvals.length > 0) {
          return "satisfied";
        }
        await this.emitEvent("deadline_missed", incident, "orchestrator", {
          deadline_kind: "T_REVIEW_SLA",
          reason: "DEADLINE_MISSED_REVIEW_SLA",
        });
        await this.appendMarker(incident, "DEADLINE_MISSED_REVIEW_SLA");
        return "breached";
      },
      peruAdvisory: async () => {
        return;
      },
      phaseFollowup: async (incidentCode, payload) => {
        const incident = await this.findIncidentByCode(incidentCode);
        const phase = payload.phase;
        await this.appendMarker(
          incident,
          `PHASE_DUE:${typeof phase === "number" ? phase : 2}`,
        );
        await this.emitEvent("deadline_missed", incident, "orchestrator", {
          deadline_kind: "T_PHASE_FOLLOWUP",
          reason: "PHASE_DUE",
        });
        this.deps.page({
          incident_code: incidentCode,
          kind: "T_PHASE_FOLLOWUP",
          reason: "PHASE_DUE",
        });
      },
      retry: async (incidentCode, payload) => {
        const failedKind = payload.failed_kind;
        const inner = payload.payload;
        if (typeof failedKind !== "string") {
          throw new PimsValidationError("retry_payload", "failed_kind");
        }
        const nested: JsonObject =
          typeof inner === "object" && inner !== null && !Array.isArray(inner)
            ? inner
            : {};
        switch (failedKind) {
          case "T72_AUTHORITY":
            await this.effects.authorityDeadline(incidentCode);
            return;
          case "T_PROCESSOR":
            await this.effects.processorDeadline(incidentCode);
            return;
          case "T_SUBJECT":
            await this.effects.subjectDeadline(incidentCode);
            return;
          case "T_REVIEW_SLA":
            await this.effects.reviewDeadline(incidentCode);
            return;
          case "T_PERU_ADVISORY":
            await this.effects.peruAdvisory(incidentCode);
            return;
          case "T_PHASE_FOLLOWUP":
            await this.effects.phaseFollowup(incidentCode, nested);
            return;
          default:
            throw new PimsValidationError("retry_payload", "failed_kind");
        }
      },
    };
  }

  private async callTool(
    role: AgentRole,
    tool: ToolName,
    args: JsonObject,
    context?: ToolCallContext,
  ): Promise<JsonObject> {
    const handle = this.deps.roles.createCapabilityHandle(role);
    return this.deps.tools.execute(handle, tool, args, context);
  }

  private async appendAction(
    incident: PimsIncident,
    action: {
      action_type: "C" | "A" | "R";
      description: string;
      responsible?: string;
      evidence?: string | null;
    },
  ): Promise<void> {
    const args: JsonObject = {
      incident_id: incident.id,
      action_type: action.action_type,
      description: action.description,
    };
    if (action.responsible !== undefined) {
      args.responsible = action.responsible;
    }
    if (action.evidence !== undefined && action.evidence !== null) {
      args.evidence = action.evidence;
    }
    await this.callTool("investigator", "pims_add_action", args, {
      incidentId: incident.id,
      incidentCode: incident.incident_code,
    });
  }

  private async appendMarker(
    incident: PimsIncident,
    token: string,
  ): Promise<PimsIncident> {
    const fresh = await this.deps.adapter.getIncident(incident.id);
    if (readMarkers(fresh.evidence_refs).includes(token)) {
      return fresh;
    }
    return appendEvidenceMarker(
      this.deps.adapter,
      this.deps.evidenceStore,
      fresh,
      token,
      this.deps.config.PIMS_SCHEMA,
    );
  }

  private announceRole(incidentCode: string, role: AgentRole): void {
    const events = this.deps.events;
    if (events === undefined) {
      return;
    }
    const previous = this.currentRoleByIncident.get(incidentCode) ?? null;
    this.currentRoleByIncident.set(incidentCode, role);
    events.emit({
      type: "role:transition",
      at_utc: this.deps.clock().toISOString(),
      incident_code: incidentCode,
      role,
      previous_role: previous,
      lease_holder: this.holderId,
    });
  }

  private emitLifecycleChange(
    incidentCode: string,
    from: PimsIncident["status"],
    to: PimsIncident["status"],
    actorRole: AgentRole,
  ): void {
    this.deps.events?.emit({
      type: "lifecycle:status_change",
      at_utc: this.deps.clock().toISOString(),
      incident_code: incidentCode,
      from,
      to,
      actor_role: actorRole,
    });
  }

  private async emitEvent(
    event:
      | "incident_opened"
      | "pii_assumed"
      | "incident_triaged"
      | "investigation_complete"
      | "notice_sent"
      | "notice_exempted"
      | "deadline_missed"
      | "corrective_linked"
      | "risk_signalled"
      | "training_recommended"
      | "gate_blocked"
      | "incident_closed"
      | "incident_reopened",
    incident: PimsIncident,
    role: AgentRole,
    attrs: IndicatorEventAttrs,
  ): Promise<void> {
    await this.deps.indicator.emitTransition(
      {
        event,
        actor_role: role,
        incident_code: incident.incident_code,
        attrs,
      },
      incident,
    );
  }

  private async findIncidentByCode(code: string): Promise<PimsIncident> {
    const page = await this.deps.adapter.listIncidents({ search: code });
    const match = page.results.find(
      (candidate) => candidate.incident_code === code,
    );
    if (match === undefined) {
      throw new PimsNotFoundError("Incident", code);
    }
    return match;
  }

  private async withLease<T>(
    incidentCode: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const depth = this.leaseDepth.get(incidentCode) ?? 0;
    if (depth === 0) {
      await this.deps.evidenceStore.acquireLease(
        incidentCode,
        this.holderId,
        this.deps.config.LEASE_TTL_S,
      );
    }
    this.leaseDepth.set(incidentCode, depth + 1);
    try {
      return await fn();
    } finally {
      const remaining = (this.leaseDepth.get(incidentCode) ?? 1) - 1;
      if (remaining <= 0) {
        this.leaseDepth.delete(incidentCode);
        await this.deps.evidenceStore.releaseLease(incidentCode, this.holderId);
      } else {
        this.leaseDepth.set(incidentCode, remaining);
      }
    }
  }
}

function limaDate(now: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new ConfigError(
        `Intl.DateTimeFormat missing part '${type}' for America/Lima`,
        "CONFIG_TYPE:TIME_ZONE",
      );
    }
    return part.value;
  };
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function truncateAtWordBoundary(
  value: string,
  limit: number,
  tooLong: () => Error,
  marker: string,
  markers: string[],
): string {
  if (value.length <= limit) {
    return value;
  }
  const suffix = "…[truncated]";
  const maxIndex = limit - suffix.length;
  const boundary = value.lastIndexOf(" ", maxIndex);
  if (boundary <= 0) {
    throw tooLong();
  }
  markers.push(marker);
  return `${value.slice(0, boundary)}${suffix}`;
}

function readNumber(value: JsonObject, key: string): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isInteger(candidate)) {
    throw new PimsValidationError(
      key,
      `Missing integer '${key}' in tool result`,
    );
  }
  return candidate;
}

function parseIncident(value: JsonObject): PimsIncident {
  return PimsIncidentSchema.parse(value);
}

function parseNotify(value: JsonObject): PimsNotifyResult {
  return PimsNotifyResultSchema.parse(value);
}

function parseRiskSignal(value: JsonObject): PimsEmitRiskSignalResult {
  const queued = value.queued;
  const periodName = value.period_name;
  if (queued === true) {
    const queuedAt = value.queued_at_utc;
    const reason = value.reason;
    if (typeof queuedAt !== "string" || typeof reason !== "string") {
      throw new PimsValidationError(
        "pims_emit_risk_signal",
        "Malformed queued signal",
      );
    }
    return {
      queued: true,
      period_name: typeof periodName === "string" ? periodName : "",
      queued_at_utc: queuedAt,
      reason,
    };
  }
  const riskId = value.risk_id;
  const riskCode = value.risk_code;
  if (
    typeof riskId !== "number" ||
    typeof riskCode !== "string" ||
    typeof periodName !== "string"
  ) {
    throw new PimsValidationError(
      "pims_emit_risk_signal",
      "Malformed risk signal",
    );
  }
  return { risk_id: riskId, risk_code: riskCode, period_name: periodName };
}

function readPackId(payload: JsonValue): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const candidate = payload.pack_id;
  return typeof candidate === "string" ? candidate : null;
}

function severityLevel(severity: IncidentSeverity | null | undefined): number {
  switch (severity) {
    case "C":
      return 4;
    case "H":
      return 3;
    case "M":
      return 2;
    case "L":
      return 1;
    default:
      return 2;
  }
}

function buildBundleFacts(
  incident: PimsIncident,
  history: PimsIncidentHistory[],
): EvidenceBundleIncident {
  const description = incident.description ?? incident.title;
  const reporter = incident.reported_by;
  if (reporter === null || reporter === undefined || reporter.length === 0) {
    throw new ArtifactIncompleteError("evidence-bundle", "reporter");
  }
  const personInCharge = incident.assigned_to;
  if (
    personInCharge === null ||
    personInCharge === undefined ||
    personInCharge.length === 0
  ) {
    throw new ArtifactIncompleteError("evidence-bundle", "person_in_charge");
  }

  const actions = incident.actions ?? [];
  const awareness = awarenessFromIncident(incident);
  const notificationSteps = actions
    .filter((action) => action.action_type === "R")
    .map((action) => `resolution:${action.action_date}`);

  return {
    description,
    time_period: {
      from: awareness.toISOString(),
      to: new Date(
        Math.max(
          ...history.map((row) => new Date(row.changed_at).getTime()),
          awareness.getTime(),
        ),
      ).toISOString(),
    },
    consequences: `cid:${incident.affected_cid.join(",")};data:${incident.affected_data_types.join(",")}`,
    reporter,
    reported_to:
      notificationSteps.length > 0 ? notificationSteps.join(",") : "internal",
    resolution_steps: actions
      .filter(
        (action) => action.action_type === "C" || action.action_type === "A",
      )
      .map((action) => `${action.action_type}:${action.description}`),
    person_in_charge: personInCharge,
    data_recovered: null,
    cid_fact: [...incident.affected_cid],
    pii_description: incident.involves_personal_data
      ? incident.affected_data_types.join(",")
      : null,
    notification_steps:
      notificationSteps.length > 0 ? notificationSteps : ["none"],
  };
}

function triageJsonSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      incident_type: { type: "string", enum: [...INCIDENT_TYPES] },
      candidate_probabilities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...INCIDENT_TYPES] },
            probability: { type: "number" },
          },
          required: ["type", "probability"],
          additionalProperties: false,
        },
      },
      severity: { type: "string", enum: [...INCIDENT_SEVERITIES] },
      impact: { type: "string", enum: [...INCIDENT_IMPACTS] },
      affected_cid: {
        type: "array",
        items: { type: "string", enum: [...AFFECTED_CID] },
      },
      rationale: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
      },
      citations: { type: "array", items: { type: "string" } },
    },
    required: [
      "incident_type",
      "candidate_probabilities",
      "severity",
      "impact",
      "affected_cid",
      "rationale",
      "citations",
    ],
    additionalProperties: false,
  };
}

function rootCauseJsonSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      method: { type: "string", enum: [...TOT_METHODS] },
      cause: { type: "string" },
      evidence_refs: { type: "array", items: { type: "string" } },
      systemic: { type: "boolean" },
      remediation: { type: "string" },
      root_cause_unproven: { type: "boolean" },
    },
    required: [
      "method",
      "cause",
      "evidence_refs",
      "systemic",
      "remediation",
      "root_cause_unproven",
    ],
    additionalProperties: false,
  };
}

function riskCatalogJsonSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      threat_code: { type: ["string", "null"] },
      vulnerability_code: { type: ["string", "null"] },
    },
    required: ["threat_code", "vulnerability_code"],
    additionalProperties: false,
  };
}

function containmentJsonSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            responsible: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["description"],
          additionalProperties: false,
        },
      },
    },
    required: ["actions"],
    additionalProperties: false,
  };
}

function gateJsonSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      breach_requiring_response: { type: "boolean" },
      rationale: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "string",
          pattern: "^[^:]+:[^:]+:.+$",
          description:
            "Exact doc_id:chunk_id:lines citation copied from retrieval_citations",
        },
      },
    },
    required: ["breach_requiring_response", "rationale", "citations"],
    additionalProperties: false,
  };
}

function trainingJsonSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      topic: { type: "string" },
      audience: { type: "string" },
    },
    required: ["topic", "audience"],
    additionalProperties: false,
  };
}
