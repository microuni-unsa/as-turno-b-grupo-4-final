import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptPayload, encryptPayload } from "@pims/evidence/crypto.ts";
import {
  agentStateTable,
  bundleManifestsTable,
  dedupeIndexTable,
  draftPacksTable,
  indicatorSpoolTable,
  leasesTable,
  ragRetrievalsTable,
  reviewApprovalsTable,
  riskQueueTable,
  rootCausesTable,
  stagedAttachmentsTable,
  timersTable,
  toolLedgerTable,
  triageCalibrationTable,
} from "@pims/evidence/schema.ts";
import {
  type ReviewApproval,
  ReviewApprovalSchema,
  type RootCause,
  RootCauseSchema,
  type TriageCalibration,
  TriageCalibrationSchema,
} from "@pims/types/agent.ts";
import {
  assertSafeFileName,
  parseStorageSegment,
} from "@pims/types/attachments.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import {
  AttachmentHashMismatchError,
  EvidenceNotFoundError,
  EvidenceStoreEncryptionError,
  EvidenceStoreWriteError,
  LeaseHeldError,
  LeaseLostError,
  PathEscapeError,
  PimsValidationError,
  ReviewApprovalInvalidError,
  ReviewApprovalReusedError,
  SchedulerUnknownTimerError,
} from "@pims/types/errors.ts";
import {
  type AuditTrailLedgerEntry,
  type DedupeIndexRecord,
  type EvidenceAttachment,
  type EvidenceBundleManifest,
  EvidenceBundleManifestSchema,
  type ForensicScanResult,
  ForensicScanResultSchema,
  type IndicatorSpoolRecord,
  type RiskQueueRecord,
  RiskQueueRecordSchema,
  type RiskSignalPayload,
  RiskSignalPayloadSchema,
  type TimerRecord,
  type ToolLedgerRecord,
  ToolLedgerRecordSchema,
} from "@pims/types/evidence.ts";
import {
  type JsonObject,
  JsonObjectSchema,
  type JsonValue,
  JsonValueSchema,
} from "@pims/types/models.ts";
import { type NoticeState, NoticeStateSchema } from "@pims/types/notices.ts";
import {
  type RagRetrievalRecord,
  RagRetrievalRecordSchema,
} from "@pims/types/rag.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function parseJsonObject(value: unknown, field: string): JsonObject {
  const parsed = JsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new EvidenceStoreWriteError(`Invalid JSON object: ${field}`, {
      issues: zodIssuesToDetails(parsed.error),
    });
  }
  return parsed.data;
}

function resolveBaseStorageDir(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new PimsValidationError(
      "baseStorageDir",
      "baseStorageDir is required",
    );
  }
  return path.resolve(value);
}

function resolveInsideRoot(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root + path.sep)) {
    throw new PathEscapeError(relativePath);
  }
  return resolved;
}

function parseDecryptedJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new EvidenceStoreWriteError(`Invalid decrypted JSON: ${field}`);
  }
}

export interface EvidenceStoreOptions {
  connectionUri?: string;
  sql?: postgres.Sql;
  keyHex: string;
  baseStorageDir: string;
}

export class EvidenceStore {
  readonly sql: postgres.Sql;
  readonly db: ReturnType<typeof drizzle>;
  private readonly keyHex: string;
  private readonly baseStorageDir: string;
  private readonly ownsSql: boolean;

  constructor(options: EvidenceStoreOptions);
  constructor(
    connectionUriOrSql: string | postgres.Sql,
    keyHex: string,
    baseStorageDir: string,
  );
  constructor(
    optionsOrTarget: EvidenceStoreOptions | string | postgres.Sql,
    keyHexArg?: string,
    baseStorageDirArg?: string,
  ) {
    const resolvedBaseStorageDir = resolveBaseStorageDir(
      typeof optionsOrTarget === "object"
        ? optionsOrTarget.baseStorageDir
        : baseStorageDirArg,
    );

    if (typeof optionsOrTarget === "string") {
      this.ownsSql = true;
      this.sql = postgres(optionsOrTarget, { max: 10 });
      if (!keyHexArg) {
        throw new EvidenceStoreEncryptionError("keyHex is required");
      }
      this.keyHex = keyHexArg;
      this.baseStorageDir = resolvedBaseStorageDir;
    } else if (typeof optionsOrTarget === "function") {
      this.ownsSql = false;
      this.sql = optionsOrTarget;
      if (!keyHexArg) {
        throw new EvidenceStoreEncryptionError("keyHex is required");
      }
      this.keyHex = keyHexArg;
      this.baseStorageDir = resolvedBaseStorageDir;
    } else {
      const opts = optionsOrTarget;
      if (opts.sql) {
        this.ownsSql = false;
        this.sql = opts.sql;
      } else if (opts.connectionUri) {
        this.ownsSql = true;
        this.sql = postgres(opts.connectionUri, { max: 10 });
      } else {
        throw new EvidenceStoreEncryptionError(
          "Either connectionUri or sql must be provided to EvidenceStore",
        );
      }
      this.keyHex = opts.keyHex;
      this.baseStorageDir = resolvedBaseStorageDir;
    }
    this.db = drizzle(this.sql);
  }

  async init(): Promise<void> {
    await this.sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS evidence;

      CREATE TABLE IF NOT EXISTS evidence.staged_attachments (
        id SERIAL PRIMARY KEY,
        incident_code VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        sha256 VARCHAR(64) NOT NULL,
        bytes INTEGER NOT NULL,
        mime VARCHAR(128) NOT NULL,
        pii_tags JSONB NOT NULL,
        forensic_scan_encrypted TEXT,
        storage_path TEXT NOT NULL,
        pims_attachment_id INTEGER,
        uploader VARCHAR(128) NOT NULL DEFAULT 'evidence-collector',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evidence.draft_packs (
        id SERIAL PRIMARY KEY,
        incident_code VARCHAR(64) NOT NULL,
        pack_type VARCHAR(32) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        payload_encrypted TEXT NOT NULL,
        content_sha256 VARCHAR(64) NOT NULL,
        review_approval_id VARCHAR(64),
        state VARCHAR(32) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evidence.bundle_manifests (
        incident_code VARCHAR(64) PRIMARY KEY,
        seal_sha256 VARCHAR(64),
        sealed_at_utc TIMESTAMPTZ,
        manifest_json_encrypted TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evidence.leases (
        incident_code VARCHAR(64) PRIMARY KEY,
        holder_id VARCHAR(128) NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence.timers (
        timer_id VARCHAR(128) PRIMARY KEY,
        incident_code VARCHAR(64) NOT NULL,
        timer_type VARCHAR(64) NOT NULL,
        fire_at_utc TIMESTAMPTZ NOT NULL,
        payload_json JSONB NOT NULL,
        fired BOOLEAN NOT NULL DEFAULT FALSE,
        cancelled_reason VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS evidence.dedupe_index (
        incident_code VARCHAR(64) PRIMARY KEY,
        pims_incident_id INTEGER,
        title_normalized VARCHAR(255) NOT NULL,
        incident_date VARCHAR(32) NOT NULL,
        system_or_url VARCHAR(255) NOT NULL,
        embedding_vector JSONB NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
      );

      ALTER TABLE evidence.dedupe_index
        ADD COLUMN IF NOT EXISTS pims_incident_id INTEGER;

      CREATE TABLE IF NOT EXISTS evidence.risk_queue (
        id SERIAL PRIMARY KEY,
        incident_code VARCHAR(64) NOT NULL,
        signal_payload JSONB NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evidence.indicator_spool (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS evidence.tool_ledger (
        id SERIAL PRIMARY KEY,
        incident_code VARCHAR(64) NOT NULL,
        at_utc TIMESTAMPTZ NOT NULL,
        role VARCHAR(64) NOT NULL,
        tool VARCHAR(64) NOT NULL,
        args_redacted JSONB NOT NULL,
        result_ref VARCHAR(255) NOT NULL,
        idempotency_key VARCHAR(128) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence.review_approvals (
        approval_id VARCHAR(64) PRIMARY KEY,
        incident_code VARCHAR(64) NOT NULL,
        pack_type VARCHAR(32) NOT NULL,
        content_sha256 VARCHAR(64) NOT NULL,
        approved_at_utc TIMESTAMPTZ NOT NULL,
        consumed_at_utc TIMESTAMPTZ,
        consumed_by VARCHAR(128),
        note TEXT NOT NULL
      );


      CREATE TABLE IF NOT EXISTS evidence.triage_calibration (
        id SERIAL PRIMARY KEY,
        incident_code VARCHAR(64) UNIQUE NOT NULL,
        actual_incident_type VARCHAR(2) NOT NULL,
        nonconformity_score DOUBLE PRECISION NOT NULL,
        recorded_at_utc TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence.root_causes (
        incident_code VARCHAR(64) PRIMARY KEY,
        analysis_json JSONB NOT NULL,
        created_at_utc TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence.agent_state (
        key VARCHAR(128) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at_utc TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence.rag_retrievals (
        id SERIAL PRIMARY KEY,
        incident_code VARCHAR(64),
        at_utc TIMESTAMPTZ NOT NULL,
        query TEXT NOT NULL,
        corpus_version VARCHAR(64) NOT NULL,
        payload_encrypted TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS tool_ledger_incident_idem_idx
        ON evidence.tool_ledger (incident_code, idempotency_key);
    `);
  }

  assertSafePath(schema: string, incidentCode: string): string {
    const safeSchema = parseStorageSegment(schema, "schema");
    const safeIncident = parseStorageSegment(incidentCode, "incidentCode");
    return resolveInsideRoot(
      this.baseStorageDir,
      path.join(safeSchema, safeIncident),
    );
  }

  async stageAttachment(
    schema: string,
    incidentCode: string,
    fileName: string,
    fileBytes: Buffer,
    mime: string,
    uploader: string,
    forensicScan?: ForensicScanResult | null,
    pimsAttachmentId?: number,
  ): Promise<EvidenceAttachment> {
    const safeFileName = assertSafeFileName(fileName);
    const incidentDir = this.assertSafePath(schema, incidentCode);
    const attachmentsDir = path.join(incidentDir, "attachments");
    await fs.promises.mkdir(attachmentsDir, { recursive: true });

    let scan: ForensicScanResult | null = null;
    if (forensicScan !== undefined && forensicScan !== null) {
      const parsedScan = ForensicScanResultSchema.safeParse(forensicScan);
      if (!parsedScan.success) {
        throw new PimsValidationError(
          "forensic_scan",
          "Invalid forensic scan result",
          { issues: zodIssuesToDetails(parsedScan.error) },
        );
      }
      scan = parsedScan.data;
    }

    const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
    const encryptedFile = encryptPayload(fileBytes, this.keyHex);

    const absoluteStoragePath = path.join(
      attachmentsDir,
      `${safeFileName}.enc`,
    );
    await fs.promises.writeFile(absoluteStoragePath, encryptedFile);

    const forensicScanEncrypted =
      scan === null
        ? null
        : encryptPayload(JSON.stringify(scan), this.keyHex).toString("base64");

    const piiTags = scan?.visual_pii ?? [];
    const now = new Date();

    try {
      await this.db.insert(stagedAttachmentsTable).values({
        incident_code: incidentCode,
        file_name: safeFileName,
        sha256,
        bytes: fileBytes.length,
        mime,
        pii_tags: piiTags,
        forensic_scan_encrypted: forensicScanEncrypted,
        storage_path: path.relative(this.baseStorageDir, absoluteStoragePath),
        pims_attachment_id: pimsAttachmentId ?? null,
        uploader,
        created_at: now,
      });
    } catch (error) {
      await fs.promises.rm(absoluteStoragePath, { force: true });
      throw error;
    }

    return {
      file_name: safeFileName,
      sha256,
      bytes: fileBytes.length,
      mime,
      pii_tags: piiTags,
      forensic_scan: scan,
      uploader,
      uploaded_at_utc: now.toISOString(),
      ...(pimsAttachmentId === undefined
        ? {}
        : { pims_attachment_id: pimsAttachmentId }),
    };
  }

  async getStagedAttachmentBytes(
    schema: string,
    incidentCode: string,
    fileName: string,
  ): Promise<Buffer> {
    this.assertSafePath(schema, incidentCode);
    const safeFileName = assertSafeFileName(fileName);
    const rows = await this.db
      .select()
      .from(stagedAttachmentsTable)
      .where(
        and(
          eq(stagedAttachmentsTable.incident_code, incidentCode),
          eq(stagedAttachmentsTable.file_name, safeFileName),
        ),
      )
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      throw new EvidenceNotFoundError("staged_attachment", safeFileName);
    }

    const row = rows[0];
    const storagePath = resolveInsideRoot(
      this.baseStorageDir,
      row.storage_path,
    );

    let encrypted: Buffer;
    try {
      encrypted = await fs.promises.readFile(storagePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new EvidenceNotFoundError("storage_file", storagePath);
      }
      throw error;
    }

    const decrypted = decryptPayload(encrypted, this.keyHex);

    const computedSha256 = crypto
      .createHash("sha256")
      .update(decrypted)
      .digest("hex");
    if (computedSha256 !== row.sha256) {
      throw new AttachmentHashMismatchError();
    }

    return decrypted;
  }

  async listStagedAttachments(
    incidentCode: string,
  ): Promise<EvidenceAttachment[]> {
    const rows = await this.db
      .select()
      .from(stagedAttachmentsTable)
      .where(eq(stagedAttachmentsTable.incident_code, incidentCode))
      .orderBy(asc(stagedAttachmentsTable.created_at));

    return rows.map((row) => {
      let scan: ForensicScanResult | null = null;
      if (row.forensic_scan_encrypted) {
        const decryptedBuf = decryptPayload(
          Buffer.from(row.forensic_scan_encrypted, "base64"),
          this.keyHex,
        );
        const parsedScan = ForensicScanResultSchema.safeParse(
          parseDecryptedJson(decryptedBuf.toString("utf8"), "forensic_scan"),
        );
        if (!parsedScan.success) {
          throw new EvidenceStoreWriteError("Invalid encrypted forensic scan", {
            issues: zodIssuesToDetails(parsedScan.error),
          });
        }
        scan = parsedScan.data;
      }

      return {
        file_name: row.file_name,
        sha256: row.sha256,
        bytes: row.bytes,
        mime: row.mime,
        pii_tags: row.pii_tags,
        forensic_scan: scan,
        uploader: row.uploader,
        uploaded_at_utc: row.created_at.toISOString(),
        ...(row.pims_attachment_id === null
          ? {}
          : { pims_attachment_id: row.pims_attachment_id }),
      };
    });
  }

  async replaceStagedAttachment(
    schema: string,
    incidentCode: string,
    fileName: string,
    fileBytes: Buffer,
    mime: string,
    uploader: string,
  ): Promise<EvidenceAttachment> {
    const safeFileName = assertSafeFileName(fileName);
    this.assertSafePath(schema, incidentCode);
    const existing = await this.db
      .select()
      .from(stagedAttachmentsTable)
      .where(
        and(
          eq(stagedAttachmentsTable.incident_code, incidentCode),
          eq(stagedAttachmentsTable.file_name, safeFileName),
        ),
      );

    for (const row of existing) {
      const storagePath = resolveInsideRoot(
        this.baseStorageDir,
        row.storage_path,
      );
      await fs.promises.rm(storagePath, { force: true });
      await this.db
        .delete(stagedAttachmentsTable)
        .where(eq(stagedAttachmentsTable.id, row.id));
    }

    return this.stageAttachment(
      schema,
      incidentCode,
      safeFileName,
      fileBytes,
      mime,
      uploader,
    );
  }

  async saveRagRetrieval(record: RagRetrievalRecord): Promise<number> {
    const parsed = RagRetrievalRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid RAG retrieval record", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    const encryptedPayload = encryptPayload(
      canonicalizeJson(parsed.data),
      this.keyHex,
    ).toString("base64");
    const inserted = await this.db
      .insert(ragRetrievalsTable)
      .values({
        incident_code: parsed.data.incident_code,
        at_utc: new Date(parsed.data.at_utc),
        query: parsed.data.query,
        corpus_version: parsed.data.corpus_version,
        payload_encrypted: encryptedPayload,
      })
      .returning({ id: ragRetrievalsTable.id });
    const insertedId = inserted[0]?.id;
    if (insertedId === undefined) {
      throw new EvidenceStoreWriteError("RAG retrieval insert returned no id");
    }
    return insertedId;
  }

  async listRagRetrievals(
    incidentCode: string,
    limit = 20,
  ): Promise<RagRetrievalRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new PimsValidationError(
        "rag_retrievals.limit",
        "limit must be a positive integer",
      );
    }
    const rows = await this.db
      .select()
      .from(ragRetrievalsTable)
      .where(eq(ragRetrievalsTable.incident_code, incidentCode))
      .orderBy(desc(ragRetrievalsTable.at_utc), desc(ragRetrievalsTable.id))
      .limit(limit);

    return rows.map((row) => {
      const decrypted = decryptPayload(
        Buffer.from(row.payload_encrypted, "base64"),
        this.keyHex,
      );
      const parsed = RagRetrievalRecordSchema.safeParse(
        parseDecryptedJson(decrypted.toString("utf8"), "rag_retrieval.payload"),
      );
      if (!parsed.success) {
        throw new EvidenceStoreWriteError("Invalid RAG retrieval payload", {
          issues: zodIssuesToDetails(parsed.error),
        });
      }
      return parsed.data;
    });
  }

  async saveDraftPack(
    incidentCode: string,
    packType: "authority" | "subject",
    payload: JsonValue,
    contentSha256: string,
    reviewApprovalId?: string | null,
    state: NoticeState = "draft",
  ): Promise<number> {
    const parsedState = NoticeStateSchema.safeParse(state);
    if (!parsedState.success) {
      throw new PimsValidationError(
        "draft_pack.state",
        "Invalid notice state",
        { issues: zodIssuesToDetails(parsedState.error) },
      );
    }
    if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
      throw new PimsValidationError(
        "draft_pack.content_sha256",
        "contentSha256 must be a lowercase SHA-256 hex digest",
      );
    }
    const parsedPayload = JsonValueSchema.safeParse(payload);
    if (!parsedPayload.success) {
      throw new EvidenceStoreWriteError("Draft pack payload is not JSON-safe", {
        issues: zodIssuesToDetails(parsedPayload.error),
      });
    }
    if (
      packType === "authority" &&
      (parsedState.data === "exempted" || parsedState.data === "not_required")
    ) {
      throw new PimsValidationError(
        "draft_pack.state",
        `Authority packs cannot use state '${parsedState.data}'`,
      );
    }

    const encryptedPayload = encryptPayload(
      JSON.stringify(parsedPayload.data),
      this.keyHex,
    ).toString("base64");
    const now = new Date();

    const existing = await this.db
      .select()
      .from(draftPacksTable)
      .where(
        and(
          eq(draftPacksTable.incident_code, incidentCode),
          eq(draftPacksTable.pack_type, packType),
          eq(draftPacksTable.state, parsedState.data),
        ),
      )
      .orderBy(desc(draftPacksTable.version))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      const rowId = existing[0].id;
      await this.db
        .update(draftPacksTable)
        .set({
          payload_encrypted: encryptedPayload,
          content_sha256: contentSha256,
          review_approval_id: reviewApprovalId ?? null,
          state: parsedState.data,
          updated_at: now,
        })
        .where(eq(draftPacksTable.id, rowId));
      return rowId;
    }

    const latestAnyState = await this.db
      .select()
      .from(draftPacksTable)
      .where(
        and(
          eq(draftPacksTable.incident_code, incidentCode),
          eq(draftPacksTable.pack_type, packType),
        ),
      )
      .orderBy(desc(draftPacksTable.version))
      .limit(1);

    const nextVersion = latestAnyState[0] ? latestAnyState[0].version + 1 : 1;

    const inserted = await this.db
      .insert(draftPacksTable)
      .values({
        incident_code: incidentCode,
        pack_type: packType,
        version: nextVersion,
        payload_encrypted: encryptedPayload,
        content_sha256: contentSha256,
        review_approval_id: reviewApprovalId ?? null,
        state: parsedState.data,
        created_at: now,
        updated_at: now,
      })
      .returning({ id: draftPacksTable.id });

    const insertedId = inserted[0]?.id;
    if (insertedId === undefined) {
      throw new EvidenceStoreWriteError("Draft pack insert returned no id");
    }
    return insertedId;
  }

  async getDraftPack(
    incidentCode: string,
    packType: "authority" | "subject",
  ): Promise<{
    id: number;
    payload: JsonValue;
    contentSha256: string;
    reviewApprovalId: string | null;
    state: string;
  } | null> {
    const rows = await this.db
      .select()
      .from(draftPacksTable)
      .where(
        and(
          eq(draftPacksTable.incident_code, incidentCode),
          eq(draftPacksTable.pack_type, packType),
        ),
      )
      .orderBy(desc(draftPacksTable.id))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const row = rows[0];
    const decryptedBuf = decryptPayload(
      Buffer.from(row.payload_encrypted, "base64"),
      this.keyHex,
    );
    const parsedPayload = JsonValueSchema.safeParse(
      parseDecryptedJson(decryptedBuf.toString("utf8"), "draft_pack.payload"),
    );
    if (!parsedPayload.success) {
      throw new EvidenceStoreWriteError("Invalid draft pack payload", {
        issues: zodIssuesToDetails(parsedPayload.error),
      });
    }

    return {
      id: row.id,
      payload: parsedPayload.data,
      contentSha256: row.content_sha256,
      reviewApprovalId: row.review_approval_id,
      state: row.state,
    };
  }

  async setDraftPackState(
    incidentCode: string,
    packType: "authority" | "subject",
    state: NoticeState,
    reviewApprovalId: string | null,
  ): Promise<void> {
    const parsedState = NoticeStateSchema.safeParse(state);
    if (!parsedState.success) {
      throw new PimsValidationError(
        "draft_pack.state",
        "Invalid notice state",
        { issues: zodIssuesToDetails(parsedState.error) },
      );
    }
    const latest = await this.db
      .select({ id: draftPacksTable.id })
      .from(draftPacksTable)
      .where(
        and(
          eq(draftPacksTable.incident_code, incidentCode),
          eq(draftPacksTable.pack_type, packType),
        ),
      )
      .orderBy(desc(draftPacksTable.id))
      .limit(1);

    const rowId = latest[0]?.id;
    if (rowId === undefined) {
      throw new EvidenceNotFoundError(
        "draft_pack",
        `${incidentCode}:${packType}`,
      );
    }

    await this.db
      .update(draftPacksTable)
      .set({
        state: parsedState.data,
        review_approval_id: reviewApprovalId,
        updated_at: new Date(),
      })
      .where(eq(draftPacksTable.id, rowId));
  }

  async acquireLease(
    incidentCode: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const acquired = await this.db
      .insert(leasesTable)
      .values({
        incident_code: incidentCode,
        holder_id: holderId,
        acquired_at: now,
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: leasesTable.incident_code,
        set: {
          holder_id: holderId,
          acquired_at: now,
          expires_at: expiresAt,
        },
        setWhere: or(
          eq(leasesTable.holder_id, holderId),
          lt(leasesTable.expires_at, now),
        ),
      })
      .returning({ incident_code: leasesTable.incident_code });

    if (acquired.length === 0) {
      const holderRows = await this.db
        .select({ holder_id: leasesTable.holder_id })
        .from(leasesTable)
        .where(eq(leasesTable.incident_code, incidentCode))
        .limit(1);
      const holder = holderRows[0]?.holder_id;
      if (holder === undefined) {
        throw new EvidenceStoreWriteError("Lease conflict without a row");
      }
      throw new LeaseHeldError(holder);
    }
    return true;
  }

  async renewLease(
    incidentCode: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const updated = await this.db
      .update(leasesTable)
      .set({ expires_at: expiresAt })
      .where(
        and(
          eq(leasesTable.incident_code, incidentCode),
          eq(leasesTable.holder_id, holderId),
          gt(leasesTable.expires_at, now),
        ),
      )
      .returning({ incident_code: leasesTable.incident_code });

    if (updated.length === 0) {
      throw new LeaseLostError(incidentCode);
    }
    return true;
  }

  async releaseLease(incidentCode: string, holderId: string): Promise<boolean> {
    const released = await this.db
      .delete(leasesTable)
      .where(
        and(
          eq(leasesTable.incident_code, incidentCode),
          eq(leasesTable.holder_id, holderId),
        ),
      )
      .returning({ incident_code: leasesTable.incident_code });

    if (released.length === 0) {
      throw new LeaseLostError(incidentCode);
    }
    return true;
  }

  async armTimer(record: TimerRecord): Promise<void> {
    await this.db
      .insert(timersTable)
      .values({
        timer_id: record.timer_id,
        incident_code: record.incident_code,
        timer_type: record.timer_type,
        fire_at_utc: new Date(record.fire_at_utc),
        payload_json: record.payload,
        fired: record.fired,
        cancelled_reason: record.cancelled_reason ?? null,
      })
      .onConflictDoUpdate({
        target: timersTable.timer_id,
        set: {
          incident_code: record.incident_code,
          timer_type: record.timer_type,
          fire_at_utc: new Date(record.fire_at_utc),
          payload_json: record.payload,
          fired: record.fired,
          cancelled_reason: record.cancelled_reason ?? null,
        },
      });
  }

  async cancelTimer(timerId: string, reason: string): Promise<void> {
    await this.db
      .update(timersTable)
      .set({ cancelled_reason: reason })
      .where(eq(timersTable.timer_id, timerId));
  }

  async listActiveTimers(incidentCode?: string): Promise<TimerRecord[]> {
    const conditions = [
      eq(timersTable.fired, false),
      isNull(timersTable.cancelled_reason),
    ];
    if (incidentCode) {
      conditions.push(eq(timersTable.incident_code, incidentCode));
    }

    const rows = await this.db
      .select()
      .from(timersTable)
      .where(and(...conditions))
      .orderBy(asc(timersTable.fire_at_utc));

    return rows.map((r) => ({
      timer_id: r.timer_id,
      incident_code: r.incident_code,
      timer_type: r.timer_type,
      fire_at_utc: r.fire_at_utc.toISOString(),
      payload: parseJsonObject(r.payload_json, "timers.payload_json"),
      fired: r.fired,
      cancelled_reason: r.cancelled_reason,
    }));
  }

  async appendToolLedger(
    entry: AuditTrailLedgerEntry & { incident_code: string },
  ): Promise<void> {
    await this.db
      .insert(toolLedgerTable)
      .values({
        incident_code: entry.incident_code,
        at_utc: new Date(entry.at_utc),
        role: entry.role,
        tool: entry.tool,
        args_redacted: entry.args_redacted,
        result_ref: entry.result_ref,
        idempotency_key: entry.idempotency_key,
      })
      .onConflictDoNothing({
        target: [
          toolLedgerTable.incident_code,
          toolLedgerTable.idempotency_key,
        ],
      });
  }

  async listToolLedger(incidentCode: string): Promise<AuditTrailLedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(toolLedgerTable)
      .where(eq(toolLedgerTable.incident_code, incidentCode))
      .orderBy(asc(toolLedgerTable.at_utc));

    return rows.map((r) => ({
      at_utc: r.at_utc.toISOString(),
      role: r.role,
      tool: r.tool,
      args_redacted: parseJsonObject(
        r.args_redacted,
        "tool_ledger.args_redacted",
      ),
      result_ref: r.result_ref,
      idempotency_key: r.idempotency_key,
    }));
  }

  async spoolIndicator(
    eventType: string,
    payload: JsonObject,
  ): Promise<number> {
    const inserted = await this.db
      .insert(indicatorSpoolTable)
      .values({
        event_type: eventType,
        payload_json: payload,
        created_at: new Date(),
      })
      .returning({ id: indicatorSpoolTable.id });

    const insertedId = inserted[0]?.id;
    if (insertedId === undefined) {
      throw new EvidenceStoreWriteError(
        "Indicator spool insert returned no id",
      );
    }
    return insertedId;
  }

  async listIndicatorSpool(): Promise<IndicatorSpoolRecord[]> {
    const rows = await this.db
      .select()
      .from(indicatorSpoolTable)
      .orderBy(asc(indicatorSpoolTable.id));

    return rows.map((r) => ({
      id: r.id,
      event_type: r.event_type,
      payload: parseJsonObject(r.payload_json, "indicator_spool.payload_json"),
      created_at_utc: r.created_at.toISOString(),
    }));
  }

  async indexDedupe(record: DedupeIndexRecord): Promise<void> {
    await this.db
      .insert(dedupeIndexTable)
      .values({
        incident_code: record.incident_code,
        pims_incident_id: record.pims_incident_id,
        title_normalized: record.title_normalized,
        incident_date: record.incident_date,
        system_or_url: record.system_or_url,
        embedding_vector: record.embedding_vector,
        is_deleted: record.is_deleted,
      })
      .onConflictDoUpdate({
        target: dedupeIndexTable.incident_code,
        set: {
          pims_incident_id: record.pims_incident_id,
          title_normalized: record.title_normalized,
          incident_date: record.incident_date,
          system_or_url: record.system_or_url,
          embedding_vector: record.embedding_vector,
          is_deleted: record.is_deleted,
        },
      });
  }

  async findDedupeMatch(
    titleNormalized: string,
    incidentDate: string,
    systemOrUrl: string,
  ): Promise<DedupeIndexRecord | null> {
    const rows = await this.db
      .select()
      .from(dedupeIndexTable)
      .where(
        and(
          eq(dedupeIndexTable.title_normalized, titleNormalized),
          eq(dedupeIndexTable.incident_date, incidentDate),
          eq(dedupeIndexTable.system_or_url, systemOrUrl),
          eq(dedupeIndexTable.is_deleted, false),
        ),
      )
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const r = rows[0];
    return {
      incident_code: r.incident_code,
      pims_incident_id: r.pims_incident_id,
      title_normalized: r.title_normalized,
      incident_date: r.incident_date,
      system_or_url: r.system_or_url,
      embedding_vector: r.embedding_vector,
      is_deleted: r.is_deleted,
    };
  }

  async saveBundleManifest(
    incidentCode: string,
    manifest: EvidenceBundleManifest,
    sealSha256?: string | null,
  ): Promise<void> {
    const parsed = EvidenceBundleManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid evidence bundle manifest", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    const manifestEncrypted = encryptPayload(
      JSON.stringify(parsed.data),
      this.keyHex,
    ).toString("base64");
    const now = new Date();
    const effectiveSeal = sealSha256 ?? parsed.data.seal_sha256 ?? null;
    const sealedAt = parsed.data.sealed_at_utc
      ? new Date(parsed.data.sealed_at_utc)
      : null;

    await this.db
      .insert(bundleManifestsTable)
      .values({
        incident_code: incidentCode,
        seal_sha256: effectiveSeal,
        sealed_at_utc: sealedAt,
        manifest_json_encrypted: manifestEncrypted,
        created_at: now,
      })
      .onConflictDoUpdate({
        target: bundleManifestsTable.incident_code,
        set: {
          seal_sha256: effectiveSeal,
          sealed_at_utc: sealedAt,
          manifest_json_encrypted: manifestEncrypted,
        },
      });
  }

  async getBundleManifest(
    incidentCode: string,
  ): Promise<EvidenceBundleManifest | null> {
    const rows = await this.db
      .select()
      .from(bundleManifestsTable)
      .where(eq(bundleManifestsTable.incident_code, incidentCode))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const row = rows[0];
    const decryptedBuf = decryptPayload(
      Buffer.from(row.manifest_json_encrypted, "base64"),
      this.keyHex,
    );
    const parsed = EvidenceBundleManifestSchema.safeParse(
      parseDecryptedJson(
        decryptedBuf.toString("utf8"),
        "bundle_manifest.manifest",
      ),
    );
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid evidence bundle manifest", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    return parsed.data;
  }

  async pruneRetention(
    retentionYears: number,
  ): Promise<{ prunedDraftsCount: number; prunedFilesCount: number }> {
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);

    const deletedDrafts = await this.db
      .delete(draftPacksTable)
      .where(
        and(
          eq(draftPacksTable.state, "draft"),
          lt(draftPacksTable.created_at, cutoff),
        ),
      )
      .returning({ id: draftPacksTable.id });

    let prunedFilesCount = 0;
    const oldAttachments = await this.db
      .select()
      .from(stagedAttachmentsTable)
      .where(lt(stagedAttachmentsTable.created_at, cutoff));

    for (const att of oldAttachments) {
      const manifests = await this.db
        .select({ incident_code: bundleManifestsTable.incident_code })
        .from(bundleManifestsTable)
        .where(eq(bundleManifestsTable.incident_code, att.incident_code))
        .limit(1);

      if (manifests.length === 0) {
        const storagePath = resolveInsideRoot(
          this.baseStorageDir,
          att.storage_path,
        );
        await fs.promises.rm(storagePath, { force: true });
        prunedFilesCount += 1;
        await this.db
          .delete(stagedAttachmentsTable)
          .where(eq(stagedAttachmentsTable.id, att.id));
      }
    }

    return {
      prunedDraftsCount: deletedDrafts.length,
      prunedFilesCount,
    };
  }

  private toReviewApprovalRow(
    row: typeof reviewApprovalsTable.$inferSelect,
  ): ReviewApproval {
    const parsed = ReviewApprovalSchema.safeParse({
      approval_id: row.approval_id,
      incident_code: row.incident_code,
      pack_type: row.pack_type,
      content_sha256: row.content_sha256,
      approved_at_utc: row.approved_at_utc.toISOString(),
      consumed_at_utc: row.consumed_at_utc
        ? row.consumed_at_utc.toISOString()
        : null,
      consumed_by: row.consumed_by,
      note: row.note,
    });
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid review approval row", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    return parsed.data;
  }

  async markStagedAttachmentUploaded(
    incidentCode: string,
    fileName: string,
    sha256: string,
    pimsAttachmentId: number,
  ): Promise<void> {
    const safeFileName = assertSafeFileName(fileName);
    const updated = await this.db
      .update(stagedAttachmentsTable)
      .set({ pims_attachment_id: pimsAttachmentId })
      .where(
        and(
          eq(stagedAttachmentsTable.incident_code, incidentCode),
          eq(stagedAttachmentsTable.file_name, safeFileName),
          eq(stagedAttachmentsTable.sha256, sha256),
        ),
      )
      .returning({ id: stagedAttachmentsTable.id });

    if (updated.length === 0) {
      throw new EvidenceNotFoundError("staged_attachment", fileName);
    }
  }

  async saveRootCause(
    incidentCode: string,
    rootCause: RootCause,
  ): Promise<void> {
    const parsed = RootCauseSchema.safeParse(rootCause);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid root cause", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    const now = new Date();
    await this.db
      .insert(rootCausesTable)
      .values({
        incident_code: incidentCode,
        analysis_json: parsed.data,
        created_at_utc: now,
      })
      .onConflictDoUpdate({
        target: rootCausesTable.incident_code,
        set: {
          analysis_json: parsed.data,
          created_at_utc: now,
        },
      });
  }

  async getRootCause(incidentCode: string): Promise<RootCause | null> {
    const rows = await this.db
      .select()
      .from(rootCausesTable)
      .where(eq(rootCausesTable.incident_code, incidentCode))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const parsed = RootCauseSchema.safeParse(rows[0].analysis_json);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid stored root cause", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    return parsed.data;
  }

  async getAgentState(key: string): Promise<JsonValue | null> {
    const rows = await this.db
      .select()
      .from(agentStateTable)
      .where(eq(agentStateTable.key, key))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const parsed = JsonValueSchema.safeParse(rows[0].value);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError(`Invalid agent state: ${key}`, {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    return parsed.data;
  }

  async setAgentState(key: string, value: JsonValue): Promise<void> {
    const parsed = JsonValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError(`Invalid agent state: ${key}`, {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    const now = new Date();
    await this.db
      .insert(agentStateTable)
      .values({ key, value: parsed.data, updated_at_utc: now })
      .onConflictDoUpdate({
        target: agentStateTable.key,
        set: { value: parsed.data, updated_at_utc: now },
      });
  }

  async mintReviewApproval(params: {
    incidentCode: string;
    packType: "authority" | "subject" | "resolution";
    contentSha256: string;
    note: string;
  }): Promise<ReviewApproval> {
    const approvalId = crypto.randomUUID();
    const inserted = await this.db
      .insert(reviewApprovalsTable)
      .values({
        approval_id: approvalId,
        incident_code: params.incidentCode,
        pack_type: params.packType,
        content_sha256: params.contentSha256,
        approved_at_utc: new Date(),
        consumed_at_utc: null,
        consumed_by: null,
        note: params.note,
      })
      .onConflictDoNothing({ target: reviewApprovalsTable.approval_id })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new ReviewApprovalInvalidError(
        `Review approval id collision: ${approvalId}`,
      );
    }
    return this.toReviewApprovalRow(row);
  }

  async getReviewApproval(approvalId: string): Promise<ReviewApproval | null> {
    const rows = await this.db
      .select()
      .from(reviewApprovalsTable)
      .where(eq(reviewApprovalsTable.approval_id, approvalId))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }
    return this.toReviewApprovalRow(rows[0]);
  }

  async consumeReviewApproval(
    approvalId: string,
    contentSha256: string,
    consumedBy: string,
  ): Promise<ReviewApproval> {
    const updated = await this.db
      .update(reviewApprovalsTable)
      .set({ consumed_at_utc: new Date(), consumed_by: consumedBy })
      .where(
        and(
          eq(reviewApprovalsTable.approval_id, approvalId),
          eq(reviewApprovalsTable.content_sha256, contentSha256),
          isNull(reviewApprovalsTable.consumed_at_utc),
        ),
      )
      .returning();

    const row = updated[0];
    if (row === undefined) {
      const existing = await this.db
        .select()
        .from(reviewApprovalsTable)
        .where(eq(reviewApprovalsTable.approval_id, approvalId))
        .limit(1);

      const existingRow = existing[0];
      if (existingRow !== undefined) {
        if (existingRow.consumed_at_utc !== null) {
          throw new ReviewApprovalReusedError();
        }
        throw new ReviewApprovalInvalidError(
          `Review approval content hash mismatch: ${approvalId}`,
        );
      }
      throw new ReviewApprovalInvalidError(
        `Unknown review approval: ${approvalId}`,
      );
    }
    return this.toReviewApprovalRow(row);
  }

  async revokeReviewApprovals(
    incidentCode: string,
    packType?: "authority" | "subject" | "resolution",
  ): Promise<number> {
    const conditions = [eq(reviewApprovalsTable.incident_code, incidentCode)];
    if (packType !== undefined) {
      conditions.push(eq(reviewApprovalsTable.pack_type, packType));
    }

    const deleted = await this.db
      .delete(reviewApprovalsTable)
      .where(and(...conditions))
      .returning({ approval_id: reviewApprovalsTable.approval_id });

    return deleted.length;
  }

  async listReviewApprovals(incidentCode: string): Promise<ReviewApproval[]> {
    const rows = await this.db
      .select()
      .from(reviewApprovalsTable)
      .where(eq(reviewApprovalsTable.incident_code, incidentCode))
      .orderBy(asc(reviewApprovalsTable.approved_at_utc));

    return rows.map((row) => this.toReviewApprovalRow(row));
  }

  async listDueTimers(now: Date, limit: number): Promise<TimerRecord[]> {
    const rows = await this.db
      .select()
      .from(timersTable)
      .where(
        and(
          eq(timersTable.fired, false),
          isNull(timersTable.cancelled_reason),
          lte(timersTable.fire_at_utc, now),
        ),
      )
      .orderBy(asc(timersTable.fire_at_utc))
      .limit(limit);

    return rows.map((r) => ({
      timer_id: r.timer_id,
      incident_code: r.incident_code,
      timer_type: r.timer_type,
      fire_at_utc: r.fire_at_utc.toISOString(),
      payload: parseJsonObject(r.payload_json, "timers.payload_json"),
      fired: r.fired,
      cancelled_reason: r.cancelled_reason,
    }));
  }

  async markTimerFired(timerId: string, firedAt: Date): Promise<void> {
    void firedAt;
    const updated = await this.db
      .update(timersTable)
      .set({ fired: true })
      .where(eq(timersTable.timer_id, timerId))
      .returning({ timer_id: timersTable.timer_id });

    if (updated.length === 0) {
      throw new SchedulerUnknownTimerError(timerId);
    }
  }

  async enqueueRiskSignal(
    incidentCode: string,
    payload: RiskSignalPayload,
  ): Promise<number> {
    const parsed = RiskSignalPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid risk signal payload", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }

    const inserted = await this.db
      .insert(riskQueueTable)
      .values({
        incident_code: incidentCode,
        signal_payload: parseJsonObject(
          parsed.data,
          "risk_queue.signal_payload",
        ),
        status: "queued",
        queued_at: new Date(),
      })
      .returning({ id: riskQueueTable.id });

    const insertedId = inserted[0]?.id;
    if (insertedId === undefined) {
      throw new EvidenceStoreWriteError("Risk queue insert returned no id");
    }
    return insertedId;
  }

  async listQueuedRiskSignals(
    incidentCode?: string,
  ): Promise<RiskQueueRecord[]> {
    const rows = await this.db
      .select()
      .from(riskQueueTable)
      .where(
        incidentCode === undefined
          ? undefined
          : eq(riskQueueTable.incident_code, incidentCode),
      )
      .orderBy(asc(riskQueueTable.id));

    return rows.map((row) => {
      const parsed = RiskQueueRecordSchema.safeParse({
        id: row.id,
        incident_code: row.incident_code,
        signal_payload: row.signal_payload,
        status: row.status,
        queued_at_utc: row.queued_at.toISOString(),
      });
      if (!parsed.success) {
        throw new EvidenceStoreWriteError("Invalid risk queue row", {
          issues: zodIssuesToDetails(parsed.error),
        });
      }
      return parsed.data;
    });
  }

  async markRiskSignalSent(id: number): Promise<void> {
    const updated = await this.db
      .update(riskQueueTable)
      .set({ status: "sent" })
      .where(eq(riskQueueTable.id, id))
      .returning({ id: riskQueueTable.id });

    if (updated.length === 0) {
      throw new EvidenceStoreWriteError(
        `Risk signal ${id} could not be marked sent`,
      );
    }
  }

  async markRiskSignalFailed(id: number, reason: string): Promise<void> {
    const updated = await this.db
      .update(riskQueueTable)
      .set({ status: "failed" })
      .where(eq(riskQueueTable.id, id))
      .returning({ id: riskQueueTable.id });

    if (updated.length === 0) {
      throw new EvidenceStoreWriteError(
        `Risk signal ${id} could not be marked failed: ${reason}`,
      );
    }
  }

  async updateRiskSignalPayload(
    id: number,
    payload: RiskSignalPayload,
  ): Promise<void> {
    const parsed = RiskSignalPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid risk signal payload", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }

    const updated = await this.db
      .update(riskQueueTable)
      .set({
        signal_payload: parseJsonObject(
          parsed.data,
          "risk_queue.signal_payload",
        ),
      })
      .where(eq(riskQueueTable.id, id))
      .returning({ id: riskQueueTable.id });

    if (updated.length === 0) {
      throw new EvidenceStoreWriteError(
        `Risk signal ${id} payload could not be updated`,
      );
    }
  }

  async deleteIndicatorSpool(ids: number[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const deleted = await this.db
      .delete(indicatorSpoolTable)
      .where(inArray(indicatorSpoolTable.id, ids))
      .returning({ id: indicatorSpoolTable.id });
    return deleted.length;
  }

  async countIndicatorSpool(): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(indicatorSpoolTable);
    return rows[0]?.count ?? 0;
  }

  async dropOldestIndicatorSpool(count: number): Promise<number> {
    if (count <= 0) {
      return 0;
    }
    const rows = await this.db
      .select({ id: indicatorSpoolTable.id })
      .from(indicatorSpoolTable)
      .orderBy(asc(indicatorSpoolTable.id))
      .limit(count);

    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      return 0;
    }

    const deleted = await this.db
      .delete(indicatorSpoolTable)
      .where(inArray(indicatorSpoolTable.id, ids))
      .returning({ id: indicatorSpoolTable.id });
    return deleted.length;
  }

  async listDedupeIndex(): Promise<DedupeIndexRecord[]> {
    const rows = await this.db
      .select()
      .from(dedupeIndexTable)
      .orderBy(asc(dedupeIndexTable.incident_code));

    return rows.map((r) => ({
      incident_code: r.incident_code,
      pims_incident_id: r.pims_incident_id,
      title_normalized: r.title_normalized,
      incident_date: r.incident_date,
      system_or_url: r.system_or_url,
      embedding_vector: r.embedding_vector,
      is_deleted: r.is_deleted,
    }));
  }

  async saveTriageCalibration(sample: TriageCalibration): Promise<void> {
    const parsed = TriageCalibrationSchema.safeParse(sample);
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid triage calibration sample", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    const data = parsed.data;
    const values = {
      incident_code: data.incident_code,
      actual_incident_type: data.actual_incident_type,
      nonconformity_score: data.nonconformity_score,
      recorded_at_utc: new Date(data.recorded_at_utc),
    };

    await this.db
      .insert(triageCalibrationTable)
      .values(values)
      .onConflictDoUpdate({
        target: triageCalibrationTable.incident_code,
        set: values,
      });
  }

  async listTriageCalibration(): Promise<TriageCalibration[]> {
    const rows = await this.db
      .select()
      .from(triageCalibrationTable)
      .orderBy(asc(triageCalibrationTable.id));

    return rows.map((row) => {
      const parsed = TriageCalibrationSchema.safeParse({
        incident_code: row.incident_code,
        actual_incident_type: row.actual_incident_type,
        nonconformity_score: row.nonconformity_score,
        recorded_at_utc: row.recorded_at_utc.toISOString(),
      });
      if (!parsed.success) {
        throw new EvidenceStoreWriteError("Invalid triage calibration row", {
          issues: zodIssuesToDetails(parsed.error),
        });
      }
      return parsed.data;
    });
  }

  async findToolLedgerByIdempotencyKey(
    incidentCode: string,
    idempotencyKey: string,
  ): Promise<ToolLedgerRecord | null> {
    const rows = await this.db
      .select()
      .from(toolLedgerTable)
      .where(
        and(
          eq(toolLedgerTable.incident_code, incidentCode),
          eq(toolLedgerTable.idempotency_key, idempotencyKey),
        ),
      )
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const row = rows[0];
    const parsed = ToolLedgerRecordSchema.safeParse({
      id: row.id,
      incident_code: row.incident_code,
      at_utc: row.at_utc.toISOString(),
      role: row.role,
      tool: row.tool,
      args_redacted: row.args_redacted,
      result_ref: row.result_ref,
      idempotency_key: row.idempotency_key,
    });
    if (!parsed.success) {
      throw new EvidenceStoreWriteError("Invalid tool ledger row", {
        issues: zodIssuesToDetails(parsed.error),
      });
    }
    return parsed.data;
  }

  async close(): Promise<void> {
    if (this.ownsSql) {
      await this.sql.end();
    }
  }
}
