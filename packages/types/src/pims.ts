import { z } from "zod";

export const AFFECTED_DATA_TYPES_ES = [
  "identificativos",
  "contacto",
  "caracteristicas_personales",
  "circunstancias_sociales",
  "academicos_profesionales",
  "detalles_empleo",
  "informacion_comercial",
  "economicos_financieros",
  "transacciones_bienes_servicios",
  "categorias_especiales",
  "datos_relativos_condenas_infracciones",
  "otros",
] as const;

export const AFFECTED_DATA_TYPES_BUNDLE = [
  "names",
  "id_doc",
  "address",
  "phone",
  "email",
  "financial",
  "health",
  "biometric",
  "geolocation",
  "credentials",
  "minors",
  "sensitive",
] as const;

export const ALL_AFFECTED_DATA_TYPES = [
  ...AFFECTED_DATA_TYPES_ES,
  ...AFFECTED_DATA_TYPES_BUNDLE,
] as const;

export type AffectedDataType = (typeof ALL_AFFECTED_DATA_TYPES)[number];

export const SECURITY_MEASURES_ADOPTED_ES = [
  "cifrado_datos",
  "control_acceso",
  "copias_seguridad",
  "formacion_personal",
  "gestion_vulnerabilidades",
  "monitorizacion_logs",
  "politicas_seguridad",
  "procedimientos_incidentes",
  "seguridad_redes",
  "otras",
] as const;

export const SECURITY_MEASURES_ADOPTED_BUNDLE = [
  "encrypt_rest",
  "encrypt_transit",
  "mfa",
  "network_seg",
  "rbac",
  "siem",
  "training",
  "patching",
  "backups",
  "dlp",
  "access_revocation",
  "staff_training",
  "incident_plan",
] as const;

export const ALL_SECURITY_MEASURES = [
  ...SECURITY_MEASURES_ADOPTED_ES,
  ...SECURITY_MEASURES_ADOPTED_BUNDLE,
] as const;

export const AFFECTED_CID = ["C", "I", "D"] as const;

export const INCIDENT_STATUSES = ["O", "P", "C"] as const;
export const INCIDENT_SEVERITIES = ["L", "M", "H", "C"] as const;
export const INCIDENT_IMPACTS = ["L", "M", "H", "V"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];
export const INCIDENT_TYPES = [
  "UA",
  "DL",
  "MW",
  "PH",
  "DS",
  "HE",
  "DV",
  "OT",
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const ACTION_TYPES = ["C", "A", "R"] as const;
export const AUDIT_STATUSES = ["P", "R", "C"] as const;
export const AUDIT_TYPES = ["I", "E"] as const;
export const FINDING_CLASSIFICATIONS = ["N", "O", "M"] as const;
export const ACTION_PLAN_STATUSES = ["O", "P", "C"] as const;
export const RISK_EVAL_STATUSES = ["B", "O", "T", "C"] as const;

export type SecurityMeasure = (typeof ALL_SECURITY_MEASURES)[number];
export type AffectedCid = (typeof AFFECTED_CID)[number];
export type ActionType = (typeof ACTION_TYPES)[number];
export type FindingClassification = (typeof FINDING_CLASSIFICATIONS)[number];
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];
export type RiskEvalStatus = (typeof RISK_EVAL_STATUSES)[number];
export type ResponseStrategy = "M" | "A" | "T" | "E";
export const ASSET_RELEVANCES = ["BAJO", "MEDIO", "ALTO", "CRITICO"] as const;
export const FORM_MEASURE_VALUES = ["Y", "N", "U"] as const;
export const EVENT_TYPES = [
  "created",
  "updated",
  "notified",
  "status_changed",
  "closed",
  "reopened",
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const AuditModelSchema = z.object({
  created_at: z.string(),
  created_by: z.number().nullable().optional(),
  updated_at: z.string(),
  updated_by: z.number().nullable().optional(),
  is_deleted: z.boolean(),
  deleted_at: z.string().nullable().optional(),
  deleted_by: z.number().nullable().optional(),
});

export const UserSummarySchema = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  is_platform_admin: z.boolean().optional(),
});

export const UserProfileSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  area: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  is_platform_admin: z.boolean(),
  must_change_password: z.boolean(),
});

export const TenantInfoSchema = z.object({
  name: z.string(),
  schema_name: z.string().optional(),
});

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  user: UserSummarySchema,
});

export const TokenRefreshRequestSchema = z.object({
  refresh: z.string().min(1),
});

export const TokenRefreshResponseSchema = z.object({
  access: z.string().min(1),
});

export const PimsIncidentActionSchema = z.object({
  id: z.number().optional(),
  incident: z.number().optional(),
  incident_id: z.number().optional(),
  action_type: z.enum(ACTION_TYPES),
  responsible: z.string(),
  action_date: z.string(),
  description: z.string(),
  evidence: z.string().nullable().optional(),
  position: z.number().optional(),
});

export const PimsIncidentAttachmentSchema = z.object({
  id: z.number(),
  incident: z.number().optional(),
  incident_id: z.number().optional(),
  file: z.string(),
  file_name: z.string().optional(),
  original_name: z.string().optional(),
  file_size: z.number().optional(),
  content_type: z.string().optional(),
  uploaded_at: z.string().optional(),
  uploaded_by: z.number().nullable().optional(),
  uploaded_by_name: z.string().nullable().optional(),
});

export const PimsIncidentHistorySchema = z.object({
  id: z.number(),
  incident: z.number().optional(),
  incident_id: z.number().optional(),
  event_type: z.string().optional(),
  event_type_label: z.string().optional(),
  changed_at: z.string(),
  actor: z.string().nullable().optional(),
  changed_by: z.number().nullable().optional(),
  changed_by_name: z.string().nullable().optional(),
  field_name: z.string().optional(),
  old_value: z.string().nullable().optional(),
  new_value: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  recipients_snapshot: z.array(z.string()).nullable().optional(),
});

export const PimsIncidentRecipientSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  label: z.string(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
});

export const PimsIncidentRecipientCreateSchema = z.object({
  email: z.string().email(),
  label: z.string(),
  is_active: z.boolean().optional().default(true),
});

export const PimsIncidentSchema = AuditModelSchema.extend({
  id: z.number(),
  incident_code: z.string(),
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
  involves_personal_data: z.boolean(),
  incident_date: z.string(),
  incident_time: z.string().nullable().optional(),
  detection_date: z.string().nullable().optional(),
  detection_time: z.string().nullable().optional(),
  incident_type: z.enum(INCIDENT_TYPES),
  status: z.enum(INCIDENT_STATUSES),
  severity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  impact: z.enum(INCIDENT_IMPACTS).nullable().optional(),
  title: z.string(),
  description: z.string().max(1000).nullable().optional(),
  reported_by: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  affected_treatment: z.string().nullable().optional(),
  dpo_contact_name: z.string().nullable().optional(),
  dpo_contact_email: z.string().nullable().optional(),
  dpo_contact_phone: z.string().nullable().optional(),
  affected_data_types: z.array(z.enum(ALL_AFFECTED_DATA_TYPES)),
  num_affected_subjects: z.number().nullable().optional(),
  compromised_system: z.string().nullable().optional(),
  affected_url: z.string().nullable().optional(),
  evidence_refs: z.string().nullable().optional(),
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
  security_measures_adopted: z.array(z.enum(ALL_SECURITY_MEASURES)),
  resolved_date: z.string().nullable().optional(),
  affected_cid: z.array(z.enum(AFFECTED_CID)),
  actions: z.array(PimsIncidentActionSchema).optional(),
  attachments: z.array(PimsIncidentAttachmentSchema).optional(),
  history: z.array(PimsIncidentHistorySchema).optional(),
  attachments_count: z.number().optional(),
  actions_count: z.number().optional(),
});

export const PimsIncidentCreateSchema = z.object({
  title: z.string().min(1),
  involves_personal_data: z.boolean(),
  incident_date: z.string().min(1),
  incident_type: z.enum(INCIDENT_TYPES),
  status: z.enum(INCIDENT_STATUSES),
  incident_code: z.string().optional(),
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
  incident_time: z.string().nullable().optional(),
  detection_date: z.string().nullable().optional(),
  detection_time: z.string().nullable().optional(),
  severity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  impact: z.enum(INCIDENT_IMPACTS).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  reported_by: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  affected_treatment: z.string().nullable().optional(),
  dpo_contact_name: z.string().nullable().optional(),
  dpo_contact_email: z.string().nullable().optional(),
  dpo_contact_phone: z.string().nullable().optional(),
  affected_data_types: z.array(z.enum(ALL_AFFECTED_DATA_TYPES)).optional(),
  num_affected_subjects: z.number().nullable().optional(),
  compromised_system: z.string().nullable().optional(),
  affected_url: z.string().nullable().optional(),
  evidence_refs: z.string().nullable().optional(),
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
  security_measures_adopted: z.array(z.enum(ALL_SECURITY_MEASURES)).optional(),
  resolved_date: z.string().nullable().optional(),
  affected_cid: z.array(z.enum(AFFECTED_CID)).optional(),
  actions: z
    .array(
      PimsIncidentActionSchema.partial().extend({
        action_type: z.enum(ACTION_TYPES),
        responsible: z.string(),
        action_date: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
});

export const PimsIncidentUpdateSchema =
  PimsIncidentCreateSchema.partial().extend({
    is_deleted: z.boolean().optional(),
    deleted_at: z.string().nullable().optional(),
  });

export const PimsAuditActionPlanSchema = z.object({
  id: z.number().optional(),
  finding: z.number().optional(),
  code: z.string().optional(),
  action_plan: z.string().optional(),
  description: z.string().optional(),
  responsible: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(ACTION_PLAN_STATUSES),
  progress: z.number().optional(),
  position: z.number().optional(),
});

export const PimsAuditFindingSchema = z.object({
  id: z.number().optional(),
  audit: z.number().optional(),
  classification: z.enum(FINDING_CLASSIFICATIONS),
  description: z.string(),
  evidence: z.string().nullable().optional(),
  actions: z.array(PimsAuditActionPlanSchema).optional(),
});

export const PimsAuditSchema = AuditModelSchema.extend({
  id: z.number(),
  code: z.string(),
  audit_code: z.string().optional(),
  name: z.string(),
  audit_type: z.enum(AUDIT_TYPES),
  status: z.enum(AUDIT_STATUSES),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  lead_auditor: z.string().nullable().optional(),
  findings: z.array(PimsAuditFindingSchema).optional(),
});

export const PimsAuditCreateSchema = z.object({
  audit_type: z.enum(AUDIT_TYPES),
  name: z.string().min(1),
  status: z.enum(AUDIT_STATUSES),
  code: z.string().optional(),
  audit_code: z.string().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  lead_auditor: z.string().nullable().optional(),
  findings: z
    .array(
      z.object({
        classification: z.enum(FINDING_CLASSIFICATIONS),
        description: z.string().min(1),
        evidence: z.string().nullable().optional(),
        actions: z
          .array(
            z.object({
              action_plan: z.string().optional(),
              description: z.string().optional(),
              responsible: z.string().min(1),
              due_date: z.string().min(1),
              status: z.enum(ACTION_PLAN_STATUSES),
              progress: z.number().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export const PimsAuditUpdateSchema = PimsAuditCreateSchema.partial();

export const PimsRiskPeriodSchema = z.object({
  id: z.number(),
  name: z.string(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  status: z.string().optional(),
  is_active: z.boolean().optional(),
  is_locked: z.boolean().optional(),
});

export const PimsThreatSchema = z.object({
  code: z.string(),
  label: z.string(),
  category: z.string(),
  subtype: z.string().nullable().optional(),
});

export const PimsVulnerabilitySchema = z.object({
  code: z.string(),
  label: z.string(),
  category: z.string(),
  subtype: z.string().nullable().optional(),
});

export const PimsSafeguardSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
});

export const PimsRiskRangeSchema = z.object({
  level: z.string(),
  min_value: z.number(),
  max_value: z.number(),
});

export const PimsActiveMatrixSchema = z.object({
  dimension: z.number().int().positive().optional(),
  risk_ranges: z.array(PimsRiskRangeSchema).optional(),
});

export const PimsRiskEvaluationSchema = AuditModelSchema.extend({
  id: z.number(),
  code: z.string(),
  risk_code: z.string().optional(),
  name: z.string(),
  status: z.enum(RISK_EVAL_STATUSES),
  risk_period: z.number(),
  scope: z.string().nullable().optional(),
});

export const PimsRiskEvaluationCreateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  risk_period: z.number().int().positive().optional(),
  status: z.enum(RISK_EVAL_STATUSES).optional(),
  scope: z.string().nullable().optional(),
  code: z.string().optional(),
  risk_code: z.string().optional(),
  risk_owner: z.string().optional(),
  threat: z.string().optional(),
  threat_code: z.string().optional(),
  vulnerability: z.string().optional(),
  vulnerability_code: z.string().optional(),
  controlled_probability: z.number().optional(),
  controlled_impact: z.number().optional(),
  response_strategy: z.string().optional(),
  assets: z
    .array(
      z.union([
        z.number(),
        z.object({ asset: z.number().optional(), id: z.number().optional() }),
      ]),
    )
    .optional(),
});

export const PimsAnnexAControlSchema = z.object({
  code: z.string(),
  name: z.string(),
  group_code: z.string().optional(),
  group_name: z.string().optional(),
  applicable_role: z.string().optional(),
  description: z.string().optional(),
  source_standard: z.string().optional(),
});

export const PimsCatalogOptionSchema = z.object({
  code: z.string(),
  label: z.string(),
});

export const PimsRiskCatalogSchema = z.object({
  periods: z.array(PimsRiskPeriodSchema).optional(),
  current_period: PimsRiskPeriodSchema.optional(),
  threats: z.array(PimsThreatSchema),
  vulnerabilities: z.array(PimsVulnerabilitySchema),
  safeguards: z.array(PimsSafeguardSchema).optional(),
  active_matrix: PimsActiveMatrixSchema.optional(),
  applicable_annex_a_controls: z.array(PimsAnnexAControlSchema).optional(),
  annex_a_controls: z.array(PimsAnnexAControlSchema).optional(),
  control_types: z.array(PimsCatalogOptionSchema).optional(),
  security_measure_types: z.array(PimsCatalogOptionSchema).optional(),
  estimated_times: z.array(PimsCatalogOptionSchema).optional(),
  risk_treatment_levels: z.array(z.string()).optional(),
});

export const PimsAssetSchema = AuditModelSchema.extend({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  custodians: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  is_data_asset: z.boolean().optional(),
  category: z.string().optional(),
  classification: z.string().optional(),
  usage_frequency: z.string().optional(),
  confidentiality: z.string().optional(),
  integrity: z.string().optional(),
  availability: z.string().optional(),
  relevance: z.enum(ASSET_RELEVANCES),
});

export const PimsDashboardTabSchema = z.object({
  key: z.string(),
  label: z.string(),
});

export const PimsKpiSchema = z.object({
  key: z.string(),
  label: z.string(),
  domain: z.string(),
  domain_label: z.string(),
  description: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  direction: z.string(),
  target: z.number(),
  warning: z.number(),
  has_target: z.boolean(),
  status: z.string(),
  has_data: z.boolean(),
  reason: z.string(),
  numerator: z.number().nullable(),
  denominator: z.number(),
  caption: z.string(),
  is_default_target: z.boolean(),
});

export const PimsDashboardSemaphoreSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.string(),
  kpis_ok: z.number().optional(),
  kpis_total: z.number().optional(),
  detail: z.string().optional(),
});

export const PimsDashboardChartSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
});

export const PimsDashboardResponseSchema = z.object({
  tab: z.string(),
  tabs: z.array(PimsDashboardTabSchema).optional(),
  generated_at: z.string().optional(),
  kpis: z.array(PimsKpiSchema),
  charts: z.array(PimsDashboardChartSchema).optional(),
  semaphores: z.array(PimsDashboardSemaphoreSchema).optional(),
  risk_period: PimsRiskPeriodSchema.optional(),
});
export const DashboardKpisSchema = PimsDashboardResponseSchema;

export const PimsAnnexAItemSchema = z.object({
  code: z.string(),
  label: z.string(),
  count: z.number().optional(),
});

export const PimsAnnexAMetaResponseSchema = z.object({
  standard: z.object({
    code: z.string(),
    label: z.string().optional(),
    annex_label: z.string().optional(),
    total_controls: z.number().optional(),
    is_superseded: z.boolean().optional(),
  }),
  groups: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      count: z.number(),
    }),
  ),
  roles: z.array(PimsAnnexAItemSchema).optional(),
  sources: z.array(PimsAnnexAItemSchema).optional(),
});
export const AnnexAControlsMetaSchema = PimsAnnexAMetaResponseSchema;

export function paginatedResultSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}

export type AuditModel = z.infer<typeof AuditModelSchema>;
export type UserSummary = z.infer<typeof UserSummarySchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type TenantInfo = z.infer<typeof TenantInfoSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type TokenRefreshRequest = z.infer<typeof TokenRefreshRequestSchema>;
export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>;

export type PimsIncident = z.infer<typeof PimsIncidentSchema>;
export type PimsIncidentCreate = z.infer<typeof PimsIncidentCreateSchema>;
export type PimsIncidentUpdate = z.infer<typeof PimsIncidentUpdateSchema>;
export type PimsIncidentAction = z.infer<typeof PimsIncidentActionSchema>;
export type PimsIncidentAttachment = z.infer<
  typeof PimsIncidentAttachmentSchema
>;
export type PimsIncidentHistory = z.infer<typeof PimsIncidentHistorySchema>;
export type PimsIncidentRecipient = z.infer<typeof PimsIncidentRecipientSchema>;
export type PimsIncidentRecipientCreate = z.infer<
  typeof PimsIncidentRecipientCreateSchema
>;

export type PimsAudit = z.infer<typeof PimsAuditSchema>;
export type PimsAuditCreate = z.infer<typeof PimsAuditCreateSchema>;
export type PimsAuditUpdate = z.infer<typeof PimsAuditUpdateSchema>;
export type PimsAuditFinding = z.infer<typeof PimsAuditFindingSchema>;
export type PimsAuditActionPlan = z.infer<typeof PimsAuditActionPlanSchema>;

export type PimsRiskEvaluation = z.infer<typeof PimsRiskEvaluationSchema>;
export type PimsRiskEvaluationCreate = z.infer<
  typeof PimsRiskEvaluationCreateSchema
>;
export type PimsRiskCatalogResponse = z.infer<typeof PimsRiskCatalogSchema>;
export type PimsAnnexAControl = z.infer<typeof PimsAnnexAControlSchema>;
export type PimsCatalogOption = z.infer<typeof PimsCatalogOptionSchema>;
export type PimsRiskPeriod = z.infer<typeof PimsRiskPeriodSchema>;
export type PimsThreat = z.infer<typeof PimsThreatSchema>;
export type PimsVulnerability = z.infer<typeof PimsVulnerabilitySchema>;
export type PimsAsset = z.infer<typeof PimsAssetSchema>;

export type PimsDashboardTab = z.infer<typeof PimsDashboardTabSchema>;
export type PimsKpi = z.infer<typeof PimsKpiSchema>;
export type PimsDashboardResponse = z.infer<typeof PimsDashboardResponseSchema>;
export type PimsAnnexAMetaResponse = z.infer<
  typeof PimsAnnexAMetaResponseSchema
>;

export interface PaginatedResult<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
