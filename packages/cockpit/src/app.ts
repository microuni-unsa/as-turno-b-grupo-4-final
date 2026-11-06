import type { Agent } from "@pims/agent";
import type { AgentEventEmitter } from "@pims/agent/events/agent-events.ts";
import {
  loginWithPims,
  requirePermission,
  type SessionRegistry,
} from "@pims/cockpit/auth.ts";
import { handleChat } from "@pims/cockpit/chat.ts";
import {
  checkPendingDecisions,
  getRegulatoryTimers,
  listAllIncidents,
} from "@pims/cockpit/chat-tools.ts";
import { buildSnapshot, CockpitEventHub } from "@pims/cockpit/event-hub.ts";
import {
  draftGuidedIncident,
  explainField,
} from "@pims/cockpit/guided-create.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import type { IntakePayload } from "@pims/types/agent.ts";
import {
  type ChatRequest,
  ChatRequestSchema,
  CockpitLoginRequestSchema,
  type CockpitSession,
  ExemptionAttestationRequestSchema,
  type ExemptionAttestationResponse,
  GuidedDraftRequestSchema,
  GuidedExplainRequestSchema,
  GuidedSubmitRequestSchema,
  RevisionRequestSchema,
  type StreamSnapshot,
} from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CloseChecklistFailedError,
  CockpitChatInvalidError,
  CockpitPermissionDeniedError,
  CockpitPermissionsMissingError,
  CockpitPiiBlockedError,
  CockpitRoleConflictError,
  CockpitRoleUnknownError,
  CockpitSessionInvalidError,
  ExemptionUngroundedError,
  FormNarrativeTooLongError,
  ModelUnavailableError,
  NotifyNoRecipientsError,
  PiiRedactionUnavailableError,
  PimsAuthFailedError,
  PimsBaseError,
  PimsNotFoundError,
  PimsPermissionDeniedError,
  PimsUnavailableError,
  PimsValidationError,
  ReviewApprovalInvalidError,
  ReviewApprovalMissingError,
  ReviewApprovalReusedError,
  RoleToolDeniedError,
  TransitionForbiddenError,
} from "@pims/types/errors.ts";
import type { ExemptionEvaluationInput } from "@pims/types/notices.ts";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { ZodError } from "zod";

const READINESS_CACHE_TTL_MS = 10 * CONSTANTS.MS_PER_SECOND;
const SSE_HEARTBEAT_MS = 5 * CONSTANTS.MS_PER_SECOND;

export interface CockpitAppDeps {
  config: AgentConfig;
  adapter: PimsAdapter;
  store: EvidenceStore;
  agent: Agent;
  ragService: RAGService;
  events: AgentEventEmitter;
  sessions: SessionRegistry;
  clock?: () => Date;
  hub?: CockpitEventHub;
}

interface CockpitEnv {
  Variables: {
    session: CockpitSession;
  };
}

interface ReadinessCache {
  at_ms: number;
  ready: boolean;
  checks: {
    database: boolean;
    rag_index: boolean;
    pims: boolean;
    presidio: boolean;
  };
}

function errorStatus(error: unknown): number {
  if (error instanceof ZodError) {
    return 400;
  }
  if (
    error instanceof PimsAuthFailedError ||
    error instanceof CockpitSessionInvalidError
  ) {
    return 401;
  }
  if (
    error instanceof CockpitPermissionDeniedError ||
    error instanceof PimsPermissionDeniedError ||
    error instanceof RoleToolDeniedError
  ) {
    return 403;
  }
  if (error instanceof PimsNotFoundError) {
    return 404;
  }
  if (
    error instanceof PimsValidationError ||
    error instanceof TransitionForbiddenError ||
    error instanceof CloseChecklistFailedError ||
    error instanceof NotifyNoRecipientsError ||
    error instanceof ReviewApprovalMissingError ||
    error instanceof ReviewApprovalReusedError ||
    error instanceof ReviewApprovalInvalidError ||
    error instanceof ExemptionUngroundedError ||
    error instanceof CockpitRoleUnknownError ||
    error instanceof CockpitRoleConflictError ||
    error instanceof CockpitPermissionsMissingError
  ) {
    return 409;
  }
  if (
    error instanceof CockpitChatInvalidError ||
    error instanceof CockpitPiiBlockedError ||
    error instanceof CitationFabricatedError ||
    error instanceof FormNarrativeTooLongError
  ) {
    return 400;
  }
  if (
    error instanceof PimsUnavailableError ||
    error instanceof ModelUnavailableError ||
    error instanceof PiiRedactionUnavailableError
  ) {
    return 503;
  }
  return 500;
}

function errorCode(error: unknown): string {
  if (error instanceof ZodError) {
    return "COCKPIT_REQUEST_INVALID";
  }
  if (
    error instanceof PimsAuthFailedError ||
    error instanceof CockpitSessionInvalidError
  ) {
    return error.code;
  }
  if (
    error instanceof CockpitPermissionDeniedError ||
    error instanceof PimsPermissionDeniedError ||
    error instanceof RoleToolDeniedError
  ) {
    return error.code;
  }
  if (error instanceof PimsNotFoundError) {
    return error.code;
  }
  if (error instanceof PimsBaseError) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const details = error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join(", ");
    return `Request body failed validation: ${details}`;
  }
  if (
    error instanceof PimsAuthFailedError ||
    error instanceof CockpitSessionInvalidError
  ) {
    return error.message;
  }
  if (
    error instanceof CockpitPermissionDeniedError ||
    error instanceof PimsPermissionDeniedError ||
    error instanceof RoleToolDeniedError
  ) {
    return error.message;
  }
  if (error instanceof PimsNotFoundError) {
    return error.message;
  }
  if (error instanceof PimsBaseError) {
    return error.message;
  }
  return "Internal server error";
}

function parseIncidentId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PimsValidationError("incident_id", "INCIDENT_ID_INVALID");
  }
  return id;
}

export function createCockpitApp(deps: CockpitAppDeps): Hono<CockpitEnv> {
  const clock =
    deps.clock !== undefined && deps.clock !== null
      ? deps.clock
      : () => new Date();
  const hub =
    deps.hub !== undefined && deps.hub !== null
      ? deps.hub
      : new CockpitEventHub(deps.events);
  const app = new Hono<CockpitEnv>();
  let readiness: ReadinessCache | null = null;

  app.use(
    "*",
    cors({
      origin: (origin) => origin,
      allowHeaders: ["Authorization", "Content-Type", "Accept"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    }),
  );

  app.post("/api/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request = CockpitLoginRequestSchema.parse(body);
    const session = await loginWithPims(
      request.username,
      request.password,
      deps.config,
    );
    deps.sessions.add(session);
    return c.json(session, 200);
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/login") {
      await next();
      return;
    }
    const header = c.req.header("Authorization");
    if (header === undefined || header === null) {
      throw new CockpitSessionInvalidError("Missing authorization header");
    }
    if (!header.startsWith("Bearer ")) {
      throw new CockpitSessionInvalidError("Invalid bearer token format");
    }
    const token = header.slice("Bearer ".length).trim();
    if (token === "") {
      throw new CockpitSessionInvalidError("Empty bearer token");
    }
    const session = deps.sessions.get(token);
    if (session === undefined || session === null) {
      throw new CockpitSessionInvalidError("Session not found or expired");
    }
    c.set("session", session);
    await next();
  });

  app.get("/api/session", (c) => {
    const session = c.get("session");
    const expiresAtMs = new Date(session.expires_at_utc).getTime();
    const remainingSeconds = Math.max(
      0,
      Math.floor((expiresAtMs - clock().getTime()) / CONSTANTS.MS_PER_SECOND),
    );
    return c.json({
      user_id: session.user_id,
      username: session.username,
      schema: session.schema,
      native_role: session.native_role,
      permissions: session.permissions,
      default_persona: session.default_persona,
      can_switch_persona: session.can_switch_persona,
      expires_at_utc: session.expires_at_utc,
      remaining_seconds: remainingSeconds,
    });
  });

  app.get("/api/incidents", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");
    const incidents = await listAllIncidents(deps.adapter);
    return c.json({ incidents });
  });

  app.post("/api/incidents/draft", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request = GuidedDraftRequestSchema.parse(body);
    const result = await draftGuidedIncident(
      request,
      {
        config: deps.config,
        modelClient: deps.agent.modelClient,
        presidioClient: deps.agent.presidioClient,
        ragService: deps.ragService,
        now: clock,
      },
      session.username,
    );
    return c.json(result);
  });

  app.post("/api/incidents/explain", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request = GuidedExplainRequestSchema.parse(body);
    const result = await explainField(request, {
      config: deps.config,
      modelClient: deps.agent.modelClient,
      presidioClient: deps.agent.presidioClient,
      ragService: deps.ragService,
      now: clock,
    });
    return c.json(result);
  });

  app.post("/api/incidents", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request = GuidedSubmitRequestSchema.parse(body);

    const hasReporter =
      (request.rep_document_number !== null &&
        request.rep_document_number !== undefined &&
        request.rep_document_number !== "") ||
      (request.rep_first_name !== null &&
        request.rep_first_name !== undefined &&
        request.rep_first_name !== "");

    const hasEntity =
      (request.entity_ruc !== null &&
        request.entity_ruc !== undefined &&
        request.entity_ruc !== "") ||
      (request.entity_name !== null &&
        request.entity_name !== undefined &&
        request.entity_name !== "");

    const hasDpo =
      (request.dpo_contact_email !== null &&
        request.dpo_contact_email !== undefined &&
        request.dpo_contact_email !== "") ||
      (request.dpo_contact_name !== null &&
        request.dpo_contact_name !== undefined &&
        request.dpo_contact_name !== "");

    const intakePayload: IntakePayload = {
      channel: "cockpit_guided",
      title: request.title,
      description:
        request.description !== null && request.description !== undefined
          ? request.description
          : undefined,
      involves_personal_data: request.involves_personal_data,
      incident_date: request.incident_date,
      incident_time:
        request.incident_time !== null && request.incident_time !== undefined
          ? request.incident_time
          : undefined,
      detection_date:
        request.detection_date !== null && request.detection_date !== undefined
          ? request.detection_date
          : undefined,
      detection_time:
        request.detection_time !== null && request.detection_time !== undefined
          ? request.detection_time
          : undefined,
      incident_type: request.incident_type,
      affected_data_types: request.affected_data_types,
      security_measures_adopted: request.security_measures_adopted,
      affected_cid: request.affected_cid,
      num_affected_subjects:
        request.num_affected_subjects !== null &&
        request.num_affected_subjects !== undefined
          ? request.num_affected_subjects
          : undefined,
      compromised_system:
        request.compromised_system !== null &&
        request.compromised_system !== undefined
          ? request.compromised_system
          : undefined,
      affected_url:
        request.affected_url !== null && request.affected_url !== undefined
          ? request.affected_url
          : undefined,
      status:
        request.status !== null && request.status !== undefined
          ? request.status
          : undefined,
      severity:
        request.severity !== null && request.severity !== undefined
          ? request.severity
          : undefined,
      impact:
        request.impact !== null && request.impact !== undefined
          ? request.impact
          : undefined,
      reported_by:
        request.reported_by !== null && request.reported_by !== undefined
          ? request.reported_by
          : undefined,
      assigned_to:
        request.assigned_to !== null && request.assigned_to !== undefined
          ? request.assigned_to
          : undefined,
      affected_treatment:
        request.affected_treatment !== null &&
        request.affected_treatment !== undefined
          ? request.affected_treatment
          : undefined,
      evidence_refs:
        request.evidence_refs !== null && request.evidence_refs !== undefined
          ? request.evidence_refs
          : undefined,
      measure_updated_registry:
        request.measure_updated_registry !== null &&
        request.measure_updated_registry !== undefined
          ? request.measure_updated_registry
          : undefined,
      measure_new_security:
        request.measure_new_security !== null &&
        request.measure_new_security !== undefined
          ? request.measure_new_security
          : undefined,
      measure_improved_policies:
        request.measure_improved_policies !== null &&
        request.measure_improved_policies !== undefined
          ? request.measure_improved_policies
          : undefined,
      measure_considered_resolved:
        request.measure_considered_resolved !== null &&
        request.measure_considered_resolved !== undefined
          ? request.measure_considered_resolved
          : undefined,
      measure_reported_authorities:
        request.measure_reported_authorities !== null &&
        request.measure_reported_authorities !== undefined
          ? request.measure_reported_authorities
          : undefined,
      resolved_date:
        request.resolved_date !== null && request.resolved_date !== undefined
          ? request.resolved_date
          : undefined,
      actions: request.actions.length > 0 ? request.actions : undefined,
      reporter: hasReporter
        ? {
            document_number:
              request.rep_document_number !== null &&
              request.rep_document_number !== undefined
                ? request.rep_document_number
                : undefined,
            document_expiry:
              request.rep_document_expiry !== null &&
              request.rep_document_expiry !== undefined
                ? request.rep_document_expiry
                : undefined,
            first_name:
              request.rep_first_name !== null &&
              request.rep_first_name !== undefined
                ? request.rep_first_name
                : undefined,
            last_name_p:
              request.rep_last_name_p !== null &&
              request.rep_last_name_p !== undefined
                ? request.rep_last_name_p
                : undefined,
            last_name_m:
              request.rep_last_name_m !== null &&
              request.rep_last_name_m !== undefined
                ? request.rep_last_name_m
                : undefined,
            position:
              request.rep_position !== null &&
              request.rep_position !== undefined
                ? request.rep_position
                : undefined,
            phone:
              request.rep_phone !== null && request.rep_phone !== undefined
                ? request.rep_phone
                : undefined,
            email:
              request.rep_email !== null && request.rep_email !== undefined
                ? request.rep_email
                : undefined,
          }
        : undefined,
      entity: hasEntity
        ? {
            type:
              request.entity_type !== null && request.entity_type !== undefined
                ? (request.entity_type as "R" | "U")
                : undefined,
            ruc:
              request.entity_ruc !== null && request.entity_ruc !== undefined
                ? request.entity_ruc
                : undefined,
            name:
              request.entity_name !== null && request.entity_name !== undefined
                ? request.entity_name
                : undefined,
            phone:
              request.entity_phone !== null &&
              request.entity_phone !== undefined
                ? request.entity_phone
                : undefined,
            extension:
              request.entity_extension !== null &&
              request.entity_extension !== undefined
                ? request.entity_extension
                : undefined,
            department:
              request.entity_department !== null &&
              request.entity_department !== undefined
                ? request.entity_department
                : undefined,
            province:
              request.entity_province !== null &&
              request.entity_province !== undefined
                ? request.entity_province
                : undefined,
            district:
              request.entity_district !== null &&
              request.entity_district !== undefined
                ? request.entity_district
                : undefined,
          }
        : undefined,
      dpo: hasDpo
        ? {
            name:
              request.dpo_contact_name !== null &&
              request.dpo_contact_name !== undefined
                ? request.dpo_contact_name
                : undefined,
            email:
              request.dpo_contact_email !== null &&
              request.dpo_contact_email !== undefined
                ? request.dpo_contact_email
                : undefined,
            phone:
              request.dpo_contact_phone !== null &&
              request.dpo_contact_phone !== undefined
                ? request.dpo_contact_phone
                : undefined,
          }
        : undefined,
    };

    const intakeResult = await deps.agent.orchestrator.intake(intakePayload);
    const isDedupe = intakeResult.dedupe.action !== "create";
    return c.json(
      {
        incident_code: intakeResult.incident.incident_code,
        status: intakeResult.incident.status,
        dedupe: isDedupe,
        marker: isDedupe ? "DEDUPE_MERGED:cockpit_guided" : undefined,
      },
      isDedupe ? 200 : 201,
    );
  });

  app.get("/api/compliance", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");
    const [timers, pendingDecisions] = await Promise.all([
      getRegulatoryTimers(deps.store, clock),
      checkPendingDecisions(deps.adapter, deps.store, session),
    ]);
    return c.json({
      timers,
      pending_decisions: pendingDecisions,
    });
  });

  app.get("/api/incidents/:id/proposal", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");
    const incidentId = parseIncidentId(c.req.param("id"));
    const incident = await deps.adapter.getIncident(incidentId);
    const [authorityPack, subjectPack, rootCause] = await Promise.all([
      deps.store.getDraftPack(incident.incident_code, "authority"),
      deps.store.getDraftPack(incident.incident_code, "subject"),
      deps.store.getRootCause(incident.incident_code),
    ]);
    return c.json({
      incident_id: incident.id,
      incident_code: incident.incident_code,
      authority_pack: authorityPack,
      subject_pack: subjectPack,
      root_cause: rootCause,
    });
  });

  app.get("/api/stream", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");

    return streamSSE(c, async (stream) => {
      let closed = false;
      let writeQueue = Promise.resolve();
      const safeWriteSSE = (msg: {
        id?: string;
        event?: string;
        data: string;
      }): Promise<void> => {
        if (closed || c.req.raw.signal.aborted) {
          return Promise.resolve();
        }
        writeQueue = writeQueue
          .then(async () => {
            if (!closed && !c.req.raw.signal.aborted) {
              await stream.writeSSE(msg);
            }
          })
          .catch((err) => {
            console.error("SSE_WRITE_FAILED:", err);
          });
        return writeQueue;
      };

      const unsubscribe = hub.subscribe(session, (id, event) => {
        if (closed || c.req.raw.signal.aborted) {
          return;
        }
        void safeWriteSSE({
          id: String(id),
          event: "agent",
          data: JSON.stringify(event),
        });
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });

      try {
        await stream.write(": connected\n\n");
        await safeWriteSSE({
          id: String(hub.allocateId()),
          event: "stream:ready",
          data: JSON.stringify({ at_utc: clock().toISOString() }),
        });
        let snapshot: StreamSnapshot;
        try {
          snapshot = await buildSnapshot(
            deps.adapter,
            deps.store,
            clock,
            session,
          );
        } catch (error) {
          console.error("BUILD_SNAPSHOT_FATAL_ERROR:", error);
          snapshot = {
            incidents: [],
            timers: [],
            pending_decisions: [],
          };
        }
        await safeWriteSSE({
          id: String(hub.allocateId()),
          event: "snapshot",
          data: JSON.stringify(snapshot),
        });

        while (!closed && !c.req.raw.signal.aborted) {
          await stream.sleep(SSE_HEARTBEAT_MS);
          if (closed || c.req.raw.signal.aborted) {
            break;
          }
          await stream.write(": heartbeat\n\n");
        }
      } finally {
        closed = true;
        unsubscribe();
      }
    });
  });

  app.post("/api/incidents/:id/approve", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    const incidentId = parseIncidentId(c.req.param("id"));
    const result = await deps.agent.orchestrator.approveAndNotify(incidentId, {
      vetoWindowMin: CONSTANTS.HUMAN_VETO_WINDOW_MIN,
      operator: session.username,
    });
    return c.json({
      parked: result.parked,
      parkedUntilUtc: result.parkedUntilUtc,
      notifies: result.notifies,
      actions: result.actions,
    });
  });

  app.post("/api/incidents/:id/revision", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    const incidentId = parseIncidentId(c.req.param("id"));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request = RevisionRequestSchema.parse(body);
    const incident = await deps.adapter.getIncident(incidentId);
    const latest = await deps.store.getDraftPack(
      incident.incident_code,
      request.pack_type,
    );
    if (latest === null) {
      throw new ReviewApprovalMissingError(
        `${incident.incident_code}:${request.pack_type}`,
      );
    }
    if (latest.state === "sent" || latest.state === "acknowledged") {
      throw new PimsValidationError("revision", "PACK_ALREADY_SENT");
    }
    await deps.agent.orchestrator.veto(
      incident.incident_code,
      request.pack_type,
      session.username,
      request.reason,
    );
    return c.json({ ok: true });
  });

  app.post("/api/incidents/:id/regenerate", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    const incidentId = parseIncidentId(c.req.param("id"));
    const incident = await deps.adapter.getIncident(incidentId);
    await deps.agent.orchestrator.regenerateProposal(incident.id);
    return c.json({ ok: true });
  });

  app.post("/api/incidents/:id/exemption", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    const incidentId = parseIncidentId(c.req.param("id"));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request = ExemptionAttestationRequestSchema.parse(body);
    const incident = await deps.adapter.getIncident(incidentId);
    if (!incident.involves_personal_data || incident.status === "C") {
      throw new PimsValidationError(
        "exemption",
        "SUBJECT_NOTICE_NOT_APPLICABLE",
      );
    }
    const latest = await deps.store.getDraftPack(
      incident.incident_code,
      "subject",
    );
    if (
      latest !== null &&
      (latest.state === "sent" || latest.state === "acknowledged")
    ) {
      throw new PimsValidationError("exemption", "SUBJECT_NOTICE_ALREADY_SENT");
    }

    const now = clock();
    const approval = await deps.store.mintReviewApproval({
      incidentCode: incident.incident_code,
      packType: "subject",
      contentSha256: request.source_file_sha256,
      note: `ART34_3A_ENCRYPTION_ATTESTATION:${session.username}`,
    });

    const input: ExemptionEvaluationInput = {
      incidentCode: incident.incident_code,
      securityMeasuresAdopted: incident.security_measures_adopted,
      encryptionProofs: [
        {
          incident_code: incident.incident_code,
          source_file_sha256: request.source_file_sha256,
          scope: request.scope,
          algorithm: request.algorithm,
          key_management_ref: request.key_management_ref,
          applies_to_affected_data: request.applies_to_affected_data,
          evidence_refs: request.evidence_refs,
          verified_by: session.username,
          verified_at_utc: now.toISOString(),
          review_approval_id: approval.approval_id,
        },
      ],
      subsequentMeasures: [],
      disproportionateEffort: null,
      authorityInstruction: null,
    };

    const result = await deps.agent.orchestrator.attestSubjectExemption(
      incidentId,
      input,
    );
    const response: ExemptionAttestationResponse = {
      exemption: result.exemption,
      pack_id: result.pack_id,
    };
    return c.json(response);
  });

  app.post("/api/chat", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid JSON body" },
        400,
      );
    }
    const request: ChatRequest = ChatRequestSchema.parse(body);
    const result = await handleChat(
      {
        adapter: deps.adapter,
        store: deps.store,
        modelClient: deps.agent.modelClient,
        presidioClient: deps.agent.presidioClient,
        ragService: deps.ragService,
        config: deps.config,
        clock,
      },
      session,
      request,
    );
    return c.json(result);
  });

  app.get("/healthz", (c) =>
    c.json({ status: "ok", uptime_s: Math.floor(process.uptime()) }),
  );

  app.get("/readyz", async (c) => {
    const now = clock().getTime();
    if (readiness === null || now - readiness.at_ms > READINESS_CACHE_TTL_MS) {
      let database = false;
      let pims = false;
      let presidio = false;
      try {
        await deps.store.sql`SELECT 1`;
        database = true;
      } catch {
        database = false;
      }
      try {
        await deps.adapter.getProfile();
        pims = true;
      } catch {
        pims = false;
      }
      try {
        presidio = await deps.agent.presidioClient.isHealthy();
      } catch {
        presidio = false;
      }
      readiness = {
        at_ms: now,
        ready: database && pims && presidio,
        checks: {
          database,
          rag_index: deps.ragService.getVersion() !== "",
          pims,
          presidio,
        },
      };
      readiness.ready =
        readiness.checks.database &&
        readiness.checks.rag_index &&
        readiness.checks.pims &&
        readiness.checks.presidio;
    }
    return c.json(
      readiness.ready
        ? { status: "ready", checks: readiness.checks }
        : { status: "not_ready", checks: readiness.checks },
      readiness.ready ? 200 : 503,
    );
  });

  app.use("/*", serveStatic({ root: "./dist/client" }));

  app.notFound((c) =>
    c.json(
      {
        error: "NOT_FOUND",
        message: `Route not found: ${c.req.method} ${c.req.path}`,
      },
      404,
    ),
  );

  app.onError((error, c) => {
    return c.json(
      {
        error: errorCode(error),
        message: errorMessage(error),
        details: error instanceof ZodError ? error.issues : undefined,
      },
      errorStatus(error) as 400 | 401 | 403 | 404 | 409 | 500 | 503,
    );
  });

  return app;
}
