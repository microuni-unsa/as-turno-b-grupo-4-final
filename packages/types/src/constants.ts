/**
 * Centralized Operational Constants & Defaults
 *
 * Implements Rule: No repeated cross-file literals.
 */

export const DEFAULT_PIMS_BASE_URL = "https://unsa.27k.pe";
export const DEFAULT_PIMS_SCHEMA = "unsa";
export const DEFAULT_PIMS_TIMEOUT_MS = 15000;
export const DEFAULT_PIMS_MAX_RETRIES = 3;
export const DEFAULT_IDEMPOTENCY_KEY_PREFIX = "agi1";
export const DEFAULT_RETRY_BACKOFF_MS = [1000, 5000, 30000] as const;
export const MAX_ATTACHMENT_SIZE_MB = 10;
export const MAX_INCIDENT_DESCRIPTION_LENGTH = 1000;

export const EVENT_TYPE_LABELS: Record<string, string> = {
  created: "Creado",
  updated: "Actualizado",
  notified: "Notificado",
  status_changed: "Cambio de estado",
  closed: "Cerrado",
  reopened: "Reabierto",
};
