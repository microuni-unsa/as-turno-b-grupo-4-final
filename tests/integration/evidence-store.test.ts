import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EvidenceStore } from "@pims/evidence";
import type {
  DedupeIndexRecord,
  ForensicScanResult,
  TimerRecord,
} from "@pims/types";
import { LeaseHeldError, LeaseLostError, PathEscapeError } from "@pims/types";
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

  describe("Tenant directory isolation", () => {
    it("assertSafePath throws PathEscapeError on traversal attempts", () => {
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
    });

    it("assertSafePath succeeds and creates directory for legitimate schema and incident", () => {
      const resolved = store.assertSafePath("public", "INC-001");
      expect(resolved).toBe(path.resolve(storageRootDir, "public", "INC-001"));
      expect(fs.existsSync(path.join(resolved, "attachments"))).toBe(true);
    });
  });

  describe("Staged attachments with encryption at rest", () => {
    it("stages attachment, encrypts file on disk, retrieves raw bytes, and lists attachments", async () => {
      const rawText =
        "Forensic evidence payload containing confidential breach details";
      const fileBytes = Buffer.from(rawText, "utf8");
      const scanResult: ForensicScanResult = {
        ocr_text: rawText,
        iocs: ["198.51.100.14"],
        visual_pii: ["analyst@soc.corp"],
        encryption_proof_verified: true,
        tamper_score: 0.0,
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
      expect(staged.sha256).toBe(
        crypto.createHash("sha256").update(fileBytes).digest("hex"),
      );
      expect(staged.pims_attachment_id).toBe(101);

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
      expect(retrievedBytes.toString("utf8")).toBe(rawText);

      const stagedList = await store.listStagedAttachments("INC-001");
      expect(stagedList.length).toBeGreaterThanOrEqual(1);
      const target = stagedList.find(
        (att) => att.file_name === "forensic-memory-dump.txt",
      );
      expect(target).toBeDefined();
      expect(target?.sha256).toBe(staged.sha256);
      expect(target?.forensic_scan?.iocs).toContain("198.51.100.14");
    });
  });

  describe("Draft packs encryption and versioning", () => {
    it("saves draft pack encrypted in database and retrieves decrypted payload", async () => {
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
      const contentSha256 = crypto
        .createHash("sha256")
        .update(JSON.stringify(draftPayload))
        .digest("hex");

      const draftId = await store.saveDraftPack(
        "INC-001",
        "authority",
        draftPayload,
        contentSha256,
        "APPROVAL-AUTH-001",
        "draft",
      );
      expect(draftId).toBeGreaterThan(0);

      const dbRows = await store.sql.unsafe<{ payload_encrypted: string }[]>(
        `SELECT payload_encrypted FROM evidence.draft_packs WHERE incident_code = 'INC-001' AND pack_type = 'authority' LIMIT 1;`,
      );
      expect(dbRows.length).toBe(1);
      const row = dbRows[0];
      if (!row) {
        throw new Error("Expected draft pack row in database");
      }
      expect(row.payload_encrypted).not.toContain(
        "AEPD Article 33 Formal Notification",
      );
      expect(row.payload_encrypted).not.toContain(
        "Database credentials exposed",
      );

      const retrieved = await store.getDraftPack("INC-001", "authority");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.payload).toEqual(draftPayload);
      expect(retrieved?.contentSha256).toBe(contentSha256);
      expect(retrieved?.reviewApprovalId).toBe("APPROVAL-AUTH-001");
      expect(retrieved?.state).toBe("draft");
    });
  });

  describe("Distributed leases lifecycle", () => {
    it("acquires, blocks conflicting holder, renews, handles expiration, and releases lease", async () => {
      const acquired = await store.acquireLease(
        "INC-LEASE-01",
        "worker-alpha",
        60,
      );
      expect(acquired).toBe(true);

      await expect(
        store.acquireLease("INC-LEASE-01", "worker-bravo", 60),
      ).rejects.toThrow(LeaseHeldError);

      const renewed = await store.renewLease(
        "INC-LEASE-01",
        "worker-alpha",
        120,
      );
      expect(renewed).toBe(true);

      await store.sql.unsafe(
        `UPDATE evidence.leases SET expires_at = NOW() - INTERVAL '10 seconds' WHERE incident_code = 'INC-LEASE-01';`,
      );
      await expect(
        store.renewLease("INC-LEASE-01", "worker-alpha", 60),
      ).rejects.toThrow(LeaseLostError);

      await store.acquireLease("INC-LEASE-01", "worker-alpha", 60);
      await store.releaseLease("INC-LEASE-01", "worker-alpha");

      const acquiredBravo = await store.acquireLease(
        "INC-LEASE-01",
        "worker-bravo",
        60,
      );
      expect(acquiredBravo).toBe(true);
    });
  });

  describe("Timers management", () => {
    it("arms T72_AUTHORITY timer, lists active, cancels with reason, and verifies removal", async () => {
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
      expect(foundTimer).toBeDefined();
      expect(foundTimer?.timer_type).toBe("T72_AUTHORITY");

      await store.cancelTimer(
        "timer-t72-art33-inc001",
        "authority_pack_submitted_early",
      );

      const afterCancelTimers = await store.listActiveTimers("INC-001");
      const cancelledFound = afterCancelTimers.find(
        (t) => t.timer_id === "timer-t72-art33-inc001",
      );
      expect(cancelledFound).toBeUndefined();
    });
  });

  describe("Deduplication index", () => {
    it("indexes incident and finds dedupe match on normalized title, date, and system", async () => {
      const dedupeRecord: DedupeIndexRecord = {
        incident_code: "INC-DEDUPE-001",
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

      expect(match).not.toBeNull();
      expect(match?.incident_code).toBe("INC-DEDUPE-001");
      expect(match?.system_or_url).toBe("https://db-cluster.corp.internal");

      const noMatch = await store.findDedupeMatch(
        "unrelated incident title",
        "2026-10-30",
        "https://db-cluster.corp.internal",
      );
      expect(noMatch).toBeNull();
    });
  });

  describe("Tool ledger & indicator spool", () => {
    it("appends tool ledger entry, lists ledger, spools indicator, and lists spool", async () => {
      const ledgerEntry = {
        incident_code: "INC-001",
        at_utc: new Date().toISOString(),
        role: "incident_lead",
        tool: "quarantine_endpoint",
        args_redacted: { hostname: "srv-db-prod-01", action: "isolate" },
        result_ref: "result://actions/isolate-01",
        idempotency_key: "idem-quarantine-01",
      };

      await store.appendToolLedger(ledgerEntry);
      const ledger = await store.listToolLedger("INC-001");
      expect(ledger.length).toBeGreaterThanOrEqual(1);
      const recorded = ledger.find(
        (l) => l.idempotency_key === "idem-quarantine-01",
      );
      expect(recorded).toBeDefined();
      expect(recorded?.tool).toBe("quarantine_endpoint");

      const spoolId = await store.spoolIndicator("INDICATOR_OBSERVED", {
        type: "c2_ip",
        value: "198.51.100.99",
        confidence: 0.95,
      });
      expect(spoolId).toBeGreaterThan(0);

      const spoolItems = await store.listIndicatorSpool();
      expect(spoolItems.length).toBeGreaterThanOrEqual(1);
      const foundSpool = spoolItems.find((s) => s.id === spoolId);
      expect(foundSpool).toBeDefined();
      expect(foundSpool?.event_type).toBe("INDICATOR_OBSERVED");
    });
  });

  describe("Retention pruning", () => {
    it("executes pruneRetention cleanly without throwing errors", async () => {
      const result = await store.pruneRetention(6);
      expect(result).toBeDefined();
      expect(typeof result.prunedDraftsCount).toBe("number");
      expect(typeof result.prunedFilesCount).toBe("number");
      expect(result.prunedDraftsCount).toBeGreaterThanOrEqual(0);
      expect(result.prunedFilesCount).toBeGreaterThanOrEqual(0);
    });
  });
});
