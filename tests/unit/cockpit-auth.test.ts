import {
  derivePermissions,
  normalizeRoleLabel,
  resolveNativeRole,
  SessionRegistry,
} from "@pims/cockpit/auth.ts";
import { resolvePersona } from "@pims/cockpit/chat.ts";
import { canReceiveEvent } from "@pims/cockpit/event-hub.ts";
import type { AgentEvent } from "@pims/types/agent.ts";
import type {
  CockpitPermission,
  CockpitRole,
  CockpitSession,
} from "@pims/types/cockpit.ts";
import {
  CockpitPermissionDeniedError,
  CockpitRoleUnknownError,
  CockpitSessionInvalidError,
} from "@pims/types/errors.ts";
import type { PimsPermission } from "@pims/types/pims.ts";
import { describe, expect, it } from "vitest";

function session(
  role: CockpitRole,
  permissions: CockpitPermission[],
  canSwitch = false,
): CockpitSession {
  return {
    access_token: "token",
    expires_at_utc: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    user_id: 1,
    username: "operator",
    schema: "unsa",
    native_role: role,
    permissions,
    default_persona:
      role === "Editor" ? "dpo" : role === "Lector" ? "auditor" : "executive",
    can_switch_persona: canSwitch,
  };
}

function permission(
  modulo: string,
  overrides: Partial<PimsPermission> = {},
): PimsPermission {
  return {
    modulo,
    ver: false,
    crear: false,
    editar: false,
    eliminar: false,
    aprobar: false,
    ...overrides,
  };
}

const roleEvent: AgentEvent = {
  type: "role:transition",
  at_utc: "2026-10-01T10:00:00.000Z",
  incident_code: "INC-001",
  role: "triage",
  previous_role: null,
  lease_holder: "agent:1",
};

const mutationEvent: AgentEvent = {
  type: "tool:mutation",
  at_utc: "2026-10-01T10:00:00.000Z",
  incident_code: "INC-001",
  method: "PATCH",
  endpoint: "/api/incidents/1/",
  operation: "update_incident",
  idempotency_key: "key",
  duration_ms: 12,
  status: 200,
  attempt: 1,
  payload_keys: ["severity"],
  error_code: null,
};

describe("Cockpit native role adaptation", () => {
  it("normalizes accented role labels", () => {
    expect(normalizeRoleLabel("Oficial de Protección de Datos")).toBe(
      "oficial_de_proteccion_de_datos",
    );
    expect(normalizeRoleLabel(" Auditor / Consultor ")).toBe(
      "auditor_consultor",
    );
  });

  it("maps platform admin and external advisor flags first", () => {
    expect(
      resolveNativeRole({ is_platform_admin: true, platform_role: "Lector" }),
    ).toBe("Administrador");
    expect(
      resolveNativeRole({
        is_external_advisor: true,
        platform_role: "Operador",
      }),
    ).toBe("Lector");
  });

  it("maps every live role label", () => {
    expect(resolveNativeRole({ platform_role: "administrador" })).toBe(
      "Administrador",
    );
    expect(resolveNativeRole({ platform_role: "Operador" })).toBe("Operador");
    expect(resolveNativeRole({ platform_role: "Editor" })).toBe("Editor");
    expect(
      resolveNativeRole({
        platform_role: "Oficial de Protección de Datos",
      }),
    ).toBe("Editor");
    expect(resolveNativeRole({ platform_role: "Auditor" })).toBe("Lector");
  });

  it("treats a null platform role as Operador", () => {
    expect(resolveNativeRole({ platform_role: null })).toBe("Operador");
  });

  it("rejects unknown platform roles", () => {
    expect(() => resolveNativeRole({ platform_role: "robot" })).toThrow(
      CockpitRoleUnknownError,
    );
  });

  it("derives only the granted cockpit permissions", () => {
    const permissions = derivePermissions([
      permission("Incidentes", { ver: true, editar: true }),
      permission("Seguridad", { ver: false }),
      permission("Auditorías", { ver: true }),
      permission("Riesgos (DPIIA)", { ver: true }),
      permission("Usuarios y Roles", { ver: false }),
    ]);
    expect(permissions).toEqual([
      "view_incident",
      "change_incident",
      "view_audit",
      "view_riskevaluation",
    ]);
    expect(permissions).not.toContain("view_securitylog");
    expect(permissions).not.toContain("manage_users");
  });

  it("does not invent permissions for missing modules", () => {
    expect(derivePermissions([])).toEqual([]);
  });
});

describe("Cockpit persona authorization", () => {
  it("uses the session default persona when none is requested", () => {
    expect(
      resolvePersona(session("Editor", ["view_incident"]), undefined),
    ).toBe("dpo");
  });

  it("rejects persona switching for pinned roles", () => {
    expect(() =>
      resolvePersona(session("Lector", ["view_incident"]), "executive"),
    ).toThrow(CockpitPermissionDeniedError);
  });

  it("allows operator persona switching", () => {
    expect(
      resolvePersona(session("Operador", ["view_incident"], true), "auditor"),
    ).toBe("auditor");
  });
});

describe("Cockpit SSE event filtering", () => {
  it("drops every event without view_incident", () => {
    expect(canReceiveEvent(session("Lector", []), roleEvent)).toBe(false);
  });

  it("hides tool mutations without view_securitylog", () => {
    const reader = session("Editor", [
      "view_incident",
      "change_incident",
      "view_audit",
    ]);
    expect(canReceiveEvent(reader, roleEvent)).toBe(true);
    expect(canReceiveEvent(reader, mutationEvent)).toBe(false);
  });

  it("streams tool mutations to operators with view_securitylog", () => {
    const operator = session("Operador", ["view_incident", "view_securitylog"]);
    expect(canReceiveEvent(operator, mutationEvent)).toBe(true);
  });
});

describe("Cockpit session registry", () => {
  it("rejects expired sessions", () => {
    const registry = new SessionRegistry(
      () => new Date("2031-01-01T00:00:00.000Z"),
    );
    const expired = session("Operador", ["view_incident"]);
    expired.access_token = "expired";
    registry.add(expired);
    expect(() => registry.get("expired")).toThrow(CockpitSessionInvalidError);
    expect(registry.purgeExpired()).toBe(0);
  });

  it("rejects unknown tokens", () => {
    const registry = new SessionRegistry();
    expect(() => registry.get("missing")).toThrow(CockpitSessionInvalidError);
  });
});
