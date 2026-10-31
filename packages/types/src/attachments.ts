import path from "node:path";
import {
  ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_SIZE_MB,
} from "@pims/types/constants.ts";
import {
  AttachmentRejectedError,
  PathEscapeError,
} from "@pims/types/errors.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import { z } from "zod";

export type AllowedAttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

export const AttachmentMetaSchema = z.object({
  fileName: z.string().min(1).max(255),
  bytes: z.number().int().nonnegative(),
});

export function assertSafeFileName(fileName: string): string {
  const hasControl = Array.from(fileName).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  if (
    fileName === "" ||
    fileName === "." ||
    fileName === ".." ||
    fileName !== path.basename(fileName) ||
    hasControl
  ) {
    throw new PathEscapeError(fileName);
  }
  return fileName;
}

export function parseAttachmentExtension(
  fileName: string,
): AllowedAttachmentExtension {
  const safeName = assertSafeFileName(fileName);
  const ext = path.extname(safeName).slice(1).toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.includes(ext as AllowedAttachmentExtension)) {
    throw new AttachmentRejectedError(`disallowed_extension:${ext}`);
  }
  return ext as AllowedAttachmentExtension;
}

export function assertAttachmentMeta(
  fileName: string,
  bytes: number,
  maxSizeMb: number = MAX_ATTACHMENT_SIZE_MB,
): AllowedAttachmentExtension {
  const meta = AttachmentMetaSchema.safeParse({ fileName, bytes });
  if (!meta.success) {
    throw new AttachmentRejectedError("invalid_metadata", {
      issues: zodIssuesToDetails(meta.error),
    });
  }
  if (!Number.isInteger(maxSizeMb) || maxSizeMb <= 0) {
    throw new AttachmentRejectedError(`invalid_max_size:${maxSizeMb}`);
  }
  const ext = parseAttachmentExtension(meta.data.fileName);
  if (meta.data.bytes > maxSizeMb * 1024 * 1024) {
    throw new AttachmentRejectedError(`oversized:${meta.data.bytes}`);
  }
  return ext;
}

export const StorageSegmentSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export function parseStorageSegment(value: string, field: string): string {
  const parsed = StorageSegmentSchema.safeParse(value);
  if (!parsed.success) {
    throw new PathEscapeError(`${field}:${value}`);
  }
  return parsed.data;
}
