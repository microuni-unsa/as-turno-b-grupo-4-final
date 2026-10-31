import { JsonObjectSchema } from "@pims/types/models.ts";
import { z } from "zod";

export const ForensicScanResultSchema = z.object({
  ocr_text: z.string(),
  iocs: z.array(z.string()),
  visual_pii: z.array(z.string()),
  encryption_proof_signal: z.boolean(),
  tamper_score: z.number().min(0).max(1),
});
export type ForensicScanResult = z.infer<typeof ForensicScanResultSchema>;

export const EvidenceAttachmentSchema = z.object({
  file_name: z.string().min(1),
  sha256: z.string().length(64),
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
  pii_tags: z.array(z.string()),
  forensic_scan: ForensicScanResultSchema.nullable(),
  uploader: z.string().min(1),
  uploaded_at_utc: z.string().datetime(),
  pims_attachment_id: z.number().int().optional(),
});
export type EvidenceAttachment = z.infer<typeof EvidenceAttachmentSchema>;

export const EvidenceBundleIncidentSchema = z.object({
  description: z.string().min(1),
  time_period: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }),
  consequences: z.string().min(1),
  reporter: z.string().min(1),
  reported_to: z.string().min(1),
  resolution_steps: z.array(z.string()),
  person_in_charge: z.string().min(1),
  data_recovered: z.string().nullable(),
  cid_fact: z.array(z.string()),
  pii_description: z.string().nullable(),
  notification_steps: z.array(z.string()),
});
export type EvidenceBundleIncident = z.infer<
  typeof EvidenceBundleIncidentSchema
>;

export const CounterfactualControlSchema = z.object({
  control_code: z.string().min(1),
  blocks_cut_set: z.boolean(),
  residual_probability_delta: z.number(),
  proof_rationale: z.string().min(1),
});
export type CounterfactualControl = z.infer<typeof CounterfactualControlSchema>;

export const EvidenceBundleRootCauseSchema = z.object({
  method: z.enum(["5-whys", "fishbone", "fault-tree"]),
  tot_posterior: z.number().min(0).max(1),
  summary: z.string().min(1),
  systemic: z.boolean(),
  counterfactuals: z.array(CounterfactualControlSchema),
});
export type EvidenceBundleRootCause = z.infer<
  typeof EvidenceBundleRootCauseSchema
>;

export const EvidenceBundleManifestSchema = z.object({
  manifest: z.literal("evidence-bundle"),
  incident_code: z.string().min(1),
  sealed_at_utc: z.string().datetime().nullable(),
  seal_sha256: z.string().length(64).nullable(),
  incident: EvidenceBundleIncidentSchema,
  items: z.array(EvidenceAttachmentSchema),
  citations: z.array(z.string()),
  packs: z.array(z.string()),
  root_cause: EvidenceBundleRootCauseSchema,
});
export type EvidenceBundleManifest = z.infer<
  typeof EvidenceBundleManifestSchema
>;

export const AuditTrailLedgerEntrySchema = z.object({
  at_utc: z.string().datetime(),
  role: z.string().min(1),
  tool: z.string().min(1),
  args_redacted: JsonObjectSchema,
  result_ref: z.string().min(1),
  idempotency_key: z.string().min(1),
});
export type AuditTrailLedgerEntry = z.infer<typeof AuditTrailLedgerEntrySchema>;

export const AuditTrailExportSchema = z.object({
  export_version: z.literal("1.0"),
  incident_code: z.string().min(1),
  exported_at_utc: z.string().datetime(),
  timeline: z.array(JsonObjectSchema),
  tool_ledger: z.array(AuditTrailLedgerEntrySchema),
  timer_ledger: z.array(JsonObjectSchema),
});
export type AuditTrailExport = z.infer<typeof AuditTrailExportSchema>;

export const LeaseRecordSchema = z.object({
  incident_code: z.string().min(1),
  holder_id: z.string().min(1),
  acquired_at_utc: z.string().datetime(),
  expires_at_utc: z.string().datetime(),
});
export type LeaseRecord = z.infer<typeof LeaseRecordSchema>;

export const TimerRecordSchema = z.object({
  timer_id: z.string().min(1),
  incident_code: z.string().min(1),
  timer_type: z.string().min(1),
  fire_at_utc: z.string().datetime(),
  payload: JsonObjectSchema,
  fired: z.boolean(),
  cancelled_reason: z.string().nullable(),
});
export type TimerRecord = z.infer<typeof TimerRecordSchema>;

export const DedupeIndexRecordSchema = z.object({
  incident_code: z.string().min(1),
  title_normalized: z.string().min(1),
  incident_date: z.string().min(1),
  system_or_url: z.string().min(1),
  embedding_vector: z.array(z.number()),
  is_deleted: z.boolean(),
});
export type DedupeIndexRecord = z.infer<typeof DedupeIndexRecordSchema>;

export const RiskQueueRecordSchema = z.object({
  id: z.number().int().positive(),
  incident_code: z.string().min(1),
  signal_payload: JsonObjectSchema,
  status: z.enum(["queued", "sent", "failed"]),
  queued_at_utc: z.string().datetime(),
});
export type RiskQueueRecord = z.infer<typeof RiskQueueRecordSchema>;

export const IndicatorSpoolRecordSchema = z.object({
  id: z.number().int().positive(),
  event_type: z.string().min(1),
  payload: JsonObjectSchema,
  created_at_utc: z.string().datetime(),
});
export type IndicatorSpoolRecord = z.infer<typeof IndicatorSpoolRecordSchema>;

export const ToolLedgerRecordSchema = AuditTrailLedgerEntrySchema.extend({
  id: z.number().int().positive(),
  incident_code: z.string().min(1),
});
export type ToolLedgerRecord = z.infer<typeof ToolLedgerRecordSchema>;
