import {
  bigint,
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  text,
  time,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const unsa = pgSchema("unsa");

export const authUser = unsa.table("auth_user", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  password: text("password").notNull(),
  last_login: timestamp("last_login", { withTimezone: true }),
  is_superuser: boolean("is_superuser").notNull().default(false),
  username: varchar("username", { length: 150 }).notNull(),
  first_name: varchar("first_name", { length: 150 }),
  last_name: varchar("last_name", { length: 150 }),
  email: varchar("email", { length: 254 }),
  is_staff: boolean("is_staff").notNull().default(false),
  is_active: boolean("is_active").notNull().default(true),
  date_joined: timestamp("date_joined", { withTimezone: true }).notNull(),
});

export const coreUserProfile = unsa.table("core_userprofile", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  user_id: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => authUser.id),
  area: varchar("area", { length: 100 }),
  position: varchar("position", { length: 100 }),
  is_platform_admin: boolean("is_platform_admin").notNull().default(false),
  must_change_password: boolean("must_change_password")
    .notNull()
    .default(false),
});

export const customerClient = pgTable("customer_client", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  schema_name: varchar("schema_name", { length: 63 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  tax_id: varchar("tax_id", { length: 20 }),
  contact_email: varchar("contact_email", { length: 254 }),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }),
  document_limit: integer("document_limit"),
  compliance_standard: varchar("compliance_standard", { length: 50 }),
});

export const coreIncident = unsa.table("core_incident", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  is_deleted: boolean("is_deleted").notNull().default(false),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  created_by_id: integer("created_by_id").notNull(),
  updated_by_id: integer("updated_by_id"),
  deleted_by_id: integer("deleted_by_id"),

  incident_code: varchar("incident_code", { length: 20 }).notNull(),
  rep_document_number: varchar("rep_document_number", { length: 20 }),
  rep_document_expiry: date("rep_document_expiry"),
  rep_first_name: varchar("rep_first_name", { length: 100 }),
  rep_last_name_p: varchar("rep_last_name_p", { length: 100 }),
  rep_last_name_m: varchar("rep_last_name_m", { length: 100 }),
  rep_position: varchar("rep_position", { length: 100 }),
  rep_phone: varchar("rep_phone", { length: 20 }),
  rep_email: varchar("rep_email", { length: 254 }),
  entity_type: varchar("entity_type", { length: 1 }),
  entity_ruc: varchar("entity_ruc", { length: 11 }),
  entity_name: varchar("entity_name", { length: 200 }),
  entity_phone: varchar("entity_phone", { length: 20 }),
  entity_extension: varchar("entity_extension", { length: 10 }),
  entity_department: varchar("entity_department", { length: 50 }),
  entity_province: varchar("entity_province", { length: 100 }),
  entity_district: varchar("entity_district", { length: 100 }),
  involves_personal_data: boolean("involves_personal_data")
    .notNull()
    .default(false),
  incident_date: date("incident_date").notNull(),
  incident_time: time("incident_time"),
  detection_date: date("detection_date"),
  detection_time: time("detection_time"),
  incident_type: varchar("incident_type", { length: 2 }).notNull(),
  status: varchar("status", { length: 1 }).notNull(),
  severity: varchar("severity", { length: 1 }),
  impact: varchar("impact", { length: 1 }),
  title: varchar("title", { length: 150 }).notNull(),
  description: text("description"),
  reported_by: varchar("reported_by", { length: 150 }),
  assigned_to: varchar("assigned_to", { length: 150 }),
  affected_treatment: varchar("affected_treatment", { length: 200 }),
  dpo_contact_name: varchar("dpo_contact_name", { length: 150 }),
  dpo_contact_email: varchar("dpo_contact_email", { length: 254 }),
  dpo_contact_phone: varchar("dpo_contact_phone", { length: 20 }),
  affected_data_types: jsonb("affected_data_types").notNull(),
  num_affected_subjects: integer("num_affected_subjects"),
  compromised_system: varchar("compromised_system", { length: 255 }),
  affected_url: varchar("affected_url", { length: 500 }),
  evidence_refs: text("evidence_refs"),
  measure_updated_registry: varchar("measure_updated_registry", { length: 1 }),
  measure_new_security: varchar("measure_new_security", { length: 1 }),
  measure_improved_policies: varchar("measure_improved_policies", {
    length: 1,
  }),
  measure_considered_resolved: varchar("measure_considered_resolved", {
    length: 1,
  }),
  measure_reported_authorities: varchar("measure_reported_authorities", {
    length: 1,
  }),
  security_measures_adopted: jsonb("security_measures_adopted").notNull(),
  resolved_date: date("resolved_date"),
  affected_cid: jsonb("affected_cid").notNull(),
});

export const coreIncidentAction = unsa.table("core_incidentaction", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  incident_id: bigint("incident_id", { mode: "number" })
    .notNull()
    .references(() => coreIncident.id),
  action_type: varchar("action_type", { length: 1 }).notNull(),
  responsible: varchar("responsible", { length: 150 }).notNull(),
  action_date: date("action_date").notNull(),
  description: text("description").notNull(),
  evidence: text("evidence"),
  position: integer("position").notNull().default(1),
});

export const coreIncidentAttachment = unsa.table("core_incidentattachment", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  incident_id: bigint("incident_id", { mode: "number" })
    .notNull()
    .references(() => coreIncident.id),
  file: varchar("file", { length: 500 }).notNull(),
  file_name: varchar("file_name", { length: 255 }).notNull(),
  uploaded_at: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  uploaded_by_id: integer("uploaded_by_id"),
});

export const coreIncidentHistory = unsa.table("core_incidenthistory", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  incident_id: bigint("incident_id", { mode: "number" })
    .notNull()
    .references(() => coreIncident.id),
  event_type: varchar("event_type", { length: 20 }).notNull(),
  changed_at: timestamp("changed_at", { withTimezone: true }).notNull(),
  actor: varchar("actor", { length: 150 }),
  changed_by_id: integer("changed_by_id"),
  description: text("description"),
  recipients_snapshot: jsonb("recipients_snapshot"),
});

export const coreIncidentRecipient = unsa.table("core_incidentrecipient", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  label: varchar("label", { length: 100 }),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const coreAudit = unsa.table("core_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  audit_code: varchar("audit_code", { length: 20 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  audit_type: varchar("audit_type", { length: 1 }).notNull(),
  status: varchar("status", { length: 1 }).notNull(),
  start_date: date("start_date"),
  end_date: date("end_date"),
  scope: text("scope"),
  objective: text("objective"),
  lead_auditor: varchar("lead_auditor", { length: 150 }),
  audit_team: text("audit_team"),
  involved_areas: text("involved_areas"),
  progress: integer("progress").default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  is_deleted: boolean("is_deleted").notNull().default(false),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  created_by_id: integer("created_by_id").notNull(),
  updated_by_id: integer("updated_by_id"),
  deleted_by_id: integer("deleted_by_id"),
});

export const coreAuditFinding = unsa.table("core_auditfinding", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  audit_id: bigint("audit_id", { mode: "number" })
    .notNull()
    .references(() => coreAudit.id),
  classification: varchar("classification", { length: 1 }).notNull(),
  description: text("description").notNull(),
  evidence: text("evidence"),
  position: integer("position").notNull().default(1),
});

export const coreAuditActionPlan = unsa.table("core_auditactionplan", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  finding_id: bigint("finding_id", { mode: "number" })
    .notNull()
    .references(() => coreAuditFinding.id),
  action_plan: text("action_plan").notNull(),
  responsible: varchar("responsible", { length: 150 }),
  due_date: date("due_date"),
  status: varchar("status", { length: 1 }).notNull(),
  progress: integer("progress").default(0),
  closed_at: date("closed_at"),
  position: integer("position").notNull().default(1),
});

export const coreRiskPeriod = unsa.table("core_riskperiod", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  start_date: date("start_date").notNull(),
  end_date: date("end_date").notNull(),
  status: varchar("status", { length: 1 }).notNull(),
  is_active: boolean("is_active").notNull().default(false),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  is_deleted: boolean("is_deleted").notNull().default(false),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export const coreRiskEvaluation = unsa.table("core_riskevaluation", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  risk_code: varchar("risk_code", { length: 20 }).notNull(),
  risk_owner: varchar("risk_owner", { length: 150 }),
  threat: text("threat"),
  vulnerability: text("vulnerability"),
  description: text("description").notNull(),
  controlled_probability: integer("controlled_probability")
    .notNull()
    .default(3),
  controlled_impact: integer("controlled_impact").notNull().default(3),
  controlled_score: numeric("controlled_score", {
    precision: 5,
    scale: 2,
  }).default("9.00"),
  controlled_severity: varchar("controlled_severity", { length: 1 }).default(
    "M",
  ),
  threat_code: varchar("threat_code", { length: 50 }),
  vulnerability_code: varchar("vulnerability_code", { length: 50 }),
  response_strategy: varchar("response_strategy", { length: 1 }).default("M"),
  status: varchar("status", { length: 1 }).notNull().default("B"),
  period_id: bigint("period_id", { mode: "number" })
    .notNull()
    .references(() => coreRiskPeriod.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  is_deleted: boolean("is_deleted").notNull().default(false),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  created_by_id: integer("created_by_id").notNull(),
  updated_by_id: integer("updated_by_id"),
});

export const coreRiskEvaluationAsset = unsa.table("core_riskevaluationasset", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  evaluation_id: bigint("evaluation_id", { mode: "number" }).notNull(),
  asset_id: bigint("asset_id", { mode: "number" }).notNull(),
});

export const coreAsset = unsa.table("core_asset", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  owner: varchar("owner", { length: 150 }),
  custodians: text("custodians"),
  location: varchar("location", { length: 150 }),
  is_data_asset: boolean("is_data_asset").notNull().default(false),
  category: varchar("category", { length: 50 }).notNull(),
  classification: varchar("classification", { length: 50 }).notNull(),
  usage_frequency: varchar("usage_frequency", { length: 50 }).notNull(),
  confidentiality: varchar("confidentiality", { length: 1 }).notNull(),
  integrity: varchar("integrity", { length: 1 }).notNull(),
  availability: varchar("availability", { length: 1 }).notNull(),
  relevance: varchar("relevance", { length: 20 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  is_deleted: boolean("is_deleted").notNull().default(false),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});
