import crypto from "node:crypto";
import {
  type PlainLanguageValidationOptions,
  PlainLanguageValidator,
} from "@pims/notices/plain-language.ts";
import {
  type Art34Exemption,
  ArtifactIncompleteError,
  type AuthorityNoticePack,
  AuthorityNoticePackSchema,
  type DpoContact,
  type HighRiskGateResult,
  HighRiskGateResultSchema,
  type SubjectNoticePack,
  SubjectNoticePackSchema,
  type SubjectNoticeState,
} from "@pims/types";

export type ComposeAuthorityPackParams = Omit<
  AuthorityNoticePack,
  "pack" | "pack_id" | "jurisdiction"
> & {
  pack_id?: string;
};

export interface EvaluateHighRiskGateParams {
  severity: string;
  impact: string;
  affectedDataTypes: string[];
  numAffectedSubjects: number;
  unencryptedExfiltration: boolean;
  authorityOrdered: boolean;
  reviewer: string;
}

export interface ComposeSubjectNoticeParams {
  incidentCode: string;
  lang?: "es" | "en";
  highRiskGate: HighRiskGateResult;
  exemption?: Art34Exemption | null;
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

export class NoticeComposer {
  composeAuthorityPack(
    params: ComposeAuthorityPackParams,
  ): AuthorityNoticePack {
    if (params.item_a_unknown.length > 0 && params.phased === false) {
      throw new ArtifactIncompleteError(
        "authority",
        "phased_required_when_unknown",
      );
    }

    if (
      params.submitted_at_utc !== null &&
      params.submitted_at_utc !== undefined
    ) {
      const submitted = new Date(params.submitted_at_utc).getTime();
      const deadline = new Date(params.deadline_at_utc).getTime();
      if (submitted > deadline) {
        if (
          !params.delay_reasons ||
          params.delay_reasons.reasons.length === 0
        ) {
          throw new ArtifactIncompleteError(
            "authority",
            "delay_reasons_required_when_late",
          );
        }
      }
    }

    const pack: AuthorityNoticePack = {
      ...params,
      pack: "authority",
      jurisdiction: "EU_GDPR",
      pack_id: params.pack_id ?? crypto.randomUUID(),
    };

    return AuthorityNoticePackSchema.parse(pack);
  }

  evaluateHighRiskGate(params: EvaluateHighRiskGateParams): HighRiskGateResult {
    const triggers: string[] = [];

    if (params.severity === "C") {
      triggers.push("severity:C");
    }
    if (params.impact === "V") {
      triggers.push("impact:V");
    }
    if (params.numAffectedSubjects >= 100) {
      triggers.push("num_affected_subjects>=100");
    }
    if (params.unencryptedExfiltration === true) {
      triggers.push("unencrypted_exfiltration");
    }
    if (params.authorityOrdered === true) {
      triggers.push("authority_ordered");
    }

    const sensitiveDataTypes = new Set([
      "sensitive",
      "health",
      "biometric",
      "minors",
      "financial",
      "credentials",
    ]);

    const hasSensitive = params.affectedDataTypes.some((dataType) =>
      sensitiveDataTypes.has(dataType.toLowerCase()),
    );
    if (hasSensitive) {
      triggers.push("sensitive_data_types");
    }

    const verdict = triggers.length > 0;
    const result: HighRiskGateResult = {
      verdict,
      triggers,
      determined_at_utc: new Date().toISOString(),
      reviewer: params.reviewer,
    };

    return HighRiskGateResultSchema.parse(result);
  }

  composeSubjectNotice(params: ComposeSubjectNoticeParams): SubjectNoticePack {
    if (!params.highRiskGate.verdict) {
      const notRequiredPack: SubjectNoticePack = {
        pack: "subject",
        pack_id: params.packId ?? crypto.randomUUID(),
        incident_code: params.incidentCode,
        lang: params.lang ?? "es",
        high_risk_gate: params.highRiskGate,
        exemption: null,
        body_plain: "",
        item_b_contact: params.contact,
        item_c_consequences: "",
        item_d_measures: [],
        recommendations: [],
        citations: [],
        review_approval_id: params.reviewApprovalId ?? null,
        state: "not_required",
      };
      return SubjectNoticePackSchema.parse(notRequiredPack);
    }

    if (params.exemption) {
      const exemptedPack: SubjectNoticePack = {
        pack: "subject",
        pack_id: params.packId ?? crypto.randomUUID(),
        incident_code: params.incidentCode,
        lang: params.lang ?? "es",
        high_risk_gate: params.highRiskGate,
        exemption: params.exemption,
        body_plain: params.bodyPlain,
        item_b_contact: params.contact,
        item_c_consequences: params.consequences,
        item_d_measures: params.measures,
        recommendations: params.recommendations,
        citations: params.citations,
        review_approval_id: params.reviewApprovalId ?? null,
        state: "exempted",
      };
      return SubjectNoticePackSchema.parse(exemptedPack);
    }

    PlainLanguageValidator.validate(params.bodyPlain, params.waivers);

    const pack: SubjectNoticePack = {
      pack: "subject",
      pack_id: params.packId ?? crypto.randomUUID(),
      incident_code: params.incidentCode,
      lang: params.lang ?? "es",
      high_risk_gate: params.highRiskGate,
      exemption: null,
      body_plain: params.bodyPlain,
      item_b_contact: params.contact,
      item_c_consequences: params.consequences,
      item_d_measures: params.measures,
      recommendations: params.recommendations,
      citations: params.citations,
      review_approval_id: params.reviewApprovalId ?? null,
      state: params.state ?? "draft",
    };

    return SubjectNoticePackSchema.parse(pack);
  }

  static composeAuthorityPack(
    params: ComposeAuthorityPackParams,
  ): AuthorityNoticePack {
    return new NoticeComposer().composeAuthorityPack(params);
  }

  static evaluateHighRiskGate(
    params: EvaluateHighRiskGateParams,
  ): HighRiskGateResult {
    return new NoticeComposer().evaluateHighRiskGate(params);
  }

  static composeSubjectNotice(
    params: ComposeSubjectNoticeParams,
  ): SubjectNoticePack {
    return new NoticeComposer().composeSubjectNotice(params);
  }
}
