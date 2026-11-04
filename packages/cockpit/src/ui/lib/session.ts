import type { CockpitPermission, CockpitSession } from "@pims/types/cockpit.ts";

const SESSION_STORAGE_KEY = "pims_cockpit_session";
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

export function notifySessionExpired(reason = "SESSION_EXPIRED"): void {
  clearSession();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("cockpit:session-expired", {
        detail: { reason },
      }),
    );
  }
}

export function startSessionWatchdog(): void {
  stopSessionWatchdog();
  if (typeof window === "undefined") {
    return;
  }
  const session = getSession();
  if (!session) {
    return;
  }
  const expiresAt = new Date(session.expires_at_utc).getTime();
  const msRemaining = expiresAt - Date.now();
  if (msRemaining <= 0) {
    notifySessionExpired("TOKEN_EXPIRED");
    return;
  }
  watchdogTimer = setTimeout(() => {
    notifySessionExpired("TOKEN_EXPIRED");
  }, msRemaining);
}

export function stopSessionWatchdog(): void {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

export function saveSession(session: CockpitSession): void {
  if (typeof window === "undefined") {
    return;
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
  } catch {
    clearSession();
    return null;
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
  return session.permissions.includes(permission);
}

export function canSwitchPersona(session: CockpitSession | null): boolean {
  if (session === null) {
    return false;
  }
  return session.can_switch_persona;
}
