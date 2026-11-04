import type { Agent } from "@pims/agent";
import type { AgentEventEmitter } from "@pims/agent/events/agent-events.ts";
import {
  loginWithPims,
  requirePermission,
  type SessionRegistry,
} from "@pims/cockpit/auth.ts";
import { handleChat } from "@pims/cockpit/chat.ts";
import { listAllIncidents } from "@pims/cockpit/chat-tools.ts";
import { buildSnapshot, CockpitEventHub } from "@pims/cockpit/event-hub.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import {
  type ChatRequest,
  ChatRequestSchema,
  CockpitLoginRequestSchema,
  type CockpitSession,
  ExemptionAttestationRequestSchema,
  type ExemptionAttestationResponse,
  RevisionRequestSchema,
} from "@pims/types/cockpit.ts";
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
  ModelUnavailableError,
  NotifyNoRecipientsError,
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
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { ZodError } from "zod";

const READINESS_CACHE_TTL_MS = 10_000;
const SSE_HEARTBEAT_MS = 15_000;

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
  checks: { database: boolean; rag_index: boolean; pims: boolean };
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
    error instanceof CitationFabricatedError
  ) {
    return 400;
  }
  if (
    error instanceof PimsUnavailableError ||
    error instanceof ModelUnavailableError
  ) {
    return 503;
  }
  return 500;
}

function errorCode(error: unknown): string {
  if (error instanceof ZodError) {
    return "COCKPIT_REQUEST_INVALID";
  }
  if (error instanceof PimsBaseError) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return "Request body failed validation";
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
  const clock = deps.clock ?? (() => new Date());
  const hub = deps.hub ?? new CockpitEventHub(deps.events);
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
    const body = await c.req.json().catch(() => ({}));
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
    if (header === undefined || !header.startsWith("Bearer ")) {
      throw new CockpitSessionInvalidError("Missing bearer token");
    }
    const token = header.slice("Bearer ".length).trim();
    if (token === "") {
      throw new CockpitSessionInvalidError("Empty bearer token");
    }
    c.set("session", deps.sessions.get(token));
    await next();
  });

  app.get("/api/incidents", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");
    const incidents = await listAllIncidents(deps.adapter);
    return c.json({ incidents });
  });

  app.get("/api/stream", async (c) => {
    const session = c.get("session");
    requirePermission(session, "view_incident");

    return streamSSE(c, async (stream) => {
      let closed = false;
      const unsubscribe = hub.subscribe(session, (id, event) => {
        if (closed) {
          return;
        }
        void stream
          .writeSSE({
            id: String(id),
            event: "agent",
            data: JSON.stringify(event),
          })
          .catch(() => {
            closed = true;
          });
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });

      try {
        await stream.writeSSE({
          id: String(hub.allocateId()),
          event: "stream:ready",
          data: JSON.stringify({ at_utc: clock().toISOString() }),
        });
        const snapshot = await buildSnapshot(
          deps.adapter,
          deps.store,
          clock,
          session,
        );
        await stream.writeSSE({
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
      vetoWindowMin: 0,
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
    const body = await c.req.json().catch(() => ({}));
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

  app.post("/api/incidents/:id/exemption", async (c) => {
    const session = c.get("session");
    requirePermission(session, "change_incident");
    const incidentId = parseIncidentId(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
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
    const body = await c.req.json().catch(() => ({}));
    const request: ChatRequest = ChatRequestSchema.parse(body);
    const result = await handleChat(
      {
        adapter: deps.adapter,
        store: deps.store,
        modelClient: deps.agent.modelClient,
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
      readiness = {
        at_ms: now,
        ready: database && pims,
        checks: {
          database,
          rag_index: deps.ragService.getVersion() !== "",
          pims,
        },
      };
      readiness.ready =
        readiness.checks.database &&
        readiness.checks.rag_index &&
        readiness.checks.pims;
    }
    return c.json(
      readiness.ready
        ? { status: "ready", checks: readiness.checks }
        : { status: "not_ready", checks: readiness.checks },
      readiness.ready ? 200 : 503,
    );
  });

  app.notFound((c) =>
    c.json({ error: "NOT_FOUND", message: "Route not found" }, 404),
  );

  app.onError((error, c) => {
    return c.json(
      { error: errorCode(error), message: errorMessage(error) },
      errorStatus(error) as 400 | 401 | 403 | 404 | 409 | 500 | 503,
    );
  });

  return app;
}
