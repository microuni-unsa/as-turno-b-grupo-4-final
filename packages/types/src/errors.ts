import type { JsonObject } from "@pims/types/models.ts";

export type PimsErrorDetails = JsonObject | undefined;

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

export class ConfigError extends PimsBaseError {
  constructor(
    message: string,
    code = "CONFIG_ERROR",
    details?: PimsErrorDetails,
  ) {
    super(message, code, details);
  }
}

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

export class PimsAuthFailedError extends PimsBaseError {
  constructor(
    message = "PIMS authentication failed",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_AUTH_FAILED", details);
  }
}

export class PimsClientBugError extends PimsBaseError {
  constructor(
    message = "PIMS client bug / malformed authorization header",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_CLIENT_BUG", details);
  }
}

export class PimsGateBlockedError extends PimsBaseError {
  readonly gateCode: string;

  constructor(gateCode: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `PIMS gate blocked by code: ${gateCode}`;
    super(msg, `PIMS_GATE_BLOCKED:${gateCode}`, details);
    this.gateCode = gateCode;
  }
}

export class PimsPermissionDeniedError extends PimsBaseError {
  readonly endpoint: string;

  constructor(endpoint: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `Permission denied for PIMS endpoint: ${endpoint}`;
    super(msg, `PIMS_PERMISSION_DENIED:${endpoint}`, details);
    this.endpoint = endpoint;
  }
}

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

export class PimsConflictCodeError extends PimsBaseError {
  constructor(
    message = "PIMS conflict on code sequence or unique constraint",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_CONFLICT_CODE", details);
  }
}

export class PimsThrottledError extends PimsBaseError {
  constructor(
    message = "PIMS request throttled (HTTP 429)",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_THROTTLED", details);
  }
}

export class PimsUnavailableError extends PimsBaseError {
  constructor(
    message = "PIMS service unavailable (HTTP 5xx)",
    details?: PimsErrorDetails,
  ) {
    super(message, "PIMS_UNAVAILABLE", details);
  }
}

export class PimsEmptyListError extends PimsBaseError {
  readonly resource: string;

  constructor(resource: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `No rows returned for resource list: ${resource}`;
    super(msg, `PIMS_EMPTY_LIST:${resource}`, details);
    this.resource = resource;
  }
}

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

export class NotifyNoRecipientsError extends PimsBaseError {
  constructor(
    message = "No active recipients configured for notification",
    details?: PimsErrorDetails,
  ) {
    super(message, "NOTIFY_NO_RECIPIENTS", details);
  }
}

export class RiskPeriodClosedError extends PimsBaseError {
  constructor(
    message = "Risk period is closed or inactive (read-only)",
    details?: PimsErrorDetails,
  ) {
    super(message, "RISK_PERIOD_CLOSED", details);
  }
}

export class ControlNotApplicableError extends PimsBaseError {
  constructor(
    message = "Annex A control is not applicable in SoA",
    details?: PimsErrorDetails,
  ) {
    super(message, "CONTROL_NOT_APPLICABLE", details);
  }
}

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

export class ModelUnavailableError extends PimsBaseError {
  readonly route: string;
  readonly reason: string;

  constructor(route: string, reason: string, details?: PimsErrorDetails) {
    super(
      `Model provider route '${route}' is unavailable: ${reason}`,
      `MODEL_UNAVAILABLE:${route}:${reason}`,
      details,
    );
    this.route = route;
    this.reason = reason;
  }
}

export class ModelSchemaViolationError extends PimsBaseError {
  readonly route: string;

  constructor(route: string, message: string, details?: PimsErrorDetails) {
    super(message, `MODEL_SCHEMA_VIOLATION:${route}`, details);
    this.route = route;
  }
}

export class RagNoEvidenceError extends PimsBaseError {
  constructor(
    message = "No normative or grounding evidence found meeting minimum score threshold",
    details?: PimsErrorDetails,
  ) {
    super(message, "RAG_NO_EVIDENCE", details);
  }
}

export class RagCorpusStaleError extends PimsBaseError {
  constructor(
    message = "RAG corpus is stale; ingest SHA-256 does not match active version",
    details?: PimsErrorDetails,
  ) {
    super(message, "RAG_CORPUS_STALE", details);
  }
}

export class RagIngestLockedError extends PimsBaseError {
  constructor(
    message = "RAG ingestion lock held by another process",
    details?: PimsErrorDetails,
  ) {
    super(message, "RAG_INGEST_LOCKED", details);
  }
}

export class RagEvalFailedError extends PimsBaseError {
  readonly qid: string;

  constructor(qid: string, message: string, details?: PimsErrorDetails) {
    super(message, `RAG_EVAL_FAILED:${qid}`, details);
    this.qid = qid;
  }
}

export class CitationInvalidError extends PimsBaseError {
  readonly detail: string;

  constructor(detail: string, message?: string, details?: PimsErrorDetails) {
    const msg = message ?? `Citation is invalid: ${detail}`;
    super(msg, `CITATION_INVALID:${detail}`, details);
    this.detail = detail;
  }
}

export class CitationFabricatedError extends PimsBaseError {
  readonly chunkId: string;

  constructor(chunkId: string, message?: string, details?: PimsErrorDetails) {
    const msg =
      message ?? `Citation references non-existent chunk ID: ${chunkId}`;
    super(msg, `CITATION_FABRICATED:${chunkId}`, details);
    this.chunkId = chunkId;
  }
}

export class RagIndexError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "RAG_INDEX_ERROR", details);
  }
}
