import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { redactForPrompt } from "@pims/agent/llm/safe-prompt.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { extractPii } from "@pims/evidence/forensic-patterns.ts";
import { PlainLanguageValidator } from "@pims/notices";
import type { RAGService } from "@pims/rag/rag-service.ts";
import {
  CitationEntailmentResultSchema,
  CLOSE_CHECKLIST_ITEMS,
  type ConstitutionalReviewResult,
  ConstitutionalReviewResultSchema,
  type JudgeName,
  type JudgeVerdict,
  type ProsecutorResult,
  ProsecutorResultSchema,
  type ReviewContext,
  type ReviewRejection,
} from "@pims/types/agent.ts";
import {
  MODEL_ROUTE_REASONING,
  PII_PHONE_REGIONS,
} from "@pims/types/constants.ts";
import {
  EvidenceNotFoundError,
  ModelSchemaViolationError,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import { findPhoneNumbersInText } from "libphonenumber-js";

export const PROSECUTOR_SYSTEM =
  "You are the adversarial prosecutor in the §6.3 constitutional review. Attack the notice pack for legal incompleteness, ungrounded claims, plain-language failures, and PII leakage. Return one challenge per weakness with target, challenge, severity, and the evidence a human reviewer must supply. Never invent facts that are absent from the pack; severity 'high' blocks approval.";

export const JUDGE_NLI_SYSTEM =
  "You are the citation entailment judge in the §6.3 constitutional review. For every citation, decide whether the cited passage entails the claims in the notice body. Return a score in [0,1], a boolean entailed flag, and the unsupported claims verbatim. Never accept a citation that does not support the claim it is attached to.";

const PROSECUTOR_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["challenges"],
  properties: {
    challenges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["target", "challenge", "severity", "evidence_required"],
        properties: {
          target: { type: "string" },
          challenge: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          evidence_required: { type: "string" },
        },
      },
    },
  },
};

const NLI_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["entailment"],
  properties: {
    entailment: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["citation", "score", "entailed", "unsupported_claims"],
        properties: {
          citation: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 1 },
          entailed: { type: "boolean" },
          unsupported_claims: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DNI_PATTERN = /(?<!\d)\d{8}(?!\d)/g;
const RUC_PATTERN = /(?<!\d)(?:10|15|17|20)\d{9}(?!\d)/g;
const SYLLABLE_PATTERN = /[aeiouáéíóúü]+/gi;

type PiiPattern = "email" | "phone" | "dni" | "ruc";

export interface ConstitutionalReviewerDeps {
  modelClient: AgentModelClient;
  ragService: RAGService;
  evidenceStore: EvidenceStore;
  config: AgentConfig;
  clock: () => Date;
}

function hasValidPhone(text: string): boolean {
  for (const region of PII_PHONE_REGIONS) {
    for (const match of findPhoneNumbersInText(text, region)) {
      if (match.number.isValid()) {
        return true;
      }
    }
  }
  return false;
}

function classifyPiiValue(value: string): PiiPattern {
  if (value.match(EMAIL_PATTERN)) {
    return "email";
  }
  if (hasValidPhone(value)) {
    return "phone";
  }
  if (value.match(RUC_PATTERN)) {
    return "ruc";
  }
  return "dni";
}

function detectForbiddenPii(text: string): PiiPattern | null {
  if (text.match(EMAIL_PATTERN)) {
    return "email";
  }
  if (hasValidPhone(text)) {
    return "phone";
  }
  if (text.match(DNI_PATTERN)) {
    return "dni";
  }
  if (text.match(RUC_PATTERN)) {
    return "ruc";
  }
  const extracted = extractPii(text);
  const first = extracted[0];
  if (first !== undefined) {
    return classifyPiiValue(first);
  }
  return null;
}

function countSyllables(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  let syllables = 0;
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) {
      continue;
    }
    const groups = part.segment.match(SYLLABLE_PATTERN);
    syllables += Math.max(1, groups?.length ?? 0);
  }
  return syllables;
}

function fleschKincaidGrade(body: string): number {
  const sentences = PlainLanguageValidator.splitSentences(body, "es").length;
  const words = PlainLanguageValidator.countWords(body);
  if (sentences === 0 || words === 0) {
    return 0;
  }
  const syllables = countSyllables(body);
  return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

function passedVerdict(
  judge: JudgeName,
  findings: string[],
  score: number | null,
): JudgeVerdict {
  return { judge, passed: true, findings, required_fix: null, score };
}

function failedVerdict(
  judge: JudgeName,
  findings: string[],
  requiredFix: string,
  score: number | null = null,
): JudgeVerdict {
  if (requiredFix.length === 0) {
    throw new ModelSchemaViolationError(
      MODEL_ROUTE_REASONING,
      `Judge ${judge} produced an empty required_fix`,
    );
  }
  return {
    judge,
    passed: false,
    findings,
    required_fix: requiredFix,
    score,
  };
}

function rejectionFor(verdict: JudgeVerdict): ReviewRejection {
  const fix = verdict.required_fix;
  if (fix === null) {
    throw new ModelSchemaViolationError(
      MODEL_ROUTE_REASONING,
      `Failed judge ${verdict.judge} did not name a required_fix`,
    );
  }
  return { judge: verdict.judge, item: fix, required_fix: fix };
}

export class ConstitutionalReviewer {
  private readonly modelClient: AgentModelClient;
  private readonly ragService: RAGService;
  private readonly evidenceStore: EvidenceStore;
  private readonly config: AgentConfig;
  private readonly clock: () => Date;

  constructor(deps: ConstitutionalReviewerDeps) {
    this.modelClient = deps.modelClient;
    this.ragService = deps.ragService;
    this.evidenceStore = deps.evidenceStore;
    this.config = deps.config;
    this.clock = deps.clock;
  }

  async review(
    ctx: ReviewContext,
    incident: PimsIncident,
  ): Promise<ConstitutionalReviewResult> {
    return this.run(ctx, incident, false);
  }

  async reviewResolution(
    ctx: ReviewContext,
    incident: PimsIncident,
  ): Promise<ConstitutionalReviewResult> {
    return this.run(ctx, incident, true);
  }

  private async run(
    ctx: ReviewContext,
    incident: PimsIncident,
    isResolution: boolean,
  ): Promise<ConstitutionalReviewResult> {
    const prosecutor = await this.prosecute(ctx);
    const highChallenge = prosecutor.challenges.find(
      (challenge) => challenge.severity === "high",
    );
    if (highChallenge) {
      return ConstitutionalReviewResultSchema.parse({
        approved: false,
        approval_id: null,
        judges: [],
        prosecutor,
        semantic_entropy: ctx.semantic_entropy,
        rejection: {
          judge: "prosecutor",
          item: highChallenge.target,
          required_fix: highChallenge.challenge,
        },
      });
    }

    const legalCompleteness = this.judgeLegalCompleteness(ctx, incident);
    const citationNli = await this.judgeCitationNli(ctx);
    const plainLanguage =
      isResolution && ctx.body_text.trim().length === 0
        ? passedVerdict("plain_language", ["resolution body is empty"], 0)
        : this.judgePlainLanguage(ctx);
    const piiEntropy = this.judgePiiSemanticEntropy(ctx);
    const judges: JudgeVerdict[] = [
      legalCompleteness,
      citationNli,
      plainLanguage,
      piiEntropy,
    ];

    const failed = judges.find((verdict) => !verdict.passed);
    if (failed) {
      return ConstitutionalReviewResultSchema.parse({
        approved: false,
        approval_id: null,
        judges,
        prosecutor,
        semantic_entropy: ctx.semantic_entropy,
        rejection: rejectionFor(failed),
      });
    }

    const approval = await this.evidenceStore.mintReviewApproval({
      incidentCode: ctx.incident_code,
      packType: ctx.pack_type,
      contentSha256: ctx.content_sha256,
      note: "constitutional rubric passed",
    });

    const packType = ctx.pack_type;
    if (!isResolution && packType !== "resolution") {
      const row = await this.evidenceStore.getDraftPack(
        ctx.incident_code,
        packType,
      );
      if (row === null) {
        throw new EvidenceNotFoundError("draft_pack", ctx.incident_code);
      }
      const terminalState =
        row.state === "not_required" || row.state === "exempted";
      if (terminalState) {
        await this.evidenceStore.saveDraftPack(
          ctx.incident_code,
          packType,
          row.payload,
          ctx.content_sha256,
          approval.approval_id,
          row.state === "not_required" ? "not_required" : "exempted",
        );
      } else {
        await this.evidenceStore.saveDraftPack(
          ctx.incident_code,
          packType,
          row.payload,
          ctx.content_sha256,
          approval.approval_id,
          "approved",
        );
      }
    }

    return ConstitutionalReviewResultSchema.parse({
      approved: true,
      approval_id: approval.approval_id,
      judges,
      prosecutor,
      semantic_entropy: ctx.semantic_entropy,
      rejection: null,
    });
  }

  private async prosecute(ctx: ReviewContext): Promise<ProsecutorResult> {
    const response = await this.modelClient.chat_json({
      route: MODEL_ROUTE_REASONING,
      system: PROSECUTOR_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            pack_type: ctx.pack_type,
            body: redactForPrompt(ctx.body_text),
            citations: ctx.citations,
            reviewed_at_utc: this.clock().toISOString(),
          }),
        },
      ],
      json_schema: PROSECUTOR_JSON_SCHEMA,
      max_tokens: 1200,
      temperature: this.config.TEMP_REASONING,
    });

    const parsed = ProsecutorResultSchema.safeParse(response.content);
    if (!parsed.success) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `Prosecutor returned invalid shape: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  private judgeLegalCompleteness(
    ctx: ReviewContext,
    incident: PimsIncident,
  ): JudgeVerdict {
    const findings: string[] = [];
    const body = ctx.body_text.trim();

    if (ctx.pack_type === "authority") {
      if (body.length === 0) {
        findings.push("authority body is empty");
        return failedVerdict("legal_completeness", findings, "body_text");
      }
      if (ctx.citations.length === 0) {
        findings.push("authority pack carries no citations");
        return failedVerdict("legal_completeness", findings, "citations");
      }
      const dpoName = (incident.dpo_contact_name ?? "").trim();
      const dpoEmail = (incident.dpo_contact_email ?? "").trim();
      if (dpoName.length === 0) {
        findings.push("DPO contact name is missing");
        return failedVerdict(
          "legal_completeness",
          findings,
          "dpo_contact_name",
        );
      }
      if (dpoEmail.length === 0) {
        findings.push("DPO contact email is missing");
        return failedVerdict(
          "legal_completeness",
          findings,
          "dpo_contact_email",
        );
      }
      return passedVerdict("legal_completeness", findings, null);
    }

    if (ctx.pack_type === "subject") {
      if (body.length === 0) {
        return passedVerdict(
          "legal_completeness",
          ["subject notice is not required or exempted"],
          null,
        );
      }
      if (ctx.citations.length === 0) {
        findings.push("subject pack carries no citations");
        return failedVerdict("legal_completeness", findings, "citations");
      }
      const dpoName = (incident.dpo_contact_name ?? "").trim();
      const dpoEmail = (incident.dpo_contact_email ?? "").trim();
      if (dpoName.length === 0) {
        findings.push("DPO contact name is missing");
        return failedVerdict(
          "legal_completeness",
          findings,
          "dpo_contact_name",
        );
      }
      if (dpoEmail.length === 0) {
        findings.push("DPO contact email is missing");
        return failedVerdict(
          "legal_completeness",
          findings,
          "dpo_contact_email",
        );
      }
      return passedVerdict("legal_completeness", findings, null);
    }

    const checklist = ctx.checklist;
    if (checklist === null) {
      findings.push("resolution review has no close checklist");
      return failedVerdict("legal_completeness", findings, "bundle_sealed");
    }
    const counts = new Map<string, number>();
    for (const item of checklist) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    for (const item of CLOSE_CHECKLIST_ITEMS) {
      const count = counts.get(item) ?? 0;
      if (count === 0) {
        findings.push(`close checklist is missing ${item}`);
        return failedVerdict("legal_completeness", findings, item);
      }
      if (count > 1) {
        findings.push(`close checklist repeats ${item}`);
        return failedVerdict("legal_completeness", findings, item);
      }
    }
    for (const item of checklist) {
      if (!CLOSE_CHECKLIST_ITEMS.includes(item)) {
        findings.push(`close checklist contains unknown item ${item}`);
        return failedVerdict("legal_completeness", findings, item);
      }
    }
    return passedVerdict("legal_completeness", findings, null);
  }

  private async judgeCitationNli(ctx: ReviewContext): Promise<JudgeVerdict> {
    const citationPayload = ctx.citations.map((citation) => ({
      citation,
      passage_text: this.ragService.getPassageByCitation(citation).passage.text,
    }));

    const response = await this.modelClient.chat_json({
      route: MODEL_ROUTE_REASONING,
      system: JUDGE_NLI_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            claims: redactForPrompt(ctx.body_text),
            citations: citationPayload,
          }),
        },
      ],
      json_schema: NLI_JSON_SCHEMA,
      max_tokens: 1500,
      temperature: this.config.TEMP_REASONING,
    });

    const parsed = CitationEntailmentResultSchema.safeParse(response.content);
    if (!parsed.success) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `Citation NLI judge returned invalid shape: ${parsed.error.message}`,
      );
    }

    const byCitation = new Map(
      parsed.data.entailment.map((entry) => [entry.citation, entry]),
    );

    for (const citation of ctx.citations) {
      const entry = byCitation.get(citation);
      if (entry === undefined) {
        return failedVerdict(
          "citation_nli",
          [`NLI response omits citation ${citation}`],
          citation,
          0,
        );
      }
      if (!entry.entailed || entry.score < this.config.NLI_ENTAILMENT_MIN) {
        return failedVerdict(
          "citation_nli",
          [
            `citation ${citation} score ${entry.score} below minimum ${this.config.NLI_ENTAILMENT_MIN}`,
            ...entry.unsupported_claims,
          ],
          citation,
          entry.score,
        );
      }
    }

    return passedVerdict("citation_nli", [], null);
  }

  private judgePlainLanguage(ctx: ReviewContext): JudgeVerdict {
    const score = fleschKincaidGrade(ctx.body_text);
    try {
      PlainLanguageValidator.validate(ctx.body_text, {
        locale: "es",
        maxWords: this.config.PLAIN_LANG_MAX_WORDS,
        numericApprovals: ctx.numeric_approvals,
        ...(ctx.plain_language_waiver === null
          ? {}
          : { plainLanguageWaiver: ctx.plain_language_waiver }),
      });
    } catch (error: unknown) {
      if (
        error instanceof PlainLanguageViolationError ||
        error instanceof SubjectCountForbiddenError
      ) {
        return failedVerdict(
          "plain_language",
          [error.message],
          error.code,
          score,
        );
      }
      throw error;
    }
    return passedVerdict("plain_language", [], score);
  }

  private judgePiiSemanticEntropy(ctx: ReviewContext): JudgeVerdict {
    if (ctx.body_text.trim() === "" && ctx.pack_type !== "resolution") {
      return passedVerdict(
        "pii_semantic_entropy",
        ["no synthesized text to scan"],
        0,
      );
    }

    const piiPattern = detectForbiddenPii(ctx.body_text);
    if (piiPattern !== null) {
      return failedVerdict(
        "pii_semantic_entropy",
        [`notice body contains ${piiPattern} pattern`],
        `pii:${piiPattern}`,
        ctx.semantic_entropy,
      );
    }

    if (ctx.semantic_entropy === null) {
      return failedVerdict(
        "pii_semantic_entropy",
        ["semantic entropy is unavailable"],
        "semantic_entropy_missing",
        null,
      );
    }

    if (ctx.semantic_entropy > this.config.MAX_SEMANTIC_ENTROPY) {
      return failedVerdict(
        "pii_semantic_entropy",
        [
          `semantic entropy ${ctx.semantic_entropy} exceeds ${this.config.MAX_SEMANTIC_ENTROPY}`,
        ],
        "semantic_entropy_high",
        ctx.semantic_entropy,
      );
    }

    return passedVerdict("pii_semantic_entropy", [], ctx.semantic_entropy);
  }
}
