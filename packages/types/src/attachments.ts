import path from "node:path";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  AttachmentRejectedError,
  PathEscapeError,
} from "@pims/types/errors.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import { z } from "zod";

export type AllowedAttachmentExtension =
  (typeof CONSTANTS.ATTACHMENT_EXTENSIONS)[number];

export const AttachmentMetaSchema = z.object({
  fileName: z.string().min(1).max(CONSTANTS.MAX_FILENAME_LENGTH),
  bytes: z.number().int().nonnegative(),
});

export function isSafeFileName(fileName: string): boolean {
  for (let i = 0; i < fileName.length; i++) {
    const code = fileName.charCodeAt(i);
    if (code < 32 || code === 127) {
      return false;
    }
  }
  if (
    fileName === "" ||
    fileName === "." ||
    fileName === ".." ||
    fileName !== path.basename(fileName)
  ) {
    return false;
  }
  return true;
}

export function assertSafeFileName(fileName: string): string {
  if (!isSafeFileName(fileName)) {
    throw new PathEscapeError(fileName);
  }
  return fileName;
}

export function parseAttachmentExtension(
  fileName: string,
): AllowedAttachmentExtension {
  const safeName = assertSafeFileName(fileName);
  const ext = path.extname(safeName).slice(1).toLowerCase();
  if (
    !CONSTANTS.ATTACHMENT_EXTENSIONS.includes(ext as AllowedAttachmentExtension)
  ) {
    throw new AttachmentRejectedError(`disallowed_extension:${ext}`);
  }
  return ext as AllowedAttachmentExtension;
}

export function assertAttachmentMeta(
  fileName: string,
  bytes: number,
  maxSizeMb: number = CONSTANTS.MAX_ATTACHMENT_SIZE_MB,
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
