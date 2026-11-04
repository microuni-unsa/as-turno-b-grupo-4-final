import {
  getSession,
  notifySessionExpired,
} from "@pims/cockpit/ui/lib/session.ts";
import type {
  ApproveResponse,
  ChatPersona,
  ChatRequest,
  ChatResponse,
  CockpitLoginRequest,
  CockpitSession,
  ExemptionAttestationRequest,
  ExemptionAttestationResponse,
  RevisionRequest,
} from "@pims/types/cockpit.ts";

export class SessionExpiredError extends Error {
  constructor(message = "La sesión ha expirado o no es válida") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = getSession();
  if (session === null || session.access_token === "") {
    notifySessionExpired("NO_SESSION");
    throw new SessionExpiredError("No hay sesión activa");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    notifySessionExpired("UNAUTHORIZED_RESPONSE");
    throw new SessionExpiredError("Sesión expirada o no autorizada");
  }

  return response;
}

export async function checkSession(): Promise<
  CockpitSession & { remaining_seconds: number }
> {
  const response = await authenticatedFetch("/api/session", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Error al verificar sesión (${response.status})`);
  }
  return (await response.json()) as CockpitSession & {
    remaining_seconds: number;
  };
}

export async function login(
  payload: CockpitLoginRequest,
): Promise<CockpitSession> {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorJson = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      errorJson.message ?? `Error de inicio de sesión (${response.status})`,
    );
  }
  return (await response.json()) as CockpitSession;
}

export async function approveIncident(
  incidentId: number,
): Promise<ApproveResponse> {
  const response = await authenticatedFetch(
    `/api/incidents/${incidentId}/approve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      err.message ?? `Error al aprobar incidente (${response.status})`,
    );
  }
  return (await response.json()) as ApproveResponse;
}

export async function requestRevision(
  incidentId: number,
  payload: RevisionRequest,
): Promise<{ ok: boolean }> {
  const response = await authenticatedFetch(
    `/api/incidents/${incidentId}/revision`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      err.message ?? `Error al solicitar revisión (${response.status})`,
    );
  }
  return (await response.json()) as { ok: boolean };
}

export async function attestExemption(
  incidentId: number,
  payload: ExemptionAttestationRequest,
): Promise<ExemptionAttestationResponse> {
  const response = await authenticatedFetch(
    `/api/incidents/${incidentId}/exemption`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      err.message ?? `Error al atestiguar exención (${response.status})`,
    );
  }
  return (await response.json()) as ExemptionAttestationResponse;
}

export async function sendChat(
  message: string,
  incidentCode?: string,
  persona?: ChatPersona,
): Promise<ChatResponse> {
  const body: ChatRequest = {
    message,
    incident_code: incidentCode,
    persona,
  };
  const response = await authenticatedFetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(err.message ?? `Error en el chat (${response.status})`);
  }
  return (await response.json()) as ChatResponse;
}
