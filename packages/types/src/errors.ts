import { PLAIN_LANGUAGE_MAX_WORDS } from "@pims/types/constants.ts";
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
  readonly maxWords: number;

  constructor(
    sentenceIndex: number,
    wordCount: number,
    maxWords = PLAIN_LANGUAGE_MAX_WORDS,
    details?: PimsErrorDetails,
  ) {
    super(
      `Sentence ${sentenceIndex} exceeds plain language limit: ${wordCount} words (max ${maxWords})`,
      "PLAIN_LANGUAGE_VIOLATION",
      details,
    );
    this.sentenceIndex = sentenceIndex;
    this.wordCount = wordCount;
    this.maxWords = maxWords;
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

export class CanonicalizationError extends PimsBaseError {
  constructor(
    message = "Value cannot be canonicalized as JSON",
    details?: PimsErrorDetails,
  ) {
    super(message, "CANONICALIZATION_ERROR", details);
  }
}

export class EvidenceStoreWriteError extends PimsBaseError {
  constructor(
    message = "Evidence store write or payload validation failed",
    details?: PimsErrorDetails,
  ) {
    super(message, "EVIDENCE_STORE_WRITE_ERROR", details);
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

export class RoleUnknownError extends PimsBaseError {
  readonly role: string;

  constructor(role: string, details?: PimsErrorDetails) {
    super(`Unknown agent role: ${role}`, `ROLE_UNKNOWN:${role}`, details);
    this.role = role;
  }
}

export class RoleToolDeniedError extends PimsBaseError {
  readonly role: string;
  readonly tool: string;

  constructor(role: string, tool: string, details?: PimsErrorDetails) {
    super(
      `Role '${role}' is not allowed to call tool '${tool}'`,
      `ROLE_TOOL_DENIED:${role}:${tool}`,
      details,
    );
    this.role = role;
    this.tool = tool;
  }
}

export class ToolUnknownError extends PimsBaseError {
  readonly tool: string;

  constructor(tool: string, details?: PimsErrorDetails) {
    super(`Unknown agent tool: ${tool}`, `TOOL_UNKNOWN:${tool}`, details);
    this.tool = tool;
  }
}

export class ToolArgsInvalidError extends PimsBaseError {
  readonly tool: string;
  readonly field: string;

  constructor(tool: string, field: string, details?: PimsErrorDetails) {
    super(
      `Invalid arguments for tool '${tool}' at field '${field}'`,
      `TOOL_ARGS_INVALID:${tool}:${field}`,
      details,
    );
    this.tool = tool;
    this.field = field;
  }
}

export class ToolResultInvalidError extends PimsBaseError {
  readonly tool: string;

  constructor(tool: string, details?: PimsErrorDetails) {
    super(
      `Tool '${tool}' returned a result violating its contract`,
      `TOOL_RESULT_INVALID:${tool}`,
      details,
    );
    this.tool = tool;
  }
}

export class SkillUnknownError extends PimsBaseError {
  readonly skill: string;

  constructor(skill: string, details?: PimsErrorDetails) {
    super(`Unknown agent skill: ${skill}`, `SKILL_UNKNOWN:${skill}`, details);
    this.skill = skill;
  }
}

export class TransitionForbiddenError extends PimsBaseError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string, details?: PimsErrorDetails) {
    super(
      `Forbidden incident status transition: ${from} -> ${to}`,
      `TRANSITION_FORBIDDEN:${from}->${to}`,
      details,
    );
    this.from = from;
    this.to = to;
  }
}

export class ActionSequenceViolationError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "ACTION_SEQUENCE_VIOLATION", details);
  }
}

export class ReviewApprovalMissingError extends PimsBaseError {
  constructor(
    message = "A valid single-use review approval id is required",
    details?: PimsErrorDetails,
  ) {
    super(message, "REVIEW_APPROVAL_MISSING", details);
  }
}

export class ReviewApprovalReusedError extends PimsBaseError {
  constructor(
    message = "Review approval was already consumed (single use only)",
    details?: PimsErrorDetails,
  ) {
    super(message, "REVIEW_APPROVAL_REUSED", details);
  }
}

export class CloseChecklistFailedError extends PimsBaseError {
  readonly item: string;

  constructor(item: string, details?: PimsErrorDetails) {
    super(
      `Close checklist item failed: ${item}`,
      `CLOSE_CHECKLIST_FAILED:${item}`,
      details,
    );
    this.item = item;
  }
}

export class LoopStepSkippedError extends PimsBaseError {
  readonly step: string;

  constructor(step: string, details?: PimsErrorDetails) {
    super(
      `Lifecycle step '${step}' was reached out of order`,
      `LOOP_STEP_SKIPPED:${step}`,
      details,
    );
    this.step = step;
  }
}

export class HistoryGapError extends PimsBaseError {
  constructor(
    message = "Expected a new core_incidenthistory row after a mutation",
    details?: PimsErrorDetails,
  ) {
    super(message, "HISTORY_GAP", details);
  }
}

export class TimerMissingError extends PimsBaseError {
  constructor(
    message = "Required awareness timer is not armed for a PII incident",
    details?: PimsErrorDetails,
  ) {
    super(message, "TIMER_MISSING", details);
  }
}

export class SchedulerDuplicateError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "SCHEDULER_DUPLICATE", details);
  }
}

export class SchedulerPastDueError extends PimsBaseError {
  readonly timerId: string;

  constructor(timerId: string, details?: PimsErrorDetails) {
    super(
      `Timer ${timerId} was already past due and fired immediately as TIMER_FIRED_LATE`,
      "SCHEDULER_PAST_DUE",
      details,
    );
    this.timerId = timerId;
  }
}

export class SchedulerUnknownTimerError extends PimsBaseError {
  readonly timerId: string;

  constructor(timerId: string, details?: PimsErrorDetails) {
    super(
      `Unknown or already fired timer: ${timerId}`,
      "SCHEDULER_UNKNOWN_TIMER",
      details,
    );
    this.timerId = timerId;
  }
}

export class SchedulerOverflowError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "SCHEDULER_OVERFLOW", details);
  }
}

export class IntakeEmptyError extends PimsBaseError {
  constructor(message = "Intake payload is empty", details?: PimsErrorDetails) {
    super(message, "INTAKE_EMPTY", details);
  }
}

export class IntakeFutureDateError extends PimsBaseError {
  constructor(
    message = "Incident date is in the future",
    details?: PimsErrorDetails,
  ) {
    super(message, "INTAKE_FUTURE_DATE", details);
  }
}

export class IntakeTitleTooLongError extends PimsBaseError {
  constructor(
    message = "Intake title exceeds the maximum length and cannot be truncated at a word boundary",
    details?: PimsErrorDetails,
  ) {
    super(message, "INTAKE_TITLE_TOO_LONG", details);
  }
}

export class IntakeDescriptionTooLongError extends PimsBaseError {
  constructor(
    message = "Intake description exceeds the maximum length and cannot be truncated at a word boundary",
    details?: PimsErrorDetails,
  ) {
    super(message, "INTAKE_DESCRIPTION_TOO_LONG", details);
  }
}

export class IntakeSlotAmbiguousError extends PimsBaseError {
  readonly field: string;
  readonly candidates: string[];

  constructor(field: string, candidates: string[], details?: PimsErrorDetails) {
    super(
      `Intake slot '${field}' is ambiguous between candidates: ${candidates.join(",")}`,
      `INTAKE_SLOT_AMBIGUOUS:${field}:${candidates.join(",")}`,
      details,
    );
    this.field = field;
    this.candidates = candidates;
  }
}

export class DuplicateCreatedError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "DUPLICATE_CREATED", details);
  }
}

export class RestoreFailedError extends PimsBaseError {
  readonly incidentCode: string;

  constructor(incidentCode: string, details?: PimsErrorDetails) {
    super(
      `Logical restore rejected or not visible for incident ${incidentCode}`,
      `RESTORE_FAILED:${incidentCode}`,
      details,
    );
    this.incidentCode = incidentCode;
  }
}

export class RiskSignalNoAssetError extends PimsBaseError {
  constructor(
    message = "No tenant asset matches the compromised system; signal queued with asset_pending",
    details?: PimsErrorDetails,
  ) {
    super(message, "RISK_SIGNAL_NO_ASSET", details);
  }
}

export class AuditLinkFailedError extends PimsBaseError {
  readonly reason: string;

  constructor(reason: string, details?: PimsErrorDetails) {
    super(
      `Audit action link failed: ${reason}`,
      `AUDIT_LINK_FAILED:${reason}`,
      details,
    );
    this.reason = reason;
  }
}

export class AuditLinkDuplicateError extends PimsBaseError {
  constructor(
    message = "More than one audit finding matches the incident corrective-action prefix",
    details?: PimsErrorDetails,
  ) {
    super(message, "AUDIT_LINK_DUPLICATE", details);
  }
}

export class EscalateStuckReviewError extends PimsBaseError {
  constructor(
    message = "Review rejected MAX_REVIEW_CYCLES times; notices parked and operator paged",
    details?: PimsErrorDetails,
  ) {
    super(message, "ESCALATE_STUCK_REVIEW", details);
  }
}

export class IndicatorSpoolFullError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "INDICATOR_SPOOL_FULL", details);
  }
}

export class OperatorHaltError extends PimsBaseError {
  constructor(
    message = "OPERATOR_HALT is engaged; new mutations are frozen",
    details?: PimsErrorDetails,
  ) {
    super(message, "OPERATOR_HALT", details);
  }
}

export class ConformalCalibrationError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "CONFORMAL_CALIBRATION_ERROR", details);
  }
}

export class PromptPiiBlockedError extends PimsBaseError {
  readonly fields: string[];

  constructor(fields: string[], details?: PimsErrorDetails) {
    super(
      `Prompt PII gate blocked model call for fields: ${fields.join(",")}`,
      "PROMPT_PII_BLOCKED",
      details,
    );
    this.fields = fields;
  }
}

export class PiiRedactionUnavailableError extends PimsBaseError {
  constructor(
    message = "Presidio PII redaction sidecar is unavailable",
    details?: PimsErrorDetails,
  ) {
    super(message, "PII_REDACTION_UNAVAILABLE", details);
  }
}

export class FormNarrativeTooLongError extends PimsBaseError {
  readonly cap: number;
  readonly length: number;

  constructor(cap: number, length: number, details?: PimsErrorDetails) {
    super(
      `Form narrative of ${length} characters exceeds maximum cap of ${cap}`,
      "FORM_NARRATIVE_TOO_LONG",
      details,
    );
    this.cap = cap;
    this.length = length;
  }
}

export class RootCauseUnprovenError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "ROOT_CAUSE_UNPROVEN", details);
  }
}

export class RootCauseAmbiguousError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "ROOT_CAUSE_AMBIGUOUS", details);
  }
}

export const DEADLINE_MISSED_KINDS = ["72H", "SUBJECT", "REVIEW_SLA"] as const;
export type DeadlineMissedKind = (typeof DEADLINE_MISSED_KINDS)[number];

export class DeadlineMissedError extends PimsBaseError {
  readonly kind: DeadlineMissedKind;

  constructor(kind: DeadlineMissedKind, details?: PimsErrorDetails) {
    super(`Deadline missed: ${kind}`, `DEADLINE_MISSED_${kind}`, details);
    this.kind = kind;
  }
}

export class PeruAdvisoryError extends PimsBaseError {
  constructor(
    message = "Peru 48h advisory clock reached (advisory only, never blocks close)",
    details?: PimsErrorDetails,
  ) {
    super(message, "PERU_48H_ADVISORY", details);
  }
}

export class CockpitRoleUnknownError extends PimsBaseError {
  readonly role: string;

  constructor(role: string, details?: PimsErrorDetails) {
    super(
      `Unknown PIMS platform role: ${role}`,
      "COCKPIT_ROLE_UNKNOWN",
      details,
    );
    this.role = role;
  }
}

export class CockpitRoleConflictError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "COCKPIT_ROLE_CONFLICT", details);
  }
}

export class CockpitPermissionDeniedError extends PimsBaseError {
  readonly permission: string;

  constructor(permission: string, details?: PimsErrorDetails) {
    super(
      `Cockpit permission denied: ${permission}`,
      "COCKPIT_PERMISSION_DENIED",
      details,
    );
    this.permission = permission;
  }
}

export class CockpitSessionInvalidError extends PimsBaseError {
  constructor(
    message = "Cockpit session is invalid or expired",
    details?: PimsErrorDetails,
  ) {
    super(message, "COCKPIT_SESSION_INVALID", details);
  }
}

export class CockpitPermissionsMissingError extends PimsBaseError {
  constructor(
    message = "PIMS login response did not include the permissions matrix",
    details?: PimsErrorDetails,
  ) {
    super(message, "COCKPIT_PERMISSIONS_MISSING", details);
  }
}

export class CockpitPiiBlockedError extends PimsBaseError {
  readonly fields: string[];

  constructor(fields: string[], details?: PimsErrorDetails) {
    super(
      `Cockpit chat response blocked by the PII gate for fields: ${fields.join(",")}`,
      "COCKPIT_PII_BLOCKED",
      details,
    );
    this.fields = fields;
  }
}

export class CockpitChatInvalidError extends PimsBaseError {
  constructor(message: string, details?: PimsErrorDetails) {
    super(message, "COCKPIT_CHAT_INVALID", details);
  }
}
