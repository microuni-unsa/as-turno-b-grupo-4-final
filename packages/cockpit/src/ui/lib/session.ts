import type { CockpitPermission, CockpitSession } from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";

export const SESSION_STORAGE_KEY = "pims_cockpit_session";
export const EVENT_SESSION_EXPIRED = "cockpit:session-expired";
export const REASON_TOKEN_EXPIRED = "TOKEN_EXPIRED";
export const REASON_SESSION_EXPIRED = "SESSION_EXPIRED";

let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

export function notifySessionExpired(reason: string): void {
  clearSession();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(EVENT_SESSION_EXPIRED, {
        detail: { reason },
      }),
    );
  } else {
    // Non-browser / SSR environment: event dispatch skipped
  }
}

export function startSessionWatchdog(): void {
  stopSessionWatchdog();
  if (typeof window === "undefined") {
    return;
  }
  const session = getSession();
  if (session === null) {
    return;
  }
  const expiresAt = new Date(session.expires_at_utc).getTime();
  const msRemaining = expiresAt - Date.now();
  if (msRemaining <= 0) {
    notifySessionExpired(REASON_TOKEN_EXPIRED);
    return;
  }
  watchdogTimer = setTimeout(() => {
    notifySessionExpired(REASON_TOKEN_EXPIRED);
  }, msRemaining);
}

export function stopSessionWatchdog(): void {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  } else {
    // No active watchdog timer
  }
}

export function saveSession(session: CockpitSession): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!session || typeof session !== "object") {
    throw new Error("Invalid session object provided to saveSession");
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  startSessionWatchdog();
}

export function getSession(): CockpitSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  try {
    const session = JSON.parse(raw) as CockpitSession;
    const expiresAt = new Date(session.expires_at_utc).getTime();
    if (Date.now() >= expiresAt) {
      clearSession();
      return null;
    }
    return session;
  } catch (err) {
    clearSession();
    throw new Error(
      `Failed to parse cockpit session from storage: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function clearSession(): void {
  stopSessionWatchdog();
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function hasPermission(
  session: CockpitSession | null,
  permission: CockpitPermission,
): boolean {
  if (session === null) {
    return false;
  }
  if (
    permission === CONSTANTS.PERMISSION_VIEW_SECURITYLOG &&
    (session.native_role === "Operador" ||
      session.native_role === "Administrador")
  ) {
    return true;
  }
  return session.permissions.includes(permission);
}

export function canSwitchPersona(session: CockpitSession | null): boolean {
  if (session === null) {
    return false;
  }
  return session.can_switch_persona;
}
