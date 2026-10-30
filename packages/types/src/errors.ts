/**
 * PIMS Error Taxonomy
 *
 * Implements named error hierarchy per §3.6 of Agente de Incidentes specification.
 * Every failure branch in PIMS operations maps deterministically to an explicit named error.
 */

export type PimsErrorDetails =
  | Record<
      string,
      | string
      | number
      | boolean
      | null
      | string[]
      | Record<string, string[]>
      | Record<string, unknown>
    >
  | undefined;

export class PimsBaseError extends Error {
  readonly code: string;
  readonly details?: PimsErrorDetails;

  constructor(message: string, code: string, details?: PimsErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Configuration loading and decryption errors.
 */
export class ConfigError extends PimsBaseError {
  constructor(
    message: string,
    code = "CONFIG_ERROR",
    details?: PimsErrorDetails,
  ) {
    super(message, code, details);
  }
}

/**
 * Validation failure (HTTP 400 with field errors).
 * Code: PIMS_VALIDATION:<field>
 */
export class PimsValidationError extends PimsBaseError {
  readonly field: string;
  readonly fields?: Record<string, string[]>;

  constructor(
    field: string,
    message?: string,
    fields?: Record<string, string[]>,
    details?: PimsErrorDetails,
  ) {
    const errorDetails = details ?? fields;
    const msg = message ?? `Validation failed for field: ${field}`;
    super(msg, `PIMS_VALIDATION:${field}`, errorDetails);
    this.field = field;
    this.fields = fields;
  }
}

/**
 * Authentication failure (HTTP 401 with missing/invalid/expired token or schema mismatch).
 * Code: PIMS_AUTH_FAILED
 */
export class PimsAuthFailedError extends PimsBaseError {
  constructor(
    message = "PIMS authentication failed",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_AUTH_FAILED", details);
  }
}

/**
 * Client-side malformed authorization header or request format bug.
 * Code: PIMS_CLIENT_BUG
 */
export class PimsClientBugError extends PimsBaseError {
  constructor(
    message = "PIMS client bug / malformed authorization header",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_CLIENT_BUG", details);
  }
}

/**
 * License or platform gate blocked (HTTP 403 LICENSE_EXPIRED / SERVICE_SUSPENDED / DOCUMENT_LIMIT_REACHED).
 * Code: PIMS_GATE_BLOCKED:<code>
 */
export class PimsGateBlockedError extends PimsBaseError {
  readonly gateCode: string;

  constructor(gateCode: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `PIMS gate blocked by code: ${gateCode}`;
    super(msg, `PIMS_GATE_BLOCKED:${gateCode}`, details);
    this.gateCode = gateCode;
  }
}

/**
 * Missing module permission for endpoint (HTTP 403).
 * Code: PIMS_PERMISSION_DENIED:<endpoint>
 */
export class PimsPermissionDeniedError extends PimsBaseError {
  readonly endpoint: string;

  constructor(endpoint: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `Permission denied for PIMS endpoint: ${endpoint}`;
    super(msg, `PIMS_PERMISSION_DENIED:${endpoint}`, details);
    this.endpoint = endpoint;
  }
}

/**
 * Resource not found or tenant boundary isolation (HTTP 404).
 * Code: PIMS_NOT_FOUND:<model>:<id>
 */
export class PimsNotFoundError extends PimsBaseError {
  readonly model: string;
  readonly entityId: string | number;

  constructor(
    model: string,
    id: string | number,
    message?: string,
    details?: PimsErrorDetails,
  ) {
    const msg = message ?? `No ${model} matches query for id ${id}`;
    super(msg, `PIMS_NOT_FOUND:${model}:${id}`, details);
    this.model = model;
    this.entityId = id;
  }
}

/**
 * Conflict on system code sequence or unique key (HTTP 409).
 * Code: PIMS_CONFLICT_CODE
 */
export class PimsConflictCodeError extends PimsBaseError {
  constructor(
    message = "PIMS conflict on code sequence or unique constraint",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_CONFLICT_CODE", details);
  }
}

/**
 * Request throttled by rate limit (HTTP 429).
 * Code: PIMS_THROTTLED
 */
export class PimsThrottledError extends PimsBaseError {
  constructor(
    message = "PIMS request throttled (HTTP 429)",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_THROTTLED", details);
  }
}

/**
 * Server failure (HTTP 5xx) after exhausting retries.
 * Code: PIMS_UNAVAILABLE
 */
export class PimsUnavailableError extends PimsBaseError {
  constructor(
    message = "PIMS service unavailable (HTTP 5xx)",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_UNAVAILABLE", details);
  }
}

/**
 * List resource returned empty results when non-empty was expected.
 * Code: PIMS_EMPTY_LIST:<resource>
 */
export class PimsEmptyListError extends PimsBaseError {
  readonly resource: string;

  constructor(resource: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `No rows returned for resource list: ${resource}`;
    super(msg, `PIMS_EMPTY_LIST:${resource}`, details);
    this.resource = resource;
  }
}

/**
 * Attachment file missing or 404 on download URL.
 * Code: PIMS_ATTACHMENT_MISSING:<id>
 */
export class PimsAttachmentMissingError extends PimsBaseError {
  readonly attachmentId: string | number;

  constructor(
    id: string | number,
    message?: string,
    details?: PimsErrorDetails,
  ) {
    const msg = message ?? `Attachment file missing for attachment id: ${id}`;
    super(msg, `PIMS_ATTACHMENT_MISSING:${id}`, details);
    this.attachmentId = id;
  }
}

/**
 * E13 notification attempted with zero active recipients configured.
 * Code: NOTIFY_NO_RECIPIENTS
 */
export class NotifyNoRecipientsError extends PimsBaseError {
  constructor(
    message = "No active recipients configured for notification",
    details?: PimsErrorDetails,
  ) {
    super(message, "NOTIFY_NO_RECIPIENTS", details);
  }
}

/**
 * Attempted write into a closed or inactive risk period.
 * Code: RISK_PERIOD_CLOSED
 */
export class RiskPeriodClosedError extends PimsBaseError {
  constructor(
    message = "Risk period is closed or inactive (read-only)",
    details?: PimsErrorDetails,
  ) {
    super(message, "RISK_PERIOD_CLOSED", details);
  }
}

/**
 * Annex A control selected in treatment is not marked applicable in Statement of Applicability (SoA).
 * Code: CONTROL_NOT_APPLICABLE
 */
export class ControlNotApplicableError extends PimsBaseError {
  constructor(
    message = "Annex A control is not applicable in SoA",
    details?: PimsErrorDetails,
  ) {
    super(message, "CONTROL_NOT_APPLICABLE", details);
  }
}

/**
 * PIMS error response body shape could not be parsed as standard DRF.
 * Code: PIMS_ERROR_SHAPE_UNKNOWN
 */
export class PimsErrorShapeUnknownError extends PimsBaseError {
  readonly rawBody?: string;

  constructor(
    message = "PIMS returned an unparseable error shape",
    rawBody?: string,
    details?: PimsErrorDetails,
  ) {
    super(
      message,
      "PIMS_ERROR_SHAPE_UNKNOWN",
      details ?? { rawBody: rawBody ?? "" },
    );
    this.rawBody = rawBody;
  }
}

/**
 * Unknown code received from PIMS catalog or enum.
 * Code: PIMS_UNKNOWN_CODE:<field>:<code>
 */
export class PimsUnknownCodeError extends PimsBaseError {
  readonly field: string;
  readonly unknownCode: string;

  constructor(
    field: string,
    code: string,
    message?: string,
    details?: PimsErrorDetails,
  ) {
    const msg =
      message ?? `Unknown code '${code}' encountered for field '${field}'`;
    super(msg, `PIMS_UNKNOWN_CODE:${field}:${code}`, details);
    this.field = field;
    this.unknownCode = code;
  }
}
