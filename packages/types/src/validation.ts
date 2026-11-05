import { z } from "zod";

export const ZodIssueDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string(),
});
export type ZodIssueDetail = z.infer<typeof ZodIssueDetailSchema>;

export function zodIssuesToDetails(error: z.ZodError): ZodIssueDetail[] {
  return error.issues.map((issue) => {
    const path =
      issue.path.length > 0
        ? issue.path.map((segment) => String(segment)).join(".")
        : "(root)";
    const message =
      issue.message.length > 0
        ? issue.message
        : `Validation failed with code: ${issue.code}`;

    return {
      path,
      message,
      code: issue.code,
    };
  });
}
