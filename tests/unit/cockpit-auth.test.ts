import {
  derivePermissions,
  normalizeRoleLabel,
  requirePermission,
  resolveNativeRole,
  SessionRegistry,
} from "@pims/cockpit/auth.ts";
import { resolvePersona } from "@pims/cockpit/chat.ts";
import { canReceiveEvent } from "@pims/cockpit/event-hub.ts";
import { hasPermission } from "@pims/cockpit/ui/lib/session.ts";
import type { AgentEvent } from "@pims/types/agent.ts";
import type {
  CockpitPermission,
  CockpitRole,
  CockpitSession,
} from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  CockpitPermissionDeniedError,
  CockpitRoleUnknownError,
  CockpitSessionInvalidError,
} from "@pims/types/errors.ts";
import type { PimsPermission } from "@pims/types/pims.ts";
import {
  TEST_ALT_INCIDENT_CODE,
  TEST_DATE_2026_10_01,
  TEST_SCHEMA,
} from "@tests/helpers/test-constants.ts";
import { describe, expect, it } from "vitest";

function session(
  role: CockpitRole,
  permissions: CockpitPermission[],
  canSwitch: boolean,
): CockpitSession {
  let default_persona: "dpo" | "auditor" | "executive";
  if (role === "Editor") {
    default_persona = "dpo";
  } else if (role === "Lector") {
    default_persona = "auditor";
  } else if (role === "Operador" || role === "Administrador") {
    default_persona = "executive";
  } else {
    throw new Error(`Unhandled CockpitRole: ${role}`);
  }

  return {
    access_token: "token",
    expires_at_utc: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    user_id: 1,
    username: "operator",
    schema: TEST_SCHEMA,
    native_role: role,
    permissions,
    default_persona,
    can_switch_persona: canSwitch,
  };
}

function permission(
  modulo: string,
  overrides: Partial<PimsPermission>,
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
  at_utc: `${TEST_DATE_2026_10_01}T10:00:00.000Z`,
  incident_code: TEST_ALT_INCIDENT_CODE,
  role: "triage",
  previous_role: null,
  lease_holder: "agent:1",
};

const mutationEvent: AgentEvent = {
  type: "tool:mutation",
  at_utc: `${TEST_DATE_2026_10_01}T10:00:00.000Z`,
  incident_code: TEST_ALT_INCIDENT_CODE,
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

  it("grants view_securitylog to Operador and Administrador even if module Seguridad is absent", () => {
    const operatorPermissions = derivePermissions(
      [permission("Incidentes", { ver: true })],
      "Operador",
    );
    expect(operatorPermissions).toContain(
      CONSTANTS.PERMISSION_VIEW_SECURITYLOG,
    );

    const adminPermissions = derivePermissions(
      [permission("Incidentes", { ver: true })],
      "Administrador",
    );
    expect(adminPermissions).toContain(CONSTANTS.PERMISSION_VIEW_SECURITYLOG);
  });

  it("does not grant view_securitylog to Editor or Lector if module Seguridad is absent", () => {
    const editorPermissions = derivePermissions(
      [permission("Incidentes", { ver: true })],
      "Editor",
    );
    expect(editorPermissions).not.toContain(
      CONSTANTS.PERMISSION_VIEW_SECURITYLOG,
    );

    const lectorPermissions = derivePermissions(
      [permission("Incidentes", { ver: true })],
      "Lector",
    );
    expect(lectorPermissions).not.toContain(
      CONSTANTS.PERMISSION_VIEW_SECURITYLOG,
    );
  });
});

describe("Cockpit persona authorization", () => {
  it("uses the session default persona when none is requested", () => {
    expect(
      resolvePersona(session("Editor", ["view_incident"], false), undefined),
    ).toBe("dpo");
  });

  it("rejects persona switching for pinned roles", () => {
    expect(() =>
      resolvePersona(session("Lector", ["view_incident"], false), "executive"),
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
    expect(canReceiveEvent(session("Lector", [], false), roleEvent)).toBe(
      false,
    );
  });

  it("hides tool mutations without view_securitylog", () => {
    const reader = session(
      "Editor",
      ["view_incident", "change_incident", "view_audit"],
      false,
    );
    expect(canReceiveEvent(reader, roleEvent)).toBe(true);
    expect(canReceiveEvent(reader, mutationEvent)).toBe(false);
  });

  it("streams tool mutations to operators with view_securitylog", () => {
    const operator = session(
      "Operador",
      ["view_incident", "view_securitylog"],
      false,
    );
    expect(canReceiveEvent(operator, mutationEvent)).toBe(true);
  });

  it("streams tool mutations to operators even without view_securitylog in permissions list", () => {
    const operator = session("Operador", ["view_incident"], false);
    expect(canReceiveEvent(operator, mutationEvent)).toBe(true);
  });

  it("streams tool mutations to administrators even without view_securitylog in permissions list", () => {
    const admin = session("Administrador", ["view_incident"], true);
    expect(canReceiveEvent(admin, mutationEvent)).toBe(true);
  });
});

describe("Cockpit permission checks and session helpers", () => {
  it("requirePermission allows view_securitylog for Operador and Administrador", () => {
    const operator = session("Operador", ["view_incident"], false);
    const admin = session("Administrador", ["view_incident"], true);

    expect(() =>
      requirePermission(operator, CONSTANTS.PERMISSION_VIEW_SECURITYLOG),
    ).not.toThrow();
    expect(() =>
      requirePermission(admin, CONSTANTS.PERMISSION_VIEW_SECURITYLOG),
    ).not.toThrow();
  });

  it("requirePermission rejects view_securitylog for Editor and Lector without permission", () => {
    const editor = session("Editor", ["view_incident"], false);
    const lector = session("Lector", ["view_incident"], false);

    expect(() =>
      requirePermission(editor, CONSTANTS.PERMISSION_VIEW_SECURITYLOG),
    ).toThrow(CockpitPermissionDeniedError);
    expect(() =>
      requirePermission(lector, CONSTANTS.PERMISSION_VIEW_SECURITYLOG),
    ).toThrow(CockpitPermissionDeniedError);
  });

  it("hasPermission allows view_securitylog for Operador and Administrador", () => {
    const operator = session("Operador", ["view_incident"], false);
    const admin = session("Administrador", ["view_incident"], true);

    expect(hasPermission(operator, CONSTANTS.PERMISSION_VIEW_SECURITYLOG)).toBe(
      true,
    );
    expect(hasPermission(admin, CONSTANTS.PERMISSION_VIEW_SECURITYLOG)).toBe(
      true,
    );
  });

  it("hasPermission rejects view_securitylog for Editor and Lector without permission", () => {
    const editor = session("Editor", ["view_incident"], false);
    const lector = session("Lector", ["view_incident"], false);

    expect(hasPermission(editor, CONSTANTS.PERMISSION_VIEW_SECURITYLOG)).toBe(
      false,
    );
    expect(hasPermission(lector, CONSTANTS.PERMISSION_VIEW_SECURITYLOG)).toBe(
      false,
    );
  });

  it("hasPermission returns false for null session", () => {
    expect(hasPermission(null, CONSTANTS.PERMISSION_VIEW_SECURITYLOG)).toBe(
      false,
    );
  });
});

describe("Cockpit session registry", () => {
  it("rejects expired sessions", () => {
    const registry = new SessionRegistry(
      () => new Date("2031-01-01T00:00:00.000Z"),
    );
    const expired = session("Operador", ["view_incident"], false);
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
