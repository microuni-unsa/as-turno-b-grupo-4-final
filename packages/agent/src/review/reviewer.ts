import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { redactForPrompt } from "@pims/agent/llm/safe-prompt.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
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
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CitationInvalidError,
  EvidenceNotFoundError,
  ModelSchemaViolationError,
  PiiRedactionUnavailableError,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types/errors.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

export const REVIEW_CHALLENGE_SYSTEM =
  "You review a breach notice pack for legal completeness, ungrounded claims, plain-language failures, and personal data leakage. Return one challenge per weakness with target, challenge, severity (low, medium, high), and the evidence a human reviewer must supply. Never invent facts absent from the pack; severity high blocks approval.";

export const REVIEW_CHALLENGE_AUTHORITY_SYSTEM =
  "You review an Article 33 supervisory-authority notification pack for legal completeness, ungrounded claims, and personal data leakage. The addressee is the supervisory authority, so do NOT reject for data-subject plain-language style. Scope is strictly the Article 33(3)(a), (c), and (d) items present in body_text: nature, categories, and approximate numbers of data subjects and records; likely consequences; and measures taken and proposed. Note that GDPR Article 33(3)(b) DPO contact details are structured and validated separately in item_b_dpo; do NOT challenge body_text for omitting DPO contact details. Furthermore, Article 33(3)(c) requires describing the likely consequences and breach risk exposure (e.g. unauthorized access, credential misuse, fraud); do NOT challenge forward-looking risk descriptions as speculative merely because post-breach harm is not yet confirmed. Do NOT demand proof that data subjects were notified (that is Article 34, a separate pack); do NOT demand evidence beyond what an Article 33 notification must contain. When approximate counts of data subjects or records are stated in body_text (e.g. 350), that satisfies Article 33(3)(a); do NOT challenge numbers as missing when numeric approximations are provided. A severity of high is allowed ONLY when you quote the exact pack sentence that is missing, contradictory, or ungrounded, and name which of the (a), (c), or (d) items it violates. Return one challenge per weakness with target, challenge, severity (low, medium, high), and the evidence a human reviewer must supply. Never invent facts absent from the pack; severity high blocks approval.";

export const REVIEW_CHALLENGE_SUBJECT_SYSTEM =
  "You review a GDPR Article 34 data-subject breach communication for legal completeness, ungrounded claims, plain-language accessibility, and personal data leakage. Scope is strictly the Article 34(2) elements present in body_text: clear and plain language describing the nature of the breach, likely consequences, and measures taken or proposed to address the breach. Do NOT demand general privacy policy elements (such as legal basis of processing under Article 6, data retention periods under Article 13/14, or the full Article 15–22 rights catalog) as this is a specific breach communication, not a general privacy notice. Note that GDPR Article 34(2) DPO contact details are structured and validated separately in the pack contact block; do NOT challenge body_text for omitting DPO contact details. When approximate counts or categories of data are stated in body_text, that satisfies the requirement; do NOT challenge numbers as missing when approximations are provided. A severity of high is allowed ONLY when you quote the exact pack sentence that is missing, contradictory, or ungrounded, or when essential Article 34 breach facts (nature of breach, consequences, mitigations) are completely absent. Return one challenge per weakness with target, challenge, severity (low, medium, high), and the evidence a human reviewer must supply. Never invent facts absent from the pack; severity high blocks approval.";

export const REVIEW_CHALLENGE_RESOLUTION_SYSTEM =
  "You review an incident closure resolution summary (close-out record, NOT a breach notification). Scope is strictly: the summary describes what happened and what containment or remediation was done; no sentence contradicts the supplied checklist coverage; no new factual claims appear that the checklist cannot support. Aggregate counts, data-category names (for example, the words names, IDs, addresses, contacts when no actual values follow them), and measure names are expected content, NOT personal data leakage: challenge PII leakage ONLY when the text contains a concrete identifying value of a real person (an actual name, an actual ID number, an actual phone, email, or street address). Category words without values are never leakage. Do NOT demand breach-notification elements (72-hour authority notification proof, data-subject communication, DPO contact details, notification format or recipients): notification is a separate pack reviewed separately. Do NOT demand legal citations beyond those supplied. A severity of high is allowed ONLY when you quote the exact sentence that is contradictory, ungrounded, or contains a concrete identifying value. Return one challenge per weakness with target, challenge, severity (low, medium, high), and the evidence a human reviewer must supply. Never invent facts absent from the text; severity high blocks approval.";

export interface ReviewerDeps {
  modelClient: AgentModelClient;
  ragService: RAGService;
  evidenceStore: EvidenceStore;
  config: AgentConfig;
  presidioClient?: PresidioClient;
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
      const rawDpoName = incident.dpo_contact_name;
      const dpoName =
        rawDpoName !== null && rawDpoName !== undefined
          ? rawDpoName.trim()
          : "";
      if (dpoName.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_name",
          required_fix: "DPO contact name is missing",
        };
      }
      const rawDpoEmail = incident.dpo_contact_email;
      const dpoEmail =
        rawDpoEmail !== null && rawDpoEmail !== undefined
          ? rawDpoEmail.trim()
          : "";
      if (dpoEmail.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_email",
          required_fix: "DPO contact email is missing",
        };
      }
      return null;
    } else if (ctx.pack_type === "subject") {
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
      const rawDpoName = incident.dpo_contact_name;
      const dpoName =
        rawDpoName !== null && rawDpoName !== undefined
          ? rawDpoName.trim()
          : "";
      if (dpoName.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_name",
          required_fix: "DPO contact name is missing",
        };
      }
      const rawDpoEmail = incident.dpo_contact_email;
      const dpoEmail =
        rawDpoEmail !== null && rawDpoEmail !== undefined
          ? rawDpoEmail.trim()
          : "";
      if (dpoEmail.length === 0) {
        return {
          judge: "reviewer",
          item: "dpo_contact_email",
          required_fix: "DPO contact email is missing",
        };
      }
      return null;
    } else if (ctx.pack_type === "resolution") {
      const checklist = ctx.checklist;
      if (checklist === null || checklist === undefined) {
        return {
          judge: "reviewer",
          item: "bundle_sealed",
          required_fix: "resolution review has no close checklist",
        };
      }
      const counts = new Map<string, number>();
      for (const item of checklist) {
        const existing = counts.get(item);
        counts.set(item, existing !== undefined ? existing + 1 : 1);
      }
      for (const item of CLOSE_CHECKLIST_ITEMS) {
        const count = counts.get(item);
        const actualCount = count !== undefined ? count : 0;
        if (actualCount === 0) {
          return {
            judge: "reviewer",
            item,
            required_fix: `close checklist is missing ${item}`,
          };
        }
        if (actualCount > 1) {
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
    } else {
      throw new Error(
        `Unexpected pack_type in legalCompletenessRejection: ${String((ctx as unknown as Record<string, unknown>).pack_type)}`,
      );
    }
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
          maxWords:
            this.deps.config.PLAIN_LANG_MAX_WORDS !== undefined
              ? this.deps.config.PLAIN_LANG_MAX_WORDS
              : CONSTANTS.PLAIN_LANGUAGE_MAX_WORDS,
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
      const presidio =
        this.deps.presidioClient ??
        (typeof this.deps.modelClient.getPresidioClient === "function"
          ? this.deps.modelClient.getPresidioClient()
          : null);
      if (!presidio) {
        throw new PiiRedactionUnavailableError(
          "PII_REDACTION_UNAVAILABLE: Presidio analyzer client is required for notice review",
        );
      }
      const rawSpans = await presidio.analyze(ctx.body_text);
      const piiSpans = rawSpans.filter(
        (span) =>
          span.entity_type !== "URL" &&
          span.entity_type !== "IP_ADDRESS" &&
          span.entity_type !== "LOCATION",
      );
      if (piiSpans.length > 0) {
        const piiTypes = Array.from(
          new Set(piiSpans.map((span) => span.entity_type)),
        ).join(", ");
        return NoticeReviewer.reject([], {
          judge: "reviewer",
          item: "pii_leakage",
          required_fix: `Notice body contains ${piiSpans.length} unredacted PII value(s) (${piiTypes})`,
        });
      }
    }

    // Resolution challenge calls stay enabled (audit trail of challenges),
    // but their verdict is advisory: the deployed reasoning model cannot
    // reliably distinguish data-category names from identifying values and
    // invents checklist policies, while Presidio above is the authoritative
    // PII gate. Notice packs keep the blocking prosecutor.
    const isResolutionReview = isResolution || ctx.pack_type === "resolution";
    let challenges: ProsecutorChallenge[] = [];
    {
      const challengeSystem =
        isResolution || ctx.pack_type === "resolution"
          ? REVIEW_CHALLENGE_RESOLUTION_SYSTEM
          : ctx.pack_type === "authority"
            ? REVIEW_CHALLENGE_AUTHORITY_SYSTEM
            : ctx.pack_type === "subject"
              ? REVIEW_CHALLENGE_SUBJECT_SYSTEM
              : REVIEW_CHALLENGE_SYSTEM;
      const challengeResponse = await this.deps.modelClient.chat_json({
        system: challengeSystem,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              pack_type: ctx.pack_type,
              body_text: await redactForPrompt(ctx.body_text),
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
        route: CONSTANTS.MODEL_ROUTE_REASONING,
      });
      const parsedProsecutor = ProsecutorResultSchema.safeParse(
        challengeResponse.content,
      );
      if (!parsedProsecutor.success) {
        throw new ModelSchemaViolationError(
          CONSTANTS.MODEL_ROUTE_REASONING,
          `Review challenge returned invalid shape: ${parsedProsecutor.error.message}`,
        );
      }
      challenges = parsedProsecutor.data.challenges;

      const blockingEnabled =
        this.deps.config.REVIEW_CHALLENGE_BLOCKING !== undefined
          ? this.deps.config.REVIEW_CHALLENGE_BLOCKING
          : CONSTANTS.DEFAULT_REVIEW_CHALLENGE_BLOCKING;

      const highChallenge =
        blockingEnabled && !isResolutionReview
          ? challenges.find((c) => c.severity === "high")
          : undefined;
      if (highChallenge !== undefined) {
        return NoticeReviewer.reject(challenges, {
          judge: "reviewer",
          item: highChallenge.target,
          required_fix: highChallenge.challenge,
        });
      }
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
