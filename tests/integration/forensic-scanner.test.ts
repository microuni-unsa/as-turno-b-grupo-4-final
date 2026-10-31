import crypto from "node:crypto";
import { ForensicScanner } from "@pims/evidence";
import type { ModelProvider } from "@pims/types";
import {
  AttachmentHashMismatchError,
  AttachmentRejectedError,
} from "@pims/types";
import { describe, expect, it, vi } from "vitest";

describe("ForensicScanner Integration Suite", () => {
  const scanner = new ForensicScanner();

  describe("File extension allowlist", () => {
    it("validates permitted extensions pass without error", () => {
      expect(() => scanner.validateAttachment("scan.pdf", 1024)).not.toThrow();
      expect(() => scanner.validateAttachment("image.png", 1024)).not.toThrow();
      expect(() => scanner.validateAttachment("log.txt", 1024)).not.toThrow();
      expect(() => scanner.validateAttachment("photo.jpg", 1024)).not.toThrow();
      expect(() =>
        scanner.validateAttachment("document.docx", 1024),
      ).not.toThrow();
    });

    it("throws AttachmentRejectedError for disallowed extensions", () => {
      expect(() => scanner.validateAttachment("malware.exe", 1024)).toThrow(
        AttachmentRejectedError,
      );
      expect(() => scanner.validateAttachment("backdoor.sh", 1024)).toThrow(
        AttachmentRejectedError,
      );
      expect(() => scanner.validateAttachment("script.py", 1024)).toThrow(
        AttachmentRejectedError,
      );
      expect(() => scanner.validateAttachment("payload.bin", 1024)).toThrow(
        AttachmentRejectedError,
      );
    });
  });

  describe("Attachment size limits", () => {
    it("validates 5MB attachment passes within the 10MB default threshold", () => {
      const fiveMb = 5 * 1024 * 1024;
      expect(() =>
        scanner.validateAttachment("scan.pdf", fiveMb),
      ).not.toThrow();
    });

    it("validates exactly 10MB attachment passes", () => {
      const tenMb = 10 * 1024 * 1024;
      expect(() => scanner.validateAttachment("scan.pdf", tenMb)).not.toThrow();
    });

    it("throws AttachmentRejectedError when attachment exceeds 10MB threshold (15MB)", () => {
      const fifteenMb = 15 * 1024 * 1024;
      expect(() => scanner.validateAttachment("scan.pdf", fifteenMb)).toThrow(
        AttachmentRejectedError,
      );
    });
  });

  describe("Pre-upload SHA-256 calculation", () => {
    it("computes deterministic SHA-256 matching crypto standard", () => {
      const content = Buffer.from(
        "Forensic audit log content for integrity hash verification",
        "utf8",
      );
      const computed = scanner.computeSha256(content);
      const expected = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      expect(computed).toBe(expected);
      expect(computed).toHaveLength(64);
    });
  });

  describe("Post-upload verification", () => {
    it("passes verification when downloaded bytes match pre-upload SHA-256", () => {
      const originalBytes = Buffer.from(
        "Valid verified forensic archive data",
        "utf8",
      );
      const sha256 = scanner.computeSha256(originalBytes);

      const isValid = scanner.verifyPostUploadHash(sha256, originalBytes);
      expect(isValid).toBe(true);
    });

    it("throws AttachmentHashMismatchError when downloaded bytes are tampered or altered", () => {
      const originalBytes = Buffer.from(
        "Original untampered evidence bytes",
        "utf8",
      );
      const alteredBytes = Buffer.from(
        "Tampered modified evidence bytes",
        "utf8",
      );
      const originalSha256 = scanner.computeSha256(originalBytes);

      expect(() =>
        scanner.verifyPostUploadHash(originalSha256, alteredBytes),
      ).toThrow(AttachmentHashMismatchError);
    });
  });

  describe("Multimodal forensic scan (text attachment)", () => {
    it("scans text attachment and extracts IOCs (IP addresses, domains, hashes) and PII markers", async () => {
      const sampleText = [
        "INCIDENT INVESTIGATION LOG",
        "Connection from suspicious IP: 198.51.100.42 to external host 203.0.113.10.",
        "Observed DNS queries to exfiltrate.malicious-c2.net during breach window.",
        "Malware payload hash identified: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.",
        "Primary contact person: dpo.officer@acme-corp.com, Spanish ID: 12345678Z, Phone: (555) 234-5678.",
        "Reported by internal handler token: [REPORTANTE].",
        "System configuration verified: AES-256 encryption_proof confirmed on target volumes.",
      ].join("\n");

      const textBytes = Buffer.from(sampleText, "utf8");
      const result = await scanner.scanAttachment(
        "incident-analysis.txt",
        textBytes,
      );

      expect(result.ocr_text).toBe(sampleText);

      expect(result.iocs).toContain("198.51.100.42");
      expect(result.iocs).toContain("203.0.113.10");
      expect(result.iocs).toContain("exfiltrate.malicious-c2.net");
      expect(result.iocs).toContain(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      expect(result.visual_pii).toContain("dpo.officer@acme-corp.com");
      expect(result.visual_pii).toContain("12345678Z");
      expect(result.visual_pii).toContain("(555) 234-5678");
      expect(result.visual_pii).toContain("[REPORTANTE]");

      expect(result.encryption_proof_verified).toBe(true);
      expect(result.tamper_score).toBe(0.0);
    });

    it("scans visual attachment using modelProvider vision_json integration", async () => {
      const mockVisionResult = {
        ocr_text: "Visual scan OCR extracted text from document screenshot",
        iocs: ["192.0.2.1"],
        visual_pii: ["leaked_user@domain.com"],
        encryption_proof_verified: true,
        tamper_score: 0.05,
      };

      const mockModelProvider = {
        vision_json: vi.fn().mockResolvedValue(mockVisionResult),
      } as unknown as ModelProvider;

      const fakeImageBytes = Buffer.from("fake-png-binary-stream", "utf8");
      const result = await scanner.scanAttachment(
        "evidence-screenshot.png",
        fakeImageBytes,
        mockModelProvider,
      );

      expect(result.ocr_text).toBe(
        "Visual scan OCR extracted text from document screenshot",
      );
      expect(result.iocs).toContain("192.0.2.1");
      expect(result.visual_pii).toContain("leaked_user@domain.com");
      expect(result.encryption_proof_verified).toBe(true);
      expect(result.tamper_score).toBe(0.05);
    });
  });
});
