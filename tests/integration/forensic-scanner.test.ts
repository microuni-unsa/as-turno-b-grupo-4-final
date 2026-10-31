import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModelConfig } from "@pims/config";
import { ForensicScanner } from "@pims/evidence";
import { OpenAIModelProvider } from "@pims/models";
import {
  AttachmentHashMismatchError,
  AttachmentRejectedError,
} from "@pims/types";
import { describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SENTINEL = "PIMS_FORENSIC_SENTINEL";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function readFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

const modelConfig: ModelConfig = {
  provider: "openai",
  model: "dummy",
  auth_env: "DUMMY",
  timeout_ms: 1000,
  max_retries: 0,
  fallback: "none",
};

function createProvider(): OpenAIModelProvider {
  return new OpenAIModelProvider({
    reasoningConfig: modelConfig,
    fastConfig: modelConfig,
    visionConfig: modelConfig,
    embeddingsConfig: modelConfig,
    rerankerConfig: modelConfig,
    apiKey: "test",
  });
}

describe("ForensicScanner Integration Suite", () => {
  const scanner = new ForensicScanner();

  describe("File extension allowlist", () => {
    it("accepts every allowlisted extension", () => {
      for (const fileName of [
        "scan.pdf",
        "image.png",
        "log.txt",
        "photo.jpg",
        "photo.jpeg",
        "scan.tif",
        "scan.bmp",
        "document.doc",
        "document.docx",
      ]) {
        expect(() => scanner.validateAttachment(fileName, 1024)).not.toThrow();
      }
    });

    it("rejects extensions outside the allowlist", () => {
      for (const fileName of [
        "malware.exe",
        "backdoor.sh",
        "script.py",
        "payload.bin",
        "archive.zip",
        "no-extension",
      ]) {
        expect(() => scanner.validateAttachment(fileName, 1024)).toThrow(
          AttachmentRejectedError,
        );
      }
    });
  });

  describe("Attachment size limits", () => {
    it("accepts exactly the 10MB ceiling and rejects one byte more", () => {
      const tenMb = 10 * 1024 * 1024;
      expect(() => scanner.validateAttachment("scan.pdf", tenMb)).not.toThrow();
      expect(() => scanner.validateAttachment("scan.pdf", tenMb + 1)).toThrow(
        AttachmentRejectedError,
      );
    });
  });

  describe("Pre-upload and post-upload hashing", () => {
    it("computes the standard SHA-256 digest", () => {
      const content = Buffer.from("Forensic audit log content", "utf8");
      const computed = scanner.computeSha256(content);
      const expected = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      expect(computed).toBe(expected);
      expect(computed).toHaveLength(64);
    });

    it("verifies matching bytes and normalises hex case", () => {
      const bytes = Buffer.from("Valid verified forensic archive data", "utf8");
      const sha256 = scanner.computeSha256(bytes);

      expect(scanner.verifyPostUploadHash(sha256, bytes)).toBe(true);
      expect(scanner.verifyPostUploadHash(sha256.toUpperCase(), bytes)).toBe(
        true,
      );
    });

    it("throws AttachmentHashMismatchError on altered bytes", () => {
      const original = Buffer.from("Original untampered evidence bytes");
      const altered = Buffer.from("Tampered modified evidence bytes");

      expect(() =>
        scanner.verifyPostUploadHash(scanner.computeSha256(original), altered),
      ).toThrow(AttachmentHashMismatchError);
    });
  });

  describe("Text attachment scanning", () => {
    const sampleText = [
      "INCIDENT INVESTIGATION LOG",
      "Connection from suspicious IP: 198.51.100.42 to external host 203.0.113.10.",
      "Observed DNS queries to exfiltrate.malicious-c2.net during breach window.",
      "Unresolved lookup for domain.unknown in local resolver cache.",
      "Malware payload hash identified: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.",
      "Primary contact person: dpo.officer@acme-corp.com, Spanish ID: 12345678Z, invalid ID: 00000000A, Phone: +1 213 373 4253.",
      "Reported by internal handler token: [REPORTANTE].",
      "System configuration verified: AES-256 encryption_proof confirmed on target volumes.",
    ].join("\n");

    it("extracts validated IOCs and PII markers", async () => {
      const result = await scanner.scanAttachment(
        "incident-analysis.txt",
        Buffer.from(sampleText, "utf8"),
      );

      expect(result.ocr_text).toBe(sampleText);

      expect(result.iocs).toContain("198.51.100.42");
      expect(result.iocs).toContain("203.0.113.10");
      expect(result.iocs).toContain("exfiltrate.malicious-c2.net");
      expect(result.iocs).toContain(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(result.iocs).not.toContain("domain.unknown");

      expect(result.visual_pii).toContain("dpo.officer@acme-corp.com");
      expect(result.visual_pii).toContain("12345678Z");
      expect(result.visual_pii).toContain("+12133734253");
      expect(result.visual_pii).toContain("[REPORTANTE]");
      expect(result.visual_pii).not.toContain("00000000A");

      expect(result.tamper_score).toBe(0);
    });

    it("never claims encryption proof from keywords in extracted text", async () => {
      const result = await scanner.scanAttachment(
        "log.txt",
        Buffer.from("AES-256 encryption_proof confirmed"),
      );

      expect(result.encryption_proof_signal).toBe(false);
    });

    it("rejects binary or invalid UTF-8 payloads labelled .txt", async () => {
      await expect(
        scanner.scanAttachment("binary.txt", Buffer.from([0xff, 0xfe, 0x00])),
      ).rejects.toThrow(AttachmentRejectedError);

      await expect(
        scanner.scanAttachment("nul.txt", Buffer.from("abc\u0000def")),
      ).rejects.toThrow(AttachmentRejectedError);
    });
  });

  describe("Word attachment parsing", () => {
    it("extracts sentinel text from .doc and .docx", async () => {
      for (const fileName of ["pims-sentinel.doc", "pims-sentinel.docx"]) {
        const result = await scanner.scanAttachment(
          fileName,
          readFixture(fileName),
        );
        expect(result.ocr_text).toContain(SENTINEL);
        expect(result.iocs).toContain("198.51.100.42");
        expect(result.encryption_proof_signal).toBe(false);
      }
    });

    it("rejects empty or non-parseable Word documents", async () => {
      for (const fileName of ["pims-empty.doc", "pims-empty.docx"]) {
        await expect(
          scanner.scanAttachment(fileName, readFixture(fileName)),
        ).rejects.toThrow(AttachmentRejectedError);
      }

      const oleMagic = Buffer.from([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      ]);
      await expect(
        scanner.scanAttachment(
          "broken.doc",
          Buffer.concat([oleMagic, Buffer.alloc(512)]),
        ),
      ).rejects.toThrow(AttachmentRejectedError);
    });
  });

  describe("Content signature verification", () => {
    it("rejects a .png that contains PDF bytes", async () => {
      try {
        await scanner.scanAttachment(
          "evidence-screenshot.png",
          readFixture("pims-sentinel.pdf"),
          createProvider(),
        );
        expect.unreachable("Should have thrown AttachmentRejectedError");
      } catch (err) {
        expect(err).toBeInstanceOf(AttachmentRejectedError);
        expect((err as AttachmentRejectedError).reason).toContain(
          "content_type_mismatch",
        );
      }
    });

    it("rejects a .docx that is not a zip container", async () => {
      await expect(
        scanner.scanAttachment(
          "notes.docx",
          Buffer.from("this is not a docx container"),
        ),
      ).rejects.toThrow(AttachmentRejectedError);
    });
  });

  describe("Visual attachment scanning", () => {
    it("requires a vision provider for images and PDFs", async () => {
      await expect(
        scanner.scanAttachment("evidence-screenshot.png", PNG_1X1),
      ).rejects.toThrow(AttachmentRejectedError);
    });

    it("maps a real provider vision response without heuristics", async () => {
      const provider = createProvider();
      const visionSpy = vi.spyOn(provider, "vision_json").mockResolvedValue({
        extracted_text_redacted: "Visual scan OCR extracted text",
        iocs: ["192.0.2.1"],
        pii_detected: ["leaked_user@domain.com"],
        encryption_proof_verified: true,
        tamper_score: 0.05,
        layout_hashes: ["sha256:layout-1", "sha256:layout-2"],
      });

      const result = await scanner.scanAttachment(
        "evidence-screenshot.png",
        PNG_1X1,
        provider,
      );

      expect(result).toEqual({
        ocr_text: "Visual scan OCR extracted text",
        iocs: ["192.0.2.1"],
        visual_pii: ["leaked_user@domain.com"],
        encryption_proof_signal: true,
        tamper_score: 0.05,
      });

      expect(visionSpy).toHaveBeenCalledTimes(1);
      const args = visionSpy.mock.calls[0]?.[0];
      expect(args?.image_or_pdf_ref).toBe(
        `data:image/png;base64,${PNG_1X1.toString("base64")}`,
      );
      expect(args?.json_schema).toBeDefined();
    });

    it("uses the PDF data URL for PDF evidence", async () => {
      const provider = createProvider();
      const pdfBytes = readFixture("pims-sentinel.pdf");
      const visionSpy = vi.spyOn(provider, "vision_json").mockResolvedValue({
        extracted_text_redacted: SENTINEL,
        iocs: [],
        pii_detected: [],
        encryption_proof_verified: false,
        tamper_score: 0,
        layout_hashes: [],
      });

      const result = await scanner.scanAttachment(
        "pims-sentinel.pdf",
        pdfBytes,
        provider,
      );

      expect(result.ocr_text).toBe(SENTINEL);
      expect(result.encryption_proof_signal).toBe(false);
      expect(visionSpy.mock.calls[0]?.[0].image_or_pdf_ref).toBe(
        `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
      );
    });
  });
});
