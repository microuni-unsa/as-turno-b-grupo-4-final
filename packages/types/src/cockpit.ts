import {
  NoticePackTypeSchema,
  PimsNotifyResultSchema,
  ReviewApprovalKindSchema,
} from "@pims/types/agent.ts";
import { ExemptionEvaluationResultSchema } from "@pims/types/notices.ts";
import {
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

export const ChatResponseSchema = z.object({
  reply: z.string().min(1),
  persona: ChatPersonaSchema,
  citations: z.array(ChatCitationSchema),
  pending_decisions: z.array(PendingDecisionSchema),
  tool_calls: z.array(z.string()),
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
