import { CanonicalizationError } from "@pims/types/errors.ts";
import { JsonValueSchema } from "@pims/types/models.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import canonicalize from "canonicalize";

export function canonicalizeJson(value: unknown): string {
  const parsed = JsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new CanonicalizationError("Value is not JSON-safe", {
      issues: zodIssuesToDetails(parsed.error),
    });
  }
  const result = canonicalize(parsed.data);
  if (result === undefined) {
    throw new CanonicalizationError("Canonicalizer returned undefined");
  }
  return result;
}
