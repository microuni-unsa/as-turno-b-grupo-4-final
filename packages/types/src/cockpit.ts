import {
  NoticePackTypeSchema,
  PimsNotifyResultSchema,
  ReviewApprovalKindSchema,
} from "@pims/types/agent.ts";
import { ExemptionEvaluationResultSchema } from "@pims/types/notices.ts";
import {
  ACTION_TYPES,
  AFFECTED_CID,
  ALL_AFFECTED_DATA_TYPES,
  ALL_SECURITY_MEASURES,
  FORM_MEASURE_VALUES,
  INCIDENT_IMPACTS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  PimsIncidentActionSchema,
} from "@pims/types/pims.ts";
import { z } from "zod";

export const COCKPIT_ROLES = [
  "Administrador",
  "Operador",
  "Editor",
  "Lector",
] as const;
export const CockpitRoleSchema = z.enum(COCKPIT_ROLES);
export type CockpitRole = z.infer<typeof CockpitRoleSchema>;

export const CHAT_PERSONAS = ["auditor", "executive", "dpo"] as const;
export const ChatPersonaSchema = z.enum(CHAT_PERSONAS);
export type ChatPersona = z.infer<typeof ChatPersonaSchema>;

export const COCKPIT_PERMISSIONS = [
  "view_incident",
  "change_incident",
  "view_securitylog",
  "view_audit",
  "view_riskevaluation",
  "manage_users",
] as const;
export const CockpitPermissionSchema = z.enum(COCKPIT_PERMISSIONS);
export type CockpitPermission = z.infer<typeof CockpitPermissionSchema>;

export const CockpitLoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type CockpitLoginRequest = z.infer<typeof CockpitLoginRequestSchema>;

export const CockpitSessionSchema = z.object({
  access_token: z.string().min(1),
  expires_at_utc: z.string().datetime(),
  user_id: z.number().int().positive(),
  username: z.string().min(1),
  schema: z.string().min(1),
  native_role: CockpitRoleSchema,
  permissions: z.array(CockpitPermissionSchema),
  default_persona: ChatPersonaSchema,
  can_switch_persona: z.boolean(),
});
export type CockpitSession = z.infer<typeof CockpitSessionSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  incident_code: z.string().min(1).optional(),
  persona: ChatPersonaSchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatCitationSchema = z.object({
  citation: z.string().min(1),
  doc_id: z.string().min(1),
  chunk_id: z.string().min(1),
  lines: z.string().min(1),
  chunk_sha256: z.string().length(64),
  dense_score: z.number().nullable(),
  bm25_rank: z.number().int().positive().nullable(),
  rrf_score: z.number(),
  rerank_score: z.number(),
  text: z.string(),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const PendingDecisionSchema = z.object({
  incident_id: z.number().int().positive(),
  incident_code: z.string().min(1),
  kind: ReviewApprovalKindSchema,
  pack_type: NoticePackTypeSchema.nullable(),
  approval_id: z.string().nullable(),
  blocked_reason: z.string().nullable(),
  actionable: z.boolean(),
});
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const ChatTraceSpanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["turn", "tool", "model", "agent"]),
  status: z.enum(["ok", "error"]),
  start_ms: z.number(),
  end_ms: z.number(),
  duration_ms: z.number(),
  relative_start_ms: z.number(),
  args: z.record(z.unknown()).optional(),
  result: z
    .union([z.record(z.unknown()), z.string(), z.array(z.unknown())])
    .optional(),
  error: z.string().optional(),
  track: z.string().optional(),
});
export type ChatTraceSpan = z.infer<typeof ChatTraceSpanSchema>;

export const ChatToolAggregateSchema = z.object({
  tool: z.string().min(1),
  calls: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  total_ms: z.number().nonnegative(),
  avg_ms: z.number().nonnegative(),
  max_ms: z.number().nonnegative(),
});
export type ChatToolAggregate = z.infer<typeof ChatToolAggregateSchema>;

export const ChatTraceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start_iso: z.string(),
  wall_time_ms: z.number().nonnegative(),
  model_time_ms: z.number().nonnegative(),
  tool_time_ms: z.number().nonnegative(),
  idle_time_ms: z.number().nonnegative(),
  turns_count: z.number().int().nonnegative(),
  requests_count: z.number().int().nonnegative(),
  tool_calls_count: z.number().int().nonnegative(),
  tokens_estimate: z.number().int().nonnegative().optional(),
  cost_estimate_usd: z.number().nonnegative().optional(),
  spans: z.array(ChatTraceSpanSchema),
  aggregates: z.array(ChatToolAggregateSchema),
});
export type ChatTrace = z.infer<typeof ChatTraceSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string().min(1),
  persona: ChatPersonaSchema,
  citations: z.array(ChatCitationSchema),
  pending_decisions: z.array(PendingDecisionSchema),
  tool_calls: z.array(z.string()),
  reasoning: z.string().optional(),
  trace: ChatTraceSchema,
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ApproveResponseSchema = z.object({
  parked: z.boolean(),
  parkedUntilUtc: z.string().datetime().nullable(),
  notifies: z.array(PimsNotifyResultSchema),
  actions: z.array(PimsIncidentActionSchema),
});
export type ApproveResponse = z.infer<typeof ApproveResponseSchema>;

export const RevisionRequestSchema = z.object({
  pack_type: z.enum(["authority", "subject"]),
  reason: z.string().min(1),
});
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;

export const ExemptionAttestationRequestSchema = z.object({
  letter: z.literal("a"),
  source_file_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  scope: z.enum(["encrypt_rest", "encrypt_transit"]),
  algorithm: z.string().min(1),
  key_management_ref: z.string().min(1),
  applies_to_affected_data: z.boolean(),
  evidence_refs: z.array(z.string().min(1)).min(1),
});
export type ExemptionAttestationRequest = z.infer<
  typeof ExemptionAttestationRequestSchema
>;

export const ExemptionAttestationResponseSchema = z.object({
  exemption: ExemptionEvaluationResultSchema,
  pack_id: z.string().min(1),
});
export type ExemptionAttestationResponse = z.infer<
  typeof ExemptionAttestationResponseSchema
>;

export const CockpitIncidentSummarySchema = z.object({
  id: z.number().int().positive(),
  incident_code: z.string().min(1),
  status: z.enum(INCIDENT_STATUSES),
  severity: z.enum(INCIDENT_SEVERITIES).nullable(),
  impact: z.enum(INCIDENT_IMPACTS).nullable(),
  incident_type: z.enum(INCIDENT_TYPES),
  title: z.string(),
  detection_date: z.string().nullable(),
  updated_at: z.string(),
});
export type CockpitIncidentSummary = z.infer<
  typeof CockpitIncidentSummarySchema
>;

export const CockpitTimerSchema = z.object({
  timer_id: z.string().min(1),
  incident_code: z.string().min(1),
  timer_type: z.string().min(1),
  fire_at_utc: z.string().datetime(),
  remaining_ms: z.number().int(),
});
export type CockpitTimer = z.infer<typeof CockpitTimerSchema>;

export const StreamSnapshotSchema = z.object({
  incidents: z.array(CockpitIncidentSummarySchema),
  timers: z.array(CockpitTimerSchema),
  pending_decisions: z.array(PendingDecisionSchema),
});
export type StreamSnapshot = z.infer<typeof StreamSnapshotSchema>;

export const GuidedActionSchema = z.object({
  action_type: z.enum(ACTION_TYPES),
  responsible: z.string().min(1),
  action_date: z.string().min(1),
  description: z.string().min(1),
  evidence: z.string().nullable().optional(),
});
export type GuidedAction = z.infer<typeof GuidedActionSchema>;

export const GuidedReportingSchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().max(1000).nullable().optional(),
  incident_date: z.string().min(1),
  incident_time: z.string().nullable().optional(),
  detection_date: z.string().nullable().optional(),
  detection_time: z.string().nullable().optional(),
  incident_type: z.enum(INCIDENT_TYPES),
  involves_personal_data: z.boolean(),
  status: z.enum(INCIDENT_STATUSES).default("O"),
  severity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  impact: z.enum(INCIDENT_IMPACTS).nullable().optional(),
  affected_data_types: z.array(z.enum(ALL_AFFECTED_DATA_TYPES)).default([]),
  num_affected_subjects: z.number().nullable().optional(),
  affected_treatment: z.string().nullable().optional(),
  compromised_system: z.string().nullable().optional(),
  affected_url: z.string().nullable().optional(),
  evidence_refs: z.string().nullable().optional(),
  security_measures_adopted: z.array(z.enum(ALL_SECURITY_MEASURES)).default([]),
  affected_cid: z.array(z.enum(AFFECTED_CID)).default([]),
  rep_document_number: z.string().nullable().optional(),
  rep_document_expiry: z.string().nullable().optional(),
  rep_first_name: z.string().nullable().optional(),
  rep_last_name_p: z.string().nullable().optional(),
  rep_last_name_m: z.string().nullable().optional(),
  rep_position: z.string().nullable().optional(),
  rep_phone: z.string().nullable().optional(),
  rep_email: z.string().nullable().optional(),
  entity_type: z.string().nullable().optional(),
  entity_ruc: z.string().nullable().optional(),
  entity_name: z.string().nullable().optional(),
  entity_phone: z.string().nullable().optional(),
  entity_extension: z.string().nullable().optional(),
  entity_department: z.string().nullable().optional(),
  entity_province: z.string().nullable().optional(),
  entity_district: z.string().nullable().optional(),
  reported_by: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  dpo_contact_name: z.string().nullable().optional(),
  dpo_contact_email: z.string().nullable().optional(),
  dpo_contact_phone: z.string().nullable().optional(),
  measure_updated_registry: z.enum(FORM_MEASURE_VALUES).nullable().optional(),
  measure_new_security: z.enum(FORM_MEASURE_VALUES).nullable().optional(),
  measure_improved_policies: z.enum(FORM_MEASURE_VALUES).nullable().optional(),
  measure_considered_resolved: z
    .enum(FORM_MEASURE_VALUES)
    .nullable()
    .optional(),
  measure_reported_authorities: z
    .enum(FORM_MEASURE_VALUES)
    .nullable()
    .optional(),
  resolved_date: z.string().nullable().optional(),
  actions: z.array(GuidedActionSchema).default([]),
});
export type GuidedReporting = z.infer<typeof GuidedReportingSchema>;

export const GuidedProvenanceSchema = z.enum([
  "narrative",
  "partial",
  "default",
]);
export type GuidedProvenance = z.infer<typeof GuidedProvenanceSchema>;

export const GuidedDraftRequestSchema = z.object({
  narrative: z.string().optional(),
  partial: GuidedReportingSchema.partial().optional(),
  sections: z.array(z.string()).optional(),
});
export type GuidedDraftRequest = z.infer<typeof GuidedDraftRequestSchema>;

export const GuidedDraftResponseSchema = z.object({
  draft: GuidedReportingSchema,
  provenance: z.record(z.string(), GuidedProvenanceSchema),
  redaction_report: z.object({
    total_spans: z.number().int().nonnegative(),
    entities_found: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});
export type GuidedDraftResponse = z.infer<typeof GuidedDraftResponseSchema>;

export const GuidedExplainRequestSchema = z.object({
  field: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type GuidedExplainRequest = z.infer<typeof GuidedExplainRequestSchema>;

export const GuidedExplainOptionSchema = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type GuidedExplainOption = z.infer<typeof GuidedExplainOptionSchema>;

export const GuidedExplainResponseSchema = z.object({
  field: z.string().min(1),
  type: z.enum(["enum", "semantic"]),
  explanation: z.string(),
  citations: z.array(ChatCitationSchema).optional(),
  options: z.array(GuidedExplainOptionSchema).optional(),
});
export type GuidedExplainResponse = z.infer<typeof GuidedExplainResponseSchema>;

export const GuidedSubmitRequestSchema = GuidedReportingSchema.extend({
  idempotency_key: z.string().min(1),
});
export type GuidedSubmitRequest = z.infer<typeof GuidedSubmitRequestSchema>;

export const PresidioRecognizerResultSchema = z.object({
  entity_type: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  score: z.number(),
  analysis_explanation: z.unknown().optional(),
});
export type PresidioRecognizerResult = z.infer<
  typeof PresidioRecognizerResultSchema
>;

export const PresidioAnalyzeRequestSchema = z.object({
  text: z.string(),
  language: z.literal("es"),
  score_threshold: z.number().optional(),
  entities: z.array(z.string()).optional(),
});
export type PresidioAnalyzeRequest = z.infer<
  typeof PresidioAnalyzeRequestSchema
>;
