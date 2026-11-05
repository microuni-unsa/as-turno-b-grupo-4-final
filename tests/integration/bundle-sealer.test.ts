import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BundleSealer, EvidenceStore } from "@pims/evidence";
import type {
  EvidenceBundleIncident,
  EvidenceBundleRootCause,
  JsonObject,
} from "@pims/types";
import {
  BundleAlreadySealedError,
  BundlePimsMismatchError,
  canonicalizeJson,
} from "@pims/types";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  TEST_ALT_INCIDENT_CODE,
  TEST_MIME_TEXT,
  TEST_POSTGRES_IMAGE,
  TEST_STORAGE_PUBLIC,
} from "@tests/helpers/test-constants.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("BundleSealer Integration Suite (Testcontainers PostgreSQL)", {
  timeout: 120_000,
}, () => {
  let container: StartedPostgreSqlContainer;
  let store: EvidenceStore;
  let sealer: BundleSealer;
  const storageRootDir = path.resolve(process.cwd(), "bundle-sealer-test");
  const testKeyHex =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeAll(async () => {
    container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE).start();

    if (fs.existsSync(storageRootDir)) {
      await fs.promises.rm(storageRootDir, { recursive: true, force: true });
    } else {
      // Storage directory does not exist prior to creation
    }
    await fs.promises.mkdir(storageRootDir, { recursive: true });

    store = new EvidenceStore({
      connectionUri: container.getConnectionUri(),
      keyHex: testKeyHex,
      baseStorageDir: storageRootDir,
    });

    await store.init();
    sealer = new BundleSealer(store);
  });

  afterAll(async () => {
    if (store) {
      await store.close();
    } else {
      // EvidenceStore was not initialized
    }
    if (container) {
      await container.stop();
    } else {
      // Container was not started
    }
    if (fs.existsSync(storageRootDir)) {
      await fs.promises.rm(storageRootDir, { recursive: true, force: true });
    } else {
      // Storage directory already cleaned up
    }
  });

  const incidentCode = TEST_ALT_INCIDENT_CODE;

  const incidentFacts: EvidenceBundleIncident = {
    description:
      "Unauthorized SQL injection export on customer portal database",
    time_period: {
      from: "2026-10-30T08:00:00.000Z",
      to: "2026-10-30T11:45:00.000Z",
    },
    consequences:
      "High risk to data subject rights and confidentiality of PII records",
    reporter: "Lead Security Analyst",
    reported_to: "Data Protection Officer",
    resolution_steps: [
      "Patched SQL injection vulnerability in search endpoint",
      "Revoked exposed database session credentials",
      "Enabled enhanced WAF inspection rules",
    ],
    person_in_charge: "Chief Information Security Officer",
    data_recovered:
      "All exposed records reconciled against primary database replica",
    cid_fact: ["Confidentiality compromised", "Integrity intact"],
    pii_description: "Names and corporate email addresses of customers",
    notification_steps: [
      "Drafted AEPD Article 33 notification",
      "Prepared Article 34 individual notices",
    ],
  };

  const rootCause: EvidenceBundleRootCause = {
    method: "5-whys",
    cause: "Unsanitized user input concatenation in legacy search query",
    systemic: false,
    remediation:
      "Parameterized queries with ORM strictly prevent arbitrary SQL execution",
  };

  describe("Evidence bundle assembly and sealing", () => {
    it("stages two attachments bound to PIMS ids", async () => {
      await store.stageAttachment(
        TEST_STORAGE_PUBLIC,
        incidentCode,
        "firewall-traffic.log",
        Buffer.from("Observed suspicious outbound traffic log entries"),
        TEST_MIME_TEXT,
        "security-analyst",
        null,
        101,
      );
      await store.stageAttachment(
        TEST_STORAGE_PUBLIC,
        incidentCode,
        "database-access.log",
        Buffer.from("Database queries containing exfiltration markers"),
        TEST_MIME_TEXT,
        "security-analyst",
        null,
        102,
      );

      const stagedList = await store.listStagedAttachments(incidentCode);
      expect(stagedList).toHaveLength(2);
    });

    it("creates and persists the manifest", async () => {
      const manifest = await sealer.createManifest(
        incidentCode,
        incidentFacts,
        rootCause,
        ["CITATION-AEPD-01"],
        ["pack-art33-authority", "pack-art34-subject"],
      );

      expect(manifest.manifest).toBe("evidence-bundle");
      expect(manifest.sealed_at_utc).toBeNull();
      expect(manifest.seal_sha256).toBeNull();
      expect(manifest.items).toHaveLength(2);

      const persisted = await store.getBundleManifest(incidentCode);
      expect(persisted?.items).toHaveLength(2);
      expect(persisted?.incident).toEqual(incidentFacts);
    });

    it("reconciles with the PIMS attachment ids", async () => {
      await expect(
        sealer.reconcileWithPims(incidentCode, [101, 102]),
      ).resolves.toBeUndefined();
      await expect(
        sealer.reconcileWithPims(incidentCode, [101, 102, 103]),
      ).resolves.toBeUndefined();
      await expect(
        sealer.reconcileWithPims(incidentCode, [101]),
      ).rejects.toThrow(BundlePimsMismatchError);
      await expect(sealer.reconcileWithPims(incidentCode, [])).rejects.toThrow(
        BundlePimsMismatchError,
      );
    });

    it("rejects reconciliation when a staged attachment has no PIMS id", async () => {
      await store.stageAttachment(
        TEST_STORAGE_PUBLIC,
        "INC-NO-PIMS",
        "unuploaded.log",
        Buffer.from("staged but never uploaded"),
        TEST_MIME_TEXT,
        "security-analyst",
      );

      await expect(sealer.reconcileWithPims("INC-NO-PIMS", [])).rejects.toThrow(
        BundlePimsMismatchError,
      );
    });

    it("seals with sha256(canonicalizeJson(manifest with seal_sha256 null))", async () => {
      const sealResult = await sealer.sealBundle(incidentCode);

      const preimage = { ...sealResult.manifest, seal_sha256: null };
      const expected = crypto
        .createHash("sha256")
        .update(canonicalizeJson(preimage), "utf8")
        .digest("hex");

      expect(sealResult.sealSha256).toBe(expected);
      expect(sealResult.marker).toBe(`BUNDLE_SEALED:${sealResult.sealSha256}`);
      expect(sealResult.manifest.seal_sha256).toBe(sealResult.sealSha256);

      const updatedManifest = await store.getBundleManifest(incidentCode);
      expect(updatedManifest?.seal_sha256).toBe(sealResult.sealSha256);
    });

    it("blocks re-sealing a sealed bundle", async () => {
      await expect(sealer.sealBundle(incidentCode)).rejects.toThrow(
        BundleAlreadySealedError,
      );
    });
  });

  describe("Audit trail export", () => {
    it("redacts every argument except the allowlisted keys", async () => {
      await store.appendToolLedger({
        incident_code: incidentCode,
        at_utc: new Date().toISOString(),
        role: "incident_lead",
        tool: "query_database_state",
        args_redacted: {
          incident_code: incidentCode,
          status: "in_investigation",
          internal_db_password: "supersecret-password-val",
        },
        result_ref: "ref-tool-query-01",
        idempotency_key: "idem-tool-01",
      });

      await store.appendToolLedger({
        incident_code: incidentCode,
        at_utc: new Date().toISOString(),
        role: "incident_lead",
        tool: "revoke_api_credentials",
        args_redacted: {
          incident_code: incidentCode,
          status: "revoked",
          api_token_plaintext: "token-prod-xyz-987",
        },
        result_ref: "ref-tool-revoke-02",
        idempotency_key: "idem-tool-02",
      });

      const timeline: JsonObject[] = [
        {
          phase: "Detection",
          at_utc: "2026-10-30T08:00:00.000Z",
          summary: "Anomaly alerted",
        },
      ];
      const timerLedger: JsonObject[] = [
        {
          timer_id: "T72_AUTHORITY",
          status: "active",
          fire_at_utc: "2026-11-02T08:00:00.000Z",
        },
      ];

      const exportResult = await sealer.exportAuditTrail(
        incidentCode,
        timeline,
        timerLedger,
      );

      expect(exportResult.export_version).toBe("1.0");
      expect(exportResult.timeline).toEqual(timeline);
      expect(exportResult.timer_ledger).toEqual(timerLedger);
      expect(exportResult.tool_ledger).toHaveLength(2);

      const first = exportResult.tool_ledger[0];
      expect(first?.args_redacted.incident_code).toBe(incidentCode);
      expect(first?.args_redacted.status).toBe("in_investigation");
      expect(first?.args_redacted.internal_db_password).toBe("[REDACTED]");

      const second = exportResult.tool_ledger[1];
      expect(second?.args_redacted.api_token_plaintext).toBe("[REDACTED]");
    });
  });
});
