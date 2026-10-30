import { serve } from "@hono/node-server";
import type { MockDatabaseClient } from "@pims/pims-mock/db/client.ts";
import {
  authUser,
  coreAsset,
  coreAudit,
  coreAuditActionPlan,
  coreAuditFinding,
  coreIncident,
  coreIncidentAction,
  coreIncidentAttachment,
  coreIncidentHistory,
  coreIncidentRecipient,
  coreRiskEvaluation,
  coreRiskEvaluationAsset,
  coreRiskPeriod,
  coreUserProfile,
  customerClient,
} from "@pims/pims-mock/db/schema.ts";
import {
  annexMeta,
  dashboardKpis,
  riskCatalogs,
} from "@pims/pims-mock/fixtures.ts";
import {
  EVENT_TYPE_LABELS,
  PimsAuditCreateSchema,
  PimsAuditUpdateSchema,
  PimsIncidentCreateSchema,
  PimsIncidentRecipientCreateSchema,
  PimsIncidentUpdateSchema,
  PimsRiskEvaluationCreateSchema,
} from "@pims/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { z } from "zod";

function formatDrfErrors(error: z.ZodError): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] ? String(issue.path[0]) : "detail";
    if (!res[field]) {
      res[field] = [];
    }
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      res[field].push("Este campo es requerido.");
    } else {
      res[field].push(issue.message || "Valor inválido.");
    }
  }
  return res;
}

export interface PimsServerOptions {
  port?: number;
  nestedActionMode?: "replace" | "merge";
  nestedAuditMode?: "replace" | "merge";
}

export interface PimsTestServerInstance {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export function buildPimsApp(
  dbClient: MockDatabaseClient,
  options?: PimsServerOptions,
) {
  const { db } = dbClient;
  const nestedActionMode = options?.nestedActionMode ?? "replace";
  const nestedAuditMode = options?.nestedAuditMode ?? "replace";

  const app = new Hono();

  app.use("*", cors());

  // Helper to query full incident with all 57 keys
  const getFullIncident = async (incidentId: number) => {
    const incidents = await db
      .select()
      .from(coreIncident)
      .where(
        and(
          eq(coreIncident.id, incidentId),
          eq(coreIncident.is_deleted, false),
        ),
      );
    const inc = incidents[0];
    if (!inc) {
      return null;
    }

    const actions = await db
      .select()
      .from(coreIncidentAction)
      .where(eq(coreIncidentAction.incident_id, incidentId))
      .orderBy(coreIncidentAction.position, coreIncidentAction.id);

    const attachments = await db
      .select({
        id: coreIncidentAttachment.id,
        file: coreIncidentAttachment.file,
        file_name: coreIncidentAttachment.file_name,
        uploaded_at: coreIncidentAttachment.uploaded_at,
        uploaded_by: coreIncidentAttachment.uploaded_by_id,
        uploaded_by_name: authUser.username,
      })
      .from(coreIncidentAttachment)
      .leftJoin(
        authUser,
        eq(authUser.id, coreIncidentAttachment.uploaded_by_id),
      )
      .where(eq(coreIncidentAttachment.incident_id, incidentId))
      .orderBy(desc(coreIncidentAttachment.uploaded_at));

    const historyRows = await db
      .select({
        id: coreIncidentHistory.id,
        event_type: coreIncidentHistory.event_type,
        changed_at: coreIncidentHistory.changed_at,
        actor: coreIncidentHistory.actor,
        changed_by: coreIncidentHistory.changed_by_id,
        changed_by_name: authUser.username,
        description: coreIncidentHistory.description,
        recipients_snapshot: coreIncidentHistory.recipients_snapshot,
      })
      .from(coreIncidentHistory)
      .leftJoin(authUser, eq(authUser.id, coreIncidentHistory.changed_by_id))
      .where(eq(coreIncidentHistory.incident_id, incidentId))
      .orderBy(
        desc(coreIncidentHistory.changed_at),
        desc(coreIncidentHistory.id),
      );

    const history = historyRows.map((h) => ({
      id: h.id,
      event_type: h.event_type,
      event_type_label: EVENT_TYPE_LABELS[h.event_type] ?? h.event_type,
      changed_at: h.changed_at ? new Date(h.changed_at).toISOString() : "",
      actor: h.actor,
      changed_by: h.changed_by,
      changed_by_name: h.changed_by_name,
      description: h.description,
      recipients_snapshot: h.recipients_snapshot,
    }));

    return {
      id: inc.id,
      incident_code: inc.incident_code,
      rep_document_number: inc.rep_document_number,
      rep_document_expiry: inc.rep_document_expiry,
      rep_first_name: inc.rep_first_name,
      rep_last_name_p: inc.rep_last_name_p,
      rep_last_name_m: inc.rep_last_name_m,
      rep_position: inc.rep_position,
      rep_phone: inc.rep_phone,
      rep_email: inc.rep_email,
      entity_type: inc.entity_type,
      entity_ruc: inc.entity_ruc,
      entity_name: inc.entity_name,
      entity_phone: inc.entity_phone,
      entity_extension: inc.entity_extension,
      entity_department: inc.entity_department,
      entity_province: inc.entity_province,
      entity_district: inc.entity_district,
      involves_personal_data: inc.involves_personal_data,
      incident_date: inc.incident_date,
      incident_time: inc.incident_time,
      detection_date: inc.detection_date,
      detection_time: inc.detection_time,
      incident_type: inc.incident_type,
      status: inc.status,
      severity: inc.severity,
      impact: inc.impact,
      title: inc.title,
      description: inc.description,
      reported_by: inc.reported_by,
      assigned_to: inc.assigned_to,
      affected_treatment: inc.affected_treatment,
      dpo_contact_name: inc.dpo_contact_name,
      dpo_contact_email: inc.dpo_contact_email,
      dpo_contact_phone: inc.dpo_contact_phone,
      affected_data_types: inc.affected_data_types ?? [],
      num_affected_subjects: inc.num_affected_subjects,
      compromised_system: inc.compromised_system,
      affected_url: inc.affected_url,
      evidence_refs: inc.evidence_refs,
      measure_updated_registry: inc.measure_updated_registry,
      measure_new_security: inc.measure_new_security,
      measure_improved_policies: inc.measure_improved_policies,
      measure_considered_resolved: inc.measure_considered_resolved,
      measure_reported_authorities: inc.measure_reported_authorities,
      security_measures_adopted: inc.security_measures_adopted ?? [],
      resolved_date: inc.resolved_date,
      affected_cid: inc.affected_cid ?? [],
      actions: actions.map((a) => ({
        id: a.id,
        action_type: a.action_type,
        responsible: a.responsible,
        action_date: a.action_date,
        description: a.description,
        evidence: a.evidence,
        position: a.position,
      })),
      attachments: attachments.map((att) => ({
        id: att.id,
        file: att.file,
        file_name: att.file_name,
        original_name: att.file_name,
        file_size: 1024,
        content_type: "application/octet-stream",
        uploaded_at: att.uploaded_at
          ? new Date(att.uploaded_at).toISOString()
          : "",
        uploaded_by: att.uploaded_by,
        uploaded_by_name: att.uploaded_by_name,
      })),
      history,
      attachments_count: attachments.length,
      actions_count: actions.length,
      created_at: inc.created_at.toISOString(),
      created_by: inc.created_by_id,
      updated_at: inc.updated_at.toISOString(),
      updated_by: inc.updated_by_id,
      is_deleted: inc.is_deleted,
      deleted_at: inc.deleted_at ? inc.deleted_at.toISOString() : null,
      deleted_by: inc.deleted_by_id,
    };
  };

  // Auth & Schema Middleware
  app.use(async (c, next) => {
    const simError = c.req.header("X-Simulate-Error");
    if (simError === "403_LICENSE") {
      return c.json({ detail: "LICENSE_EXPIRED" }, 403);
    }

    const p = c.req.path;
    if (
      p.startsWith("/business/login") ||
      p.startsWith("/business/token/refresh")
    ) {
      return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { detail: "Las credenciales de autenticación no se proveyeron." },
        401,
      );
    }

    const schemaHeader = c.req.header("X-PIMS-Schema");
    if (schemaHeader && schemaHeader !== "unsa" && schemaHeader !== "demo") {
      return c.json({ detail: "Esquema no autorizado o no encontrado." }, 403);
    }

    return next();
  });

  // E01: POST /business/login/
  app.post("/business/login/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.username || !body.password) {
      return c.json({ detail: "Credenciales incompletas." }, 400);
    }

    const users = await db
      .select()
      .from(authUser)
      .where(eq(authUser.username, String(body.username)));
    const user = users[0];

    if (!user || user.password !== body.password) {
      return c.json(
        {
          detail:
            "No se encontró una cuenta activa con las credenciales dadas.",
        },
        401,
      );
    }

    const profiles = await db
      .select()
      .from(coreUserProfile)
      .where(eq(coreUserProfile.user_id, user.id));
    const profile = profiles[0];

    const access = `mock-access-${user.id}-${Date.now()}`;
    const refresh = `mock-refresh-${user.id}-${Date.now()}`;

    return c.json({
      access,
      refresh,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        is_platform_admin: profile?.is_platform_admin ?? false,
      },
    });
  });

  // E02: POST /business/token/refresh/
  app.post("/business/token/refresh/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.refresh) {
      return c.json({ detail: "El token de refresco es requerido." }, 400);
    }
    return c.json({
      access: `mock-refreshed-access-${Date.now()}`,
    });
  });

  // E03: GET /business/info/
  app.get("/business/info/", async (c) => {
    const clients = await db
      .select()
      .from(customerClient)
      .where(eq(customerClient.schema_name, "unsa"));
    const client = clients[0];
    return c.json({
      name: client?.name ?? "UNSA",
      schema_name: client?.schema_name ?? "unsa",
    });
  });

  // E04: GET /business/profile/
  app.get("/business/profile/", async (c) => {
    const users = await db
      .select()
      .from(authUser)
      .where(eq(authUser.username, "admin"));
    const user = users[0];
    if (!user) {
      return c.json({ detail: "Usuario no encontrado." }, 404);
    }
    const profiles = await db
      .select()
      .from(coreUserProfile)
      .where(eq(coreUserProfile.user_id, user.id));
    const profile = profiles[0];

    return c.json({
      id: user.id,
      username: user.username,
      email: user.email ?? "admin@unsa.pe",
      area: profile?.area ?? "Seguridad",
      position: profile?.position ?? "Administrador",
      is_platform_admin: profile?.is_platform_admin ?? true,
      must_change_password: profile?.must_change_password ?? false,
    });
  });

  // E05: GET /api/incidents/
  app.get("/api/incidents/", async (c) => {
    const search = c.req.query("search");
    const status = c.req.query("status");
    const severity = c.req.query("severity");
    const incidentType = c.req.query("incident_type");

    const allIncidents = await db
      .select()
      .from(coreIncident)
      .where(eq(coreIncident.is_deleted, false))
      .orderBy(desc(coreIncident.id));

    let filtered = allIncidents;
    if (search) {
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(search.toLowerCase()) ||
          i.incident_code.toLowerCase().includes(search.toLowerCase()),
      );
    }
    if (status) {
      filtered = filtered.filter((i) => i.status === status);
    }
    if (severity) {
      filtered = filtered.filter((i) => i.severity === severity);
    }
    if (incidentType) {
      filtered = filtered.filter((i) => i.incident_type === incidentType);
    }

    const results = [];
    for (const row of filtered) {
      const inc = await getFullIncident(row.id);
      if (inc) {
        results.push(inc);
      }
    }

    return c.json({
      count: results.length,
      next: null,
      previous: null,
      results,
    });
  });

  // E06: POST /api/incidents/
  app.post("/api/incidents/", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    const parsed = PimsIncidentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatDrfErrors(parsed.error), 400);
    }

    if (
      body.detection_date &&
      body.incident_date &&
      body.detection_date < body.incident_date
    ) {
      return c.json(
        {
          detection_date: [
            "La fecha de detección no puede ser anterior a la fecha del incidente.",
          ],
        },
        400,
      );
    }

    // Auto-generate INC-###
    const countRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coreIncident);
    const nextNum = (countRes[0]?.count ?? 0) + 1;
    const incidentCode =
      body.incident_code || `INC-${String(nextNum).padStart(3, "0")}`;

    const now = new Date();
    const inserted = await db
      .insert(coreIncident)
      .values({
        incident_code: incidentCode,
        rep_document_number: body.rep_document_number ?? null,
        rep_document_expiry: body.rep_document_expiry ?? null,
        rep_first_name: body.rep_first_name ?? null,
        rep_last_name_p: body.rep_last_name_p ?? null,
        rep_last_name_m: body.rep_last_name_m ?? null,
        rep_position: body.rep_position ?? null,
        rep_phone: body.rep_phone ?? null,
        rep_email: body.rep_email ?? null,
        entity_type: body.entity_type ?? null,
        entity_ruc: body.entity_ruc ?? null,
        entity_name: body.entity_name ?? null,
        entity_phone: body.entity_phone ?? null,
        entity_extension: body.entity_extension ?? null,
        entity_department: body.entity_department ?? null,
        entity_province: body.entity_province ?? null,
        entity_district: body.entity_district ?? null,
        involves_personal_data: Boolean(body.involves_personal_data),
        incident_date: String(body.incident_date),
        incident_time: body.incident_time ?? null,
        detection_date: body.detection_date ?? null,
        detection_time: body.detection_time ?? null,
        incident_type: String(body.incident_type),
        status: String(body.status),
        severity: body.severity ?? null,
        impact: body.impact ?? null,
        title: String(body.title),
        description: body.description ?? null,
        reported_by: body.reported_by ?? null,
        assigned_to: body.assigned_to ?? null,
        affected_treatment: body.affected_treatment ?? null,
        dpo_contact_name: body.dpo_contact_name ?? null,
        dpo_contact_email: body.dpo_contact_email ?? null,
        dpo_contact_phone: body.dpo_contact_phone ?? null,
        affected_data_types: body.affected_data_types ?? [],
        num_affected_subjects: body.num_affected_subjects ?? null,
        compromised_system: body.compromised_system ?? null,
        affected_url: body.affected_url ?? null,
        evidence_refs: body.evidence_refs ?? null,
        measure_updated_registry: body.measure_updated_registry ?? null,
        measure_new_security: body.measure_new_security ?? null,
        measure_improved_policies: body.measure_improved_policies ?? null,
        measure_considered_resolved: body.measure_considered_resolved ?? null,
        measure_reported_authorities: body.measure_reported_authorities ?? null,
        security_measures_adopted: body.security_measures_adopted ?? [],
        resolved_date: body.resolved_date ?? null,
        affected_cid: body.affected_cid ?? [],
        created_at: now,
        updated_at: now,
        created_by_id: 1,
        updated_by_id: 1,
        is_deleted: false,
      })
      .returning();

    const newInc = inserted[0];
    if (!newInc) {
      return c.json({ detail: "Error creando incidente" }, 500);
    }

    // Insert initial history
    await db.insert(coreIncidentHistory).values({
      incident_id: newInc.id,
      event_type: "created",
      changed_at: now,
      actor: "admin",
      changed_by_id: 1,
      description: "Incidente creado inicialmente",
      recipients_snapshot: [],
    });

    // Insert actions if any
    if (Array.isArray(body.actions)) {
      for (let i = 0; i < body.actions.length; i++) {
        const act = body.actions[i];
        await db.insert(coreIncidentAction).values({
          incident_id: newInc.id,
          action_type: String(act.action_type || "C"),
          responsible: String(act.responsible || "admin"),
          action_date: String(
            act.action_date || now.toISOString().slice(0, 10),
          ),
          description: String(act.description || ""),
          evidence: act.evidence ? String(act.evidence) : null,
          position: i + 1,
        });
      }
    }

    const full = await getFullIncident(newInc.id);
    return c.json(full, 201);
  });

  // E07: GET /api/incidents/:id/
  app.get("/api/incidents/:id/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const full = await getFullIncident(id);
    if (!full) {
      return c.json({ detail: "No Incident matches the given query." }, 404);
    }
    return c.json(full);
  });

  // E08: PATCH /api/incidents/:id/
  app.patch("/api/incidents/:id/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const existing = await getFullIncident(id);
    if (!existing) {
      return c.json({ detail: "No Incident matches the given query." }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = PimsIncidentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatDrfErrors(parsed.error), 400);
    }
    const now = new Date();

    const updateFields: Record<string, unknown> = {
      updated_at: now,
      updated_by_id: 1,
    };

    const allowedKeys = [
      "rep_document_number",
      "rep_document_expiry",
      "rep_first_name",
      "rep_last_name_p",
      "rep_last_name_m",
      "rep_position",
      "rep_phone",
      "rep_email",
      "entity_type",
      "entity_ruc",
      "entity_name",
      "entity_phone",
      "entity_extension",
      "entity_department",
      "entity_province",
      "entity_district",
      "involves_personal_data",
      "incident_date",
      "incident_time",
      "detection_date",
      "detection_time",
      "incident_type",
      "status",
      "severity",
      "impact",
      "title",
      "description",
      "reported_by",
      "assigned_to",
      "affected_treatment",
      "dpo_contact_name",
      "dpo_contact_email",
      "dpo_contact_phone",
      "affected_data_types",
      "num_affected_subjects",
      "compromised_system",
      "affected_url",
      "evidence_refs",
      "measure_updated_registry",
      "measure_new_security",
      "measure_improved_policies",
      "measure_considered_resolved",
      "measure_reported_authorities",
      "security_measures_adopted",
      "resolved_date",
      "affected_cid",
    ];

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        updateFields[key] = body[key];
      }
    }

    await db
      .update(coreIncident)
      .set(updateFields)
      .where(eq(coreIncident.id, id));

    // Nested array actions mutation
    if (Array.isArray(body.actions)) {
      if (nestedActionMode === "replace") {
        await db
          .delete(coreIncidentAction)
          .where(eq(coreIncidentAction.incident_id, id));
      }
      for (let i = 0; i < body.actions.length; i++) {
        const act = body.actions[i];
        await db.insert(coreIncidentAction).values({
          incident_id: id,
          action_type: String(act.action_type),
          responsible: String(act.responsible),
          action_date: String(act.action_date),
          description: String(act.description),
          evidence: act.evidence ? String(act.evidence) : null,
          position: i + 1,
        });
      }
    }

    // Insert history
    await db.insert(coreIncidentHistory).values({
      incident_id: id,
      event_type: "updated",
      changed_at: now,
      actor: "admin",
      changed_by_id: 1,
      description: "Incidente actualizado",
      recipients_snapshot: [],
    });

    const full = await getFullIncident(id);
    return c.json(full, 200);
  });

  // E09: DELETE /api/incidents/:id/
  app.delete("/api/incidents/:id/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const existing = await getFullIncident(id);
    if (!existing) {
      return c.json({ detail: "No Incident matches the given query." }, 404);
    }
    await db
      .update(coreIncident)
      .set({ is_deleted: true, deleted_at: new Date(), deleted_by_id: 1 })
      .where(eq(coreIncident.id, id));
    return c.body(null, 204);
  });

  // E10: GET /api/incidents/:id/history/
  app.get("/api/incidents/:id/history/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const historyRows = await db
      .select({
        id: coreIncidentHistory.id,
        incident_id: coreIncidentHistory.incident_id,
        event_type: coreIncidentHistory.event_type,
        changed_at: coreIncidentHistory.changed_at,
        actor: coreIncidentHistory.actor,
        changed_by: coreIncidentHistory.changed_by_id,
        changed_by_name: authUser.username,
        field_name: coreIncidentHistory.event_type,
        old_value: sql<string | null>`null`,
        new_value: coreIncidentHistory.description,
        comment: coreIncidentHistory.description,
        description: coreIncidentHistory.description,
        recipients_snapshot: coreIncidentHistory.recipients_snapshot,
      })
      .from(coreIncidentHistory)
      .leftJoin(authUser, eq(authUser.id, coreIncidentHistory.changed_by_id))
      .where(eq(coreIncidentHistory.incident_id, id))
      .orderBy(
        desc(coreIncidentHistory.changed_at),
        desc(coreIncidentHistory.id),
      );

    return c.json(
      historyRows.map((h) => ({
        ...h,
        event_type_label: EVENT_TYPE_LABELS[h.event_type] ?? h.event_type,
        changed_at: h.changed_at.toISOString(),
      })),
    );
  });

  // E11: GET /api/incidents/:id/attachments/
  app.get("/api/incidents/:id/attachments/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const attachments = await db
      .select({
        id: coreIncidentAttachment.id,
        incident_id: coreIncidentAttachment.incident_id,
        file: coreIncidentAttachment.file,
        file_name: coreIncidentAttachment.file_name,
        uploaded_at: coreIncidentAttachment.uploaded_at,
        uploaded_by_id: coreIncidentAttachment.uploaded_by_id,
        uploaded_by_name: authUser.username,
      })
      .from(coreIncidentAttachment)
      .leftJoin(
        authUser,
        eq(authUser.id, coreIncidentAttachment.uploaded_by_id),
      )
      .where(eq(coreIncidentAttachment.incident_id, id))
      .orderBy(desc(coreIncidentAttachment.uploaded_at));

    return c.json(
      attachments.map((a) => ({
        id: a.id,
        incident_id: a.incident_id,
        file: a.file,
        file_name: a.file_name,
        original_name: a.file_name,
        file_size: 1024,
        content_type: "application/octet-stream",
        uploaded_at: a.uploaded_at.toISOString(),
        uploaded_by: a.uploaded_by_id,
        uploaded_by_name: a.uploaded_by_name ?? "admin",
      })),
    );
  });

  // E12: POST /api/incidents/:id/attachments/
  app.post("/api/incidents/:id/attachments/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const existing = await getFullIncident(id);
    if (!existing) {
      return c.json({ detail: "No Incident matches the given query." }, 404);
    }

    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("file") as File | null;
    const fileName = file?.name || "attachment.bin";

    const inserted = await db
      .insert(coreIncidentAttachment)
      .values({
        incident_id: id,
        file: `/media/attachments/${id}/${fileName}`,
        file_name: fileName,
        uploaded_at: new Date(),
        uploaded_by_id: 1,
      })
      .returning();

    return c.json(
      inserted.map((a) => ({
        id: a.id,
        incident_id: a.incident_id,
        file: a.file,
        file_name: a.file_name,
        original_name: a.file_name,
        file_size: 1024,
        content_type: "application/octet-stream",
        uploaded_at: a.uploaded_at.toISOString(),
        uploaded_by: a.uploaded_by_id,
        uploaded_by_name: "admin",
      })),
      201,
    );
  });

  // E13: POST /api/incidents/:id/notify/
  app.post("/api/incidents/:id/notify/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const existing = await getFullIncident(id);
    if (!existing) {
      return c.json({ detail: "No Incident matches the given query." }, 404);
    }

    const recipients = await db
      .select()
      .from(coreIncidentRecipient)
      .where(eq(coreIncidentRecipient.is_active, true));

    if (recipients.length === 0) {
      return c.json(
        {
          detail:
            "No hay destinatarios activos configurados para enviar la notificación.",
        },
        400,
      );
    }

    // Record notification in history
    await db.insert(coreIncidentHistory).values({
      incident_id: id,
      event_type: "notified",
      changed_at: new Date(),
      actor: "admin",
      changed_by_id: 1,
      description: `Notificado a ${recipients.length} destinatarios`,
      recipients_snapshot: recipients.map((r) => r.email),
    });

    const full = await getFullIncident(id);
    return c.json(full, 200);
  });

  // E14: GET /api/incident-recipients/
  app.get("/api/incident-recipients/", async (c) => {
    const recipients = await db
      .select()
      .from(coreIncidentRecipient)
      .orderBy(desc(coreIncidentRecipient.id));

    return c.json({
      count: recipients.length,
      next: null,
      previous: null,
      results: recipients.map((r) => ({
        id: r.id,
        email: r.email,
        label: r.label,
        is_active: r.is_active,
        created_at: r.created_at.toISOString(),
      })),
    });
  });

  // E15: POST /api/incident-recipients/
  app.post("/api/incident-recipients/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PimsIncidentRecipientCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatDrfErrors(parsed.error), 400);
    }

    const existingEmail = await db
      .select()
      .from(coreIncidentRecipient)
      .where(eq(coreIncidentRecipient.email, String(body.email)));
    if (existingEmail.length > 0) {
      return c.json(
        { email: ["Ya existe un destinatario con este correo."] },
        400,
      );
    }

    const now = new Date();
    const inserted = await db
      .insert(coreIncidentRecipient)
      .values({
        email: String(body.email),
        label: String(body.label),
        is_active:
          body.is_active !== undefined ? Boolean(body.is_active) : true,
        created_at: now,
      })
      .returning();

    const r = inserted[0];
    if (!r) {
      return c.json({ detail: "Error creando destinatario" }, 500);
    }
    return c.json(
      {
        id: r.id,
        email: r.email,
        label: r.label,
        is_active: r.is_active,
        created_at: r.created_at.toISOString(),
      },
      201,
    );
  });

  // E16: DELETE /api/incident-recipients/:id/
  app.delete("/api/incident-recipients/:id/", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const existing = await db
      .select()
      .from(coreIncidentRecipient)
      .where(eq(coreIncidentRecipient.id, id));
    if (existing.length === 0) {
      return c.json(
        { detail: "No IncidentRecipient matches the given query." },
        404,
      );
    }
    await db
      .delete(coreIncidentRecipient)
      .where(eq(coreIncidentRecipient.id, id));
    return c.body(null, 204);
  });

  // E17: GET /api/audits/
  app.get("/api/audits/", async (c) => {
    const audits = await db
      .select()
      .from(coreAudit)
      .where(eq(coreAudit.is_deleted, false))
      .orderBy(desc(coreAudit.id));

    const results = await Promise.all(
      audits.map(async (a) => {
        const findings = await db
          .select()
          .from(coreAuditFinding)
          .where(eq(coreAuditFinding.audit_id, a.id));

        return {
          id: a.id,
          code: a.audit_code,
          audit_code: a.audit_code,
          name: a.name,
          audit_type: a.audit_type,
          status: a.status,
          start_date: a.start_date,
          end_date: a.end_date,
          scope: a.scope,
          lead_auditor: a.lead_auditor,
          findings: findings.map((f) => ({
            id: f.id,
            classification: f.classification,
            description: f.description,
            evidence: f.evidence,
          })),
          created_at: a.created_at.toISOString(),
          created_by: a.created_by_id,
          updated_at: a.updated_at.toISOString(),
          updated_by: a.updated_by_id,
          is_deleted: a.is_deleted,
          deleted_at: a.deleted_at ? a.deleted_at.toISOString() : null,
          deleted_by: a.deleted_by_id,
        };
      }),
    );

    return c.json({
      count: results.length,
      next: null,
      previous: null,
      results,
    });
  });

  // E18: POST /api/audits/
  app.post("/api/audits/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PimsAuditCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatDrfErrors(parsed.error), 400);
    }

    const countRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coreAudit);
    const nextNum = (countRes[0]?.count ?? 0) + 1;
    const year = new Date().getFullYear();
    const auditCode =
      parsed.data.audit_code ||
      parsed.data.code ||
      `AUD-${year}-${String(nextNum).padStart(3, "0")}`;

    const now = new Date();
    const inserted = await db
      .insert(coreAudit)
      .values({
        audit_code: auditCode,
        name: parsed.data.name,
        audit_type: parsed.data.audit_type,
        status: parsed.data.status,
        start_date: parsed.data.start_date ?? null,
        end_date: parsed.data.end_date ?? null,
        scope: parsed.data.scope ?? null,
        lead_auditor: parsed.data.lead_auditor ?? null,
        audit_team: null,
        involved_areas: null,
        progress: 0,
        created_at: now,
        updated_at: now,
        created_by_id: 1,
        updated_by_id: 1,
        is_deleted: false,
      })
      .returning();

    const newAudit = inserted[0];
    if (!newAudit) {
      return c.json({ detail: "Error creando auditoría" }, 500);
    }
    return c.json(
      {
        id: newAudit.id,
        code: newAudit.audit_code,
        audit_code: newAudit.audit_code,
        name: newAudit.name,
        audit_type: newAudit.audit_type,
        status: newAudit.status,
        start_date: newAudit.start_date,
        end_date: newAudit.end_date,
        scope: newAudit.scope,
        lead_auditor: newAudit.lead_auditor,
        findings: [],
        created_at: newAudit.created_at.toISOString(),
        created_by: newAudit.created_by_id,
        updated_at: newAudit.updated_at.toISOString(),
        updated_by: newAudit.updated_by_id,
        is_deleted: newAudit.is_deleted,
        deleted_at: null,
        deleted_by: null,
      },
      201,
    );
  });

  // E19: PATCH /api/audits/:id/
  app.patch("/api/audits/:id/", async (c) => {
    const rawId = c.req.param("id");
    const id = Number.parseInt(rawId, 10);
    if (Number.isNaN(id)) {
      return c.json({ detail: "No Audit matches the given query." }, 404);
    }
    const audits = await db
      .select()
      .from(coreAudit)
      .where(and(eq(coreAudit.id, id), eq(coreAudit.is_deleted, false)));
    const audit = audits[0];
    if (!audit) {
      return c.json({ detail: "No Audit matches the given query." }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = PimsAuditUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatDrfErrors(parsed.error), 400);
    }

    if (Array.isArray(parsed.data.findings)) {
      if (nestedAuditMode === "replace") {
        await db
          .delete(coreAuditFinding)
          .where(eq(coreAuditFinding.audit_id, id));
      }
      for (let i = 0; i < parsed.data.findings.length; i++) {
        const f = parsed.data.findings[i];
        if (!f) continue;
        const insertedF = await db
          .insert(coreAuditFinding)
          .values({
            audit_id: id,
            classification: f.classification,
            description: f.description,
            evidence: f.evidence ? String(f.evidence) : null,
            position: i + 1,
          })
          .returning();

        const findingId = insertedF[0]?.id;
        if (findingId && Array.isArray(f.actions)) {
          for (let j = 0; j < f.actions.length; j++) {
            const a = f.actions[j];
            if (!a) continue;
            await db.insert(coreAuditActionPlan).values({
              finding_id: findingId,
              action_plan: String(a.description || a.action_plan || ""),
              responsible: a.responsible,
              due_date: a.due_date,
              status: a.status,
              progress: a.progress ?? 0,
              position: j + 1,
            });
          }
        }
      }
    }

    const findings = await db
      .select()
      .from(coreAuditFinding)
      .where(eq(coreAuditFinding.audit_id, id));

    return c.json({
      id: audit.id,
      code: audit.audit_code,
      audit_code: audit.audit_code,
      name: audit.name,
      audit_type: audit.audit_type,
      status: audit.status,
      start_date: audit.start_date,
      end_date: audit.end_date,
      scope: audit.scope,
      lead_auditor: audit.lead_auditor,
      findings: findings.map((f) => ({
        id: f.id,
        classification: f.classification,
        description: f.description,
        evidence: f.evidence,
      })),
      created_at: audit.created_at.toISOString(),
      created_by: audit.created_by_id,
      updated_at: audit.updated_at.toISOString(),
      updated_by: audit.updated_by_id,
      is_deleted: audit.is_deleted,
      deleted_at: null,
      deleted_by: null,
    });
  });

  // E20: GET /api/risk-evaluations/
  app.get("/api/risk-evaluations/", async (c) => {
    const risks = await db
      .select()
      .from(coreRiskEvaluation)
      .where(eq(coreRiskEvaluation.is_deleted, false))
      .orderBy(desc(coreRiskEvaluation.id));

    return c.json({
      count: risks.length,
      next: null,
      previous: null,
      results: risks.map((r) => ({
        id: r.id,
        code: r.risk_code,
        name: r.description || "Evaluación de Riesgo",
        status: r.status,
        risk_period: r.period_id,
        scope: null,
        created_at: r.created_at.toISOString(),
        created_by: r.created_by_id,
        updated_at: r.updated_at.toISOString(),
        updated_by: r.updated_by_id,
        is_deleted: r.is_deleted,
        deleted_at: null,
        deleted_by: null,
      })),
    });
  });

  // E21: POST /api/risk-evaluations/
  app.post("/api/risk-evaluations/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!Array.isArray(body.assets) || body.assets.length === 0) {
      return c.json({ assets: ["Este campo es requerido."] }, 400);
    }

    const parsed = PimsRiskEvaluationCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatDrfErrors(parsed.error), 400);
    }

    if (!body.description) {
      return c.json({ description: ["Este campo es requerido."] }, 400);
    }

    const periods = await db
      .select()
      .from(coreRiskPeriod)
      .where(eq(coreRiskPeriod.is_active, true));
    const activePeriod = periods[0];
    if (!activePeriod) {
      return c.json({ detail: "No hay un periodo de riesgo activo." }, 400);
    }

    const lastRisks = await db
      .select({ risk_code: coreRiskEvaluation.risk_code })
      .from(coreRiskEvaluation)
      .orderBy(desc(coreRiskEvaluation.id))
      .limit(1);

    let nextNum = 1;
    if (lastRisks[0]?.risk_code) {
      const m = lastRisks[0].risk_code.match(/R-(\d+)/);
      if (m?.[1]) {
        nextNum = Number.parseInt(m[1], 10) + 1;
      }
    }
    const riskCode = `R-${String(nextNum).padStart(3, "0")}`;

    const now = new Date();
    const inserted = await db
      .insert(coreRiskEvaluation)
      .values({
        risk_code: riskCode,
        risk_owner: parsed.data.risk_owner ?? "TI",
        threat: parsed.data.threat ?? null,
        vulnerability: parsed.data.vulnerability ?? null,
        description: parsed.data.description ?? "Evaluación de riesgo",
        controlled_probability: parsed.data.controlled_probability ?? 3,
        controlled_impact: parsed.data.controlled_impact ?? 3,
        controlled_score: String(
          (parsed.data.controlled_probability ?? 3) *
            (parsed.data.controlled_impact ?? 3),
        ),
        controlled_severity: "M",
        threat_code: parsed.data.threat_code ?? null,
        vulnerability_code: parsed.data.vulnerability_code ?? null,
        response_strategy: parsed.data.response_strategy ?? "M",
        status: parsed.data.status ?? "B",
        period_id: activePeriod.id,
        created_at: now,
        updated_at: now,
        is_deleted: false,
        created_by_id: 1,
        updated_by_id: 1,
      })
      .returning();

    const newRisk = inserted[0];
    if (!newRisk) {
      return c.json({ detail: "Error creando evaluación de riesgo" }, 500);
    }

    for (const item of body.assets) {
      const assetId = typeof item === "number" ? item : item.asset;
      if (assetId) {
        await db
          .insert(coreRiskEvaluationAsset)
          .values({
            evaluation_id: newRisk.id,
            asset_id: assetId,
          })
          .onConflictDoNothing();
      }
    }

    return c.json(
      {
        id: newRisk.id,
        code: newRisk.risk_code,
        name: newRisk.description || "Evaluación de Riesgo",
        status: newRisk.status,
        risk_period: newRisk.period_id,
        scope: null,
        created_at: newRisk.created_at.toISOString(),
        created_by: newRisk.created_by_id,
        updated_at: newRisk.updated_at.toISOString(),
        updated_by: newRisk.updated_by_id,
        is_deleted: newRisk.is_deleted,
        deleted_at: null,
        deleted_by: null,
      },
      201,
    );
  });

  // E22: GET /api/risk-evaluations/catalogs/
  app.get("/api/risk-evaluations/catalogs/", (c) => {
    return c.json(riskCatalogs);
  });

  // E23: GET /api/risk-evaluations/eligible-assets/
  app.get("/api/risk-evaluations/eligible-assets/", async (c) => {
    const assets = await db
      .select()
      .from(coreAsset)
      .where(eq(coreAsset.is_deleted, false));

    return c.json({
      count: assets.length,
      next: null,
      previous: null,
      results: assets.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        description: a.description,
        relevance: a.relevance,
      })),
    });
  });

  // E24: GET /api/assets/
  app.get("/api/assets/", async (c) => {
    const assets = await db
      .select()
      .from(coreAsset)
      .where(eq(coreAsset.is_deleted, false));

    return c.json({
      count: assets.length,
      next: null,
      previous: null,
      results: assets.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        description: a.description,
        owner: a.owner,
        custodians: a.custodians,
        location: a.location,
        is_data_asset: a.is_data_asset,
        category: a.category,
        classification: a.classification,
        usage_frequency: a.usage_frequency,
        confidentiality: a.confidentiality,
        integrity: a.integrity,
        availability: a.availability,
        relevance: a.relevance,
        created_at: a.created_at.toISOString(),
        created_by: 1,
        updated_at: a.updated_at.toISOString(),
        updated_by: 1,
        is_deleted: a.is_deleted,
        deleted_at: null,
        deleted_by: null,
      })),
    });
  });

  // E25: GET /api/dashboard/
  app.get("/api/dashboard/", (c) => {
    return c.json(dashboardKpis);
  });

  // E26: GET /api/annex-a-controls/meta/
  app.get("/api/annex-a-controls/meta/", (c) => {
    return c.json(annexMeta);
  });

  return app;
}

export async function createPimsTestServer(
  dbClient: MockDatabaseClient,
  options?: PimsServerOptions,
): Promise<PimsTestServerInstance> {
  const app = buildPimsApp(dbClient, options);
  const port = options?.port ?? 0;

  return new Promise((resolve) => {
    const server = serve(
      {
        fetch: app.fetch,
        port,
      },
      (info) => {
        const serverUrl = `http://localhost:${info.port}`;
        resolve({
          port: info.port,
          url: serverUrl,
          stop: async () => {
            await new Promise<void>((res, rej) => {
              server.close((err) => (err ? rej(err) : res()));
            });
          },
        });
      },
    );
  });
}
