import { SHA256_HEX_LENGTH } from "@pims/types/constants.ts";
import {
  ACTION_TYPES,
  type AffectedDataType,
  ALL_AFFECTED_DATA_TYPES,
  ALL_SECURITY_MEASURES,
  INCIDENT_IMPACTS,
  INCIDENT_SEVERITIES,
} from "@pims/types/pims.ts";
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

export const SENSITIVE_AFFECTED_DATA_TYPES = [
  "sensitive",
  "health",
  "biometric",
  "minors",
  "financial",
  "credentials",
  "categorias_especiales",
  "economicos_financieros",
  "datos_relativos_condenas_infracciones",
] as const satisfies readonly AffectedDataType[];

const SENSITIVE_AFFECTED_DATA_TYPE_SET: ReadonlySet<AffectedDataType> = new Set(
  SENSITIVE_AFFECTED_DATA_TYPES,
);

export function isSensitiveAffectedDataType(value: AffectedDataType): boolean {
  return SENSITIVE_AFFECTED_DATA_TYPE_SET.has(value);
}

export const HighRiskTriggerSchema = z.enum([
  "severity:C",
  "impact:V",
  "sensitive_data_types",
  "num_affected_subjects>=100",
  "unencrypted_exfiltration",
  "authority_ordered",
]);
export type HighRiskTrigger = z.infer<typeof HighRiskTriggerSchema>;

export const HighRiskGateInputSchema = z
  .object({
    severity: z.enum(INCIDENT_SEVERITIES),
    impact: z.enum(INCIDENT_IMPACTS),
    affectedDataTypes: z.array(z.enum(ALL_AFFECTED_DATA_TYPES)),
    numAffectedSubjects: z.number().int().nonnegative().nullable(),
    unencryptedExfiltration: z.boolean(),
    authorityOrdered: z.boolean(),
    reviewer: z.string().min(1),
  })
  .strict();
export type HighRiskGateInput = z.infer<typeof HighRiskGateInputSchema>;

export const HighRiskGateResultSchema = z.object({
  verdict: z.boolean(),
  triggers: z.array(HighRiskTriggerSchema),
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

export const NoticeStateSchema = z.union([
  AuthorityNoticeStateSchema,
  SubjectNoticeStateSchema,
]);
export type NoticeState = z.infer<typeof NoticeStateSchema>;

export const NumericApprovalSchema = z.object({
  value: z.string().min(1),
  occurrence: z.number().int().nonnegative(),
  reason: z.string().min(1),
  approval_id: z.string().uuid(),
});
export type NumericApproval = z.infer<typeof NumericApprovalSchema>;

export const PlainLanguageWaiverSchema = z.object({
  reason: z.string().min(1),
  approval_id: z.string().uuid(),
});
export type PlainLanguageWaiver = z.infer<typeof PlainLanguageWaiverSchema>;

export const PlainLanguageValidationOptionsSchema = z
  .object({
    maxWords: z.number().int().positive().optional(),
    locale: z.enum(["es", "en"]).optional(),
    plainLanguageWaiver: PlainLanguageWaiverSchema.optional(),
    numericApprovals: z.array(NumericApprovalSchema).optional(),
  })
  .strict();
export type PlainLanguageValidationOptions = z.input<
  typeof PlainLanguageValidationOptionsSchema
>;

export const EncryptionProofAttestationSchema = z
  .object({
    incident_code: z.string().min(1),
    source_file_sha256: z.string().length(SHA256_HEX_LENGTH),
    scope: z.enum(["encrypt_rest", "encrypt_transit"]),
    algorithm: z.string().min(1),
    key_management_ref: z.string().min(1),
    applies_to_affected_data: z.boolean(),
    evidence_refs: z.array(z.string().min(1)).min(1),
    verified_by: z.string().min(1),
    verified_at_utc: z.string().datetime(),
    review_approval_id: z.string().uuid(),
  })
  .strict();
export type EncryptionProofAttestation = z.infer<
  typeof EncryptionProofAttestationSchema
>;

export const SubsequentMeasureSchema = z
  .object({
    action_type: z.enum(ACTION_TYPES),
    description: z.string().min(1),
    risk_eliminated: z.boolean(),
    evidence_refs: z.array(z.string().min(1)).min(1),
    review_approval_id: z.string().uuid(),
  })
  .strict();
export type SubsequentMeasure = z.infer<typeof SubsequentMeasureSchema>;

export const DisproportionateEffortSchema = z
  .object({
    analysis_ref: z.string().min(1),
    public_artifact_ref: z.string().min(1).nullable(),
    published_at_utc: z.string().datetime(),
    review_approval_id: z.string().uuid(),
  })
  .strict();
export type DisproportionateEffort = z.infer<
  typeof DisproportionateEffortSchema
>;

export const AuthorityInstructionSchema = z
  .object({
    instruction_ref: z.string().min(1),
    ordered_at_utc: z.string().datetime(),
  })
  .strict();
export type AuthorityInstruction = z.infer<typeof AuthorityInstructionSchema>;

export const ExemptionEvaluationInputSchema = z
  .object({
    incidentCode: z.string().min(1),
    securityMeasuresAdopted: z.array(z.enum(ALL_SECURITY_MEASURES)),
    encryptionProofs: z.array(EncryptionProofAttestationSchema),
    subsequentMeasures: z.array(SubsequentMeasureSchema),
    disproportionateEffort: DisproportionateEffortSchema.nullable(),
    authorityInstruction: AuthorityInstructionSchema.nullable(),
  })
  .strict();
export type ExemptionEvaluationInput = z.infer<
  typeof ExemptionEvaluationInputSchema
>;

export const ExemptionEvaluationResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("authority_override"),
    reason: z.literal("AUTHORITY_OVERRIDE"),
    instruction_ref: z.string().min(1),
  }),
  z.object({
    kind: z.literal("exempted"),
    reason: z.enum([
      "ENCRYPTION_VERIFIED",
      "RISK_ELIMINATED",
      "DISPROPORTIONATE_EFFORT",
    ]),
    exemption: Art34ExemptionSchema,
  }),
  z.object({
    kind: z.literal("notice_required"),
    reason: z.literal("NO_EXEMPTION_QUALIFIED"),
  }),
]);
export type ExemptionEvaluationResult = z.infer<
  typeof ExemptionEvaluationResultSchema
>;

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
