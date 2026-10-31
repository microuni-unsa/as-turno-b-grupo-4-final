import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptPayload, encryptPayload } from "@pims/evidence/crypto.ts";
import {
  bundleManifestsTable,
  dedupeIndexTable,
  draftPacksTable,
  indicatorSpoolTable,
  leasesTable,
  stagedAttachmentsTable,
  timersTable,
  toolLedgerTable,
} from "@pims/evidence/schema.ts";
import {
  AttachmentHashMismatchError,
  EvidenceNotFoundError,
  EvidenceStoreEncryptionError,
  LeaseHeldError,
  LeaseLostError,
  PathEscapeError,
} from "@pims/types/errors.ts";
import type {
  AuditTrailLedgerEntry,
  DedupeIndexRecord,
  EvidenceAttachment,
  EvidenceBundleManifest,
  ForensicScanResult,
  IndicatorSpoolRecord,
  TimerRecord,
} from "@pims/types/evidence.ts";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export interface EvidenceStoreOptions {
  connectionUri?: string;
  sql?: postgres.Sql;
  keyHex: string;
  baseStorageDir?: string;
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
    baseStorageDir?: string,
  );
  constructor(
    optionsOrTarget: EvidenceStoreOptions | string | postgres.Sql,
    keyHexArg?: string,
    baseStorageDirArg?: string,
  ) {
    if (typeof optionsOrTarget === "string") {
      this.ownsSql = true;
      this.sql = postgres(optionsOrTarget, { max: 10 });
      if (!keyHexArg) {
        throw new EvidenceStoreEncryptionError("keyHex is required");
      }
      this.keyHex = keyHexArg;
      this.baseStorageDir = baseStorageDirArg ?? "evidence";
    } else if (typeof optionsOrTarget === "function") {
      this.ownsSql = false;
      this.sql = optionsOrTarget;
      if (!keyHexArg) {
        throw new EvidenceStoreEncryptionError("keyHex is required");
      }
      this.keyHex = keyHexArg;
      this.baseStorageDir = baseStorageDirArg ?? "evidence";
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
      this.baseStorageDir = opts.baseStorageDir ?? "evidence";
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
        uploader VARCHAR(128) DEFAULT 'evidence-collector',
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
        title_normalized VARCHAR(255) NOT NULL,
        incident_date VARCHAR(32) NOT NULL,
        system_or_url VARCHAR(255) NOT NULL,
        embedding_vector JSONB NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
      );

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
    `);
  }

  assertSafePath(schema: string, incidentCode: string): string {
    if (
      schema.includes("..") ||
      incidentCode.includes("..") ||
      schema.startsWith("/") ||
      incidentCode.startsWith("/") ||
      schema.includes("\\") ||
      incidentCode.includes("\\")
    ) {
      throw new PathEscapeError(`${schema}/${incidentCode}`);
    }

    const resolvedRoot = path.resolve(this.baseStorageDir);
    const resolvedPath = path.resolve(
      this.baseStorageDir,
      schema,
      incidentCode,
    );

    if (
      !resolvedPath.startsWith(resolvedRoot + path.sep) &&
      resolvedPath !== resolvedRoot
    ) {
      throw new PathEscapeError(`${schema}/${incidentCode}`);
    }

    const attachmentsDir = path.join(resolvedPath, "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });

    return resolvedPath;
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
    if (
      fileName.includes("..") ||
      fileName.includes("/") ||
      fileName.includes("\\")
    ) {
      throw new PathEscapeError(fileName);
    }

    const incidentDir = this.assertSafePath(schema, incidentCode);
    const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
    const encryptedFile = encryptPayload(fileBytes, this.keyHex);

    const storagePath = path.join(
      incidentDir,
      "attachments",
      `${fileName}.enc`,
    );
    await fs.promises.writeFile(storagePath, encryptedFile);

    const forensicScanEncrypted = forensicScan
      ? encryptPayload(JSON.stringify(forensicScan), this.keyHex).toString(
          "base64",
        )
      : null;

    const piiTags = forensicScan?.visual_pii ?? [];
    const now = new Date();

    await this.db.insert(stagedAttachmentsTable).values({
      incident_code: incidentCode,
      file_name: fileName,
      sha256,
      bytes: fileBytes.length,
      mime,
      pii_tags: piiTags,
      forensic_scan_encrypted: forensicScanEncrypted,
      storage_path: storagePath,
      pims_attachment_id: pimsAttachmentId ?? null,
      uploader,
      created_at: now,
    });

    return {
      file_name: fileName,
      sha256,
      bytes: fileBytes.length,
      mime,
      pii_tags: piiTags,
      forensic_scan: forensicScan ?? null,
      uploader,
      uploaded_at_utc: now.toISOString(),
      pims_attachment_id: pimsAttachmentId,
    };
  }

  async getStagedAttachmentBytes(
    schema: string,
    incidentCode: string,
    fileName: string,
  ): Promise<Buffer> {
    const incidentDir = this.assertSafePath(schema, incidentCode);
    const rows = await this.db
      .select()
      .from(stagedAttachmentsTable)
      .where(
        and(
          eq(stagedAttachmentsTable.incident_code, incidentCode),
          eq(stagedAttachmentsTable.file_name, fileName),
        ),
      )
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      throw new EvidenceNotFoundError("staged_attachment", fileName);
    }

    const row = rows[0];
    const storagePath = path.join(
      incidentDir,
      "attachments",
      `${fileName}.enc`,
    );
    if (!fs.existsSync(storagePath)) {
      throw new EvidenceNotFoundError("storage_file", storagePath);
    }

    const encrypted = await fs.promises.readFile(storagePath);
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
        scan = JSON.parse(decryptedBuf.toString("utf8")) as ForensicScanResult;
      }

      return {
        file_name: row.file_name,
        sha256: row.sha256,
        bytes: row.bytes,
        mime: row.mime,
        pii_tags: row.pii_tags,
        forensic_scan: scan,
        uploader: row.uploader ?? "evidence-collector",
        uploaded_at_utc: row.created_at.toISOString(),
        pims_attachment_id: row.pims_attachment_id ?? undefined,
      };
    });
  }

  async saveDraftPack(
    incidentCode: string,
    packType: "authority" | "subject",
    payload: unknown,
    contentSha256: string,
    reviewApprovalId?: string | null,
    state = "draft",
  ): Promise<number> {
    const encryptedPayload = encryptPayload(
      JSON.stringify(payload),
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
          eq(draftPacksTable.state, state),
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
          state,
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
        state,
        created_at: now,
        updated_at: now,
      })
      .returning({ id: draftPacksTable.id });

    return inserted[0]?.id ?? 1;
  }

  async getDraftPack(
    incidentCode: string,
    packType: "authority" | "subject",
  ): Promise<{
    id: number;
    payload: unknown;
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
    const payload = JSON.parse(decryptedBuf.toString("utf8"));

    return {
      id: row.id,
      payload,
      contentSha256: row.content_sha256,
      reviewApprovalId: row.review_approval_id,
      state: row.state,
    };
  }

  async acquireLease(
    incidentCode: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const now = new Date();
    const existing = await this.db
      .select()
      .from(leasesTable)
      .where(eq(leasesTable.incident_code, incidentCode))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      const lease = existing[0];
      if (lease.expires_at > now && lease.holder_id !== holderId) {
        throw new LeaseHeldError(lease.holder_id);
      }
    }

    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await this.db
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
      });

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
    await this.db
      .delete(leasesTable)
      .where(
        and(
          eq(leasesTable.incident_code, incidentCode),
          eq(leasesTable.holder_id, holderId),
        ),
      );
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
      payload: r.payload_json,
      fired: r.fired,
      cancelled_reason: r.cancelled_reason,
    }));
  }

  async appendToolLedger(
    entry: AuditTrailLedgerEntry & { incident_code: string },
  ): Promise<void> {
    await this.db.insert(toolLedgerTable).values({
      incident_code: entry.incident_code,
      at_utc: new Date(entry.at_utc),
      role: entry.role,
      tool: entry.tool,
      args_redacted: entry.args_redacted as Record<string, unknown>,
      result_ref: entry.result_ref,
      idempotency_key: entry.idempotency_key,
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
      args_redacted: r.args_redacted,
      result_ref: r.result_ref,
      idempotency_key: r.idempotency_key,
    }));
  }

  async spoolIndicator(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const inserted = await this.db
      .insert(indicatorSpoolTable)
      .values({
        event_type: eventType,
        payload_json: payload,
        created_at: new Date(),
      })
      .returning({ id: indicatorSpoolTable.id });

    return inserted[0]?.id ?? 1;
  }

  async listIndicatorSpool(): Promise<IndicatorSpoolRecord[]> {
    const rows = await this.db
      .select()
      .from(indicatorSpoolTable)
      .orderBy(asc(indicatorSpoolTable.id));

    return rows.map((r) => ({
      id: r.id,
      event_type: r.event_type,
      payload: r.payload_json,
      created_at_utc: r.created_at.toISOString(),
    }));
  }

  async indexDedupe(record: DedupeIndexRecord): Promise<void> {
    await this.db
      .insert(dedupeIndexTable)
      .values({
        incident_code: record.incident_code,
        title_normalized: record.title_normalized,
        incident_date: record.incident_date,
        system_or_url: record.system_or_url,
        embedding_vector: record.embedding_vector,
        is_deleted: record.is_deleted,
      })
      .onConflictDoUpdate({
        target: dedupeIndexTable.incident_code,
        set: {
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
    const manifestEncrypted = encryptPayload(
      JSON.stringify(manifest),
      this.keyHex,
    ).toString("base64");
    const now = new Date();
    const effectiveSeal = sealSha256 ?? manifest.seal_sha256 ?? null;
    const sealedAt = manifest.sealed_at_utc
      ? new Date(manifest.sealed_at_utc)
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
    return JSON.parse(decryptedBuf.toString("utf8")) as EvidenceBundleManifest;
  }

  async pruneRetention(
    retentionYears: number,
  ): Promise<{ prunedDraftsCount: number; prunedFilesCount: number }> {
    const cutoffMs = retentionYears * 365.25 * 24 * 3600 * 1000;
    const cutoff = new Date(Date.now() - cutoffMs);

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
        .select()
        .from(bundleManifestsTable)
        .where(
          and(
            eq(bundleManifestsTable.incident_code, att.incident_code),
            isNotNull(bundleManifestsTable.seal_sha256),
          ),
        );

      if (manifests.length === 0) {
        if (fs.existsSync(att.storage_path)) {
          try {
            await fs.promises.unlink(att.storage_path);
            prunedFilesCount += 1;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        }
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

  async close(): Promise<void> {
    if (this.ownsSql) {
      await this.sql.end();
    }
  }
}
