import crypto from "node:crypto";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import { CanonicalizationError } from "@pims/types/errors.ts";
import { type JsonValue, JsonValueSchema } from "@pims/types/models.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import { z } from "zod";

const ENVELOPE_KEYS_TO_STRIP = new Set([
  "state",
  "review_approval_id",
  "submitted_at_utc",
]);

const NoticeEnvelopeSchema = z.record(z.string(), JsonValueSchema);

export function hashCanonicalContent(obj: unknown): string {
  const parsed = NoticeEnvelopeSchema.safeParse(obj);
  if (!parsed.success) {
    throw new CanonicalizationError("Notice pack is not JSON-safe", {
      issues: zodIssuesToDetails(parsed.error),
    });
  }

  const projected: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (ENVELOPE_KEYS_TO_STRIP.has(key)) {
      continue;
    }
    projected[key] = value;
  }

  return crypto
    .createHash("sha256")
    .update(canonicalizeJson(projected), "utf8")
    .digest("hex");
}
