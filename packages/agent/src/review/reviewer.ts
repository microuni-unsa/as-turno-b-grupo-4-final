import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { redactForPrompt } from "@pims/agent/llm/safe-prompt.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { extractPii } from "@pims/evidence/forensic-patterns.ts";
import { PlainLanguageValidator } from "@pims/notices/plain-language.ts";
import type { RAGService } from "@pims/rag";
import type {
  ProsecutorChallenge,
  ReviewContext,
  ReviewRejection,
  ReviewResult,
} from "@pims/types/agent.ts";
import {
  CLOSE_CHECKLIST_ITEMS,
  ProsecutorResultSchema,
  ReviewResultSchema,
} from "@pims/types/agent.ts";
import { MODEL_ROUTE_REASONING } from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CitationInvalidError,
  EvidenceNotFoundError,
  ModelSchemaViolationError,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types/errors.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

export const REVIEW_CHALLENGE_SYSTEM =
  "You review a breach notice pack for legal completeness, ungrounded claims, plain-language failures, and personal data leakage. Return one challenge per weakness with target, challenge, severity (low, medium, high), and the evidence a human reviewer must supply. Never invent facts absent from the pack; severity high blocks approval.";

export const REVIEW_CHALLENGE_AUTHORITY_SYSTEM =
  "You review an Article 33 supervisory-authority notification pack for legal completeness, ungrounded claims, and personal data leakage. The addressee is the supervisory authority, so do NOT reject for data-subject plain-language style. Return one challenge per weakness with target, challenge, severity (low, medium, high), and the evidence a human reviewer must supply. Never invent facts absent from the pack; severity high blocks approval.";

export interface ReviewerDeps {
  modelClient: AgentModelClient;
  ragService: RAGService;
  evidenceStore: EvidenceStore;
  config: AgentConfig;
}

export class NoticeReviewer {
  constructor(private readonly deps: ReviewerDeps) {}

  async review(
    ctx: ReviewContext,
    incident: PimsIncident,
  ): Promise<ReviewResult> {
    return this.run(ctx, incident, false);
  }

  async reviewResolution(
    ctx: ReviewContext,
    incident: PimsIncident,
  ): Promise<ReviewResult> {
    return this.run(ctx, incident, true);
  }

  private static reject(
    challenges: ProsecutorChallenge[],
    rejection: ReviewRejection,
  ): ReviewResult {
    return ReviewResultSchema.parse({
      approved: false,
      approval_id: null,
      challenges,
      rejection,
    });
  }

  private static legalCompletenessRejection(
    ctx: ReviewContext,
    incident: PimsIncident,
  ): ReviewRejection | null {
    const body = ctx.body_text.trim();

    if (ctx.pack_type === "authority") {
      if (body.length === 0) {
        return {
          judge: "reviewer",
          item: "body_text",
          required_fix: "authority body is empty",
        };
      }
      if (ctx.citations.length === 0) {
        return {
          judge: "reviewer",
          item: "citations",
          required_fix: "authority pack carries no citations",
        };
      }
      const dpoName = (incident.dpo_contact_name ?? "").trim();
      if (dpoName.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_name",
          required_fix: "DPO contact name is missing",
        };
      }
      const dpoEmail = (incident.dpo_contact_email ?? "").trim();
      if (dpoEmail.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_email",
          required_fix: "DPO contact email is missing",
        };
      }
      return null;
    }

    if (ctx.pack_type === "subject") {
      if (body.length === 0) {
        return null;
      }
      if (ctx.citations.length === 0) {
        return {
          judge: "reviewer",
          item: "citations",
          required_fix: "subject pack carries no citations",
        };
      }
      const dpoName = (incident.dpo_contact_name ?? "").trim();
      if (dpoName.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_name",
          required_fix: "DPO contact name is missing",
        };
      }
      const dpoEmail = (incident.dpo_contact_email ?? "").trim();
      if (dpoEmail.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_email",
          required_fix: "DPO contact email is missing",
        };
      }
      return null;
    }

    const checklist = ctx.checklist;
    if (checklist === null) {
      return {
        judge: "reviewer",
        item: "bundle_sealed",
        required_fix: "resolution review has no close checklist",
      };
    }
    const counts = new Map<string, number>();
    for (const item of checklist) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    for (const item of CLOSE_CHECKLIST_ITEMS) {
      const count = counts.get(item) ?? 0;
      if (count === 0) {
        return {
          judge: "reviewer",
          item,
          required_fix: `close checklist is missing ${item}`,
        };
      }
      if (count > 1) {
        return {
          judge: "reviewer",
          item,
          required_fix: `close checklist repeats ${item}`,
        };
      }
    }
    for (const item of checklist) {
      if (!CLOSE_CHECKLIST_ITEMS.includes(item)) {
        return {
          judge: "reviewer",
          item,
          required_fix: `close checklist contains unknown item ${item}`,
        };
      }
    }
    return null;
  }

  private async run(
    ctx: ReviewContext,
    incident: PimsIncident,
    isResolution: boolean,
  ): Promise<ReviewResult> {
    const legalRejection = NoticeReviewer.legalCompletenessRejection(
      ctx,
      incident,
    );
    if (legalRejection !== null) {
      return NoticeReviewer.reject([], legalRejection);
    }

    for (const citation of ctx.citations) {
      try {
        this.deps.ragService.validateCitation(citation, true);
      } catch (err: unknown) {
        if (
          err instanceof CitationInvalidError ||
          err instanceof CitationFabricatedError
        ) {
          return NoticeReviewer.reject([], {
            judge: "reviewer",
            item: citation,
            required_fix: err.message,
          });
        }
        throw err;
      }
    }

    if (ctx.body_text.trim().length > 0 && ctx.pack_type !== "authority") {
      try {
        PlainLanguageValidator.validate(ctx.body_text, {
          locale: "es",
          maxWords: this.deps.config.PLAIN_LANG_MAX_WORDS,
          numericApprovals: ctx.numeric_approvals,
          ...(ctx.plain_language_waiver === null
            ? {}
            : { plainLanguageWaiver: ctx.plain_language_waiver }),
        });
      } catch (err: unknown) {
        if (
          err instanceof PlainLanguageViolationError ||
          err instanceof SubjectCountForbiddenError
        ) {
          return NoticeReviewer.reject([], {
            judge: "reviewer",
            item: err.code,
            required_fix: err.message,
          });
        }
        throw err;
      }
    }

    if (ctx.body_text.trim().length > 0) {
      const pii = extractPii(ctx.body_text);
      if (pii.length > 0) {
        return NoticeReviewer.reject([], {
          judge: "reviewer",
          item: "pii_leakage",
          required_fix: `Notice body contains ${pii.length} unredacted PII value(s)`,
        });
      }
    }

    const challengeSystem =
      ctx.pack_type === "authority"
        ? REVIEW_CHALLENGE_AUTHORITY_SYSTEM
        : REVIEW_CHALLENGE_SYSTEM;
    const challengeResponse = await this.deps.modelClient.chat_json({
      system: challengeSystem,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            pack_type: ctx.pack_type,
            body_text: redactForPrompt(ctx.body_text),
            citations: ctx.citations,
            incident_code: ctx.incident_code,
          }),
        },
      ],
      json_schema: {
        type: "object",
        properties: {
          challenges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                target: { type: "string" },
                challenge: { type: "string" },
                severity: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
                evidence_required: { type: "string" },
              },
              required: [
                "target",
                "challenge",
                "severity",
                "evidence_required",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["challenges"],
        additionalProperties: false,
      },
      max_tokens: 2500,
      temperature: this.deps.config.TEMP_REASONING,
      route: MODEL_ROUTE_REASONING,
    });
    const parsedProsecutor = ProsecutorResultSchema.safeParse(
      challengeResponse.content,
    );
    if (!parsedProsecutor.success) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `Review challenge returned invalid shape: ${parsedProsecutor.error.message}`,
      );
    }
    const challenges = parsedProsecutor.data.challenges;

    const highChallenge = this.deps.config.REVIEW_CHALLENGE_BLOCKING
      ? challenges.find((c) => c.severity === "high")
      : undefined;
    if (highChallenge) {
      return NoticeReviewer.reject(challenges, {
        judge: "reviewer",
        item: highChallenge.target,
        required_fix: highChallenge.challenge,
      });
    }

    const approval = await this.deps.evidenceStore.mintReviewApproval({
      incidentCode: ctx.incident_code,
      packType: ctx.pack_type,
      contentSha256: ctx.content_sha256,
      note: "reviewer rubric passed",
    });

    const packType = ctx.pack_type;
    if (!isResolution && packType !== "resolution") {
      const row = await this.deps.evidenceStore.getDraftPack(
        ctx.incident_code,
        packType,
      );
      if (row === null) {
        throw new EvidenceNotFoundError("draft_pack", ctx.incident_code);
      }
      const terminalState =
        row.state === "not_required" || row.state === "exempted";
      if (terminalState) {
        await this.deps.evidenceStore.saveDraftPack(
          ctx.incident_code,
          packType,
          row.payload,
          ctx.content_sha256,
          approval.approval_id,
          row.state === "not_required" ? "not_required" : "exempted",
        );
      } else {
        await this.deps.evidenceStore.saveDraftPack(
          ctx.incident_code,
          packType,
          row.payload,
          ctx.content_sha256,
          approval.approval_id,
          "approved",
        );
      }
    }

    return ReviewResultSchema.parse({
      approved: true,
      approval_id: approval.approval_id,
      challenges,
      rejection: null,
    });
  }
}
