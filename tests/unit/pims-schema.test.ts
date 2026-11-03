import {
  LoginResponseSchema,
  PimsIncidentHistorySchema,
  PimsIncidentSchema,
  UserProfileSchema,
} from "@pims/types/pims.ts";
import { describe, expect, it } from "vitest";

const incidentJson = {
  id: 1,
  incident_code: "INC-001",
  title: "Credential stuffing against the portal",
  involves_personal_data: true,
  incident_date: "2026-10-01",
  incident_type: "DL",
  status: "O",
  affected_data_types: [],
  security_measures_adopted: [],
  affected_cid: [],
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

describe("Live PIMS serializer compatibility", () => {
  it("treats an omitted is_deleted as false", () => {
    const parsed = PimsIncidentSchema.parse(incidentJson);
    expect(parsed.is_deleted).toBe(false);
  });

  it("treats a null is_deleted as false", () => {
    const parsed = PimsIncidentSchema.parse({
      ...incidentJson,
      is_deleted: null,
    });
    expect(parsed.is_deleted).toBe(false);
  });

  it("preserves an explicit is_deleted true", () => {
    const parsed = PimsIncidentSchema.parse({
      ...incidentJson,
      is_deleted: true,
    });
    expect(parsed.is_deleted).toBe(true);
  });

  it("splits a comma-separated recipients_snapshot string", () => {
    const parsed = PimsIncidentHistorySchema.parse({
      id: 10,
      changed_at: "2026-10-01T10:00:00Z",
      recipients_snapshot: "a@example.com, b@example.com",
    });
    expect(parsed.recipients_snapshot).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("keeps a null recipients_snapshot as null", () => {
    const parsed = PimsIncidentHistorySchema.parse({
      id: 11,
      changed_at: "2026-10-01T10:00:00Z",
      recipients_snapshot: null,
    });
    expect(parsed.recipients_snapshot).toBeNull();
  });

  it("keeps an array recipients_snapshot as-is", () => {
    const parsed = PimsIncidentHistorySchema.parse({
      id: 12,
      changed_at: "2026-10-01T10:00:00Z",
      recipients_snapshot: ["a@example.com"],
    });
    expect(parsed.recipients_snapshot).toEqual(["a@example.com"]);
  });

  it("parses a live profile without id or must_change_password", () => {
    const parsed = UserProfileSchema.parse({
      username: "grupob4",
      first_name: "Grupo",
      last_name: "B4",
      email: "grupob4@unsa.edu.pe",
      is_platform_admin: false,
      is_external_advisor: false,
      platform_role: null,
    });
    expect(parsed.platform_role).toBeNull();
    expect(parsed.must_change_password).toBeUndefined();
  });

  it("parses a login response carrying the permissions matrix", () => {
    const parsed = LoginResponseSchema.parse({
      access: "access-token",
      refresh: "refresh-token",
      user: {
        id: 7,
        username: "grupob4",
        email: "grupob4@unsa.edu.pe",
        is_platform_admin: false,
        must_change_password: false,
        platform_role: "Operador",
        permissions: [
          {
            modulo: "Incidentes",
            ver: true,
            crear: true,
            editar: true,
            eliminar: false,
            aprobar: true,
          },
        ],
      },
    });
    expect(parsed.user.permissions?.[0]?.modulo).toBe("Incidentes");
    expect(parsed.user.permissions?.[0]?.editar).toBe(true);
  });
});
