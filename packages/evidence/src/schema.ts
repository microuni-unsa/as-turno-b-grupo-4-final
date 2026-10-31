import type { TotAnalysis } from "@pims/types/agent.ts";
import type { JsonObject, JsonValue } from "@pims/types/models.ts";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const evidenceSchema = pgSchema("evidence");

export const stagedAttachmentsTable = evidenceSchema.table(
  "staged_attachments",
  {
    id: serial("id").primaryKey(),
    incident_code: varchar("incident_code", { length: 64 }).notNull(),
    file_name: varchar("file_name", { length: 255 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    bytes: integer("bytes").notNull(),
    mime: varchar("mime", { length: 128 }).notNull(),
    pii_tags: jsonb("pii_tags").$type<string[]>().notNull(),
    forensic_scan_encrypted: text("forensic_scan_encrypted"),
    storage_path: text("storage_path").notNull(),
    pims_attachment_id: integer("pims_attachment_id"),
    uploader: varchar("uploader", { length: 128 })
      .notNull()
      .default("evidence-collector"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const draftPacksTable = evidenceSchema.table("draft_packs", {
  id: serial("id").primaryKey(),
  incident_code: varchar("incident_code", { length: 64 }).notNull(),
  pack_type: varchar("pack_type", { length: 32 }).notNull(),
  version: integer("version").notNull().default(1),
  payload_encrypted: text("payload_encrypted").notNull(),
  content_sha256: varchar("content_sha256", { length: 64 }).notNull(),
  review_approval_id: varchar("review_approval_id", { length: 64 }),
  state: varchar("state", { length: 32 }).notNull().default("draft"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bundleManifestsTable = evidenceSchema.table("bundle_manifests", {
  incident_code: varchar("incident_code", { length: 64 }).primaryKey(),
  seal_sha256: varchar("seal_sha256", { length: 64 }),
  sealed_at_utc: timestamp("sealed_at_utc", { withTimezone: true }),
  manifest_json_encrypted: text("manifest_json_encrypted").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leasesTable = evidenceSchema.table("leases", {
  incident_code: varchar("incident_code", { length: 64 }).primaryKey(),
  holder_id: varchar("holder_id", { length: 128 }).notNull(),
  acquired_at: timestamp("acquired_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const timersTable = evidenceSchema.table("timers", {
  timer_id: varchar("timer_id", { length: 128 }).primaryKey(),
  incident_code: varchar("incident_code", { length: 64 }).notNull(),
  timer_type: varchar("timer_type", { length: 64 }).notNull(),
  fire_at_utc: timestamp("fire_at_utc", { withTimezone: true }).notNull(),
  payload_json: jsonb("payload_json").$type<JsonObject>().notNull(),
  fired: boolean("fired").notNull().default(false),
  cancelled_reason: varchar("cancelled_reason", { length: 255 }),
});

export const dedupeIndexTable = evidenceSchema.table("dedupe_index", {
  incident_code: varchar("incident_code", { length: 64 }).primaryKey(),
  pims_incident_id: integer("pims_incident_id"),
  title_normalized: varchar("title_normalized", { length: 255 }).notNull(),
  incident_date: varchar("incident_date", { length: 32 }).notNull(),
  system_or_url: varchar("system_or_url", { length: 255 }).notNull(),
  embedding_vector: jsonb("embedding_vector").$type<number[]>().notNull(),
  is_deleted: boolean("is_deleted").notNull().default(false),
});

export const riskQueueTable = evidenceSchema.table("risk_queue", {
  id: serial("id").primaryKey(),
  incident_code: varchar("incident_code", { length: 64 }).notNull(),
  signal_payload: jsonb("signal_payload").$type<JsonObject>().notNull(),
  status: varchar("status", { length: 32 }).notNull().default("queued"),
  queued_at: timestamp("queued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const indicatorSpoolTable = evidenceSchema.table("indicator_spool", {
  id: serial("id").primaryKey(),
  event_type: varchar("event_type", { length: 64 }).notNull(),
  payload_json: jsonb("payload_json").$type<JsonObject>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const toolLedgerTable = evidenceSchema.table("tool_ledger", {
  id: serial("id").primaryKey(),
  incident_code: varchar("incident_code", { length: 64 }).notNull(),
  at_utc: timestamp("at_utc", { withTimezone: true }).notNull(),
  role: varchar("role", { length: 64 }).notNull(),
  tool: varchar("tool", { length: 64 }).notNull(),
  args_redacted: jsonb("args_redacted").$type<JsonObject>().notNull(),
  result_ref: varchar("result_ref", { length: 255 }).notNull(),
  idempotency_key: varchar("idempotency_key", { length: 128 }).notNull(),
});

export const reviewApprovalsTable = evidenceSchema.table("review_approvals", {
  approval_id: varchar("approval_id", { length: 64 }).primaryKey(),
  incident_code: varchar("incident_code", { length: 64 }).notNull(),
  pack_type: varchar("pack_type", { length: 32 }).notNull(),
  content_sha256: varchar("content_sha256", { length: 64 }).notNull(),
  approved_at_utc: timestamp("approved_at_utc", {
    withTimezone: true,
  }).notNull(),
  consumed_at_utc: timestamp("consumed_at_utc", { withTimezone: true }),
  consumed_by: varchar("consumed_by", { length: 128 }),
  note: text("note").notNull(),
});

export const incidentOutcomesTable = evidenceSchema.table("incident_outcomes", {
  incident_code: varchar("incident_code", { length: 64 }).primaryKey(),
  awareness_at_utc: timestamp("awareness_at_utc", {
    withTimezone: true,
  }).notNull(),
  closed_at_utc: timestamp("closed_at_utc", {
    withTimezone: true,
  }).notNull(),
  severity: varchar("severity", { length: 1 }).notNull(),
  review_cycles: integer("review_cycles").notNull(),
  sla_72h_met: boolean("sla_72h_met").notNull(),
  recorded_at_utc: timestamp("recorded_at_utc", {
    withTimezone: true,
  }).notNull(),
});

export const triageCalibrationTable = evidenceSchema.table(
  "triage_calibration",
  {
    id: serial("id").primaryKey(),
    incident_code: varchar("incident_code", { length: 64 }).notNull().unique(),
    actual_incident_type: varchar("actual_incident_type", {
      length: 2,
    }).notNull(),
    nonconformity_score: doublePrecision("nonconformity_score").notNull(),
    recorded_at_utc: timestamp("recorded_at_utc", {
      withTimezone: true,
    }).notNull(),
  },
);

export const totAnalysesTable = evidenceSchema.table("tot_analyses", {
  incident_code: varchar("incident_code", { length: 64 }).primaryKey(),
  analysis_json: jsonb("analysis_json").$type<TotAnalysis>().notNull(),
  created_at_utc: timestamp("created_at_utc", {
    withTimezone: true,
  }).notNull(),
});

export const agentStateTable = evidenceSchema.table("agent_state", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: jsonb("value").$type<JsonValue>().notNull(),
  updated_at_utc: timestamp("updated_at_utc", {
    withTimezone: true,
  }).notNull(),
});
