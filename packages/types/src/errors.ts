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
  readonly fields?: PimsErrorDetails;

  constructor(
    field: string,
    message?: string,
    fields?: PimsErrorDetails,
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

export class ArtifactIncompleteError extends PimsBaseError {
  readonly artifact: string;
  readonly field: string;

  constructor(artifact: string, field: string, details?: PimsErrorDetails) {
    super(
      `Artifact '${artifact}' is incomplete; missing required field: ${field}`,
      `ARTIFACT_INCOMPLETE:${artifact}:${field}`,
      details,
    );
    this.artifact = artifact;
    this.field = field;
  }
}

export class AttachmentRejectedError extends PimsBaseError {
  readonly reason: string;

  constructor(reason: string, details?: PimsErrorDetails) {
    super(
      `Attachment rejected: ${reason}`,
      `ATTACHMENT_REJECTED:${reason}`,
      details,
    );
    this.reason = reason;
  }
}

export class AttachmentHashMismatchError extends PimsBaseError {
  constructor(
    message = "Attachment SHA-256 pre-upload and post-upload verification mismatch",
    details?: PimsErrorDetails,
  ) {
    super(message, "ATTACHMENT_HASH_MISMATCH", details);
  }
}

export class BundlePimsMismatchError extends PimsBaseError {
  readonly fileName: string;

  constructor(fileName: string, details?: PimsErrorDetails) {
    super(
      `Bundle manifest does not match PIMS attachments for file: ${fileName}`,
      `BUNDLE_PIMS_MISMATCH:${fileName}`,
      details,
    );
    this.fileName = fileName;
  }
}

export class BundleAlreadySealedError extends PimsBaseError {
  constructor(
    message = "Evidence bundle is already sealed and cannot be modified",
    details?: PimsErrorDetails,
  ) {
    super(message, "BUNDLE_ALREADY_SEALED", details);
  }
}

export class ReviewApprovalInvalidError extends PimsBaseError {
  constructor(
    message = "Review approval ID is invalid or content hash mismatch",
    details?: PimsErrorDetails,
  ) {
    super(message, "REVIEW_APPROVAL_INVALID", details);
  }
}

export class ReviewRejectedError extends PimsBaseError {
  readonly judge: string;
  readonly item: string;
  readonly fix: string;

  constructor(
    judge: string,
    item: string,
    fix: string,
    details?: PimsErrorDetails,
  ) {
    super(
      `Review rejected by ${judge} on ${item}: ${fix}`,
      `REVIEW_REJECTED:${judge}:${item}:${fix}`,
      details,
    );
    this.judge = judge;
    this.item = item;
    this.fix = fix;
  }
}

export class ExportVersionUnknownError extends PimsBaseError {
  readonly version: string;

  constructor(version: string, details?: PimsErrorDetails) {
    super(
      `Audit export version '${version}' is unknown`,
      `EXPORT_VERSION_UNKNOWN:${version}`,
      details,
    );
    this.version = version;
  }
}

export class LinkDanglingError extends PimsBaseError {
  readonly linkType: string;
  readonly targetId: string;

  constructor(linkType: string, targetId: string, details?: PimsErrorDetails) {
    super(
      `Dangling ${linkType} link to id ${targetId}`,
      `LINK_DANGLING:${linkType}:${targetId}`,
      details,
    );
    this.linkType = linkType;
    this.targetId = targetId;
  }
}

export class PathEscapeError extends PimsBaseError {
  readonly attemptedPath: string;

  constructor(attemptedPath: string, details?: PimsErrorDetails) {
    super(
      `Path escape detected outside sandbox: ${attemptedPath}`,
      "PATH_ESCAPE",
      details,
    );
    this.attemptedPath = attemptedPath;
  }
}

export class LeaseLostError extends PimsBaseError {
  readonly incidentCode: string;

  constructor(incidentCode: string, details?: PimsErrorDetails) {
    super(
      `Execution lease lost for incident ${incidentCode}`,
      "LEASE_LOST",
      details,
    );
    this.incidentCode = incidentCode;
  }
}

export class LeaseHeldError extends PimsBaseError {
  readonly holder: string;

  constructor(holder: string, details?: PimsErrorDetails) {
    super(
      `Execution lease is held by another worker: ${holder}`,
      `LEASE_HELD_BY:${holder}`,
      details,
    );
    this.holder = holder;
  }
}

export class ExemptionUngroundedError extends PimsBaseError {
  readonly letter: string;
  readonly reason: string;

  constructor(letter: string, reason: string, details?: PimsErrorDetails) {
    super(
      `Article 34(3) exemption (${letter}) ungrounded: ${reason}`,
      `EXEMPTION_UNGROUNDED:${letter}:${reason}`,
      details,
    );
    this.letter = letter;
    this.reason = reason;
  }
}

export class PlainLanguageViolationError extends PimsBaseError {
  readonly sentenceIndex: number;
  readonly wordCount: number;

  constructor(
    sentenceIndex: number,
    wordCount: number,
    details?: PimsErrorDetails,
  ) {
    super(
      `Sentence ${sentenceIndex} exceeds plain language limit: ${wordCount} words (max 25)`,
      "PLAIN_LANGUAGE_VIOLATION",
      details,
    );
    this.sentenceIndex = sentenceIndex;
    this.wordCount = wordCount;
  }
}

export class SubjectCountForbiddenError extends PimsBaseError {
  constructor(
    message = "Subject counts are strictly forbidden in Art 34 body unless approved by reviewer waiver",
    details?: PimsErrorDetails,
  ) {
    super(message, "SUBJECT_COUNT_FORBIDDEN", details);
  }
}

export class EvidenceStoreEncryptionError extends PimsBaseError {
  constructor(
    message = "Evidence store cryptographic verification or decryption failed",
    details?: PimsErrorDetails,
  ) {
    super(message, "EVIDENCE_STORE_ENCRYPTION_ERROR", details);
  }
}

export class EvidenceNotFoundError extends PimsBaseError {
  readonly entity: string;
  readonly entityId: string | number;

  constructor(entity: string, id: string | number, details?: PimsErrorDetails) {
    super(
      `Evidence entity '${entity}' with id '${id}' not found`,
      `EVIDENCE_NOT_FOUND:${entity}:${id}`,
      details,
    );
    this.entity = entity;
    this.entityId = id;
  }
}
