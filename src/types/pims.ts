/**
 * PIMS Data Models, Enums, Catalogs, and API Contract Types
 *
 * Grounded in:
 * - docs/incident-agent-spec.md (§3.1, §3.2, §3.5)
 * - data/gestitel_base_de_datos.sql (lines 1031-1220 and related core tables)
 * - 38 live API transcripts in docs/incident-agent-capture/
 */

// ============================================================================
// 1. Audit Model Base
// ============================================================================

export interface AuditModel {
  created_at: string;
  created_by: number | null;
  updated_at: string;
  updated_by: number | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: number | null;
}

// ============================================================================
// 2. Catalogs & Constants
// ============================================================================

/**
 * 12 Affected Data Types (Spanish canonical catalog)
 */
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

/**
 * 12 Affected Data Types (SPA bundle Y2e catalog)
 */
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

export type AffectedDataTypeEs = (typeof AFFECTED_DATA_TYPES_ES)[number];
export type AffectedDataTypeBundle =
  (typeof AFFECTED_DATA_TYPES_BUNDLE)[number];
export type AffectedDataType =
  | AffectedDataTypeEs
  | AffectedDataTypeBundle
  | (string & {});

export const ALL_AFFECTED_DATA_TYPES = [
  ...AFFECTED_DATA_TYPES_ES,
  ...AFFECTED_DATA_TYPES_BUNDLE,
] as const;

/**
 * 10 Security Measures Adopted (Spanish canonical catalog)
 */
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

/**
 * 10 Security Measures Adopted (SPA bundle W2e catalog)
 */
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
] as const;

export type SecurityMeasureAdoptedEs =
  (typeof SECURITY_MEASURES_ADOPTED_ES)[number];
export type SecurityMeasureAdoptedBundle =
  (typeof SECURITY_MEASURES_ADOPTED_BUNDLE)[number];
export type SecurityMeasureAdopted =
  | SecurityMeasureAdoptedEs
  | SecurityMeasureAdoptedBundle
  | (string & {});

export const ALL_SECURITY_MEASURES_ADOPTED = [
  ...SECURITY_MEASURES_ADOPTED_ES,
  ...SECURITY_MEASURES_ADOPTED_BUNDLE,
] as const;

/**
 * Affected CID components (Confidentiality, Integrity, Availability)
 */
export const CID_COMPONENTS = ["C", "I", "D"] as const;
export type CidComponent = (typeof CID_COMPONENTS)[number];

// ============================================================================
// 3. Single-Code Enums & Types
// ============================================================================

/**
 * Incident Status:
 * - 'O': Abierto (Open)
 * - 'I': En Investigación (In Investigation)
 * - 'P': En Proceso (In Process / DRF status code)
 * - 'C': Cerrado (Closed)
 */
export type IncidentStatus = "O" | "I" | "P" | "C";

/**
 * Severity Level:
 * - 'B' / 'L': Bajo / Baja (Low)
 * - 'M': Medio / Media (Medium)
 * - 'A' / 'H': Alto / Alta (High)
 * - 'C': Crítico / Crítica (Critical)
 */
export type SeverityLevel = "B" | "M" | "A" | "C" | "L" | "H";

/**
 * Impact Level:
 * - 'B' / 'L': Bajo (Low)
 * - 'M': Medio (Medium)
 * - 'A' / 'H': Alto (High)
 * - 'C' / 'V': Crítico / Muy Alto (Critical / Very High)
 */
export type ImpactLevel = "B" | "M" | "A" | "C" | "L" | "H" | "V";

/**
 * Incident Type codes:
 * - UA: Acceso no autorizado (Unauthorized access)
 * - DL: Fuga o pérdida de datos (Data leak / loss)
 * - MW: Malware o ransomware (Malware / Ransomware)
 * - PH: Phishing o ingeniería social (Phishing / Social engineering)
 * - DS: Denegación de servicio (Denial of Service)
 * - HE: Error humano (Human error)
 * - DV: Robo o pérdida de dispositivo (Device theft / loss)
 * - OT: Otro (Other)
 */
export type IncidentTypeCode =
  | "UA"
  | "DL"
  | "MW"
  | "PH"
  | "DS"
  | "HE"
  | "DV"
  | "OT";

export type IncidentType = IncidentTypeCode | (string & {});

/**
 * Action Type:
 * - C: Contención (Containment)
 * - A: Análisis (Analysis)
 * - R: Resolución (Resolution)
 */
export type ActionTypeCode = "C" | "A" | "R";
export type ActionType = ActionTypeCode | (string & {});

/**
 * Reporting entity type:
 * - R: Privada (Private)
 * - U: Pública (Public)
 */
export type EntityType = "R" | "U";

/**
 * Measure Question Answers:
 * - Y: Sí (Yes)
 * - N: No (No)
 * - U: Desconocido (Unknown)
 */
export type MeasureAnswer = "Y" | "N" | "U";

/**
 * Timeline Event Type
 */
export type IncidentEventType =
  | "created"
  | "updated"
  | "notified"
  | "status_changed"
  | (string & {});

/**
 * Audit Enums
 */
export type AuditType = "I" | "E"; // I: Interna, E: Externa
export type AuditStatus = "P" | "R" | "C"; // P: Planificada, R: En curso, C: Cerrada
export type FindingClassification = "N" | "O" | "M"; // N: No conformidad, O: Observación, M: Oportunidad de mejora
export type ActionPlanStatus = "O" | "P" | "C"; // O: Abierta, P: En progreso, C: Cerrada

/**
 * Risk Enums
 */
export type RiskStatus = "O" | "T" | "C"; // O: Abierta, T: En tratamiento, C: Cerrada
export type ResponseStrategy = "M" | "A" | "T" | "E"; // M: Mitigar, A: Aceptar, T: Transferir, E: Eliminar
export type IsEffective = "P" | "Y" | "N"; // P: Pendiente, Y: Sí, N: No
export type RiskPeriodStatus = "O" | "C"; // O: Abierto, C: Cerrado

export const PERU_DEPARTMENTS = [
  "Amazonas",
  "Áncash",
  "Apurímac",
  "Arequipa",
  "Ayacucho",
  "Cajamarca",
  "Callao",
  "Cusco",
  "Huancavelica",
  "Huánuco",
  "Ica",
  "Junín",
  "La Libertad",
  "Lambayeque",
  "Lima",
  "Loreto",
  "Madre de Dios",
  "Moquegua",
  "Pasco",
  "Piura",
  "Puno",
  "San Martín",
  "Tacna",
  "Tumbes",
  "Ucayali",
] as const;

export type PeruDepartment = (typeof PERU_DEPARTMENTS)[number];

// ============================================================================
// 4. Incident Children Models
// ============================================================================

export interface PimsIncidentAction {
  id: number;
  incident_id?: number;
  action_type: ActionType;
  responsible: string | null;
  action_date: string | null;
  description: string;
  evidence?: string | null;
  position: number;
}

export interface PimsIncidentAttachment {
  id: number;
  incident_id?: number;
  file: string;
  file_name: string;
  uploaded_at: string;
  uploaded_by: number | null;
  uploaded_by_name?: string;
}

export interface PimsIncidentHistoryRecipient {
  email: string;
  label: string;
}

export interface PimsIncidentHistory {
  id: number;
  incident_id: number;
  event_type: IncidentEventType;
  event_type_label?: string;
  changed_at: string;
  actor: string | null;
  changed_by: number | null;
  changed_by_name?: string;
  description: string;
  recipients_snapshot: Array<PimsIncidentHistoryRecipient> | string | null;
}

export interface PimsIncidentRecipient {
  id: number;
  email: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

// ============================================================================
// 5. Full PimsIncident Model (57 JSON Keys per §3.2 + DDL)
// ============================================================================

export interface PimsIncident {
  // Identity & Audit
  id: number;
  incident_code: string;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_by: number | null;
  updated_by: number | null;
  deleted_by?: number | null;
  created_by_id?: number | null;
  updated_by_id?: number | null;
  deleted_by_id?: number | null;

  // Reporter Representative (PII)
  rep_document_number: string | null;
  rep_document_expiry: string | null;
  rep_first_name: string | null;
  rep_last_name_p: string | null;
  rep_last_name_m: string | null;
  rep_position: string | null;
  rep_phone: string | null;
  rep_email: string | null;

  // Reporting Entity
  entity_type: EntityType | null;
  entity_ruc: string | null;
  entity_name: string | null;
  entity_phone: string | null;
  entity_extension: string | null;
  entity_department: PeruDepartment | string | null;
  entity_province: string | null;
  entity_district: string | null;

  // Incident Timing & Classification
  involves_personal_data: boolean;
  incident_date: string;
  incident_time: string | null;
  detection_date: string | null;
  detection_time: string | null;
  incident_type: IncidentType;
  status: IncidentStatus;
  severity: SeverityLevel | null;
  impact: ImpactLevel | null;
  title: string;
  description: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  affected_treatment: string | null;

  // DPO Contact (PII)
  dpo_contact_name: string | null;
  dpo_contact_email: string | null;
  dpo_contact_phone: string | null;

  // Technical & Personal Data Impact
  affected_data_types: AffectedDataType[];
  num_affected_subjects: number | null;
  affected_data_subjects_count?: number | null;
  personal_data_categories?: string[] | null;
  compromised_system: string | null;
  affected_url: string | null;
  evidence_refs: string | null;

  // Official Form Measures
  measure_updated_registry: MeasureAnswer | null;
  measure_new_security: MeasureAnswer | null;
  measure_improved_policies: MeasureAnswer | null;
  measure_considered_resolved: MeasureAnswer | null;
  measure_reported_authorities: MeasureAnswer | null;
  security_measures_adopted: SecurityMeasureAdopted[];
  resolved_date: string | null;
  affected_cid: CidComponent[];

  // Extended Regulatory & Root Cause Keys (§3.2 / §3.4 / 57 JSON keys)
  external_reference?: string | null;
  containment_measures?: string | null;
  root_cause?: string | Record<string, unknown> | null;
  requires_authority_notification?: boolean | null;
  authority_notified_at?: string | null;
  requires_subject_notification?: boolean | null;
  subjects_notified_at?: string | null;
  is_cross_border?: boolean | null;

  // Nested Children & Counts
  actions: PimsIncidentAction[];
  attachments: PimsIncidentAttachment[];
  history: PimsIncidentHistory[];
  attachments_count: number;
  actions_count: number;
}

// Request types for Incidents
export interface CreateIncidentRequest {
  title: string;
  involves_personal_data: boolean;
  incident_date: string;
  incident_type: IncidentType;
  status: IncidentStatus;
  affected_data_types: AffectedDataType[];
  security_measures_adopted: SecurityMeasureAdopted[];
  affected_cid: CidComponent[];

  // Optional fields
  incident_time?: string | null;
  detection_date?: string | null;
  detection_time?: string | null;
  severity?: SeverityLevel | null;
  impact?: ImpactLevel | null;
  description?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  affected_treatment?: string | null;
  dpo_contact_name?: string | null;
  dpo_contact_email?: string | null;
  dpo_contact_phone?: string | null;
  num_affected_subjects?: number | null;
  compromised_system?: string | null;
  affected_url?: string | null;
  evidence_refs?: string | null;
  rep_document_number?: string | null;
  rep_document_expiry?: string | null;
  rep_first_name?: string | null;
  rep_last_name_p?: string | null;
  rep_last_name_m?: string | null;
  rep_position?: string | null;
  rep_phone?: string | null;
  rep_email?: string | null;
  entity_type?: EntityType | null;
  entity_ruc?: string | null;
  entity_name?: string | null;
  entity_phone?: string | null;
  entity_extension?: string | null;
  entity_department?: string | null;
  entity_province?: string | null;
  entity_district?: string | null;
  measure_updated_registry?: MeasureAnswer | null;
  measure_new_security?: MeasureAnswer | null;
  measure_improved_policies?: MeasureAnswer | null;
  measure_considered_resolved?: MeasureAnswer | null;
  measure_reported_authorities?: MeasureAnswer | null;
  resolved_date?: string | null;
  actions?: Array<{
    action_type: ActionType;
    responsible?: string | null;
    action_date?: string | null;
    description: string;
    evidence?: string | null;
  }>;
}

export type UpdateIncidentRequest = Partial<CreateIncidentRequest>;

// ============================================================================
// 6. Audits, Findings & Action Plans (E17 - E19)
// ============================================================================

export interface PimsAuditActionPlan {
  id: number;
  finding_id?: number;
  action_plan: string;
  responsible: string | null;
  due_date: string | null;
  status: ActionPlanStatus;
  progress: number | null;
  closed_at: string | null;
  position: number;
}

export interface PimsAuditFinding {
  id: number;
  audit_id?: number;
  classification: FindingClassification;
  description: string;
  evidence: string | null;
  position: number;
  actions: PimsAuditActionPlan[];
}

export interface PimsAuditChecklistItem {
  id: number;
  source_requirement_code: string | null;
  process: string | null;
  standard: string | null;
  requirement: string | null;
  textual_evidence: string | null;
  position: number;
  audit_id: number;
  gap_requirement_id?: number | null;
}

export interface PimsAudit {
  id: number;
  audit_code: string;
  audit_type: AuditType;
  name: string;
  scope: string | null;
  objective: string | null;
  start_date: string | null;
  end_date: string | null;
  lead_auditor: string | null;
  audit_team: string | null;
  involved_areas: string | null;
  status: AuditStatus;
  progress: number | null;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
  deleted_by?: number | null;
  checklist?: PimsAuditChecklistItem[];
  findings: PimsAuditFinding[];
  findings_count?: number;
}

export interface CreateAuditRequest {
  audit_type: AuditType;
  name: string;
  status: AuditStatus;
  scope?: string | null;
  objective?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  lead_auditor?: string | null;
  audit_team?: string | null;
  involved_areas?: string | null;
}

export interface UpdateAuditRequest {
  findings?: Array<{
    classification: FindingClassification;
    description: string;
    evidence?: string | null;
    actions?: Array<{
      action_plan: string;
      responsible?: string | null;
      due_date?: string | null;
      status: ActionPlanStatus;
      progress?: number | null;
      closed_at?: string | null;
    }>;
  }>;
  [key: string]: unknown;
}

// ============================================================================
// 7. Risks & Risk Catalogs (E20 - E24)
// ============================================================================

export interface PimsRiskPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: RiskPeriodStatus;
  is_active: boolean;
  description?: string | null;
  closed_at?: string | null;
  snapshot_matrix_name?: string | null;
  snapshot_dimension?: number | null;
  snapshot_risk_ranges?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface PimsRiskEvaluation {
  id: number;
  risk_code: string;
  risk_owner: string | null;
  threat: string | null;
  threat_code: string | null;
  vulnerability: string | null;
  vulnerability_code: string | null;
  description: string;
  controlled_probability: number;
  controlled_impact: number;
  controlled_score: number | null;
  controlled_severity: string | null;
  residual_probability: number | null;
  residual_impact: number | null;
  residual_score: number | null;
  residual_severity: string | null;
  reduction: number | null;
  is_effective: IsEffective | null;
  verification_date: string | null;
  verified_by: string | null;
  evidence: string | null;
  observations: string | null;
  status: RiskStatus;
  response_strategy: ResponseStrategy | null;
  period_id: number;
  carried_from_id?: number | null;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
  deleted_by?: number | null;
  assets?: Array<
    { asset: number } | { id: number; name?: string; code?: string }
  >;
}

export interface CreateRiskEvaluationRequest {
  description: string;
  controlled_probability: number;
  controlled_impact: number;
  assets: Array<{ asset: number }>;
  threat_code?: string;
  vulnerability_code?: string;
  threat?: string;
  vulnerability?: string;
  risk_owner?: string;
  response_strategy?: ResponseStrategy;
  status?: RiskStatus;
}

export interface PimsRiskCatalogItem {
  code: string;
  name: string;
  family?: string;
  [key: string]: unknown;
}

export interface PimsRiskCatalogResponse {
  periods: PimsRiskPeriod[];
  current_period: PimsRiskPeriod | null;
  threats: PimsRiskCatalogItem[];
  vulnerabilities: PimsRiskCatalogItem[];
  control_types: PimsRiskCatalogItem[];
  security_measure_types: PimsRiskCatalogItem[];
  estimated_times: PimsRiskCatalogItem[];
  asset_categories: PimsRiskCatalogItem[];
  asset_classifications: PimsRiskCatalogItem[];
  appraisal_bands?: unknown[];
  process_options?: unknown;
  compliance_standard?: unknown;
  annex_a_controls?: unknown[];
  applicable_annex_a_controls?: Array<{
    code: string;
    title?: string;
    is_applicable?: boolean;
    [key: string]: unknown;
  }>;
  active_matrix?: unknown;
  risk_treatment_levels?: unknown[];
  asset_scope_label?: string;
}

export interface PimsAsset {
  id: number;
  code: string;
  name: string;
  description: string | null;
  owner: string | null;
  custodians: string | null;
  location: string | null;
  is_data_asset: boolean;
  category: string | null;
  classification: string | null;
  usage_frequency: string | null;
  confidentiality: string | null;
  integrity: string | null;
  availability: string | null;
  weight_confidentiality: number;
  weight_integrity: number;
  weight_availability: number;
  purpose: string | null;
  data_categories: unknown;
  role: string | null;
  pii_controls: unknown;
  legal_basis: string | null;
  purpose_detail: string | null;
  collection_origin: string | null;
  collection_procedure: string | null;
  data_usage: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
}

// ============================================================================
// 8. Dashboard KPIs (E25)
// ============================================================================

export interface PimsKpi {
  key: string;
  label: string;
  domain: string;
  domain_label: string;
  description: string;
  value: number | string | null;
  unit: string;
  direction: string;
  target: number | string | null;
  warning: number | string | null;
  has_target: boolean;
  status: string;
  has_data: boolean;
  reason: string | null;
  numerator: number | null;
  denominator: number | null;
  caption: string | null;
  is_default_target: boolean;
}

export interface PimsDashboardResponse {
  tab: string;
  tabs: string[];
  generated_at: string;
  kpis: PimsKpi[];
}

// ============================================================================
// 9. Annex A Metadata (E26)
// ============================================================================

export interface PimsAnnexAStandard {
  code: string;
  label: string;
  annex_label: string;
  total_controls: number;
  is_superseded: boolean;
}

export interface PimsAnnexAGroup {
  code: string;
  title: string;
  controls_count: number;
  controls?: Array<{
    code: string;
    title: string;
    description?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface PimsAnnexAMetaResponse {
  standard: PimsAnnexAStandard;
  groups: PimsAnnexAGroup[];
}

// ============================================================================
// 10. Auth & Session Types (E01 - E04)
// ============================================================================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface UserProfile {
  id?: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_platform_admin: boolean;
  is_external_advisor?: boolean;
  platform_role: string | null;
  must_change_password?: boolean;
  permissions?: string[];
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: UserProfile;
}

export interface TokenRefreshRequest {
  refresh: string;
}

export interface TokenRefreshResponse {
  access: string;
}

export interface TenantInfoResponse {
  name: string;
}

// ============================================================================
// 11. Pagination Generic
// ============================================================================

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
