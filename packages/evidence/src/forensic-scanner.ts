import crypto from "node:crypto";
import {
  AttachmentHashMismatchError,
  AttachmentRejectedError,
} from "@pims/types/errors.ts";
import type { ForensicScanResult } from "@pims/types/evidence.ts";
import type { ModelProvider } from "@pims/types/models.ts";

export const ALLOWED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "tif",
  "bmp",
  "pdf",
  "doc",
  "docx",
  "txt",
] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

const VISUAL_EXTENSIONS = new Set(["jpg", "jpeg", "png", "tif", "bmp", "pdf"]);
const TEXT_DOC_EXTENSIONS = new Set(["doc", "docx", "txt"]);

const IPV4_REGEX =
  /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const DOMAIN_REGEX =
  /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/g;
const HASH_REGEX =
  /\b[a-fA-F0-9]{64}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{32}\b/g;

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DNI_NIE_REGEX = /\b[XYZxyz]?\d{7,8}[A-Za-z]\b/g;
const PHONE_REGEX =
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const PII_TOKEN_REGEX = /\[(?:REPORTANTE|CONTACTO|ID|SISTEMA|DESCRIPCION)\]/g;

const ENCRYPTION_PROOF_REGEX =
  /\b(?:AES-256|AES-GCM|encryption_proof|encrypted_at_rest|cifrado)\b/i;

export class ForensicScanner {
  readonly allowedExtensions = ALLOWED_EXTENSIONS;

  validateAttachment(fileName: string, bytes: number, maxSizeMb = 10): void {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext as AllowedExtension)) {
      throw new AttachmentRejectedError(`disallowed_extension:${ext}`);
    }

    const maxBytes = maxSizeMb * 1024 * 1024;
    if (bytes > maxBytes) {
      throw new AttachmentRejectedError(`oversized:${bytes}`);
    }
  }

  computeSha256(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  async scanAttachment(
    fileName: string,
    data: Buffer,
    modelProvider?: ModelProvider,
  ): Promise<ForensicScanResult> {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

    if (VISUAL_EXTENSIONS.has(ext)) {
      if (modelProvider) {
        const imageBase64 = data.toString("base64");
        const res = await (
          modelProvider as unknown as {
            vision_json: (
              args: Record<string, unknown>,
            ) => Promise<Record<string, unknown>>;
          }
        ).vision_json({
          prompt: "Forensic scan: OCR, IOCs, visual PII, encryption proof",
          image: imageBase64,
          system:
            "Forensic scanner: extract OCR, IOCs, visual PII, verify encryption proof",
          image_or_pdf_ref: imageBase64,
          json_schema: {
            type: "object",
            properties: {
              ocr_text: { type: "string" },
              iocs: { type: "array", items: { type: "string" } },
              visual_pii: { type: "array", items: { type: "string" } },
              encryption_proof_verified: { type: "boolean" },
              tamper_score: { type: "number" },
            },
          },
          max_tokens: 1000,
          temperature: 0.1,
        });

        const ocrText =
          typeof res.ocr_text === "string"
            ? res.ocr_text
            : typeof res.extracted_text_redacted === "string"
              ? res.extracted_text_redacted
              : "";

        const iocs = Array.isArray(res.iocs) ? (res.iocs as string[]) : [];

        const visualPii = Array.isArray(res.visual_pii)
          ? (res.visual_pii as string[])
          : Array.isArray(res.pii_detected)
            ? (res.pii_detected as string[])
            : [];

        const encryptionProof = Boolean(res.encryption_proof_verified);
        const tamperScore =
          typeof res.tamper_score === "number" ? res.tamper_score : 0.0;

        return {
          ocr_text: ocrText,
          iocs,
          visual_pii: visualPii,
          encryption_proof_verified: encryptionProof,
          tamper_score: Math.min(1, Math.max(0, tamperScore)),
        };
      }

      return {
        ocr_text: "",
        iocs: [],
        visual_pii: [],
        encryption_proof_verified: false,
        tamper_score: 0.0,
      };
    }

    if (TEXT_DOC_EXTENSIONS.has(ext)) {
      const text = data.toString("utf8");

      const ips = Array.from(text.match(IPV4_REGEX) ?? []);
      const domains = Array.from(text.match(DOMAIN_REGEX) ?? []);
      const hashes = Array.from(text.match(HASH_REGEX) ?? []);

      const filteredDomains = domains.filter((d) => !IPV4_REGEX.test(d));

      const iocs = Array.from(new Set([...ips, ...filteredDomains, ...hashes]));

      const emails = Array.from(text.match(EMAIL_REGEX) ?? []);
      const dnis = Array.from(text.match(DNI_NIE_REGEX) ?? []);
      const phones = Array.from(text.match(PHONE_REGEX) ?? []);
      const tokens = Array.from(text.match(PII_TOKEN_REGEX) ?? []);

      const visualPii = Array.from(
        new Set([...emails, ...dnis, ...phones, ...tokens]),
      );

      const encryptionProof = ENCRYPTION_PROOF_REGEX.test(text);

      return {
        ocr_text: text,
        iocs,
        visual_pii: visualPii,
        encryption_proof_verified: encryptionProof,
        tamper_score: 0.0,
      };
    }

    throw new AttachmentRejectedError(`disallowed_extension:${ext}`);
  }

  verifyPostUploadHash(
    preUploadSha256: string,
    downloadedBytes: Buffer,
  ): boolean {
    const downloadedSha256 = this.computeSha256(downloadedBytes);
    if (downloadedSha256 !== preUploadSha256) {
      throw new AttachmentHashMismatchError();
    }
    return true;
  }
}
