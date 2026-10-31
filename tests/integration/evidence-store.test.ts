import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EvidenceStore, encryptPayload } from "@pims/evidence";
import type {
  DedupeIndexRecord,
  ForensicScanResult,
  JsonValue,
  TimerRecord,
} from "@pims/types";
import {
  EvidenceStoreWriteError,
  LeaseHeldError,
  LeaseLostError,
  PathEscapeError,
  PimsValidationError,
} from "@pims/types";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("EvidenceStore Integration Suite (Testcontainers PostgreSQL)", {
  timeout: 120_000,
}, () => {
  let container: StartedPostgreSqlContainer;
  let store: EvidenceStore;
  const storageRootDir = path.resolve(process.cwd(), "evidence-test");
  const testKeyHex =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const sha256Of = (value: string): string =>
    crypto.createHash("sha256").update(value).digest("hex");

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();

    if (fs.existsSync(storageRootDir)) {
      await fs.promises.rm(storageRootDir, { recursive: true, force: true });
    }
    await fs.promises.mkdir(storageRootDir, { recursive: true });

    store = new EvidenceStore({
      connectionUri: container.getConnectionUri(),
      keyHex: testKeyHex,
      baseStorageDir: storageRootDir,
    });

    await store.init();
  });

  afterAll(async () => {
    if (store) {
      await store.close();
    }
    if (container) {
      await container.stop();
    }
    if (fs.existsSync(storageRootDir)) {
      await fs.promises.rm(storageRootDir, { recursive: true, force: true });
    }
  });

  describe("Storage root confinement", () => {
    it("rejects traversal segments and absolute paths", () => {
      expect(() => store.assertSafePath("../traversal", "INC-001")).toThrow(
        PathEscapeError,
      );
      expect(() => store.assertSafePath("public", "../INC-001")).toThrow(
        PathEscapeError,
      );
      expect(() => store.assertSafePath("/absolute", "INC-001")).toThrow(
        PathEscapeError,
      );
      expect(() => store.assertSafePath("public", "/INC-001")).toThrow(
        PathEscapeError,
      );
      expect(() => store.assertSafePath("public\\sub", "INC-001")).toThrow(
        PathEscapeError,
      );
      expect(() => store.assertSafePath("public", "INC-001\\escape")).toThrow(
        PathEscapeError,
      );
      expect(() => store.assertSafePath("", "INC-001")).toThrow(
        PathEscapeError,
      );
    });

    it("resolves legitimate segments without creating directories", () => {
      const resolved = store.assertSafePath("public", "INC-001");
      expect(resolved).toBe(path.resolve(storageRootDir, "public", "INC-001"));
      expect(fs.existsSync(resolved)).toBe(false);
    });

    it("requires a base storage directory", () => {
      expect(
        () =>
          new EvidenceStore({
            connectionUri: container.getConnectionUri(),
            keyHex: testKeyHex,
            baseStorageDir: "",
          }),
      ).toThrow(PimsValidationError);

      expect(
        () =>
          new EvidenceStore(
            container.getConnectionUri(),
            testKeyHex,
            "" as unknown as string,
          ),
      ).toThrow(PimsValidationError);
    });
  });

  describe("Staged attachments with encryption at rest", () => {
    it("stages, encrypts on disk, retrieves and lists an attachment", async () => {
      const rawText =
        "Forensic evidence payload containing confidential breach details";
      const fileBytes = Buffer.from(rawText, "utf8");
      const scanResult: ForensicScanResult = {
        ocr_text: rawText,
        iocs: ["198.51.100.14"],
        visual_pii: ["analyst@soc.corp"],
        encryption_proof_signal: false,
        tamper_score: 0,
      };

      const staged = await store.stageAttachment(
        "public",
        "INC-001",
        "forensic-memory-dump.txt",
        fileBytes,
        "text/plain",
        "evidence-collector",
        scanResult,
        101,
      );

      expect(staged.file_name).toBe("forensic-memory-dump.txt");
      expect(staged.bytes).toBe(fileBytes.length);
      expect(staged.sha256).toBe(sha256Of(rawText));
      expect(staged.pims_attachment_id).toBe(101);
      expect(staged.uploader).toBe("evidence-collector");
      expect(staged.forensic_scan).toEqual(scanResult);

      const diskPath = path.join(
        storageRootDir,
        "public",
        "INC-001",
        "attachments",
        "forensic-memory-dump.txt.enc",
      );
      expect(fs.existsSync(diskPath)).toBe(true);
      const encryptedDiskBytes = await fs.promises.readFile(diskPath);
      expect(encryptedDiskBytes.includes(Buffer.from(rawText))).toBe(false);

      const retrievedBytes = await store.getStagedAttachmentBytes(
        "public",
        "INC-001",
        "forensic-memory-dump.txt",
      );
      expect(retrievedBytes.equals(fileBytes)).toBe(true);

      const stagedList = await store.listStagedAttachments("INC-001");
      const target = stagedList.find(
        (att) => att.file_name === "forensic-memory-dump.txt",
      );
      expect(target).toBeDefined();
      expect(target?.sha256).toBe(staged.sha256);
      expect(target?.forensic_scan?.iocs).toContain("198.51.100.14");
      expect(target?.pims_attachment_id).toBe(101);
    });

    it("omits pims_attachment_id when the attachment is not yet uploaded", async () => {
      const staged = await store.stageAttachment(
        "public",
        "INC-NO-PIMS",
        "pending.txt",
        Buffer.from("not yet uploaded"),
        "text/plain",
        "evidence-collector",
      );

      expect(staged.pims_attachment_id).toBeUndefined();

      const listed = await store.listStagedAttachments("INC-NO-PIMS");
      expect(listed).toHaveLength(1);
      expect(listed[0]?.pims_attachment_id).toBeUndefined();
    });

    it("rejects file names that escape the incident directory", async () => {
      await expect(
        store.stageAttachment(
          "public",
          "INC-001",
          "../evil.txt",
          Buffer.from("x"),
          "text/plain",
          "evidence-collector",
        ),
      ).rejects.toThrow(PathEscapeError);

      expect(
        fs.existsSync(path.join(storageRootDir, "public", "evil.txt.enc")),
      ).toBe(false);
    });

    it("rejects an invalid forensic scan payload", async () => {
      await expect(
        store.stageAttachment(
          "public",
          "INC-001",
          "bad-scan.txt",
          Buffer.from("x"),
          "text/plain",
          "evidence-collector",
          { ocr_text: 1 } as unknown as ForensicScanResult,
        ),
      ).rejects.toThrow(PimsValidationError);
    });

    it("throws EvidenceStoreWriteError for a corrupt encrypted forensic scan", async () => {
      await store.stageAttachment(
        "public",
        "INC-CORRUPT-SCAN",
        "corrupt.txt",
        Buffer.from("payload"),
        "text/plain",
        "evidence-collector",
        {
          ocr_text: "payload",
          iocs: [],
          visual_pii: [],
          encryption_proof_signal: false,
          tamper_score: 0,
        },
      );

      const corrupt = encryptPayload("{not-json", testKeyHex).toString(
        "base64",
      );
      await store.sql.unsafe(
        `UPDATE evidence.staged_attachments SET forensic_scan_encrypted = $1 WHERE incident_code = 'INC-CORRUPT-SCAN';`,
        [corrupt],
      );

      await expect(
        store.listStagedAttachments("INC-CORRUPT-SCAN"),
      ).rejects.toThrow(EvidenceStoreWriteError);
    });
  });

  describe("Draft packs encryption and versioning", () => {
    it("encrypts the payload at rest and returns the real inserted id", async () => {
      const draftPayload = {
        title: "AEPD Article 33 Formal Notification",
        summary: "Database credentials exposed via public repository commit",
        authority: "AEPD (Spain)",
        impact: {
          confidentiality: true,
          integrity: false,
          availability: false,
        },
      };
      const contentSha256 = sha256Of(JSON.stringify(draftPayload));

      const draftId = await store.saveDraftPack(
        "INC-DRAFT-001",
        "authority",
        draftPayload,
        contentSha256,
        "APPROVAL-AUTH-001",
        "draft",
      );

      const rows = await store.sql.unsafe<
        { id: number; payload_encrypted: string }[]
      >(
        `SELECT id, payload_encrypted FROM evidence.draft_packs WHERE incident_code = 'INC-DRAFT-001';`,
      );
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) {
        throw new Error("Expected draft pack row in database");
      }
      expect(draftId).toBe(row.id);
      expect(row.payload_encrypted).not.toContain(
        "AEPD Article 33 Formal Notification",
      );

      const retrieved = await store.getDraftPack("INC-DRAFT-001", "authority");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.payload).toEqual(draftPayload);
      expect(retrieved?.contentSha256).toBe(contentSha256);
      expect(retrieved?.reviewApprovalId).toBe("APPROVAL-AUTH-001");
      expect(retrieved?.state).toBe("draft");
    });

    it("validates state, content hash and payload before writing", async () => {
      const payload: JsonValue = { a: 1 };

      await expect(
        store.saveDraftPack(
          "INC-DRAFT-002",
          "authority",
          payload,
          sha256Of("x"),
          null,
          "exempted",
        ),
      ).rejects.toThrow(PimsValidationError);

      await expect(
        store.saveDraftPack(
          "INC-DRAFT-002",
          "subject",
          payload,
          sha256Of("x"),
          null,
          "exempted",
        ),
      ).resolves.toBeGreaterThan(0);

      await expect(
        store.saveDraftPack(
          "INC-DRAFT-002",
          "authority",
          payload,
          "NOT-A-SHA",
          null,
        ),
      ).rejects.toThrow(PimsValidationError);

      await expect(
        store.saveDraftPack(
          "INC-DRAFT-003",
          "authority",
          { at: new Date() } as unknown as JsonValue,
          sha256Of("x"),
          null,
        ),
      ).rejects.toThrow(EvidenceStoreWriteError);
    });

    it("throws EvidenceStoreWriteError for a corrupt encrypted payload", async () => {
      await store.saveDraftPack(
        "INC-CORRUPT-DRAFT",
        "subject",
        { ok: true },
        sha256Of("{}"),
        null,
      );

      const corrupt = encryptPayload("{not-json", testKeyHex).toString(
        "base64",
      );
      await store.sql.unsafe(
        `UPDATE evidence.draft_packs SET payload_encrypted = $1 WHERE incident_code = 'INC-CORRUPT-DRAFT';`,
        [corrupt],
      );

      await expect(
        store.getDraftPack("INC-CORRUPT-DRAFT", "subject"),
      ).rejects.toThrow(EvidenceStoreWriteError);
    });
  });

  describe("Distributed leases lifecycle", () => {
    it("acquires, blocks a conflicting holder, renews, and releases", async () => {
      const acquired = await store.acquireLease(
        "INC-LEASE-01",
        "worker-alpha",
        60,
      );
      expect(acquired).toBe(true);

      await expect(
        store.acquireLease("INC-LEASE-01", "worker-bravo", 60),
      ).rejects.toThrow(LeaseHeldError);

      await expect(
        store.acquireLease("INC-LEASE-01", "worker-alpha", 120),
      ).resolves.toBe(true);

      await store.sql.unsafe(
        `UPDATE evidence.leases SET expires_at = NOW() - INTERVAL '10 seconds' WHERE incident_code = 'INC-LEASE-01';`,
      );
      await expect(
        store.renewLease("INC-LEASE-01", "worker-alpha", 60),
      ).rejects.toThrow(LeaseLostError);

      await store.acquireLease("INC-LEASE-01", "worker-alpha", 60);
      await expect(
        store.releaseLease("INC-LEASE-01", "worker-alpha"),
      ).resolves.toBe(true);

      await expect(
        store.acquireLease("INC-LEASE-01", "worker-bravo", 60),
      ).resolves.toBe(true);
    });

    it("rejects release by a non-holder", async () => {
      await store.acquireLease("INC-LEASE-02", "worker-alpha", 60);
      await expect(
        store.releaseLease("INC-LEASE-02", "worker-bravo"),
      ).rejects.toThrow(LeaseLostError);
      await store.releaseLease("INC-LEASE-02", "worker-alpha");
    });

    it("grants concurrent acquisition to exactly one holder", async () => {
      const results = await Promise.allSettled([
        store.acquireLease("INC-LEASE-RACE", "worker-alpha", 60),
        store.acquireLease("INC-LEASE-RACE", "worker-bravo", 60),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejection = rejected[0];
      if (rejection?.status !== "rejected") {
        throw new Error("Expected exactly one rejected acquisition");
      }
      expect(rejection.reason).toBeInstanceOf(LeaseHeldError);

      const holderRows = await store.sql.unsafe<{ holder_id: string }[]>(
        `SELECT holder_id FROM evidence.leases WHERE incident_code = 'INC-LEASE-RACE';`,
      );
      const holder = holderRows[0]?.holder_id;
      if (holder === undefined) {
        throw new Error("Expected a lease holder row");
      }
      await store.releaseLease("INC-LEASE-RACE", holder);
    });
  });

  describe("Timers management", () => {
    it("arms a timer, lists it as active, then cancels it", async () => {
      const timerRecord: TimerRecord = {
        timer_id: "timer-t72-art33-inc001",
        incident_code: "INC-001",
        timer_type: "T72_AUTHORITY",
        fire_at_utc: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        payload: { deadline_hours: 72, target_authority: "AEPD" },
        fired: false,
        cancelled_reason: null,
      };

      await store.armTimer(timerRecord);

      const activeTimers = await store.listActiveTimers("INC-001");
      const foundTimer = activeTimers.find(
        (t) => t.timer_id === "timer-t72-art33-inc001",
      );
      expect(foundTimer?.timer_type).toBe("T72_AUTHORITY");
      expect(foundTimer?.payload).toEqual({
        deadline_hours: 72,
        target_authority: "AEPD",
      });

      await store.cancelTimer(
        "timer-t72-art33-inc001",
        "authority_pack_submitted_early",
      );

      const afterCancel = await store.listActiveTimers("INC-001");
      expect(
        afterCancel.find((t) => t.timer_id === "timer-t72-art33-inc001"),
      ).toBeUndefined();
    });
  });

  describe("Deduplication index", () => {
    it("indexes an incident and finds the dedupe match", async () => {
      const dedupeRecord: DedupeIndexRecord = {
        incident_code: "INC-DEDUPE-001",
        pims_incident_id: 101,
        title_normalized: "unauthorized postgres database dump exfiltration",
        incident_date: "2026-10-30",
        system_or_url: "https://db-cluster.corp.internal",
        embedding_vector: [0.05, 0.22, 0.91, 0.44],
        is_deleted: false,
      };

      await store.indexDedupe(dedupeRecord);

      const match = await store.findDedupeMatch(
        "unauthorized postgres database dump exfiltration",
        "2026-10-30",
        "https://db-cluster.corp.internal",
      );
      expect(match?.incident_code).toBe("INC-DEDUPE-001");

      const noMatch = await store.findDedupeMatch(
        "unrelated incident title",
        "2026-10-30",
        "https://db-cluster.corp.internal",
      );
      expect(noMatch).toBeNull();
    });
  });

  describe("Tool ledger & indicator spool", () => {
    it("appends ledger entries, spools indicators and lists both", async () => {
      await store.appendToolLedger({
        incident_code: "INC-001",
        at_utc: new Date().toISOString(),
        role: "incident_lead",
        tool: "quarantine_endpoint",
        args_redacted: { hostname: "srv-db-prod-01", action: "isolate" },
        result_ref: "result://actions/isolate-01",
        idempotency_key: "idem-quarantine-01",
      });

      const ledger = await store.listToolLedger("INC-001");
      const recorded = ledger.find(
        (l) => l.idempotency_key === "idem-quarantine-01",
      );
      expect(recorded?.tool).toBe("quarantine_endpoint");
      expect(recorded?.args_redacted.hostname).toBe("srv-db-prod-01");

      const spoolId = await store.spoolIndicator("INDICATOR_OBSERVED", {
        type: "c2_ip",
        value: "198.51.100.99",
        confidence: 0.95,
      });
      expect(spoolId).toBeGreaterThan(0);

      const spoolItems = await store.listIndicatorSpool();
      const foundSpool = spoolItems.find((s) => s.id === spoolId);
      expect(foundSpool?.event_type).toBe("INDICATOR_OBSERVED");
      expect(foundSpool?.payload.value).toBe("198.51.100.99");
    });
  });

  describe("Retention pruning", () => {
    it("executes pruneRetention without deleting fresh rows", async () => {
      const result = await store.pruneRetention(6);
      expect(result.prunedDraftsCount).toBe(0);
      expect(result.prunedFilesCount).toBe(0);

      const remaining = await store.listStagedAttachments("INC-001");
      expect(remaining.length).toBeGreaterThanOrEqual(1);
    });

    it("deletes a draft older than the retention window", async () => {
      await store.saveDraftPack(
        "INC-RETENTION",
        "subject",
        { stale: true },
        sha256Of("{}"),
        null,
      );
      await store.sql.unsafe(
        `UPDATE evidence.draft_packs SET created_at = NOW() - INTERVAL '8 years' WHERE incident_code = 'INC-RETENTION';`,
      );

      const result = await store.pruneRetention(6);
      expect(result.prunedDraftsCount).toBe(1);
    });
  });
});
