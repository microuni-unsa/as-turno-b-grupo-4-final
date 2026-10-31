import { z } from "zod";

export const DpoContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().nullable(),
});
export type DpoContact = z.infer<typeof DpoContactSchema>;

export const DelayReasonsSchema = z.object({
  hours_late: z.number().nonnegative(),
  reasons: z.array(z.string().min(1)).min(1),
});
export type DelayReasons = z.infer<typeof DelayReasonsSchema>;

export const UnknownItemSchema = z.object({
  item: z.string().min(1),
  reason: z.string().min(1),
});
export type UnknownItem = z.infer<typeof UnknownItemSchema>;

export const AuthorityNoticeStateSchema = z.enum([
  "draft",
  "reviewed",
  "approved",
  "sent",
  "acknowledged",
]);
export type AuthorityNoticeState = z.infer<typeof AuthorityNoticeStateSchema>;

export const AuthorityNoticePackSchema = z.object({
  pack: z.literal("authority"),
  pack_id: z.string().uuid(),
  incident_code: z.string().min(1),
  jurisdiction: z.literal("EU_GDPR"),
  awareness_at_utc: z.string().datetime(),
  deadline_at_utc: z.string().datetime(),
  submitted_at_utc: z.string().datetime().nullable(),
  delay_reasons: DelayReasonsSchema.nullable(),
  phased: z.boolean(),
  phases_planned: z.number().int().positive(),
  item_a_nature: z.string().min(1),
  item_a_categories_subjects: z.array(z.string()),
  item_a_approx_subjects: z.number().int().nonnegative(),
  item_a_categories_records: z.array(z.string()),
  item_a_approx_records: z.number().int().nonnegative(),
  item_a_unknown: z.array(UnknownItemSchema),
  item_b_dpo: DpoContactSchema,
  item_c_consequences: z.string().min(1),
  item_d_measures_taken: z.array(z.string()),
  item_d_measures_proposed: z.array(z.string()),
  citations: z.array(z.string()),
  review_approval_id: z.string().uuid().nullable(),
  state: AuthorityNoticeStateSchema,
});
export type AuthorityNoticePack = z.infer<typeof AuthorityNoticePackSchema>;

export const HighRiskGateResultSchema = z.object({
  verdict: z.boolean(),
  triggers: z.array(z.string()),
  determined_at_utc: z.string().datetime(),
  reviewer: z.string().min(1),
});
export type HighRiskGateResult = z.infer<typeof HighRiskGateResultSchema>;

export const Art34ExemptionLetterSchema = z.enum(["a", "b", "c"]);
export type Art34ExemptionLetter = z.infer<typeof Art34ExemptionLetterSchema>;

export const Art34ExemptionSchema = z.object({
  letter: Art34ExemptionLetterSchema,
  evidence_refs: z.array(z.string()).min(1),
  approval_id: z.string().uuid(),
  public_artifact: z.string().nullable(),
});
export type Art34Exemption = z.infer<typeof Art34ExemptionSchema>;

export const SubjectNoticeStateSchema = z.enum([
  "draft",
  "reviewed",
  "approved",
  "sent",
  "acknowledged",
  "exempted",
  "not_required",
]);
export type SubjectNoticeState = z.infer<typeof SubjectNoticeStateSchema>;

export const SubjectNoticePackSchema = z.object({
  pack: z.literal("subject"),
  pack_id: z.string().uuid(),
  incident_code: z.string().min(1),
  lang: z.enum(["es", "en"]),
  high_risk_gate: HighRiskGateResultSchema,
  exemption: Art34ExemptionSchema.nullable(),
  body_plain: z.string(),
  item_b_contact: DpoContactSchema,
  item_c_consequences: z.string(),
  item_d_measures: z.array(z.string()),
  recommendations: z.array(z.string()),
  citations: z.array(z.string()),
  review_approval_id: z.string().uuid().nullable(),
  state: SubjectNoticeStateSchema,
});
export type SubjectNoticePack = z.infer<typeof SubjectNoticePackSchema>;
