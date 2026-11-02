import {
  EvidenceAttachmentSchema,
  ForensicScanResultSchema,
  RiskSignalPayloadSchema as RiskSignalPayloadEvidenceSchema,
  TimerRecordSchema,
  type TotMethod,
  TotMethodSchema,
} from "@pims/types/evidence.ts";
import {
  type JsonObject,
  JsonObjectSchema,
  RankedPassageSchema,
} from "@pims/types/models.ts";
import {
  Art34ExemptionLetterSchema,
  ExemptionEvaluationInputSchema,
  ExemptionEvaluationResultSchema,
  HighRiskGateResultSchema,
  NumericApprovalSchema,
  PlainLanguageWaiverSchema,
} from "@pims/types/notices.ts";
import {
  ACTION_PLAN_STATUSES,
  ACTION_TYPES,
  AFFECTED_CID,
  ALL_AFFECTED_DATA_TYPES,
  ALL_SECURITY_MEASURES,
  FINDING_CLASSIFICATIONS,
  INCIDENT_IMPACTS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  PimsIncidentActionSchema,
  PimsIncidentCreateSchema,
  PimsIncidentHistorySchema,
  PimsIncidentRecipientSchema,
  PimsIncidentSchema,
  PimsIncidentUpdateSchema,
  PimsRiskEvaluationSchema,
  paginatedResultSchema,
} from "@pims/types/pims.ts";
import { z } from "zod";

export const AGENT_ROLES = [
  "orchestrator",
  "intake",
  "triage",
  "investigator",
  "drafter",
  "compliance_reviewer",
  "notifier",
  "monitor",
] as const;
export const AgentRoleSchema = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AGENT_SKILLS = [
  "pims-incident-crud",
  "pims-notify",
  "risk-linker",
  "audit-action-linker",
  "gdpr-notice-drafter",
  "root-cause-analyzer",
  "evidence-collector",
  "deadline-scheduler",
  "indicator-reporter",
  "rag-grounded-qa",
] as const;
export const SkillNameSchema = z.enum(AGENT_SKILLS);
export type SkillName = z.infer<typeof SkillNameSchema>;

export const AGENT_TOOL_NAMES = [
  "pims_login",
  "pims_list_incidents",
  "pims_get_incident",
  "pims_create_incident",
  "pims_update_incident",
  "pims_transition_status",
  "pims_add_action",
  "pims_upload_attachment",
  "pims_list_recipients",
  "pims_manage_recipient",
  "pims_notify",
  "pims_get_history",
  "pims_search_risks",
  "pims_emit_risk_signal",
  "pims_create_audit_action",
  "rag_query",
  "scheduler_arm",
  "scheduler_cancel",
  "indicator_emit",
] as const;
export const ToolNameSchema = z.enum(AGENT_TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const TIMER_KINDS = [
  "T72_AUTHORITY",
  "T_PROCESSOR",
  "T_SUBJECT",
  "T_REVIEW_SLA",
  "T_PERU_ADVISORY",
  "T_PHASE_FOLLOWUP",
  "T_RETRY",
] as const;
export const TimerKindSchema = z.enum(TIMER_KINDS);
export type TimerKind = z.infer<typeof TimerKindSchema>;

export const LIFECYCLE_STAGES = [
  "capture",
  "dedupe",
  "triage",
  "investigate",
  "draft",
  "review",
  "approve_notify",
  "monitor",
  "close",
] as const;
export const LifecycleStageSchema = z.enum(LIFECYCLE_STAGES);
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;

export const CLOSE_CHECKLIST_ITEMS = [
  "analysis_action",
  "resolution_action_or_considered",
  "reviewer_signoff",
  "art33_documentation",
  "notices_terminal",
  "resolved_date",
  "corrective_action",
  "bundle_sealed",
] as const;
export const CloseChecklistItemSchema = z.enum(CLOSE_CHECKLIST_ITEMS);
export type CloseChecklistItem = z.infer<typeof CloseChecklistItemSchema>;

export const NOTICE_PACK_TYPES = [
  "authority",
  "subject",
  "resolution",
] as const;
export const NoticePackTypeSchema = z.enum(NOTICE_PACK_TYPES);
export type NoticePackType = z.infer<typeof NoticePackTypeSchema>;

export const PROSECUTOR_SEVERITIES = ["low", "medium", "high"] as const;
export const ProsecutorSeveritySchema = z.enum(PROSECUTOR_SEVERITIES);
export type ProsecutorSeverity = z.infer<typeof ProsecutorSeveritySchema>;

export const TRIAGE_CALIBRATION_MODES = [
  "cold_start",
  "split_conformal",
] as const;
export const TriageCalibrationModeSchema = z.enum(TRIAGE_CALIBRATION_MODES);
export type TriageCalibrationMode = z.infer<typeof TriageCalibrationModeSchema>;

export const RoleDefinitionSchema = z
  .object({
    role: AgentRoleSchema,
    prompt_version: z.string().min(1),
    prompt_sha256: z.string().length(64),
    system_prompt: z.string().min(1),
    autonomy: z.string().min(1),
    allowed_tools: z.array(ToolNameSchema),
    denied_tools: z.array(ToolNameSchema),
  })
  .strict();
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

export const RoleToolMatrixSchema = z
  .object({
    orchestrator: z.array(ToolNameSchema),
    intake: z.array(ToolNameSchema),
    triage: z.array(ToolNameSchema),
    investigator: z.array(ToolNameSchema),
    drafter: z.array(ToolNameSchema),
    compliance_reviewer: z.array(ToolNameSchema),
    notifier: z.array(ToolNameSchema),
    monitor: z.array(ToolNameSchema),
  })
  .strict();
export type RoleToolMatrix = z.infer<typeof RoleToolMatrixSchema>;

export const SkillDefinitionSchema = z
  .object({
    skill: SkillNameSchema,
    tools: z.array(ToolNameSchema),
    selector_rule: z.string().min(1),
  })
  .strict();
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

export const PimsLoginArgsSchema = z.object({}).strict();
export type PimsLoginArgs = z.infer<typeof PimsLoginArgsSchema>;

export const PimsListIncidentsArgsSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    incident_type: z.enum(INCIDENT_TYPES).optional(),
    search: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional(),
  })
  .strict();
export type PimsListIncidentsArgs = z.infer<typeof PimsListIncidentsArgsSchema>;

export const PimsGetIncidentArgsSchema = z
  .object({ id: z.number().int().positive() })
  .strict();
export type PimsGetIncidentArgs = z.infer<typeof PimsGetIncidentArgsSchema>;

export const PimsCreateIncidentArgsSchema =
  PimsIncidentCreateSchema.strict().extend({
    title: z.string().min(1).max(150),
    description: z.string().max(1000).nullable().optional(),
    status: z.literal("O"),
    affected_data_types: z.array(z.enum(ALL_AFFECTED_DATA_TYPES)),
    security_measures_adopted: z.array(z.enum(ALL_SECURITY_MEASURES)),
    affected_cid: z.array(z.enum(AFFECTED_CID)),
  });
export type PimsCreateIncidentArgs = z.infer<
  typeof PimsCreateIncidentArgsSchema
>;

export const PimsIncidentUpdateStrictSchema = PimsIncidentUpdateSchema.strict();
export type PimsIncidentUpdateStrict = z.infer<
  typeof PimsIncidentUpdateStrictSchema
>;

export const PimsUpdateIncidentArgsSchema = z
  .object({
    id: z.number().int().positive(),
    patch: PimsIncidentUpdateStrictSchema,
  })
  .strict();
export type PimsUpdateIncidentArgs = z.infer<
  typeof PimsUpdateIncidentArgsSchema
>;

export const PimsTransitionStatusArgsSchema = z
  .object({
    id: z.number().int().positive(),
    to: z.enum(INCIDENT_STATUSES),
    reason: z.string().min(1),
  })
  .strict();
export type PimsTransitionStatusArgs = z.infer<
  typeof PimsTransitionStatusArgsSchema
>;

export const PimsAddActionArgsSchema = z
  .object({
    incident_id: z.number().int().positive(),
    action_type: z.enum(ACTION_TYPES),
    description: z.string().min(1),
    responsible: z.string().min(1).optional(),
    action_date: z.string().date().optional(),
    evidence: z.string().nullable().optional(),
    review_approval_id: z.string().uuid().optional(),
  })
  .strict();
export type PimsAddActionArgs = z.infer<typeof PimsAddActionArgsSchema>;

export const PimsUploadAttachmentArgsSchema = z
  .object({
    incident_id: z.number().int().positive(),
    bytes_ref: z.string().length(64),
    file_name: z.string().min(1).max(255),
    mime: z.string().min(1).max(128),
  })
  .strict();
export type PimsUploadAttachmentArgs = z.infer<
  typeof PimsUploadAttachmentArgsSchema
>;

export const PimsListRecipientsArgsSchema = z
  .object({ active_only: z.boolean().default(true) })
  .strict();
export type PimsListRecipientsArgs = z.infer<
  typeof PimsListRecipientsArgsSchema
>;

export const PimsManageRecipientCreateArgsSchema = z
  .object({
    op: z.literal("create"),
    email: z.string().email(),
    label: z.string().min(1),
    is_active: z.boolean().optional(),
    operator_jwt_sub: z.string().min(1),
  })
  .strict();

export const PimsManageRecipientDeleteArgsSchema = z
  .object({
    op: z.literal("delete"),
    id: z.number().int().positive(),
    operator_jwt_sub: z.string().min(1),
  })
  .strict();

export const PimsManageRecipientArgsSchema = z.discriminatedUnion("op", [
  PimsManageRecipientCreateArgsSchema,
  PimsManageRecipientDeleteArgsSchema,
]);
export type PimsManageRecipientArgs = z.infer<
  typeof PimsManageRecipientArgsSchema
>;

export const PimsNotifyArgsSchema = z
  .object({
    incident_id: z.number().int().positive(),
    pack_id: z.string().uuid(),
    review_approval_id: z.string().uuid(),
  })
  .strict();
export type PimsNotifyArgs = z.infer<typeof PimsNotifyArgsSchema>;

export const PimsGetHistoryArgsSchema = z
  .object({ incident_id: z.number().int().positive() })
  .strict();
export type PimsGetHistoryArgs = z.infer<typeof PimsGetHistoryArgsSchema>;

export const PimsSearchRisksArgsSchema = z
  .object({
    search: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    page_size: z.number().int().positive().optional(),
  })
  .strict();
export type PimsSearchRisksArgs = z.infer<typeof PimsSearchRisksArgsSchema>;

export const ResponseStrategySchema = z.enum(["M", "A", "T", "E"]);

export const PimsEmitRiskSignalArgsSchema = z
  .object({
    description: z.string().min(1),
    controlled_probability: z.number().int().positive(),
    controlled_impact: z.number().int().positive(),
    asset_ids: z.array(z.number().int().positive()).optional(),
    threat_code: z.string().min(1).optional(),
    vulnerability_code: z.string().min(1).optional(),
    threat: z.string().min(1).optional(),
    vulnerability: z.string().min(1).optional(),
    risk_owner: z.string().min(1).optional(),
    response_strategy: ResponseStrategySchema.optional(),
    status: z.string().min(1).optional(),
  })
  .strict();
export type PimsEmitRiskSignalArgs = z.infer<
  typeof PimsEmitRiskSignalArgsSchema
>;

export const PimsCreateAuditActionArgsSchema = z
  .object({
    audit_id: z.number().int().positive().optional(),
    finding_id: z.number().int().positive().optional(),
    classification: z.enum(FINDING_CLASSIFICATIONS).default("N"),
    finding_description: z.string().min(1).optional(),
    action_plan: z.string().min(1),
    responsible: z.string().min(1).optional(),
    due_date: z.string().date().optional(),
    status: z.enum(ACTION_PLAN_STATUSES).default("O"),
    source_requirement_code: z.string().min(1),
  })
  .strict();
export type PimsCreateAuditActionArgs = z.infer<
  typeof PimsCreateAuditActionArgsSchema
>;

export const RagQueryArgsSchema = z
  .object({
    query: z.string().min(1),
    top_k: z.number().int().positive().optional(),
    min_score: z.number().min(0).max(1).optional(),
    normative_only: z.boolean().default(false),
  })
  .strict();
export type RagQueryArgs = z.infer<typeof RagQueryArgsSchema>;

export const SchedulerArmArgsSchema = z
  .object({
    incident_code: z.string().min(1),
    kind: TimerKindSchema,
    fire_at_utc: z.string().datetime(),
    payload: JsonObjectSchema,
  })
  .strict();
export type SchedulerArmArgs = z.infer<typeof SchedulerArmArgsSchema>;

export const SchedulerCancelArgsSchema = z
  .object({
    timer_id: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type SchedulerCancelArgs = z.infer<typeof SchedulerCancelArgsSchema>;

export const PimsLoginResultSchema = z
  .object({
    access_expires_at_utc: z.string().datetime(),
    schema: z.string().min(1),
    user_id: z.number().int().positive(),
  })
  .strict();
export type PimsLoginResult = z.infer<typeof PimsLoginResultSchema>;

export const PimsListIncidentsResultSchema =
  paginatedResultSchema(PimsIncidentSchema);
export type PimsListIncidentsResult = z.infer<
  typeof PimsListIncidentsResultSchema
>;

export const PimsGetIncidentResultSchema = PimsIncidentSchema;
export type PimsGetIncidentResult = z.infer<typeof PimsGetIncidentResultSchema>;

export const PimsCreateIncidentResultSchema = z
  .object({
    id: z.number().int().positive(),
    incident_code: z.string().min(1),
    incident: PimsIncidentSchema,
  })
  .strict();
export type PimsCreateIncidentResult = z.infer<
  typeof PimsCreateIncidentResultSchema
>;

export const PimsUpdateIncidentResultSchema = PimsIncidentSchema;
export type PimsUpdateIncidentResult = z.infer<
  typeof PimsUpdateIncidentResultSchema
>;

export const PimsTransitionStatusResultSchema = PimsIncidentSchema;
export type PimsTransitionStatusResult = z.infer<
  typeof PimsTransitionStatusResultSchema
>;

export const PimsActionMutationResultSchema = z
  .object({
    action: PimsIncidentActionSchema,
    incident: PimsIncidentSchema,
  })
  .strict();
export type PimsActionMutationResult = z.infer<
  typeof PimsActionMutationResultSchema
>;

export const PimsUploadAttachmentResultSchema = z
  .object({
    attachment_id: z.number().int().positive(),
    file: z.string().min(1),
    file_name: z.string().min(1),
    uploaded_at: z.string().min(1),
    sha256: z.string().length(64),
    forensic_scan: ForensicScanResultSchema.nullable(),
  })
  .strict();
export type PimsUploadAttachmentResult = z.infer<
  typeof PimsUploadAttachmentResultSchema
>;

export const PimsListRecipientsResultSchema = z.array(
  PimsIncidentRecipientSchema,
);
export type PimsListRecipientsResult = z.infer<
  typeof PimsListRecipientsResultSchema
>;

export const PimsManageRecipientResultSchema = z
  .object({
    id: z.number().int().positive(),
    email: z.string().email(),
    is_active: z.boolean(),
    op: z.enum(["create", "delete"]),
  })
  .strict();
export type PimsManageRecipientResult = z.infer<
  typeof PimsManageRecipientResultSchema
>;

export const PimsNotifyResultSchema = z
  .object({
    notified_at_utc: z.string().datetime(),
    recipients_snapshot: z.array(z.string().min(1)).min(1),
    history_id: z.number().int().positive(),
  })
  .strict();
export type PimsNotifyResult = z.infer<typeof PimsNotifyResultSchema>;

export const PimsGetHistoryResultSchema = z.array(PimsIncidentHistorySchema);
export type PimsGetHistoryResult = z.infer<typeof PimsGetHistoryResultSchema>;

export const PimsSearchRisksResultSchema = paginatedResultSchema(
  PimsRiskEvaluationSchema,
);
export type PimsSearchRisksResult = z.infer<typeof PimsSearchRisksResultSchema>;

export const PimsEmitRiskSignalResultSchema = z.union([
  z
    .object({
      risk_id: z.number().int().positive(),
      risk_code: z.string().min(1),
      period_name: z.string().min(1),
    })
    .strict(),
  z
    .object({
      queued: z.literal(true),
      period_name: z.string().min(1),
      queued_at_utc: z.string().datetime(),
      reason: z.string().min(1),
    })
    .strict(),
]);
export type PimsEmitRiskSignalResult = z.infer<
  typeof PimsEmitRiskSignalResultSchema
>;

export const PimsCreateAuditActionResultSchema = z
  .object({
    audit_id: z.number().int().positive(),
    audit_code: z.string().min(1),
    finding_id: z.number().int().positive(),
    action_plan_id: z.number().int().positive(),
  })
  .strict();
export type PimsCreateAuditActionResult = z.infer<
  typeof PimsCreateAuditActionResultSchema
>;

export const RagQueryResultToolSchema = z
  .object({
    query: z.string().min(1),
    passages: z.array(RankedPassageSchema),
    citations: z.array(z.string().min(1)),
    eval: z.boolean(),
  })
  .strict();
export type RagQueryResultTool = z.infer<typeof RagQueryResultToolSchema>;

export const SchedulerArmResultSchema = z
  .object({ timer_id: z.string().min(1) })
  .strict();
export type SchedulerArmResult = z.infer<typeof SchedulerArmResultSchema>;

export const SchedulerCancelResultSchema = z
  .object({ cancelled: z.literal(true) })
  .strict();
export type SchedulerCancelResult = z.infer<typeof SchedulerCancelResultSchema>;

export const IndicatorEmitResultSchema = z.union([
  z.object({ accepted: z.literal(true) }).strict(),
  z.object({ spooled: z.literal(true) }).strict(),
]);
export type IndicatorEmitResult = z.infer<typeof IndicatorEmitResultSchema>;

export const DueTimerSchema = z
  .object({
    timer: TimerRecordSchema,
    fired_at_utc: z.string().datetime(),
  })
  .strict();
export type DueTimer = z.infer<typeof DueTimerSchema>;

export const TOT_METHODS = ["5-whys", "fishbone", "fault-tree"] as const;
export { type TotMethod, TotMethodSchema };

export const TOT_EVIDENCE_KINDS = [
  "attachment",
  "history",
  "ioc",
  "action",
  "citation",
] as const;
export const TotEvidenceKindSchema = z.enum(TOT_EVIDENCE_KINDS);
export type TotEvidenceKind = z.infer<typeof TotEvidenceKindSchema>;

export const TotEvidenceSchema = z
  .object({
    ref: z.string().min(1),
    kind: TotEvidenceKindSchema,
    description: z.string().min(1),
  })
  .strict();
export type TotEvidence = z.infer<typeof TotEvidenceSchema>;

export const RootCauseSchema = z
  .object({
    method: TotMethodSchema,
    cause: z.string().min(1),
    evidence_refs: z.array(z.string().min(1)),
    systemic: z.boolean(),
    remediation: z.string().min(1),
    root_cause_unproven: z.boolean(),
  })
  .strict();
export type RootCause = z.infer<typeof RootCauseSchema>;

export const RiskCatalogCodesSchema = z
  .object({
    threat_code: z.string().min(1).nullable(),
    vulnerability_code: z.string().min(1).nullable(),
  })
  .strict();
export type RiskCatalogCodes = z.infer<typeof RiskCatalogCodesSchema>;

export const ReviewApprovalSchema = z
  .object({
    approval_id: z.string().uuid(),
    incident_code: z.string().min(1),
    pack_type: NoticePackTypeSchema,
    content_sha256: z.string().length(64),
    approved_at_utc: z.string().datetime(),
    consumed_at_utc: z.string().datetime().nullable(),
    consumed_by: z.string().nullable(),
    note: z.string(),
  })
  .strict();
export type ReviewApproval = z.infer<typeof ReviewApprovalSchema>;

export const ProsecutorChallengeSchema = z
  .object({
    target: z.string().min(1),
    challenge: z.string().min(1),
    severity: ProsecutorSeveritySchema,
    evidence_required: z.string().min(1),
  })
  .strict();
export type ProsecutorChallenge = z.infer<typeof ProsecutorChallengeSchema>;

export const ProsecutorResultSchema = z
  .object({ challenges: z.array(ProsecutorChallengeSchema) })
  .strict();
export type ProsecutorResult = z.infer<typeof ProsecutorResultSchema>;

export const ReviewRejectionSchema = z
  .object({
    judge: z.string().min(1),
    item: z.string().min(1),
    required_fix: z.string().min(1),
  })
  .strict();
export type ReviewRejection = z.infer<typeof ReviewRejectionSchema>;

export const ReviewResultSchema = z
  .object({
    approved: z.boolean(),
    approval_id: z.string().uuid().nullable(),
    challenges: z.array(ProsecutorChallengeSchema),
    rejection: ReviewRejectionSchema.nullable(),
  })
  .strict();
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const ReviewContextSchema = z
  .object({
    incident_code: z.string().min(1),
    pack_type: NoticePackTypeSchema,
    content_sha256: z.string().length(64),
    body_text: z.string(),
    citations: z.array(z.string().min(1)),
    numeric_approvals: z.array(NumericApprovalSchema),
    plain_language_waiver: PlainLanguageWaiverSchema.nullable(),
    checklist: z.array(CloseChecklistItemSchema).nullable(),
  })
  .strict();
export type ReviewContext = z.infer<typeof ReviewContextSchema>;

export const DraftReviewResultSchema = z
  .object({
    authority_pack_id: z.string().uuid().nullable(),
    subject_pack_id: z.string().uuid().nullable(),
    authority_approval_id: z.string().uuid().nullable(),
    subject_approval_id: z.string().uuid().nullable(),
    high_risk_gate: HighRiskGateResultSchema,
    exemption: ExemptionEvaluationResultSchema,
  })
  .strict();
export type DraftReviewResult = z.infer<typeof DraftReviewResultSchema>;

export const LifecycleRunSchema = z
  .object({
    run_id: z.string().uuid(),
    incident_code: z.string().min(1),
    incident_id: z.number().int().positive(),
    stage: LifecycleStageSchema,
    review_cycles: z.number().int().nonnegative(),
    veto_parked_until_utc: z.string().datetime().nullable(),
    vetoed_by: z.string().nullable(),
    halted: z.boolean(),
    reopen_generation: z.number().int().nonnegative(),
  })
  .strict();
export type LifecycleRun = z.infer<typeof LifecycleRunSchema>;

export const TriageCalibrationSchema = z
  .object({
    incident_code: z.string().min(1),
    actual_incident_type: z.enum(INCIDENT_TYPES),
    nonconformity_score: z.number().min(0).max(1),
    recorded_at_utc: z.string().datetime(),
  })
  .strict();
export type TriageCalibration = z.infer<typeof TriageCalibrationSchema>;

export const INTAKE_CHANNELS = ["form", "siem", "processor_notice"] as const;
export const IntakeChannelSchema = z.enum(INTAKE_CHANNELS);
export type IntakeChannel = z.infer<typeof IntakeChannelSchema>;

export const IntakeReporterSchema = z
  .object({
    document_number: z.string().min(1).optional(),
    document_expiry: z.string().date().optional(),
    first_name: z.string().min(1).optional(),
    last_name_p: z.string().min(1).optional(),
    last_name_m: z.string().min(1).optional(),
    position: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .strict();
export type IntakeReporter = z.infer<typeof IntakeReporterSchema>;

export const IntakeEntitySchema = z
  .object({
    type: z.enum(["R", "U"]).optional(),
    ruc: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    extension: z.string().min(1).optional(),
    department: z.string().min(1).optional(),
    province: z.string().min(1).optional(),
    district: z.string().min(1).optional(),
  })
  .strict();
export type IntakeEntity = z.infer<typeof IntakeEntitySchema>;

export const IntakeDpoSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
  })
  .strict();
export type IntakeDpo = z.infer<typeof IntakeDpoSchema>;

export const IntakeAttachmentSchema = z
  .object({
    file_name: z.string().min(1).max(255),
    mime: z.string().min(1).max(128),
    bytes_base64: z.string().min(1),
  })
  .strict();
export type IntakeAttachment = z.infer<typeof IntakeAttachmentSchema>;

export const IntakePayloadSchema = z
  .object({
    channel: IntakeChannelSchema,
    title: z.string().min(1).max(150),
    description: z.string().max(1000).optional(),
    involves_personal_data: z.boolean().nullable(),
    incident_date: z.string().date(),
    incident_time: z.string().time().optional(),
    detection_date: z.string().date().optional(),
    detection_time: z.string().time().optional(),
    incident_type: z.enum(INCIDENT_TYPES).optional(),
    reporter: IntakeReporterSchema.optional(),
    entity: IntakeEntitySchema.optional(),
    dpo: IntakeDpoSchema.optional(),
    affected_data_types: z.array(z.enum(ALL_AFFECTED_DATA_TYPES)).optional(),
    security_measures_adopted: z
      .array(z.enum(ALL_SECURITY_MEASURES))
      .optional(),
    affected_cid: z.array(z.enum(AFFECTED_CID)).optional(),
    num_affected_subjects: z.number().int().nonnegative().optional(),
    compromised_system: z.string().min(1).optional(),
    affected_url: z.string().min(1).optional(),
    assigned_to: z.string().min(1).optional(),
    source_payload: JsonObjectSchema.optional(),
    attachments: z.array(IntakeAttachmentSchema).optional(),
  })
  .strict();
export type IntakePayload = z.infer<typeof IntakePayloadSchema>;

export const DedupeActionSchema = z.enum(["create", "update", "restore"]);
export type DedupeAction = z.infer<typeof DedupeActionSchema>;

export const DedupeDecisionSchema = z
  .object({
    action: DedupeActionSchema,
    incident_code: z.string().min(1).nullable(),
    incident_id: z.number().int().positive().nullable(),
    trigram_similarity: z.number().min(0).max(1),
    cosine_similarity: z.number().min(0).max(1),
    is_deleted: z.boolean(),
  })
  .strict();
export type DedupeDecision = z.infer<typeof DedupeDecisionSchema>;

export const IntakeResultSchema = z
  .object({
    incident: PimsIncidentSchema,
    dedupe: DedupeDecisionSchema,
    timer_ids: z.array(z.string().min(1)),
  })
  .strict();
export type IntakeResult = z.infer<typeof IntakeResultSchema>;

export const INDICATOR_EVENT_TYPES = [
  "incident_opened",
  "pii_assumed",
  "incident_triaged",
  "investigation_complete",
  "notice_sent",
  "notice_exempted",
  "deadline_missed",
  "corrective_linked",
  "risk_signalled",
  "training_recommended",
  "gate_blocked",
  "incident_closed",
  "incident_reopened",
] as const;
export const IndicatorEventTypeSchema = z.enum(INDICATOR_EVENT_TYPES);
export type IndicatorEventType = z.infer<typeof IndicatorEventTypeSchema>;

export const IndicatorEventAttrsSchema = z
  .object({
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    incident_type: z.enum(INCIDENT_TYPES).optional(),
    mttd_hours: z.number().nonnegative().optional(),
    mttr_hours: z.number().nonnegative().optional(),
    sla_72h_met: z.boolean().optional(),
    exemption: Art34ExemptionLetterSchema.nullable().optional(),
    deadline_kind: TimerKindSchema.optional(),
    reason: z.string().min(1).optional(),
    topic: z.string().min(1).optional(),
    audience: z.string().min(1).optional(),
  })
  .strict();
export type IndicatorEventAttrs = z.infer<typeof IndicatorEventAttrsSchema>;

export const IndicatorEventSchema = z
  .object({
    event: IndicatorEventTypeSchema,
    incident_code: z.string().min(1),
    at_utc: z.string().datetime(),
    actor_role: AgentRoleSchema,
    attrs: IndicatorEventAttrsSchema,
  })
  .strict();
export type IndicatorEvent = z.infer<typeof IndicatorEventSchema>;

export const IndicatorEmitArgsSchema = z
  .object({ event: IndicatorEventSchema })
  .strict();
export type IndicatorEmitArgs = z.infer<typeof IndicatorEmitArgsSchema>;

export const RiskSignalPayloadRefSchema = RiskSignalPayloadEvidenceSchema;

export const TOOL_ARG_SCHEMAS: Readonly<Record<ToolName, z.ZodTypeAny>> =
  Object.freeze({
    pims_login: PimsLoginArgsSchema,
    pims_list_incidents: PimsListIncidentsArgsSchema,
    pims_get_incident: PimsGetIncidentArgsSchema,
    pims_create_incident: PimsCreateIncidentArgsSchema,
    pims_update_incident: PimsUpdateIncidentArgsSchema,
    pims_transition_status: PimsTransitionStatusArgsSchema,
    pims_add_action: PimsAddActionArgsSchema,
    pims_upload_attachment: PimsUploadAttachmentArgsSchema,
    pims_list_recipients: PimsListRecipientsArgsSchema,
    pims_manage_recipient: PimsManageRecipientArgsSchema,
    pims_notify: PimsNotifyArgsSchema,
    pims_get_history: PimsGetHistoryArgsSchema,
    pims_search_risks: PimsSearchRisksArgsSchema,
    pims_emit_risk_signal: PimsEmitRiskSignalArgsSchema,
    pims_create_audit_action: PimsCreateAuditActionArgsSchema,
    rag_query: RagQueryArgsSchema,
    scheduler_arm: SchedulerArmArgsSchema,
    scheduler_cancel: SchedulerCancelArgsSchema,
    indicator_emit: IndicatorEmitArgsSchema,
  });

export const TOOL_RESULT_SCHEMAS: Readonly<Record<ToolName, z.ZodTypeAny>> =
  Object.freeze({
    pims_login: PimsLoginResultSchema,
    pims_list_incidents: PimsListIncidentsResultSchema,
    pims_get_incident: PimsGetIncidentResultSchema,
    pims_create_incident: PimsCreateIncidentResultSchema,
    pims_update_incident: PimsUpdateIncidentResultSchema,
    pims_transition_status: PimsTransitionStatusResultSchema,
    pims_add_action: PimsActionMutationResultSchema,
    pims_upload_attachment: PimsUploadAttachmentResultSchema,
    pims_list_recipients: PimsListRecipientsResultSchema,
    pims_manage_recipient: PimsManageRecipientResultSchema,
    pims_notify: PimsNotifyResultSchema,
    pims_get_history: PimsGetHistoryResultSchema,
    pims_search_risks: PimsSearchRisksResultSchema,
    pims_emit_risk_signal: PimsEmitRiskSignalResultSchema,
    pims_create_audit_action: PimsCreateAuditActionResultSchema,
    rag_query: RagQueryResultToolSchema,
    scheduler_arm: SchedulerArmResultSchema,
    scheduler_cancel: SchedulerCancelResultSchema,
    indicator_emit: IndicatorEmitResultSchema,
  });

export type ToolArgs = JsonObject;

export const IncidentTypeSchema = z.enum(INCIDENT_TYPES);
export const IncidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);
export const IncidentImpactSchema = z.enum(INCIDENT_IMPACTS);
export const AffectedCidSchema = z.enum(AFFECTED_CID);

export const PageAlertSchema = z
  .object({
    incident_code: z.string().min(1),
    kind: TimerKindSchema,
    reason: z.string().min(1),
  })
  .strict();
export type PageAlert = z.infer<typeof PageAlertSchema>;

export const TriageClassificationResultSchema = z
  .object({
    incident_type: IncidentTypeSchema,
    conformal_set: z.array(IncidentTypeSchema),
    nonconformity_score: z.number(),
    severity: IncidentSeveritySchema,
    impact: IncidentImpactSchema,
    affected_cid: z.array(AffectedCidSchema),
    citations: z.array(z.string()),
    calibration_mode: TriageCalibrationModeSchema,
  })
  .strict();
export type TriageClassificationResult = z.infer<
  typeof TriageClassificationResultSchema
>;

export const TriageResultSchema = z
  .object({
    incident: PimsIncidentSchema,
    classification: TriageClassificationResultSchema,
    calibration_mode: TriageCalibrationModeSchema,
  })
  .strict();
export type TriageResult = z.infer<typeof TriageResultSchema>;

export const AuditLinkResultSchema = z
  .object({
    audit_id: z.number().int().positive(),
    finding_id: z.number().int().positive(),
    action_plan_id: z.number().int().positive(),
  })
  .strict();
export type AuditLinkResult = z.infer<typeof AuditLinkResultSchema>;

export const InvestigationResultSchema = z
  .object({
    incident: PimsIncidentSchema,
    rootCause: RootCauseSchema,
    auditLink: AuditLinkResultSchema.nullable(),
    riskSignal: PimsEmitRiskSignalResultSchema.nullable(),
    evidence: z.array(EvidenceAttachmentSchema),
  })
  .strict();
export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;

export const ApproveNotifyResultSchema = z
  .object({
    parked: z.boolean(),
    parkedUntilUtc: z.string().nullable(),
    actions: z.array(PimsIncidentActionSchema),
    notifies: z.array(PimsNotifyResultSchema),
  })
  .strict();
export type ApproveNotifyResult = z.infer<typeof ApproveNotifyResultSchema>;

export const MonitorResultSchema = z
  .object({
    newAttachments: z.number().int().nonnegative(),
    scopeGrowth: z.boolean(),
    reevaluated: z.array(z.string()),
    closed: z.boolean(),
  })
  .strict();
export type MonitorResult = z.infer<typeof MonitorResultSchema>;

export const CloseResultSchema = z
  .object({
    incident: PimsIncidentSchema,
    sealSha256: z.string(),
    marker: z.string(),
  })
  .strict();
export type CloseResult = z.infer<typeof CloseResultSchema>;

export const IntakeCallbacksSchema = z.object({
  piiReprompt: z
    .function()
    .returns(z.promise(z.boolean().nullable()))
    .optional(),
  futureDateReprompt: z
    .function()
    .returns(z.promise(z.string().nullable()))
    .optional(),
});
export type IntakeCallbacks = z.infer<typeof IntakeCallbacksSchema>;

export const DraftReviewOptionsSchema = z
  .object({
    exemption: ExemptionEvaluationInputSchema.optional(),
    numericApprovals: z.array(NumericApprovalSchema).optional(),
    phaseDueAtUtc: z.string().optional(),
  })
  .strict();
export type DraftReviewOptions = z.infer<typeof DraftReviewOptionsSchema>;
