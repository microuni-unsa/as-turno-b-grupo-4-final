import type { CockpitPermission, CockpitSession } from "@pims/types/cockpit.ts";

const SESSION_STORAGE_KEY = "pims_cockpit_session";

export function saveSession(session: CockpitSession): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
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
