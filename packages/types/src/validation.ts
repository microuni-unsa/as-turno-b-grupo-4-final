import type { JsonValue } from "@pims/types/models.ts";
import type { z } from "zod";

export function zodIssuesToDetails(error: z.ZodError): JsonValue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}
