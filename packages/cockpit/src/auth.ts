import type { AgentConfig } from "@pims/config";
import { PimsAdapter } from "@pims/pims-adapter";
import type {
  CockpitPermission,
  CockpitRole,
  CockpitSession,
} from "@pims/types/cockpit.ts";
import {
  CockpitPermissionDeniedError,
  CockpitPermissionsMissingError,
  CockpitRoleConflictError,
  CockpitRoleUnknownError,
  CockpitSessionInvalidError,
  PimsAuthFailedError,
} from "@pims/types/errors.ts";
import type { PimsPermission } from "@pims/types/pims.ts";
import { PimsJwtClaimsSchema } from "@pims/types/pims.ts";

export function normalizeRoleLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ADMIN_LABELS: ReadonlySet<string> = new Set([
  "administrador",
  "admin",
  "platform_admin",
]);
const OPERATOR_LABELS: ReadonlySet<string> = new Set(["operador", "operator"]);
const EDITOR_LABELS: ReadonlySet<string> = new Set([
  "editor",
  "dpo",
  "oficial_de_proteccion_de_datos",
  "oficial_proteccion_datos",
]);
const READER_LABELS: ReadonlySet<string> = new Set([
  "lector",
  "auditor",
  "consultor",
  "auditor_consultor",
  "external_advisor",
]);

export interface NativeRoleInput {
  is_platform_admin?: boolean;
  is_external_advisor?: boolean;
  platform_role?: string | null;
}

export function resolveNativeRole(input: NativeRoleInput): CockpitRole {
  if (input.is_platform_admin === true) {
    return "Administrador";
  }
  if (input.is_external_advisor === true) {
    return "Lector";
  }
  const raw = input.platform_role;
  if (raw === null || raw === undefined || raw.trim() === "") {
    return "Operador";
  }
  const normalized = normalizeRoleLabel(raw);
  if (ADMIN_LABELS.has(normalized)) {
    return "Administrador";
  }
  if (OPERATOR_LABELS.has(normalized)) {
    return "Operador";
  }
  if (EDITOR_LABELS.has(normalized)) {
    return "Editor";
  }
  if (READER_LABELS.has(normalized)) {
    return "Lector";
  }
  throw new CockpitRoleUnknownError(raw);
}

export function derivePermissions(
  permissions: PimsPermission[],
): CockpitPermission[] {
  const byModule = new Map<string, PimsPermission>();
  for (const permission of permissions) {
    byModule.set(permission.modulo, permission);
  }
  const granted: CockpitPermission[] = [];
  const add = (permission: CockpitPermission, module: string): void => {
    if (byModule.get(module)?.ver === true) {
      granted.push(permission);
    }
  };
  add("view_incident", "Incidentes");
  if (byModule.get("Incidentes")?.editar === true) {
    granted.push("change_incident");
  }
  add("view_securitylog", "Seguridad");
  add("view_audit", "Auditorías");
  add("view_riskevaluation", "Riesgos (DPIIA)");
  add("manage_users", "Usuarios y Roles");
  return granted;
}

export function requirePermission(
  session: CockpitSession,
  permission: CockpitPermission,
): void {
  if (!session.permissions.includes(permission)) {
    throw new CockpitPermissionDeniedError(permission);
  }
}

export class SessionRegistry {
  private readonly sessions = new Map<string, CockpitSession>();
  private readonly clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  add(session: CockpitSession): void {
    this.sessions.set(session.access_token, session);
  }

  get(accessToken: string): CockpitSession {
    const session = this.sessions.get(accessToken);
    if (session === undefined) {
      throw new CockpitSessionInvalidError("Unknown cockpit session token");
    }
    if (new Date(session.expires_at_utc).getTime() <= this.clock().getTime()) {
      this.sessions.delete(accessToken);
      throw new CockpitSessionInvalidError("Cockpit session token expired");
    }
    return session;
  }

  purgeExpired(): number {
    const now = this.clock().getTime();
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (new Date(session.expires_at_utc).getTime() <= now) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }
}

function decodeJwtClaims(accessToken: string): unknown {
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) {
    throw new PimsAuthFailedError("PIMS access token is not a JWT");
  }
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    throw new PimsAuthFailedError("PIMS access token payload is not base64url");
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new PimsAuthFailedError("PIMS access token payload is not JSON");
  }
}

export async function loginWithPims(
  username: string,
  password: string,
  config: AgentConfig,
): Promise<CockpitSession> {
  const adapter = new PimsAdapter({
    baseUrl: config.PIMS_BASE_URL,
    schema: config.PIMS_SCHEMA,
    timeoutMs: config.PIMS_TIMEOUT_MS,
    maxRetries: config.PIMS_MAX_RETRIES,
    idempotencyKeyPrefix: config.IDEMPOTENCY_KEY_PREFIX,
    username,
    password,
  });

  const login = await adapter.login(username, password);
  const profile = await adapter.getProfile();
  const claims = PimsJwtClaimsSchema.parse(decodeJwtClaims(login.access));

  if (claims.schema !== config.PIMS_SCHEMA) {
    throw new PimsAuthFailedError("TENANT_SCHEMA_MISMATCH");
  }
  if (claims.exp * 1000 <= Date.now()) {
    throw new PimsAuthFailedError("ACCESS_TOKEN_EXPIRED");
  }

  const loginRole = resolveNativeRole({
    is_platform_admin: login.user.is_platform_admin,
    platform_role: login.user.platform_role ?? null,
  });
  const profileRole = resolveNativeRole({
    is_platform_admin: profile.is_platform_admin,
    is_external_advisor: profile.is_external_advisor,
    platform_role: profile.platform_role ?? null,
  });
  const loginRawRole = login.user.platform_role ?? null;
  const profileRawRole = profile.platform_role ?? null;
  if (
    loginRawRole !== null &&
    profileRawRole !== null &&
    loginRole !== profileRole
  ) {
    throw new CockpitRoleConflictError(
      `PIMS login role '${loginRawRole}' conflicts with profile role '${profileRawRole}'`,
    );
  }

  const permissionRows = login.user.permissions;
  if (permissionRows === undefined) {
    throw new CockpitPermissionsMissingError();
  }

  const nativeRole = loginRole;
  const defaultPersona =
    nativeRole === "Editor"
      ? "dpo"
      : nativeRole === "Lector"
        ? "auditor"
        : "executive";

  return {
    access_token: login.access,
    expires_at_utc: new Date(claims.exp * 1000).toISOString(),
    user_id: login.user.id,
    username: login.user.username,
    schema: claims.schema,
    native_role: nativeRole,
    permissions: derivePermissions(permissionRows),
    default_persona: defaultPersona,
    can_switch_persona:
      nativeRole === "Administrador" || nativeRole === "Operador",
  };
}
