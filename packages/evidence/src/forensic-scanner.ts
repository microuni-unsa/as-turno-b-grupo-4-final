import crypto from "node:crypto";
import {
  decodeUtf8,
  extractIocs,
  extractPii,
} from "@pims/evidence/forensic-patterns.ts";
import {
  type AllowedAttachmentExtension,
  assertAttachmentMeta,
} from "@pims/types/attachments.ts";
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_TEXT_EXTENSIONS,
  ATTACHMENT_VISUAL_EXTENSIONS,
  ATTACHMENT_WORD_EXTENSIONS,
  MAX_ATTACHMENT_SIZE_MB,
} from "@pims/types/constants.ts";
import {
  AttachmentHashMismatchError,
  AttachmentRejectedError,
} from "@pims/types/errors.ts";
import {
  type ForensicScanResult,
  ForensicScanResultSchema,
} from "@pims/types/evidence.ts";
import type { JsonObject, ModelProvider } from "@pims/types/models.ts";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";

const DOC_OLE_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

const SIGNATURE_EXTENSIONS: Partial<
  Record<AllowedAttachmentExtension, string>
> = {
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
  tif: "tif",
  bmp: "bmp",
  pdf: "pdf",
  doc: "doc",
  docx: "docx",
};

const MIME_BY_EXTENSION: Record<AllowedAttachmentExtension, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  bmp: "image/bmp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

const VISION_JSON_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    extracted_text_redacted: { type: "string" },
    iocs: { type: "array", items: { type: "string" } },
    pii_detected: { type: "array", items: { type: "string" } },
    encryption_proof_verified: { type: "boolean" },
    tamper_score: { type: "number" },
    layout_hashes: { type: "array", items: { type: "string" } },
  },
  required: [
    "extracted_text_redacted",
    "iocs",
    "pii_detected",
    "encryption_proof_verified",
    "tamper_score",
    "layout_hashes",
  ],
  additionalProperties: false,
};

export class ForensicScanner {
  readonly allowedExtensions = ATTACHMENT_EXTENSIONS;

  validateAttachment(
    fileName: string,
    bytes: number,
    maxSizeMb = MAX_ATTACHMENT_SIZE_MB,
  ): void {
    assertAttachmentMeta(fileName, bytes, maxSizeMb);
  }

  computeSha256(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  async scanAttachment(
    fileName: string,
    data: Buffer,
    modelProvider?: ModelProvider,
  ): Promise<ForensicScanResult> {
    const ext = assertAttachmentMeta(
      fileName,
      data.length,
      MAX_ATTACHMENT_SIZE_MB,
    );

    if (ATTACHMENT_VISUAL_EXTENSIONS.has(ext)) {
      await this.assertContentSignature(ext, data);
      if (modelProvider === undefined) {
        throw new AttachmentRejectedError("vision_provider_required");
      }
      const vision = await modelProvider.vision_json({
        system:
          "Forensic scanner: extract OCR, IOCs, visual PII and tamper indicators from the supplied evidence.",
        image_or_pdf_ref: `data:${MIME_BY_EXTENSION[ext]};base64,${data.toString("base64")}`,
        prompt: "Forensic scan: OCR, IOCs, visual PII, tamper score",
        json_schema: VISION_JSON_SCHEMA,
        max_tokens: 1000,
        temperature: 0.1,
      });

      return ForensicScanResultSchema.parse({
        ocr_text: vision.extracted_text_redacted,
        iocs: vision.iocs,
        visual_pii: vision.pii_detected,
        encryption_proof_signal: vision.encryption_proof_verified,
        tamper_score: vision.tamper_score,
      });
    }

    const text = await this.extractText(ext, data);
    return ForensicScanResultSchema.parse({
      ocr_text: text,
      iocs: extractIocs(text),
      visual_pii: extractPii(text),
      encryption_proof_signal: false,
      tamper_score: 0,
    });
  }

  verifyPostUploadHash(
    preUploadSha256: string,
    downloadedBytes: Buffer,
  ): boolean {
    const downloadedSha256 = this.computeSha256(downloadedBytes);
    if (downloadedSha256 !== preUploadSha256.toLowerCase()) {
      throw new AttachmentHashMismatchError();
    }
    return true;
  }

  private async assertContentSignature(
    ext: AllowedAttachmentExtension,
    data: Buffer,
  ): Promise<void> {
    const expected = SIGNATURE_EXTENSIONS[ext];
    if (expected === undefined) {
      throw new AttachmentRejectedError(`no_signature_rule:${ext}`);
    }
    if (expected === "doc") {
      if (!data.subarray(0, DOC_OLE_MAGIC.length).equals(DOC_OLE_MAGIC)) {
        throw new AttachmentRejectedError("content_type_mismatch:doc");
      }
      return;
    }
    const detected = await fileTypeFromBuffer(data);
    if (detected === undefined || detected.ext !== expected) {
      throw new AttachmentRejectedError(
        `content_type_mismatch:${ext}:${detected?.ext ?? "unknown"}`,
      );
    }
  }

  private async extractText(
    ext: AllowedAttachmentExtension,
    data: Buffer,
  ): Promise<string> {
    if (ATTACHMENT_TEXT_EXTENSIONS.has(ext)) {
      return decodeUtf8(data);
    }
    if (!ATTACHMENT_WORD_EXTENSIONS.has(ext)) {
      throw new AttachmentRejectedError(`disallowed_extension:${ext}`);
    }

    await this.assertContentSignature(ext, data);

    let text: string;
    try {
      text =
        ext === "docx"
          ? (await mammoth.extractRawText({ buffer: data })).value
          : (await new WordExtractor().extract(data)).getBody();
    } catch {
      throw new AttachmentRejectedError(`no_extractable_text:${ext}`);
    }
    if (text.trim().length === 0) {
      throw new AttachmentRejectedError(`no_extractable_text:${ext}`);
    }
    return text;
  }
}
