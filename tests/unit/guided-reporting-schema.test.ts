import {
  isJobTitle,
  parseSpanishPersonName,
} from "@pims/cockpit/guided-create.ts";
import { IntakePayloadSchema } from "@pims/types/agent.ts";
import { GuidedReportingSchema } from "@pims/types/cockpit.ts";
import { describe, expect, it } from "vitest";

describe("Spanish Name Parsing & Job Title Separation", () => {
  it("accurately splits standard 3-part Spanish names (First, Paternal, Maternal)", () => {
    const res = parseSpanishPersonName("Carlos Mendoza Paredes");
    expect(res.firstName).toBe("Carlos");
    expect(res.lastNameP).toBe("Mendoza");
    expect(res.lastNameM).toBe("Paredes");
  });

  it("handles 2-part Spanish names (First, Paternal)", () => {
    const res = parseSpanishPersonName("Carlos Mendoza");
    expect(res.firstName).toBe("Carlos");
    expect(res.lastNameP).toBe("Mendoza");
    expect(res.lastNameM).toBeNull();
  });

  it("handles 4-part compound names (Two First Names, Two Surnames)", () => {
    const res = parseSpanishPersonName("Juan Carlos Mendoza Paredes");
    expect(res.firstName).toBe("Juan Carlos");
    expect(res.lastNameP).toBe("Mendoza");
    expect(res.lastNameM).toBe("Paredes");
  });

  it("strips honorific titles such as Dra., Ing., Lic.", () => {
    const res = parseSpanishPersonName("Dra. Elena Ramos");
    expect(res.firstName).toBe("Elena");
    expect(res.lastNameP).toBe("Ramos");
    expect(res.lastNameM).toBeNull();
  });

  it("identifies institutional job titles correctly", () => {
    expect(isJobTitle("Jefe de Seguridad de la Información")).toBe(true);
    expect(isJobTitle("Director de TI")).toBe(true);
    expect(isJobTitle("Auditor Interno")).toBe(true);
    expect(isJobTitle("Mendoza")).toBe(false);
    expect(isJobTitle("Paredes Quispe")).toBe(false);
  });
});

describe("GuidedReportingSchema & IntakePayload Alignment", () => {
  it("parses minimal valid guided incident with completely empty measures and actions", () => {
    const minimal = {
      title: "Filtración sospechosa en servidor",
      incident_date: "2026-11-05",
      incident_type: "OT",
      involves_personal_data: false,
    };

    const parsed = GuidedReportingSchema.parse(minimal);
    expect(parsed.title).toBe("Filtración sospechosa en servidor");
    expect(parsed.status).toBe("O");
    expect(parsed.security_measures_adopted).toEqual([]);
    expect(parsed.affected_data_types).toEqual([]);
    expect(parsed.affected_cid).toEqual([]);
    expect(parsed.actions).toEqual([]);
    expect(parsed.measure_updated_registry).toBeUndefined();
    expect(parsed.measure_new_security).toBeUndefined();
    expect(parsed.measure_improved_policies).toBeUndefined();
    expect(parsed.measure_considered_resolved).toBeUndefined();
    expect(parsed.measure_reported_authorities).toBeUndefined();
    expect(parsed.resolved_date).toBeUndefined();
  });

  it("parses guided incident with full primary PIMS fields including measures and initial actions", () => {
    const full = {
      title: "Filtración de base de datos de postulantes",
      description: "Compromiso de credenciales de base de datos.",
      incident_date: "2026-11-05",
      incident_time: "10:30:00",
      detection_date: "2026-11-05",
      detection_time: "11:00:00",
      incident_type: "DL",
      involves_personal_data: true,
      status: "O",
      severity: "H",
      impact: "H",
      affected_data_types: ["names", "id_doc", "email"],
      num_affected_subjects: 500,
      compromised_system: "admissions-db",
      affected_url: "https://admissions.unsa.edu.pe",
      evidence_refs: "Log-ID: db-leak-001",
      security_measures_adopted: ["encrypt_rest", "mfa"],
      affected_cid: ["C", "I"],
      rep_document_number: "72345678",
      rep_first_name: "Carlos",
      rep_last_name_p: "Mendoza",
      entity_type: "U",
      entity_ruc: "20123456789",
      entity_name: "UNSA",
      reported_by: "Operador de Guardia",
      assigned_to: "admin",
      dpo_contact_name: "DPO UNSA",
      dpo_contact_email: "dpo@unsa.edu.pe",
      measure_updated_registry: "Y",
      measure_new_security: "Y",
      measure_improved_policies: "U",
      measure_considered_resolved: "N",
      measure_reported_authorities: "N",
      resolved_date: null,
      actions: [
        {
          action_type: "C",
          responsible: "operador",
          action_date: "2026-11-05",
          description: "Aislamiento inmediato del host de base de datos",
          evidence: "firewall-rule-992",
        },
      ],
    };

    const parsed = GuidedReportingSchema.parse(full);
    expect(parsed.severity).toBe("H");
    expect(parsed.impact).toBe("H");
    expect(parsed.security_measures_adopted).toEqual(["encrypt_rest", "mfa"]);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]?.action_type).toBe("C");
    expect(parsed.measure_updated_registry).toBe("Y");
  });

  it("IntakePayloadSchema accepts full reporting fields with optional actions and measures", () => {
    const intakePayload = {
      channel: "cockpit_guided" as const,
      title: "Prueba de ingesta con todos los campos",
      incident_date: "2026-11-05",
      involves_personal_data: true,
      incident_type: "DL" as const,
      status: "O" as const,
      severity: "H" as const,
      impact: "H" as const,
      reported_by: "operador_test",
      assigned_to: "admin",
      affected_treatment: "Admisiones",
      evidence_refs: "Evidencia #123",
      measure_updated_registry: "Y" as const,
      measure_new_security: "Y" as const,
      measure_improved_policies: "U" as const,
      measure_considered_resolved: "N" as const,
      measure_reported_authorities: "N" as const,
      actions: [
        {
          action_type: "C" as const,
          responsible: "operador",
          action_date: "2026-11-05",
          description: "Contención de red",
        },
      ],
    };

    const parsed = IntakePayloadSchema.parse(intakePayload);
    expect(parsed.title).toBe("Prueba de ingesta con todos los campos");
    expect(parsed.severity).toBe("H");
    expect(parsed.actions).toHaveLength(1);
  });
});
