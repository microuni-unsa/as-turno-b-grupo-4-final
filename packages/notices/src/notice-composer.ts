import crypto from "node:crypto";
import { PlainLanguageValidator } from "@pims/notices/plain-language.ts";
import {
  type Art34Exemption,
  Art34ExemptionSchema,
  type AuthorityNoticePack,
  AuthorityNoticePackSchema,
  type DpoContact,
  type ExemptionEvaluationResult,
  type HighRiskGateInput,
  HighRiskGateInputSchema,
  type HighRiskGateResult,
  HighRiskGateResultSchema,
  isSensitiveAffectedDataType,
  type PlainLanguageValidationOptions,
  type SubjectNoticePack,
  SubjectNoticePackSchema,
  type SubjectNoticeState,
} from "@pims/types";
import {
  HIGH_RISK_SUBJECT_THRESHOLD,
  PLAIN_LANGUAGE_MAX_WORDS,
} from "@pims/types/constants.ts";
import {
  ArtifactIncompleteError,
  PimsValidationError,
} from "@pims/types/errors.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import { z } from "zod";

const AuthorityPackInputSchema = AuthorityNoticePackSchema.omit({
  pack: true,
  jurisdiction: true,
}).extend({ pack_id: z.string().uuid().optional() });

export type ComposeAuthorityPackParams = z.input<
  typeof AuthorityPackInputSchema
>;

export interface ComposeSubjectNoticeParams {
  incidentCode: string;
  lang?: "es" | "en";
  highRiskGate: HighRiskGateResult;
  exemptionEvaluation?: ExemptionEvaluationResult | null;
  bodyPlain: string;
  contact: DpoContact;
  consequences: string;
  measures: string[];
  recommendations: string[];
  citations: string[];
  reviewApprovalId?: string | null;
  state?: SubjectNoticeState;
  waivers?: PlainLanguageValidationOptions;
  packId?: string;
}

export interface NoticeComposerOptions {
  now?: () => Date;
  maxWords?: number;
}

export class NoticeComposer {
  private readonly now: () => Date;
  private readonly maxWords: number;

  constructor(options: NoticeComposerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxWords = options.maxWords ?? PLAIN_LANGUAGE_MAX_WORDS;
  }

  composeAuthorityPack(
    params: ComposeAuthorityPackParams,
  ): AuthorityNoticePack {
    const parsedInput = AuthorityPackInputSchema.safeParse(params);
    if (!parsedInput.success) {
      throw new PimsValidationError(
        "authority_pack",
        "Invalid authority notice pack input",
        { issues: zodIssuesToDetails(parsedInput.error) },
      );
    }
    const input = parsedInput.data;

    if (input.item_a_unknown.length > 0 && !input.phased) {
      throw new ArtifactIncompleteError(
        "authority",
        "phased_required_when_unknown",
      );
    }

    if (input.submitted_at_utc !== null) {
      const submitted = new Date(input.submitted_at_utc).getTime();
      const deadline = new Date(input.deadline_at_utc).getTime();
      if (submitted > deadline) {
        if (input.delay_reasons === null) {
          throw new ArtifactIncompleteError(
            "authority",
            "delay_reasons_required_when_late",
          );
        }
      }
    }

    const pack: AuthorityNoticePack = {
      ...input,
      pack: "authority",
      jurisdiction: "EU_GDPR",
      pack_id: input.pack_id ?? crypto.randomUUID(),
    };

    return AuthorityNoticePackSchema.parse(pack);
  }

  evaluateHighRiskGate(params: HighRiskGateInput): HighRiskGateResult {
    const parsed = HighRiskGateInputSchema.safeParse(params);
    if (!parsed.success) {
      throw new PimsValidationError(
        "high_risk_gate",
        "Invalid high risk gate input",
        { issues: zodIssuesToDetails(parsed.error) },
      );
    }
    const input = parsed.data;

    const triggers: HighRiskGateResult["triggers"] = [];
    if (input.severity === "C") {
      triggers.push("severity:C");
    }
    if (input.impact === "V") {
      triggers.push("impact:V");
    }
    if (input.affectedDataTypes.some(isSensitiveAffectedDataType)) {
      triggers.push("sensitive_data_types");
    }
    if (
      input.numAffectedSubjects !== null &&
      input.numAffectedSubjects >= HIGH_RISK_SUBJECT_THRESHOLD
    ) {
      triggers.push("num_affected_subjects>=100");
    }
    if (input.unencryptedExfiltration) {
      triggers.push("unencrypted_exfiltration");
    }
    if (input.authorityOrdered) {
      triggers.push("authority_ordered");
    }

    const result: HighRiskGateResult = {
      verdict: triggers.length > 0,
      triggers,
      determined_at_utc: this.now().toISOString(),
      reviewer: input.reviewer,
    };

    return HighRiskGateResultSchema.parse(result);
  }

  composeSubjectNotice(params: ComposeSubjectNoticeParams): SubjectNoticePack {
    const gate = HighRiskGateResultSchema.parse(params.highRiskGate);
    if (gate.verdict !== gate.triggers.length > 0) {
      throw new ArtifactIncompleteError(
        "subject",
        "high_risk_gate_inconsistent",
      );
    }

    const evaluation = params.exemptionEvaluation ?? null;
    const reviewApprovalId = params.reviewApprovalId ?? null;
    const lang = params.lang ?? "es";
    const packId = params.packId ?? crypto.randomUUID();

    if (!gate.verdict && evaluation?.kind === "exempted") {
      throw new ArtifactIncompleteError(
        "subject",
        "exemption_without_high_risk",
      );
    }

    if (params.waivers !== undefined && reviewApprovalId === null) {
      throw new ArtifactIncompleteError(
        "subject",
        "review_approval_required_for_waiver",
      );
    }

    if (!gate.verdict) {
      if (params.state !== undefined && params.state !== "not_required") {
        throw new ArtifactIncompleteError("subject", "state_inconsistent");
      }
      const notRequiredPack: SubjectNoticePack = {
        pack: "subject",
        pack_id: packId,
        incident_code: params.incidentCode,
        lang,
        high_risk_gate: gate,
        exemption: null,
        body_plain: "",
        item_b_contact: params.contact,
        item_c_consequences: "",
        item_d_measures: [],
        recommendations: [],
        citations: [],
        review_approval_id: reviewApprovalId,
        state: "not_required",
      };
      return SubjectNoticePackSchema.parse(notRequiredPack);
    }

    let exemption: Art34Exemption | null = null;
    let state: SubjectNoticeState;

    if (evaluation?.kind === "authority_override") {
      state = "draft";
    } else if (evaluation?.kind === "exempted") {
      const parsedExemption = Art34ExemptionSchema.safeParse(
        evaluation.exemption,
      );
      if (!parsedExemption.success) {
        throw new PimsValidationError(
          "subject.exemption",
          "Invalid Article 34(3) exemption",
          { issues: zodIssuesToDetails(parsedExemption.error) },
        );
      }
      const candidate = parsedExemption.data;
      if (candidate.letter === "c" && candidate.public_artifact === null) {
        throw new ArtifactIncompleteError(
          "subject",
          "exemption_public_artifact_required",
        );
      }
      if (candidate.letter !== "c" && candidate.public_artifact !== null) {
        throw new ArtifactIncompleteError(
          "subject",
          "exemption_public_artifact_forbidden",
        );
      }
      exemption = candidate;
      state = "exempted";
    } else {
      state = params.state ?? "draft";
      if (state === "exempted" || state === "not_required") {
        throw new ArtifactIncompleteError("subject", "state_inconsistent");
      }
    }

    if (state !== "exempted" && params.bodyPlain.trim().length === 0) {
      throw new ArtifactIncompleteError("subject", "body_plain_required");
    }

    PlainLanguageValidator.validate(params.bodyPlain, {
      ...params.waivers,
      locale: lang,
      maxWords: this.maxWords,
    });

    const pack: SubjectNoticePack = {
      pack: "subject",
      pack_id: packId,
      incident_code: params.incidentCode,
      lang,
      high_risk_gate: gate,
      exemption,
      body_plain: params.bodyPlain,
      item_b_contact: params.contact,
      item_c_consequences: params.consequences,
      item_d_measures: params.measures,
      recommendations: params.recommendations,
      citations: params.citations,
      review_approval_id: reviewApprovalId,
      state,
    };

    return SubjectNoticePackSchema.parse(pack);
  }

  static composeAuthorityPack(
    params: ComposeAuthorityPackParams,
  ): AuthorityNoticePack {
    return new NoticeComposer().composeAuthorityPack(params);
  }

  static evaluateHighRiskGate(params: HighRiskGateInput): HighRiskGateResult {
    return new NoticeComposer().evaluateHighRiskGate(params);
  }

  static composeSubjectNotice(
    params: ComposeSubjectNoticeParams,
  ): SubjectNoticePack {
    return new NoticeComposer().composeSubjectNotice(params);
  }
}
