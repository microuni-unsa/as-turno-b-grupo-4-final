import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import type { SqlClient } from "@/testing/pims-server/db.ts";

export interface PimsServerOptions {
  port?: number;
  nestedActionMode?: "replace" | "merge";
}

export interface PimsTestServerInstance {
  port: number;
  url: string;
  server: unknown;
  stop: () => Promise<void>;
}

interface IncidentRow {
  id: number;
  incident_code: string;
  rep_document_number: string | null;
  rep_document_expiry: string | null;
  rep_first_name: string | null;
  rep_last_name_p: string | null;
  rep_last_name_m: string | null;
  rep_position: string | null;
  rep_phone: string | null;
  rep_email: string | null;
  entity_type: string | null;
  entity_ruc: string | null;
  entity_name: string | null;
  entity_phone: string | null;
  entity_extension: string | null;
  entity_department: string | null;
  entity_province: string | null;
  entity_district: string | null;
  involves_personal_data: boolean;
  incident_date: string;
  incident_time: string | null;
  detection_date: string | null;
  detection_time: string | null;
  incident_type: string;
  status: string;
  severity: string | null;
  impact: string | null;
  title: string;
  description: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  affected_treatment: string | null;
  dpo_contact_name: string | null;
  dpo_contact_email: string | null;
  dpo_contact_phone: string | null;
  affected_data_types: unknown;
  num_affected_subjects: number | null;
  compromised_system: string | null;
  affected_url: string | null;
  evidence_refs: string | null;
  measure_updated_registry: boolean | null;
  measure_new_security: boolean | null;
  measure_improved_policies: boolean | null;
  measure_considered_resolved: boolean | null;
  measure_reported_authorities: boolean | null;
  security_measures_adopted: unknown;
  resolved_date: string | null;
  affected_cid: unknown;
  created_at: string;
  created_by_id: number | null;
  updated_at: string;
  updated_by_id: number | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by_id: number | null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7).trim();
}

/**
 * Creates and starts a reverse-engineered PIMS test API server backed by PostgreSQL.
 */
export async function createPimsTestServer(
  sql: SqlClient,
  options?: PimsServerOptions,
): Promise<PimsTestServerInstance> {
  const port = options?.port ?? 0;
  const nestedActionMode = options?.nestedActionMode ?? "replace";

  // Pre-load catalogs and meta if available on disk
  const docsPath = path.resolve(process.cwd(), "docs/incident-agent-capture");
  const fallbackDocsPath =
    "/home/cricro/temp/pims-final/docs/incident-agent-capture";
  const captureDir = fs.existsSync(docsPath) ? docsPath : fallbackDocsPath;

  const readCaptureJson = (filename: string): unknown | null => {
    const fullPath = path.join(captureDir, filename);
    if (fs.existsSync(fullPath)) {
      try {
        return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      } catch {
        return null;
      }
    }
    return null;
  };

  const cachedRiskCatalogs = readCaptureJson("35-risk-catalogs.json");
  const cachedDashboard = readCaptureJson("08-dashboard.json");
  const cachedAnnexMeta = readCaptureJson("32-annex-meta.json");

  // Helper to query full incident with all 57 keys
  const getFullIncident = async (
    incidentId: number,
  ): Promise<unknown | null> => {
    const incidents = await sql<IncidentRow[]>`
      SELECT * FROM core_incident WHERE id = ${incidentId} AND is_deleted = false
    `;
    const inc = incidents[0];
    if (!inc) {
      return null;
    }

    const actions = await sql`
      SELECT id, action_type, responsible, action_date, description, evidence, "position"
      FROM core_incidentaction
      WHERE incident_id = ${incidentId}
      ORDER BY "position" ASC, id ASC
    `;

    const attachments = await sql`
      SELECT a.id, a.file, a.file_name, a.uploaded_at, a.uploaded_by_id AS uploaded_by, u.username AS uploaded_by_name
      FROM core_incidentattachment a
      LEFT JOIN auth_user u ON u.id = a.uploaded_by_id
      WHERE a.incident_id = ${incidentId}
      ORDER BY a.uploaded_at DESC
    `;

    const historyRows = await sql`
      SELECT h.id, h.event_type, h.changed_at, h.actor, h.changed_by_id AS changed_by, u.username AS changed_by_name, h.description, h.recipients_snapshot
      FROM core_incidenthistory h
      LEFT JOIN auth_user u ON u.id = h.changed_by_id
      WHERE h.incident_id = ${incidentId}
      ORDER BY h.changed_at DESC, h.id DESC
    `;

    const getEventLabel = (et: string): string => {
      const map: Record<string, string> = {
        created: "Creado",
        updated: "Actualizado",
        notified: "Notificado",
        closed: "Cerrado",
        reopened: "Reabierto",
      };
      return map[et] ?? et;
    };

    const history = historyRows.map((h) => {
      let snap = null;
      if (h.recipients_snapshot) {
        try {
          snap =
            typeof h.recipients_snapshot === "string"
              ? JSON.parse(h.recipients_snapshot)
              : h.recipients_snapshot;
        } catch {
          snap = null;
        }
      }
      return {
        id: h.id,
        event_type: h.event_type,
        event_type_label: getEventLabel(h.event_type as string),
        changed_at: h.changed_at,
        actor: h.actor,
        changed_by: h.changed_by,
        changed_by_name: h.changed_by_name,
        description: h.description,
        recipients_snapshot: snap,
      };
    });

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
      actions,
      attachments,
      history,
      attachments_count: attachments.length,
      actions_count: actions.length,
      created_at: inc.created_at,
      created_by: inc.created_by_id,
      updated_at: inc.updated_at,
      updated_by: inc.updated_by_id,
    };
  };

  const handleFetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathName = url.pathname;
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") {
      return emptyResponse(204);
    }

    // Check for X-Simulate-Error header hook
    const simError = req.headers.get("X-Simulate-Error");
    if (simError) {
      const code = Number.parseInt(simError, 10);
      if (code === 400) {
        return jsonResponse({ detail: "Simulated Bad Request" }, 400);
      }
      if (code === 401) {
        return jsonResponse(
          { detail: "Las credenciales de autenticación no se proveyeron." },
          401,
        );
      }
      if (code === 403) {
        return jsonResponse(
          { detail: "Usted no tiene permiso para realizar esta acción." },
          403,
        );
      }
      if (code === 404) {
        return jsonResponse(
          { detail: "No resource matches the given query." },
          404,
        );
      }
      if (code === 429) {
        return jsonResponse(
          {
            detail:
              "Demasiados intentos. Por favor espere antes de intentar de nuevo.",
          },
          429,
        );
      }
      if (code === 500) {
        return jsonResponse({ detail: "Error interno del servidor." }, 500);
      }
      return jsonResponse({ detail: `Simulated error ${code}` }, code);
    }

    // E01: POST /business/login/
    if (pathName === "/business/login/" && method === "POST") {
      let body: { username?: string; password?: string } = {};
      try {
        body = (await req.json()) as {
          username?: string;
          password?: string;
        };
      } catch {
        return jsonResponse({ detail: "Cuerpo de solicitud inválido." }, 400);
      }

      const { username, password } = body;
      if (!username || !password) {
        return jsonResponse(
          { detail: "Las credenciales proporcionadas no son válidas." },
          400,
        );
      }

      const users = await sql`
          SELECT id, username, is_superuser, is_staff, is_active
          FROM auth_user
          WHERE username = ${username} AND is_active = true
        `;
      const user = users[0];

      // Match admin or existing DB user
      if (!user && username !== "admin") {
        return jsonResponse(
          {
            detail:
              "No se encontró ninguna cuenta activa con las credenciales dadas",
          },
          401,
        );
      }

      const userId = user ? user.id : 1;
      const userProfiles = await sql`
          SELECT is_platform_admin, must_change_password
          FROM core_userprofile
          WHERE user_id = ${userId}
        `;
      const profile = userProfiles[0];

      const permissions = [
        "add_incident",
        "change_incident",
        "delete_incident",
        "view_incident",
        "add_audit",
        "change_audit",
        "view_audit",
        "add_riskevaluation",
        "view_riskevaluation",
        "view_asset",
        "view_gaprequirement",
      ];

      const accessToken = `test_access_token_${userId}_${Date.now()}`;
      const refreshToken = `test_refresh_token_${userId}_${Date.now()}`;

      return jsonResponse({
        access: accessToken,
        refresh: refreshToken,
        user: {
          id: userId,
          username: username,
          is_platform_admin: profile?.is_platform_admin ?? true,
          platform_role: "admin",
          must_change_password: profile?.must_change_password ?? false,
          permissions,
        },
      });
    }

    // E02: POST /business/token/refresh/
    if (pathName === "/business/token/refresh/" && method === "POST") {
      let body: { refresh?: string } = {};
      try {
        body = (await req.json()) as { refresh?: string };
      } catch {
        return jsonResponse(
          { detail: "Token de actualización requerido." },
          400,
        );
      }
      if (!body.refresh) {
        return jsonResponse(
          { detail: "Token no válido o expirado", code: "token_not_valid" },
          401,
        );
      }
      return jsonResponse({
        access: `refreshed_access_token_${Date.now()}`,
      });
    }

    // E03: GET /business/info/
    if (pathName === "/business/info/" && method === "GET") {
      return jsonResponse({ name: "UNSA" });
    }

    // Protected endpoints require Authorization header
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse(
        { detail: "Las credenciales de autenticación no se proveyeron." },
        401,
      );
    }

    // E04: GET /business/profile/
    if (pathName === "/business/profile/" && method === "GET") {
      const users = await sql`
          SELECT username, first_name, last_name, email FROM auth_user WHERE id = 1
        `;
      const user = users[0];
      return jsonResponse({
        username: user?.username ?? "admin",
        first_name: user?.first_name ?? "Admin",
        last_name: user?.last_name ?? "UNSA",
        email: user?.email ?? "admin@unsa.pe",
        is_platform_admin: true,
        is_external_advisor: false,
        platform_role: "admin",
      });
    }

    // E05: GET /api/incidents/
    if (pathName === "/api/incidents/" && method === "GET") {
      const statusFilter = url.searchParams.get("status");
      const severityFilter = url.searchParams.get("severity");
      const typeFilter = url.searchParams.get("incident_type");
      const search = url.searchParams.get("search");

      const queryResults = await sql<IncidentRow[]>`
          SELECT * FROM core_incident WHERE is_deleted = false ORDER BY id DESC
        `;
      let incidents: IncidentRow[] = [...queryResults];

      if (statusFilter) {
        incidents = incidents.filter((i) => i.status === statusFilter);
      }
      if (severityFilter) {
        incidents = incidents.filter((i) => i.severity === severityFilter);
      }
      if (typeFilter) {
        incidents = incidents.filter((i) => i.incident_type === typeFilter);
      }
      if (search) {
        const s = search.toLowerCase();
        incidents = incidents.filter(
          (i) =>
            i.title?.toLowerCase().includes(s) ||
            i.incident_code?.toLowerCase().includes(s) ||
            i.description?.toLowerCase().includes(s),
        );
      }

      const results = incidents.map((inc) => ({
        id: inc.id,
        incident_code: inc.incident_code,
        title: inc.title,
        status: inc.status,
        severity: inc.severity,
        impact: inc.impact,
        incident_type: inc.incident_type,
        incident_date: inc.incident_date,
        reported_by: inc.reported_by,
        assigned_to: inc.assigned_to,
        created_at: inc.created_at,
        updated_at: inc.updated_at,
      }));

      return jsonResponse({
        count: results.length,
        next: null,
        previous: null,
        results,
      });
    }

    // E06: POST /api/incidents/
    if (pathName === "/api/incidents/" && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ detail: "JSON inválido" }, 400);
      }

      const errors: Record<string, string[]> = {};
      if (!body.title) errors.title = ["Este campo es requerido."];
      if (body.involves_personal_data === undefined)
        errors.involves_personal_data = ["Este campo es requerido."];
      if (!body.incident_date)
        errors.incident_date = ["Este campo es requerido."];
      if (!body.incident_type)
        errors.incident_type = ["Este campo es requerido."];
      if (!body.status) errors.status = ["Este campo es requerido."];

      if (Object.keys(errors).length > 0) {
        return jsonResponse(errors, 400);
      }

      // Generate next incident code INC-###
      const lastRows = await sql`
          SELECT incident_code FROM core_incident ORDER BY id DESC LIMIT 1
        `;
      let nextNum = 1;
      if (lastRows[0]?.incident_code) {
        const match = lastRows[0].incident_code.match(/INC-(\d+)/);
        if (match?.[1]) {
          nextNum = Number.parseInt(match[1], 10) + 1;
        }
      }
      const incidentCode = `INC-${String(nextNum).padStart(3, "0")}`;

      const affectedDataTypes = Array.isArray(body.affected_data_types)
        ? body.affected_data_types
        : [];
      const securityMeasures = Array.isArray(body.security_measures_adopted)
        ? body.security_measures_adopted
        : [];
      const affectedCid = Array.isArray(body.affected_cid)
        ? body.affected_cid
        : [];

      const inserted = await sql`
          INSERT INTO core_incident (
            incident_code, title, involves_personal_data, incident_date, incident_type, status,
            description, severity, impact, reported_by, assigned_to, affected_treatment,
            dpo_contact_name, dpo_contact_email, dpo_contact_phone,
            compromised_system, affected_url, evidence_refs,
            affected_data_types, security_measures_adopted, affected_cid,
            created_at, updated_at, is_deleted, created_by_id, updated_by_id
          ) VALUES (
            ${incidentCode}, ${String(body.title)}, ${Boolean(body.involves_personal_data)},
            ${String(body.incident_date)}, ${String(body.incident_type)}, ${String(body.status)},
            ${body.description ? String(body.description) : null},
            ${body.severity ? String(body.severity) : "M"},
            ${body.impact ? String(body.impact) : "M"},
            ${body.reported_by ? String(body.reported_by) : null},
            ${body.assigned_to ? String(body.assigned_to) : null},
            ${body.affected_treatment ? String(body.affected_treatment) : null},
            ${body.dpo_contact_name ? String(body.dpo_contact_name) : null},
            ${body.dpo_contact_email ? String(body.dpo_contact_email) : null},
            ${body.dpo_contact_phone ? String(body.dpo_contact_phone) : null},
            ${body.compromised_system ? String(body.compromised_system) : null},
            ${body.affected_url ? String(body.affected_url) : null},
            ${body.evidence_refs ? String(body.evidence_refs) : null},
            ${JSON.stringify(affectedDataTypes)}::jsonb,
            ${JSON.stringify(securityMeasures)}::jsonb,
            ${JSON.stringify(affectedCid)}::jsonb,
            NOW(), NOW(), false, 1, 1
          ) RETURNING id
        `;

      const newId = inserted[0]?.id as number;

      // Insert created history event
      await sql`
          INSERT INTO core_incidenthistory (
            event_type, changed_at, actor, changed_by_id, description, incident_id
          ) VALUES (
            'created', NOW(), 'admin', 1, 'Incidente creado', ${newId}
          )
        `;

      const fullIncident = await getFullIncident(newId);
      return jsonResponse(fullIncident, 201);
    }

    // Incident sub-routes: /api/incidents/:id/...
    const incidentMatch = pathName.match(/^\/api\/incidents\/(\d+)\/?(.*)$/);
    if (incidentMatch && incidentMatch[1] !== undefined) {
      const incidentId = Number.parseInt(incidentMatch[1], 10);
      const subRoute = (incidentMatch[2] ?? "").replace(/\/$/, "");

      // E07: GET /api/incidents/:id/
      if (subRoute === "" && method === "GET") {
        const fullIncident = await getFullIncident(incidentId);
        if (!fullIncident) {
          return jsonResponse(
            { detail: "No Incident matches the given query." },
            404,
          );
        }
        return jsonResponse(fullIncident);
      }

      // E08: PATCH /api/incidents/:id/
      if (subRoute === "" && method === "PATCH") {
        const existing = await sql`
            SELECT id FROM core_incident WHERE id = ${incidentId} AND is_deleted = false
          `;
        if (existing.length === 0) {
          return jsonResponse(
            { detail: "No Incident matches the given query." },
            404,
          );
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ detail: "JSON inválido" }, 400);
        }

        // Handle nested actions
        if (Array.isArray(body.actions)) {
          if (nestedActionMode === "replace") {
            await sql`
                DELETE FROM core_incidentaction WHERE incident_id = ${incidentId}
              `;
          }
          for (let idx = 0; idx < body.actions.length; idx++) {
            const act = body.actions[idx] as Record<string, unknown>;
            await sql`
                INSERT INTO core_incidentaction (
                  action_type, responsible, action_date, description, evidence, "position", incident_id
                ) VALUES (
                  ${String(act.action_type ?? "C")},
                  ${String(act.responsible ?? "admin")},
                  ${String(act.action_date ?? new Date().toISOString().slice(0, 10))},
                  ${String(act.description ?? "")},
                  ${act.evidence ? String(act.evidence) : null},
                  ${idx + 1},
                  ${incidentId}
                )
              `;
          }
        }

        // Dynamic column update
        const fields: string[] = ["updated_at = NOW()", "updated_by_id = 1"];
        if (body.title !== undefined)
          fields.push(`title = '${String(body.title).replace(/'/g, "''")}'`);
        if (body.status !== undefined)
          fields.push(`status = '${String(body.status)}'`);
        if (body.severity !== undefined)
          fields.push(`severity = '${String(body.severity)}'`);
        if (body.impact !== undefined)
          fields.push(`impact = '${String(body.impact)}'`);
        if (body.description !== undefined)
          fields.push(
            `description = '${String(body.description).replace(/'/g, "''")}'`,
          );
        if (body.assigned_to !== undefined)
          fields.push(
            `assigned_to = '${String(body.assigned_to).replace(/'/g, "''")}'`,
          );
        if (body.reported_by !== undefined)
          fields.push(
            `reported_by = '${String(body.reported_by).replace(/'/g, "''")}'`,
          );
        if (body.affected_treatment !== undefined)
          fields.push(
            `affected_treatment = '${String(body.affected_treatment).replace(/'/g, "''")}'`,
          );
        if (body.resolved_date !== undefined)
          fields.push(
            body.resolved_date
              ? `resolved_date = '${String(body.resolved_date)}'`
              : "resolved_date = NULL",
          );
        if (body.measure_reported_authorities !== undefined)
          fields.push(
            `measure_reported_authorities = ${Boolean(body.measure_reported_authorities)}`,
          );
        if (body.affected_data_types !== undefined)
          fields.push(
            `affected_data_types = '${JSON.stringify(body.affected_data_types)}'::jsonb`,
          );
        if (body.security_measures_adopted !== undefined)
          fields.push(
            `security_measures_adopted = '${JSON.stringify(body.security_measures_adopted)}'::jsonb`,
          );
        if (body.affected_cid !== undefined)
          fields.push(
            `affected_cid = '${JSON.stringify(body.affected_cid)}'::jsonb`,
          );

        const updateQuery = `UPDATE core_incident SET ${fields.join(", ")} WHERE id = ${incidentId}`;
        await sql.unsafe(updateQuery);

        // Append updated history record
        await sql`
            INSERT INTO core_incidenthistory (
              event_type, changed_at, actor, changed_by_id, description, incident_id
            ) VALUES (
              'updated', NOW(), 'admin', 1, 'Incidente actualizado', ${incidentId}
            )
          `;

        const updatedIncident = await getFullIncident(incidentId);
        return jsonResponse(updatedIncident);
      }

      // E09: DELETE /api/incidents/:id/
      if (subRoute === "" && method === "DELETE") {
        const existing = await sql`
            SELECT id FROM core_incident WHERE id = ${incidentId} AND is_deleted = false
          `;
        if (existing.length === 0) {
          return jsonResponse(
            { detail: "No Incident matches the given query." },
            404,
          );
        }

        await sql`
            UPDATE core_incident
            SET is_deleted = true, deleted_at = NOW(), deleted_by_id = 1
            WHERE id = ${incidentId}
          `;
        return emptyResponse(204);
      }

      // E10: GET /api/incidents/:id/history/
      if (subRoute === "history" && method === "GET") {
        const historyRows = await sql`
            SELECT h.id, h.event_type, h.changed_at, h.actor,
                   h.changed_by_id AS changed_by, u.username AS changed_by_name,
                   h.description, h.recipients_snapshot
            FROM core_incidenthistory h
            LEFT JOIN auth_user u ON u.id = h.changed_by_id
            WHERE h.incident_id = ${incidentId}
            ORDER BY h.changed_at DESC, h.id DESC
          `;

        const getEventLabel = (et: string): string => {
          const map: Record<string, string> = {
            created: "Creado",
            updated: "Actualizado",
            notified: "Notificado",
            closed: "Cerrado",
            reopened: "Reabierto",
          };
          return map[et] ?? et;
        };

        const history = historyRows.map((h) => {
          let snap = null;
          if (h.recipients_snapshot) {
            try {
              snap =
                typeof h.recipients_snapshot === "string"
                  ? JSON.parse(h.recipients_snapshot)
                  : h.recipients_snapshot;
            } catch {
              snap = null;
            }
          }
          return {
            id: h.id,
            event_type: h.event_type,
            event_type_label: getEventLabel(h.event_type as string),
            changed_at: h.changed_at,
            actor: h.actor,
            changed_by: h.changed_by,
            changed_by_name: h.changed_by_name,
            description: h.description,
            recipients_snapshot: snap,
          };
        });
        return jsonResponse(history);
      }

      // E11: GET /api/incidents/:id/attachments/
      if (subRoute === "attachments" && method === "GET") {
        const attachments = await sql`
            SELECT a.id, a.file, a.file_name, a.uploaded_at,
                   a.uploaded_by_id AS uploaded_by, u.username AS uploaded_by_name
            FROM core_incidentattachment a
            LEFT JOIN auth_user u ON u.id = a.uploaded_by_id
            WHERE a.incident_id = ${incidentId}
            ORDER BY a.uploaded_at DESC
          `;
        return jsonResponse(attachments);
      }

      // E12: POST /api/incidents/:id/attachments/
      if (subRoute === "attachments" && method === "POST") {
        let formData: FormData;
        try {
          formData = await req.formData();
        } catch {
          return jsonResponse({ file: ["Formato multipart inválido."] }, 400);
        }

        const file = formData.get("file");
        if (!file || typeof file === "string") {
          return jsonResponse({ file: ["Este campo es requerido."] }, 400);
        }

        const fileObj = file as File;
        const fileName = fileObj.name || "attachment.dat";
        const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch?.[1] ? extMatch[1].toLowerCase() : "";
        const allowedExtensions = [
          "jpg",
          "jpeg",
          "png",
          "tif",
          "bmp",
          "pdf",
          "doc",
          "docx",
          "txt",
        ];

        if (
          !allowedExtensions.includes(ext) ||
          fileObj.size > 10 * 1024 * 1024
        ) {
          return jsonResponse(
            { file: ["Tipo de archivo no permitido o tamaño excede 10MB."] },
            400,
          );
        }

        const fileUrl = `/media/tenants/unsa/incidents/${Date.now()}_${fileName}`;
        const inserted = await sql`
            INSERT INTO core_incidentattachment (
              file, file_name, uploaded_at, uploaded_by_id, incident_id
            ) VALUES (
              ${fileUrl}, ${fileName}, NOW(), 1, ${incidentId}
            ) RETURNING id, uploaded_at
          `;

        const row = inserted[0];
        return jsonResponse(
          [
            {
              id: row?.id,
              file: fileUrl,
              file_name: fileName,
              uploaded_at: row?.uploaded_at,
              uploaded_by: 1,
              uploaded_by_name: "admin",
            },
          ],
          201,
        );
      }

      // E13: POST /api/incidents/:id/notify/
      if (subRoute === "notify" && method === "POST") {
        const recipients = await sql<
          { id: number; email: string; label: string }[]
        >`
            SELECT id, email, label FROM core_incidentrecipient WHERE is_active = true
          `;
        if (recipients.length === 0) {
          return jsonResponse(
            { detail: "No hay destinatarios configurados para notificar." },
            400,
          );
        }

        const recipientsSnapshot = recipients.map((r) => ({
          email: r.email,
          label: r.label,
        }));

        await sql`
            INSERT INTO core_incidenthistory (
              event_type, changed_at, actor, changed_by_id, description, recipients_snapshot, incident_id
            ) VALUES (
              'notified', NOW(), 'admin', 1, 'Notificación enviada a destinatarios',
              ${JSON.stringify(recipientsSnapshot)}, ${incidentId}
            )
          `;

        const fullIncident = await getFullIncident(incidentId);
        return jsonResponse(fullIncident, 200);
      }
    }

    // E14: GET /api/incident-recipients/
    if (
      (pathName === "/api/incident-recipients/" && method === "POST") ||
      (pathName === "/api/incident-recipients/" && method === "GET")
    ) {
      if (method === "GET") {
        const recipients = await sql`
            SELECT id, email, label, is_active, created_at
            FROM core_incidentrecipient
            ORDER BY id ASC
          `;
        return jsonResponse({
          count: recipients.length,
          next: null,
          previous: null,
          results: recipients,
        });
      }
    }

    // E15: POST /api/incident-recipients/
    if (pathName === "/api/incident-recipients/" && method === "POST") {
      let body: { email?: string; label?: string; is_active?: boolean } = {};
      try {
        body = (await req.json()) as {
          email?: string;
          label?: string;
          is_active?: boolean;
        };
      } catch {
        return jsonResponse({ detail: "JSON inválido" }, 400);
      }

      if (!body.email) {
        return jsonResponse({ email: ["Este campo es requerido."] }, 400);
      }

      const existing = await sql`
          SELECT id FROM core_incidentrecipient WHERE email = ${body.email}
        `;
      if (existing.length > 0) {
        return jsonResponse(
          { email: ["Ya existe un destinatario con este correo."] },
          400,
        );
      }

      const inserted = await sql`
          INSERT INTO core_incidentrecipient (
            email, label, is_active, created_at
          ) VALUES (
            ${body.email}, ${body.label ?? body.email}, ${body.is_active ?? true}, NOW()
          ) RETURNING id, email, label, is_active, created_at
        `;
      return jsonResponse(inserted[0], 201);
    }

    // E16: DELETE /api/incident-recipients/:id/
    const recipientMatch = pathName.match(
      /^\/api\/incident-recipients\/(\d+)\/?$/,
    );
    if (
      recipientMatch &&
      recipientMatch[1] !== undefined &&
      method === "DELETE"
    ) {
      const recId = Number.parseInt(recipientMatch[1], 10);
      const res = await sql`
          DELETE FROM core_incidentrecipient WHERE id = ${recId} RETURNING id
        `;
      if (res.length === 0) {
        return jsonResponse(
          { detail: "No IncidentRecipient matches the given query." },
          404,
        );
      }
      return emptyResponse(204);
    }

    // E17: GET /api/audits/
    if (pathName === "/api/audits/" && method === "GET") {
      const audits = await sql`
          SELECT * FROM core_audit WHERE is_deleted = false ORDER BY id DESC
        `;
      return jsonResponse({
        count: audits.length,
        next: null,
        previous: null,
        results: audits,
      });
    }

    // E18: POST /api/audits/
    if (pathName === "/api/audits/" && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ detail: "JSON inválido" }, 400);
      }

      const countRes = await sql`SELECT COUNT(*)::int AS count FROM core_audit`;
      const nextNum = (countRes[0]?.count ?? 0) + 1;
      const currentYear = new Date().getFullYear();
      const auditCode = `AUD-${currentYear}-${String(nextNum).padStart(3, "0")}`;

      const inserted = await sql`
          INSERT INTO core_audit (
            audit_code, audit_type, name, scope, objective, start_date, end_date,
            lead_auditor, audit_team, involved_areas, status, progress,
            created_at, updated_at, is_deleted, created_by_id, updated_by_id
          ) VALUES (
            ${auditCode},
            ${String(body.audit_type ?? "INTERNAL")},
            ${String(body.name ?? "Auditoría Interna")},
            ${String(body.scope ?? "Alcance")},
            ${String(body.objective ?? "Objetivo")},
            ${String(body.start_date ?? new Date().toISOString().slice(0, 10))},
            ${String(body.end_date ?? new Date().toISOString().slice(0, 10))},
            ${String(body.lead_auditor ?? "Auditor Líder")},
            ${body.audit_team ? String(body.audit_team) : null},
            ${body.involved_areas ? String(body.involved_areas) : null},
            ${String(body.status ?? "PLANNING")},
            ${Number(body.progress ?? 0)},
            NOW(), NOW(), false, 1, 1
          ) RETURNING *
        `;
      return jsonResponse(inserted[0], 201);
    }

    // E19: PATCH /api/audits/:id/
    const auditMatch = pathName.match(/^\/api\/audits\/(\d+)\/?$/);
    if (auditMatch && auditMatch[1] !== undefined && method === "PATCH") {
      const auditId = Number.parseInt(auditMatch[1], 10);
      const audits = await sql`
          SELECT * FROM core_audit WHERE id = ${auditId} AND is_deleted = false
        `;
      if (audits.length === 0) {
        return jsonResponse(
          { detail: "No Audit matches the given query." },
          404,
        );
      }

      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ detail: "JSON inválido" }, 400);
      }

      // Handle nested findings & actions
      if (Array.isArray(body.findings)) {
        for (let fIdx = 0; fIdx < body.findings.length; fIdx++) {
          const f = body.findings[fIdx] as Record<string, unknown>;
          const findingRes = await sql`
              INSERT INTO core_auditfinding (
                classification, description, evidence, "position", audit_id
              ) VALUES (
                ${f.classification ? String(f.classification).charAt(0).toUpperCase() : "M"},
                ${String(f.description ?? "")},
                ${f.evidence ? String(f.evidence) : null},
                ${fIdx + 1},
                ${auditId}
              ) RETURNING id
            `;
          const findingId = findingRes[0]?.id as number;

          if (Array.isArray(f.actions)) {
            for (let aIdx = 0; aIdx < f.actions.length; aIdx++) {
              const a = f.actions[aIdx] as Record<string, unknown>;
              await sql`
                  INSERT INTO core_auditactionplan (
                    action_plan, responsible, due_date, status, progress, closed_at, "position", finding_id
                  ) VALUES (
                    ${String(a.action_plan ?? "")},
                    ${String(a.responsible ?? "admin")},
                    ${String(a.due_date ?? new Date().toISOString().slice(0, 10))},
                    ${a.status ? String(a.status).charAt(0).toUpperCase() : "P"},
                    ${Number(a.progress ?? 0)},
                    ${a.closed_at ? String(a.closed_at) : null},
                    ${aIdx + 1},
                    ${findingId}
                  )
                `;
            }
          }
        }
      }

      // Return updated audit
      const updated = await sql`
          SELECT * FROM core_audit WHERE id = ${auditId}
        `;
      return jsonResponse(updated[0], 200);
    }

    // E20: GET /api/risk-evaluations/
    if (pathName === "/api/risk-evaluations/" && method === "GET") {
      const risks = await sql`
          SELECT * FROM core_riskevaluation WHERE is_deleted = false ORDER BY id DESC
        `;
      return jsonResponse({
        count: risks.length,
        next: null,
        previous: null,
        results: risks,
      });
    }

    // E21: POST /api/risk-evaluations/
    if (pathName === "/api/risk-evaluations/" && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ detail: "JSON inválido" }, 400);
      }

      if (!Array.isArray(body.assets) || body.assets.length === 0) {
        return jsonResponse({ assets: ["Este campo es requerido."] }, 400);
      }

      // Active period
      const periods = await sql`
          SELECT id FROM core_riskperiod WHERE is_active = true LIMIT 1
        `;
      const activePeriod = periods[0];
      if (!activePeriod) {
        return jsonResponse(
          { detail: "No hay un periodo de riesgo activo." },
          400,
        );
      }

      // System code R-###
      const lastRisks = await sql`
          SELECT risk_code FROM core_riskevaluation ORDER BY id DESC LIMIT 1
        `;
      let nextNum = 1;
      if (lastRisks[0]?.risk_code) {
        const m = lastRisks[0].risk_code.match(/R-(\d+)/);
        if (m?.[1]) {
          nextNum = Number.parseInt(m[1], 10) + 1;
        }
      }
      const riskCode = `R-${String(nextNum).padStart(3, "0")}`;

      const inserted = await sql`
          INSERT INTO core_riskevaluation (
            risk_code, risk_owner, threat, vulnerability, description,
            controlled_probability, controlled_impact, controlled_score, controlled_severity,
            threat_code, vulnerability_code, response_strategy, status,
            period_id, created_at, updated_at, is_deleted, created_by_id, updated_by_id
          ) VALUES (
            ${riskCode},
            ${body.risk_owner ? String(body.risk_owner) : "TI"},
            ${body.threat ? String(body.threat) : "Amenaza"},
            ${body.vulnerability ? String(body.vulnerability) : "Vulnerabilidad"},
            ${String(body.description ?? "Evaluación de riesgo")},
            ${Number(body.controlled_probability ?? 3)},
            ${Number(body.controlled_impact ?? 3)},
            ${Number(body.controlled_probability ?? 3) * Number(body.controlled_impact ?? 3)},
            'M',
            ${body.threat_code ? String(body.threat_code) : null},
            ${body.vulnerability_code ? String(body.vulnerability_code) : null},
            ${body.response_strategy ? String(body.response_strategy).charAt(0).toUpperCase() : "M"},
            ${body.status ? String(body.status).charAt(0).toUpperCase() : "B"},
            ${activePeriod.id},
            NOW(), NOW(), false, 1, 1
          ) RETURNING *
        `;

      const newRisk = inserted[0];
      if (newRisk) {
        for (const item of body.assets) {
          const assetObj = item as { asset?: number };
          if (assetObj.asset) {
            await sql`
                INSERT INTO core_riskevaluationasset (asset_id, evaluation_id)
                VALUES (${assetObj.asset}, ${newRisk.id})
                ON CONFLICT DO NOTHING
              `;
          }
        }
      }

      return jsonResponse(newRisk, 201);
    }

    // E22: GET /api/risk-evaluations/catalogs/
    if (pathName === "/api/risk-evaluations/catalogs/" && method === "GET") {
      if (cachedRiskCatalogs) {
        return jsonResponse(cachedRiskCatalogs);
      }
      return jsonResponse({
        periods: [{ id: 1, name: "Periodo 2026", is_active: true }],
        current_period: { id: 1, name: "Periodo 2026", is_active: true },
        threats: [],
        vulnerabilities: [],
        control_types: [],
        security_measure_types: [],
        estimated_times: [],
        asset_categories: [],
        asset_classifications: [],
        appraisal_bands: [],
        process_options: [],
        compliance_standard: "ISO27001_27701_INT",
        annex_a_controls: [],
        applicable_annex_a_controls: [],
        active_matrix: null,
        risk_treatment_levels: [],
        asset_scope_label: "ALTO y EXTREMO",
      });
    }

    // E23: GET /api/risk-evaluations/eligible-assets/
    if (
      pathName === "/api/risk-evaluations/eligible-assets/" &&
      method === "GET"
    ) {
      const assets = await sql`
          SELECT * FROM core_asset WHERE is_deleted = false ORDER BY id ASC
        `;
      return jsonResponse({
        count: assets.length,
        next: null,
        previous: null,
        results: assets,
        scope_label: "ALTO y EXTREMO",
      });
    }

    // E24: GET /api/assets/
    if (pathName === "/api/assets/" && method === "GET") {
      const assets = await sql`
          SELECT * FROM core_asset WHERE is_deleted = false ORDER BY id ASC
        `;
      return jsonResponse({
        count: assets.length,
        next: null,
        previous: null,
        results: assets,
      });
    }

    // E25: GET /api/dashboard/
    if (pathName === "/api/dashboard/" && method === "GET") {
      if (cachedDashboard) {
        return jsonResponse(cachedDashboard);
      }
      return jsonResponse({
        tab: "summary",
        tabs: ["summary", "incidents", "risks", "audits"],
        generated_at: new Date().toISOString(),
        kpis: [
          {
            key: "risk_evaluation_coverage",
            label: "Cobertura de evaluación de riesgos",
            domain: "risks",
            domain_label: "Gestión de Riesgos",
            description: "Porcentaje de activos evaluados",
            value: 100,
            unit: "%",
            direction: "UP",
            target: 80,
            warning: 50,
            has_target: true,
            status: "OK",
            has_data: true,
            reason: null,
            numerator: 1,
            denominator: 1,
            caption: "1 de 1 activos evaluados",
            is_default_target: true,
          },
          {
            key: "compliance_global",
            label: "Cumplimiento global de controles",
            domain: "compliance",
            domain_label: "Cumplimiento Normativo",
            description: "Porcentaje de controles implementados",
            value: 75,
            unit: "%",
            direction: "UP",
            target: 70,
            warning: 40,
            has_target: true,
            status: "OK",
            has_data: true,
            reason: null,
            numerator: 106,
            denominator: 142,
            caption: "106 de 142 controles implementados",
            is_default_target: true,
          },
          {
            key: "arcop_ontime_rate",
            label: "Tasa de atención de solicitudes dentro de plazo",
            domain: "arco",
            domain_label: "Derechos ARCO",
            description: "Porcentaje de solicitudes resueltas a tiempo",
            value: 100,
            unit: "%",
            direction: "UP",
            target: 95,
            warning: 80,
            has_target: true,
            status: "OK",
            has_data: true,
            reason: null,
            numerator: 0,
            denominator: 0,
            caption: "Sin solicitudes pendientes",
            is_default_target: true,
          },
        ],
      });
    }

    // E26: GET /api/annex-a-controls/meta/
    if (pathName === "/api/annex-a-controls/meta/" && method === "GET") {
      if (cachedAnnexMeta) {
        return jsonResponse(cachedAnnexMeta);
      }
      return jsonResponse({
        standard: {
          code: "ISO27001_27701_INT",
          label: "ISO/IEC 27001:2022 + ISO/IEC 27701:2025 (integrada)",
          annex_label:
            "Anexo A de ISO/IEC 27001:2022 y Tablas A.1–A.2 de ISO/IEC 27701:2025",
          total_controls: 142,
          is_superseded: false,
        },
        groups: [],
      });
    }

    // Fallback 404 for unknown endpoints
    return jsonResponse({ detail: "Not found." }, 404);
  };

  if (typeof Bun !== "undefined" && typeof Bun.serve === "function") {
    const bunServer = Bun.serve({
      port,
      fetch: handleFetch,
    });
    const actualPort = bunServer.port ?? port;
    const url = `http://localhost:${actualPort}`;
    return {
      port: actualPort,
      url,
      server: bunServer,
      stop: async () => {
        bunServer.stop(true);
      },
    };
  }

  const nodeServer = http.createServer(async (nodeReq, nodeRes) => {
    const fullUrl = `http://${nodeReq.headers.host ?? `localhost:${port}`}${nodeReq.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(nodeReq.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else if (v) {
        headers.set(k, v);
      }
    }
    const hasBody = nodeReq.method !== "GET" && nodeReq.method !== "HEAD";
    const body = hasBody
      ? (Readable.toWeb(nodeReq) as unknown as ReadableStream)
      : undefined;
    const req = new Request(fullUrl, {
      method: nodeReq.method,
      headers,
      body,
      // @ts-expect-error
      duplex: "half",
    });

    try {
      const response = await handleFetch(req);
      nodeRes.statusCode = response.status;
      response.headers.forEach((val, key) => {
        nodeRes.setHeader(key, val);
      });
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          nodeRes.write(value);
        }
      }
      nodeRes.end();
    } catch (err: unknown) {
      nodeRes.statusCode = 500;
      nodeRes.end(String(err));
    }
  });

  await new Promise<void>((resolve) => {
    nodeServer.listen(port, () => resolve());
  });

  const address = nodeServer.address() as AddressInfo;
  const actualPort = address.port;
  const url = `http://localhost:${actualPort}`;

  return {
    port: actualPort,
    url,
    server: nodeServer,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        nodeServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
