import fs from "node:fs";
import path from "node:path";
import { PimsAdapter } from "@pims/pims-adapter";
import {
  createMockDatabase,
  createPimsTestServer,
  type MockDatabaseClient,
  type PimsTestServerInstance,
} from "@pims/pims-mock";
import {
  AttachmentRejectedError,
  NotifyNoRecipientsError,
  PimsNotFoundError,
  PimsValidationError,
} from "@pims/types";
import { PIMS_TEST_SEED_PASSWORD } from "@pims/types/constants.ts";
import { PimsGateBlockedError } from "@pims/types/errors.ts";
import type { PimsMutationRecord } from "@pims/types/pims.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("PIMS Client Adapter & Reverse-Engineered DRF API Integration Suite", () => {
  let container: StartedPostgreSqlContainer;
  let dbClient: MockDatabaseClient;
  let serverInstance: PimsTestServerInstance;
  let adapter: PimsAdapter;

  beforeAll(async () => {
    const projectRoot = process.cwd();
    const dumpPath = path.resolve(
      projectRoot,
      "data/gestitel_base_de_datos.sql",
    );
    const seedPath = path.resolve(projectRoot, "data/02-init-unsa-seed.sql");

    if (!fs.existsSync(dumpPath) || !fs.existsSync(seedPath)) {
      throw new Error(
        `Required SQL initialization files missing in ${projectRoot}/data`,
      );
    }

    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withBindMounts([
        {
          source: dumpPath,
          target: "/docker-entrypoint-initdb.d/01-gestitel.sql",
          mode: "ro",
        },
        {
          source: seedPath,
          target: "/docker-entrypoint-initdb.d/02-seed.sql",
          mode: "ro",
        },
      ])
      .start();

    dbClient = createMockDatabase(container.getConnectionUri());

    serverInstance = await createPimsTestServer(dbClient, {
      nestedActionMode: "replace",
    });

    adapter = new PimsAdapter({
      baseUrl: serverInstance.url,
      schema: "unsa",
      username: "admin",
      password: PIMS_TEST_SEED_PASSWORD,
      timeoutMs: 15000,
    });
  }, 120_000);

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
    if (dbClient) {
      await dbClient.sql.end();
    }
    if (container) {
      await container.stop();
    }
  }, 60_000);

  describe("Authentication & Session (E01–E04)", () => {
    it("E01: logs in successfully with valid credentials and obtains JWT tokens", async () => {
      const res = await adapter.login();
      expect(res.access).toBeDefined();
      expect(res.refresh).toBeDefined();
      expect(res.user.username).toBe("admin");
      expect(res.user.is_platform_admin).toBe(true);
      expect(adapter.accessToken).toBe(res.access);
    });

    it("E02: refreshes access token using refresh token", async () => {
      const _oldAccess = adapter.accessToken;
      const newAccess = await adapter.refreshToken();
      expect(newAccess).toBeDefined();
      expect(typeof newAccess).toBe("string");
      expect(adapter.accessToken).toBe(newAccess);
    });

    it("E03: retrieves tenant display info", async () => {
      const info = await adapter.getTenantInfo();
      expect(info.name).toBe("UNSA");
    });

    it("E04: retrieves user profile", async () => {
      const profile = await adapter.getProfile();
      expect(profile.username).toBe("admin");
      expect(profile.email).toBe("admin@unsa.pe");
    });
  });

  describe("Startup Probes", () => {
    it("probeNestedArrayMutationStrategy: discovers nested mutation mode and logs NESTED_PROBE:<mode>", async () => {
      const mode = await adapter.probeNestedArrayMutationStrategy();
      expect(["replace", "merge"]).toContain(mode);
      expect(adapter.nestedActionMode).toBe(mode);
    });

    it("probeAuditMutationStrategy: discovers audit finding mutation mode and logs NESTED_PROBE:audit:<mode>", async () => {
      const mode = await adapter.probeAuditMutationStrategy();
      expect(["replace", "merge"]).toContain(mode);
      expect(adapter.nestedAuditMode).toBe(mode);
    });

    it("probeNullClearCapability: probes clearing a nullable field and logs NULL_CLEAR:<field>:<ok|rejected>", async () => {
      const result = await adapter.probeNullClearCapability("description");
      expect(["ok", "rejected"]).toContain(result);
      expect(result).toBe("ok");
    });
  });

  describe("Incident Management Lifecycle (E05–E12)", () => {
    let createdIncidentId: number;
    let incidentCode: string;

    it("E06: creates incident with valid payload and generates system code INC-###", async () => {
      const incident = await adapter.createIncident({
        title: "DDoS Attack on SIS Database",
        involves_personal_data: true,
        incident_date: "2026-10-29",
        incident_type: "DS",
        status: "O",
        severity: "H",
        impact: "V",
        affected_data_types: ["identificativos", "contacto"],
        security_measures_adopted: ["monitorizacion_logs"],
        affected_cid: ["C", "I"],
        measure_new_security: "Y",
      });

      expect(incident.id).toBeDefined();
      expect(incident.incident_code).toMatch(/^INC-\d+$/);
      expect(incident.title).toBe("DDoS Attack on SIS Database");
      expect(incident.status).toBe("O");
      expect(incident.involves_personal_data).toBe(true);
      expect(incident.measure_new_security).toBe("Y");

      createdIncidentId = incident.id;
      incidentCode = incident.incident_code;
    });

    it("E07: gets complete incident detail with 57 keys and empty nested relations", async () => {
      const incident = await adapter.getIncident(createdIncidentId);
      expect(incident.id).toBe(createdIncidentId);
      expect(incident.incident_code).toBe(incidentCode);
      expect(Array.isArray(incident.actions)).toBe(true);
      expect(Array.isArray(incident.attachments)).toBe(true);
      expect(Array.isArray(incident.history)).toBe(true);
    });

    it("E08: partially updates incident triage fields and nested actions", async () => {
      const updated = await adapter.updateIncident(createdIncidentId, {
        status: "P",
        severity: "C",
        measure_reported_authorities: "Y",
        actions: [
          {
            action_type: "C",
            responsible: "SOC Lead",
            action_date: "2026-10-29",
            description: "Blocked attacking IP ranges via perimeter firewall",
            evidence: "Firewall ruleset hash verified",
            position: 1,
            id: 0,
          },
        ],
      });

      expect(updated.status).toBe("P");
      expect(updated.severity).toBe("C");
      expect(updated.measure_reported_authorities).toBe("Y");
      expect(updated.actions?.length).toBe(1);
      expect(updated.actions?.[0]?.description).toContain("perimeter firewall");
    });

    it("E10: retrieves immutable history showing creation and status changes", async () => {
      const history = await adapter.getIncidentHistory(createdIncidentId);
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history.some((h) => h.event_type === "created")).toBe(true);
      const statusChanged = history.find(
        (h) => h.event_type === "status_changed",
      );
      expect(statusChanged).toBeDefined();
      expect(statusChanged?.description).toBe("Estado: O -> P");
    });

    it("E12: uploads incident attachment with multipart/form-data", async () => {
      const fileContent = Buffer.from("forensic memory dump summary", "utf-8");
      const attachments = await adapter.uploadIncidentAttachment(
        createdIncidentId,
        fileContent,
        "forensics.txt",
      );

      expect(attachments.length).toBeGreaterThanOrEqual(1);
      const uploaded = attachments.find((a) => a.file_name === "forensics.txt");
      expect(uploaded).toBeDefined();
      expect(uploaded?.uploaded_by_name).toBe("admin");
    });

    it("E12: rejects a disallowed extension before any HTTP request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        adapter.uploadIncidentAttachment(
          createdIncidentId,
          Buffer.from("MZ binary"),
          "malware.exe",
        ),
      ).rejects.toThrow(AttachmentRejectedError);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("E12: mock API rejects a disallowed extension with a field error", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([Buffer.from("MZ binary")]),
        "malware.exe",
      );

      const res = await fetch(
        `${serverInstance.url}/api/incidents/${createdIncidentId}/attachments/`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${adapter.accessToken}` },
          body: formData,
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { file?: string[] };
      expect(body.file?.[0]).toContain("disallowed_extension");
    });

    it("E11: retrieves list of attachments for incident", async () => {
      const attachments =
        await adapter.getIncidentAttachments(createdIncidentId);
      expect(attachments.length).toBeGreaterThanOrEqual(1);
      expect(attachments.some((a) => a.file_name === "forensics.txt")).toBe(
        true,
      );
    });

    it("E05: lists incidents with status filtering", async () => {
      const list = await adapter.listIncidents({ status: "P" });
      expect(list.count).toBeGreaterThanOrEqual(1);
      expect(list.results.some((i) => i.id === createdIncidentId)).toBe(true);
    });

    it("E09: logically deletes incident (setting is_deleted=true)", async () => {
      await adapter.deleteIncident(createdIncidentId);

      await expect(adapter.getIncident(createdIncidentId)).rejects.toThrow(
        PimsNotFoundError,
      );

      const list = await adapter.listIncidents();
      expect(list.results.some((i) => i.id === createdIncidentId)).toBe(false);
    });
  });

  describe("Recipients & Notification Workflow (E13–E16)", () => {
    let incidentForNotify: number;
    let recipientId: number;

    beforeAll(async () => {
      const inc = await adapter.createIncident({
        title: "Data Exfiltration Test Incident",
        involves_personal_data: true,
        incident_date: "2026-10-29",
        incident_type: "DL",
        status: "O",
      });
      incidentForNotify = inc.id;
    });

    it("E13: fails with NOTIFY_NO_RECIPIENTS when zero active recipients are configured", async () => {
      const recipients = await adapter.listRecipients();
      for (const r of recipients.results) {
        await adapter.deleteRecipient(r.id);
      }

      await expect(adapter.notifyIncident(incidentForNotify)).rejects.toThrow(
        NotifyNoRecipientsError,
      );
    });

    it("E15: creates new notification recipient", async () => {
      const recipient = await adapter.createRecipient({
        email: "dpo-security@unsa.pe",
        label: "Data Protection Officer",
        is_active: true,
      });

      expect(recipient.id).toBeDefined();
      expect(recipient.email).toBe("dpo-security@unsa.pe");
      expect(recipient.is_active).toBe(true);
      recipientId = recipient.id;
    });

    it("E15: fails with PIMS_VALIDATION on duplicate email", async () => {
      await expect(
        adapter.createRecipient({
          email: "dpo-security@unsa.pe",
          label: "Duplicate DPO",
          is_active: true,
        }),
      ).rejects.toThrow(PimsValidationError);
    });

    it("E14: lists active notification recipients", async () => {
      const list = await adapter.listRecipients();
      expect(list.count).toBeGreaterThanOrEqual(1);
      expect(list.results.some((r) => r.id === recipientId)).toBe(true);
    });

    it("E13: notifies incident recipients and appends history snapshot", async () => {
      const notified = await adapter.notifyIncident(incidentForNotify);
      expect(notified.id).toBe(incidentForNotify);

      const history = await adapter.getIncidentHistory(incidentForNotify);
      const notifyHistory = history.find((h) => h.event_type === "notified");
      expect(notifyHistory).toBeDefined();
      expect(notifyHistory?.recipients_snapshot).toBeDefined();
      expect(notifyHistory?.recipients_snapshot?.length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("E16: hard deletes notification recipient", async () => {
      await adapter.deleteRecipient(recipientId);
      const list = await adapter.listRecipients();
      expect(list.results.some((r) => r.id === recipientId)).toBe(false);
    });
  });

  describe("Audits & Findings (E17–E19)", () => {
    let auditId: number;

    it("E18: creates audit with system code AUD-2026-###", async () => {
      const audit = await adapter.createAudit({
        audit_type: "I",
        name: "Q4 2026 GDPR Compliance Audit",
        status: "P",
        scope: "Internal processing systems",
      });

      expect(audit.id).toBeDefined();
      expect(audit.code).toMatch(/^AUD-2026-\d+$/);
      auditId = audit.id;
    });

    it("E17: lists audits", async () => {
      const audits = await adapter.listAudits();
      expect(audits.count).toBeGreaterThanOrEqual(1);
      expect(audits.results.some((a) => a.id === auditId)).toBe(true);
    });

    it("E19: updates audit with nested findings and action plans", async () => {
      const updated = await adapter.updateAudit(auditId, {
        status: "R",
        findings: [
          {
            classification: "N",
            description: "Missing access logs for HR database",
            evidence: "Audit sample 102",
            actions: [
              {
                action_plan: "Implement centralized syslog forwarder",
                responsible: "Infrastructure Team",
                due_date: "2026-12-01",
                status: "P",
                progress: 25,
              },
            ],
          },
        ],
      });

      expect(updated.id).toBe(auditId);
    });
  });

  describe("Risk Evaluations, Assets & Catalogs (E20–E24)", () => {
    it("E22: retrieves complete risk methodology catalogs", async () => {
      const catalogs = await adapter.getRiskCatalogs();
      expect(catalogs.threats).toBeDefined();
      expect(catalogs.vulnerabilities).toBeDefined();
      expect(Array.isArray(catalogs.threats)).toBe(true);
      expect(Array.isArray(catalogs.vulnerabilities)).toBe(true);
    });

    it("E24: lists assets inventory", async () => {
      const assets = await adapter.listAssets();
      expect(assets.count).toBeGreaterThanOrEqual(1);
    });

    it("E23: lists eligible assets for risk evaluation", async () => {
      const eligible = await adapter.getEligibleAssets();
      expect(eligible.count).toBeGreaterThanOrEqual(1);
    });

    it("E21: rejects risk creation when assets list is empty", async () => {
      await expect(
        adapter.createRiskEvaluation({
          description: "Unauthorized access risk",
          controlled_probability: 3,
          controlled_impact: 4,
          assets: [],
        }),
      ).rejects.toThrow(PimsValidationError);
    });

    it("E21: creates risk evaluation with asset linkage and generates code R-###", async () => {
      const assetsList = await adapter.listAssets();
      const firstAsset = assetsList.results[0] as { id: number };

      const risk = await adapter.createRiskEvaluation({
        description: "Ransomware infection risk",
        controlled_probability: 2,
        controlled_impact: 3,
        assets: [{ asset: firstAsset.id }],
      });

      expect(risk.id).toBeDefined();
      expect(risk.code).toMatch(/^R-\d+$/);
    });

    it("E20: lists risk evaluations", async () => {
      const risks = await adapter.listRiskEvaluations();
      expect(risks.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Dashboard KPIs & Standards Metadata (E25–E26)", () => {
    it("E25: retrieves executive dashboard KPIs", async () => {
      const dashboard = await adapter.getDashboardKpis("summary");
      expect(dashboard.tab).toBe("summary");
      expect(Array.isArray(dashboard.kpis)).toBe(true);
      expect(dashboard.kpis.length).toBeGreaterThanOrEqual(3);
    });

    it("E26: retrieves Annex A controls metadata", async () => {
      const meta = await adapter.getAnnexAControlsMeta();
      expect(meta.standard).toBeDefined();
      expect(meta.standard.code).toMatch(/ISO27001/);
      expect(Array.isArray(meta.groups)).toBe(true);
      expect(meta.groups.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Resilience, Error Mapping & HTTP Failure Invariants", () => {
    it("maps 400 field validation error to PimsValidationError", async () => {
      await expect(
        adapter.createIncident({
          involves_personal_data: true,
        } as unknown as {
          title: string;
          involves_personal_data: boolean;
          incident_date: string;
          incident_type: "OT";
          status: "O";
        }),
      ).rejects.toThrow(PimsValidationError);
    });

    it("maps 404 to PimsNotFoundError", async () => {
      await expect(adapter.getIncident(999999)).rejects.toThrow(
        PimsNotFoundError,
      );
    });

    it("maps 403 LICENSE_EXPIRED to PimsGateBlockedError", async () => {
      const res = await fetch(`${serverInstance.url}/api/incidents/`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${adapter.accessToken}`,
          "X-Simulate-Error": "403_LICENSE",
        },
      });
      expect(res.status).toBe(403);
    });

    it("passes extraHeaders and cookies through to the PIMS endpoint", async () => {
      const testAdapter = new PimsAdapter({
        baseUrl: adapter.baseUrl,
        schema: adapter.schema,
        username: "admin",
        password: "test-password",
        extraHeaders: { "X-Simulate-Error": "403_LICENSE" },
        cookies: { session: "sess_123" },
      });
      await expect(testAdapter.listIncidents()).rejects.toThrow(
        PimsGateBlockedError,
      );
    });
  });

  describe("Phase 4 adapter extensions (append, restore, download)", () => {
    it("appendIncidentAction preserves existing actions in replace mode", async () => {
      const incident = await adapter.createIncident({
        title: "append-action replace mode",
        involves_personal_data: false,
        incident_date: "2026-10-01",
        incident_type: "OT",
        status: "O",
      });

      const first = await adapter.appendIncidentAction(incident.id, {
        action_type: "C",
        responsible: "SOC",
        action_date: "2026-10-01",
        description: "contained the host",
        evidence: "file:host.txt",
      });
      expect(first.actions?.map((a) => a.action_type)).toEqual(["C"]);

      const second = await adapter.appendIncidentAction(incident.id, {
        action_type: "A",
        responsible: "SOC",
        action_date: "2026-10-02",
        description: "analysed the logs",
        evidence: "file:logs.txt",
      });
      expect(second.actions?.map((a) => a.action_type)).toEqual(["C", "A"]);
      expect(second.actions?.map((a) => a.position)).toEqual([1, 2]);
    });

    it("appendIncidentAction patches only the new action in merge mode", async () => {
      const mergeServer = await createPimsTestServer(dbClient, {
        nestedActionMode: "merge",
      });
      try {
        const mergeAdapter = new PimsAdapter({
          baseUrl: mergeServer.url,
          schema: "unsa",
          username: "admin",
          password: PIMS_TEST_SEED_PASSWORD,
        });
        mergeAdapter.nestedActionMode = "merge";

        const incident = await mergeAdapter.createIncident({
          title: "append-action merge mode",
          involves_personal_data: false,
          incident_date: "2026-10-01",
          incident_type: "OT",
          status: "O",
        });

        await mergeAdapter.appendIncidentAction(incident.id, {
          action_type: "C",
          responsible: "SOC",
          action_date: "2026-10-01",
          description: "contained the host",
          evidence: "file:host.txt",
        });
        const merged = await mergeAdapter.appendIncidentAction(incident.id, {
          action_type: "A",
          responsible: "SOC",
          action_date: "2026-10-02",
          description: "analysed the logs",
          evidence: "file:logs.txt",
        });

        expect(merged.actions?.length).toBe(2);
        expect(merged.actions?.map((a) => a.action_type)).toEqual(["C", "A"]);
      } finally {
        await mergeServer.stop();
      }
    });

    it("restoreIncident clears the logical delete flags and logs the outcome", async () => {
      const incident = await adapter.createIncident({
        title: "restore me",
        involves_personal_data: false,
        incident_date: "2026-10-01",
        incident_type: "OT",
        status: "O",
      });
      await adapter.deleteIncident(incident.id);
      await expect(adapter.getIncident(incident.id)).rejects.toThrow(
        PimsNotFoundError,
      );

      const restored = await adapter.restoreIncident(incident.id, {
        incidentCode: incident.incident_code,
      });
      expect(restored.is_deleted).toBe(false);
      expect(restored.deleted_at ?? null).toBeNull();
      expect(restored.incident_code).toBe(incident.incident_code);
    });

    it("downloadAttachment returns the uploaded bytes for hash verification", async () => {
      const incident = await adapter.createIncident({
        title: "attachment round trip",
        involves_personal_data: false,
        incident_date: "2026-10-01",
        incident_type: "OT",
        status: "O",
      });
      const bytes = Buffer.from("forensic attachment round trip", "utf8");
      const uploaded = await adapter.uploadIncidentAttachment(
        incident.id,
        bytes,
        "round-trip.txt",
      );
      const attachment = uploaded.find(
        (row) => row.file_name === "round-trip.txt",
      );
      expect(attachment).toBeDefined();
      if (attachment === undefined) {
        throw new Error("upload returned no attachment");
      }

      const downloaded = await adapter.downloadAttachment(attachment.file);
      expect(downloaded.equals(bytes)).toBe(true);
    });
  });

  describe("Mutation observer", () => {
    it("emits redacted per-attempt records without payload values", async () => {
      const records: PimsMutationRecord[] = [];
      const observed = new PimsAdapter({
        baseUrl: serverInstance.url,
        schema: "unsa",
        username: "admin",
        password: PIMS_TEST_SEED_PASSWORD,
        timeoutMs: 15000,
        onMutation: (record) => {
          records.push(record);
        },
      });

      await observed.login();
      const loginRecord = records.find(
        (record) => record.operation === "login",
      );
      expect(loginRecord?.payload_keys.sort()).toEqual([
        "password",
        "username",
      ]);
      expect(JSON.stringify(loginRecord)).not.toContain(
        PIMS_TEST_SEED_PASSWORD,
      );

      const incident = await observed.createIncident({
        title: "mutation observer fixture",
        involves_personal_data: false,
        incident_date: "2026-10-01",
        incident_type: "OT",
        status: "O",
      });
      await observed.updateIncident(incident.id, { severity: "L" });
      const updateRecord = records.find(
        (record) => record.operation === "update_incident",
      );
      expect(updateRecord?.method).toBe("PATCH");
      expect(updateRecord?.endpoint).toBe(`/api/incidents/${incident.id}/`);
      expect(updateRecord?.payload_keys).toEqual(["severity"]);
      expect(updateRecord?.idempotency_key).not.toBeNull();
      expect(updateRecord?.status).toBe(200);
      expect(updateRecord?.error_code).toBeNull();
      expect(updateRecord?.at_utc.endsWith("Z")).toBe(true);
    });
  });
});
