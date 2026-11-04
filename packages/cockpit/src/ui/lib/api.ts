import { getSession } from "@pims/cockpit/ui/lib/session.ts";
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

function getAuthHeader(): Record<string, string> {
  const session = getSession();
  if (session === null || session.access_token === "") {
    return {};
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
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
  const response = await fetch(`/api/incidents/${incidentId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
  });
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
  const response = await fetch(`/api/incidents/${incidentId}/revision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(payload),
  });
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
  const response = await fetch(`/api/incidents/${incidentId}/exemption`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(payload),
  });
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
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
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
