import { hashCanonicalContent, NoticeComposer } from "@pims/notices";
import {
  ArtifactIncompleteError,
  AuthorityNoticePackSchema,
  type DpoContact,
  type HighRiskGateResult,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
  SubjectNoticePackSchema,
} from "@pims/types";
import { describe, expect, it } from "vitest";

describe("Notice Composer (GDPR Art 33 Authority Pack & Art 34 Subject Notice)", () => {
  const sampleDpoContact: DpoContact = {
    name: "Oficina del DPO",
    email: "dpo@example.com",
    phone: "+34910000000",
  };

  const sampleHighRiskGatePass: HighRiskGateResult = {
    verdict: true,
    triggers: ["severity:C"],
    determined_at_utc: "2026-10-30T12:00:00.000Z",
    reviewer: "sec-auditor-1",
  };

  const sampleHighRiskGateFail: HighRiskGateResult = {
    verdict: false,
    triggers: [],
    determined_at_utc: "2026-10-30T12:00:00.000Z",
    reviewer: "sec-auditor-1",
  };

  describe("composeAuthorityPack", () => {
    const baseAuthorityParams = {
      incident_code: "INC-2026-001",
      awareness_at_utc: "2026-10-30T10:00:00.000Z",
      deadline_at_utc: "2026-11-02T10:00:00.000Z",
      submitted_at_utc: "2026-10-31T08:00:00.000Z",
      delay_reasons: null,
      phased: false,
      phases_planned: 1,
      item_a_nature: "Confidentiality breach affecting CRM export table.",
      item_a_categories_subjects: ["employees", "customers"],
      item_a_approx_subjects: 50,
      item_a_categories_records: ["contact_details"],
      item_a_approx_records: 120,
      item_a_unknown: [],
      item_b_dpo: sampleDpoContact,
      item_c_consequences: "Possible unsolicited marketing communications.",
      item_d_measures_taken: ["Credentials revoked", "IP blacklisted"],
      item_d_measures_proposed: ["Mandatory 2FA rollout"],
      citations: ["Art. 33(3)(a)", "Art. 33(3)(b)"],
      review_approval_id: "00000000-0000-0000-0000-000000000001",
      state: "draft" as const,
    };

    it("generates a valid pack matching AuthorityNoticePackSchema with pack='authority' and jurisdiction='EU_GDPR'", () => {
      const composer = new NoticeComposer();
      const pack = composer.composeAuthorityPack(baseAuthorityParams);

      expect(pack.pack).toBe("authority");
      expect(pack.jurisdiction).toBe("EU_GDPR");
      expect(pack.pack_id).toBeDefined();

      const parsed = AuthorityNoticePackSchema.safeParse(pack);
      expect(parsed.success).toBe(true);

      const staticPack =
        NoticeComposer.composeAuthorityPack(baseAuthorityParams);
      expect(staticPack.incident_code).toBe(baseAuthorityParams.incident_code);
    });

    it("throws ArtifactIncompleteError when item_a_unknown is non-empty but phased is false", () => {
      const paramsWithUnknown = {
        ...baseAuthorityParams,
        phased: false,
        item_a_unknown: [
          {
            item: "approx_records",
            reason: "Forensic analysis of binary logs in progress",
          },
        ],
      };

      const composer = new NoticeComposer();
      expect(() => composer.composeAuthorityPack(paramsWithUnknown)).toThrow(
        ArtifactIncompleteError,
      );

      try {
        composer.composeAuthorityPack(paramsWithUnknown);
        expect.unreachable("Should have thrown ArtifactIncompleteError");
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactIncompleteError);
        const error = err as ArtifactIncompleteError;
        expect(error.artifact).toBe("authority");
        expect(error.field).toBe("phased_required_when_unknown");
        expect(error.code).toBe(
          "ARTIFACT_INCOMPLETE:authority:phased_required_when_unknown",
        );
      }
    });

    it("passes when item_a_unknown is non-empty and phased is true", () => {
      const paramsPhased = {
        ...baseAuthorityParams,
        phased: true,
        phases_planned: 2,
        item_a_unknown: [
          {
            item: "approx_records",
            reason: "Forensic analysis in progress",
          },
        ],
      };

      const pack = NoticeComposer.composeAuthorityPack(paramsPhased);
      expect(pack.phased).toBe(true);
      expect(pack.item_a_unknown).toHaveLength(1);
    });

    it("throws ArtifactIncompleteError when submitted_at_utc > deadline_at_utc and delay_reasons is null or empty", () => {
      const lateParams = {
        ...baseAuthorityParams,
        deadline_at_utc: "2026-10-31T10:00:00.000Z",
        submitted_at_utc: "2026-11-01T14:00:00.000Z",
        delay_reasons: null,
      };

      const composer = new NoticeComposer();
      expect(() => composer.composeAuthorityPack(lateParams)).toThrow(
        ArtifactIncompleteError,
      );

      try {
        composer.composeAuthorityPack(lateParams);
        expect.unreachable("Should have thrown ArtifactIncompleteError");
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactIncompleteError);
        const error = err as ArtifactIncompleteError;
        expect(error.artifact).toBe("authority");
        expect(error.field).toBe("delay_reasons_required_when_late");
      }
    });

    it("passes validation when submitted_at_utc > deadline_at_utc with valid delay_reasons", () => {
      const lateParamsWithReasons = {
        ...baseAuthorityParams,
        deadline_at_utc: "2026-10-31T10:00:00.000Z",
        submitted_at_utc: "2026-11-01T14:00:00.000Z",
        delay_reasons: {
          hours_late: 28,
          reasons: [
            "Forensic extraction from encrypted volumes required specialized cryptographic recovery.",
          ],
        },
      };

      const pack = NoticeComposer.composeAuthorityPack(lateParamsWithReasons);
      expect(pack.delay_reasons?.hours_late).toBe(28);
      expect(pack.delay_reasons?.reasons).toHaveLength(1);
    });
  });

  describe("Canonical Content Hashing (hashCanonicalContent)", () => {
    const canonicalBasePack = {
      incident_code: "INC-2026-001",
      pack: "authority" as const,
      jurisdiction: "EU_GDPR" as const,
      awareness_at_utc: "2026-10-30T10:00:00.000Z",
      deadline_at_utc: "2026-11-02T10:00:00.000Z",
      submitted_at_utc: "2026-10-31T08:00:00.000Z",
      review_approval_id: "00000000-0000-0000-0000-000000000001",
      state: "draft" as const,
      item_a_nature: "Base nature text",
    };

    it("verifies envelope fields ('state', 'review_approval_id', 'submitted_at_utc') are ignored when calculating hash", () => {
      const hash1 = hashCanonicalContent(canonicalBasePack);

      const modifiedEnvelopePack = {
        ...canonicalBasePack,
        state: "sent" as const,
        review_approval_id: "11111111-1111-1111-1111-111111111111",
        submitted_at_utc: "2026-11-01T12:00:00.000Z",
      };

      const hash2 = hashCanonicalContent(modifiedEnvelopePack);

      expect(hash1).toBe(hash2);
    });

    it("verifies substantive field changes alter the hash", () => {
      const hashOriginal = hashCanonicalContent(canonicalBasePack);

      const substantiveChangePack = {
        ...canonicalBasePack,
        item_a_nature: "Altered nature text reflecting new forensic scope",
      };

      const hashModified = hashCanonicalContent(substantiveChangePack);

      expect(hashOriginal).not.toBe(hashModified);
    });
  });

  describe("evaluateHighRiskGate", () => {
    const baseGateParams = {
      severity: "B",
      impact: "M",
      affectedDataTypes: ["email", "name"],
      numAffectedSubjects: 25,
      unencryptedExfiltration: false,
      authorityOrdered: false,
      reviewer: "dpo-officer",
    };

    it("triggers 'severity:C' and returns verdict: true when severity is C", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        severity: "C",
      });

      expect(result.verdict).toBe(true);
      expect(result.triggers).toContain("severity:C");
    });

    it("triggers 'impact:V' and returns verdict: true when impact is V", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        impact: "V",
      });

      expect(result.verdict).toBe(true);
      expect(result.triggers).toContain("impact:V");
    });

    it("triggers 'sensitive_data_types' and returns verdict: true when sensitive data types are involved", () => {
      const sensitiveCategories = [
        "health",
        "biometric",
        "financial",
        "credentials",
        "minors",
        "sensitive",
      ];

      for (const cat of sensitiveCategories) {
        const result = NoticeComposer.evaluateHighRiskGate({
          ...baseGateParams,
          affectedDataTypes: [cat],
        });

        expect(result.verdict).toBe(true);
        expect(result.triggers).toContain("sensitive_data_types");
      }
    });

    it("triggers 'num_affected_subjects>=100' and returns verdict: true when subjects >= 100", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        numAffectedSubjects: 100,
      });

      expect(result.verdict).toBe(true);
      expect(result.triggers).toContain("num_affected_subjects>=100");
    });

    it("triggers 'unencrypted_exfiltration' and 'authority_ordered' flags appropriately", () => {
      const resultExfil = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        unencryptedExfiltration: true,
      });
      expect(resultExfil.verdict).toBe(true);
      expect(resultExfil.triggers).toContain("unencrypted_exfiltration");

      const resultAuth = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        authorityOrdered: true,
      });
      expect(resultAuth.verdict).toBe(true);
      expect(resultAuth.triggers).toContain("authority_ordered");
    });

    it("returns verdict: false when severity is low/medium and no high risk triggers exist", () => {
      const result = NoticeComposer.evaluateHighRiskGate(baseGateParams);

      expect(result.verdict).toBe(false);
      expect(result.triggers).toHaveLength(0);
      expect(result.reviewer).toBe("dpo-officer");
      expect(result.determined_at_utc).toBeDefined();
    });
  });

  describe("composeSubjectNotice", () => {
    const baseSubjectNoticeParams = {
      incidentCode: "INC-2026-001",
      highRiskGate: sampleHighRiskGatePass,
      bodyPlain:
        "Le comunicamos que hemos detectado un incidente de seguridad. Nuestro equipo ha restablecido los accesos. Le sugerimos cambiar su contraseña.",
      contact: sampleDpoContact,
      consequences: "Riesgo de acceso a información de contacto.",
      measures: ["Contraseñas reseteadas", "Canal de soporte habilitado"],
      recommendations: ["Renovar clave de acceso", "Revisar movimientos"],
      citations: ["Art. 34 RGPD"],
    };

    it("returns notice with state: 'not_required' when highRiskGate.verdict is false", () => {
      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        highRiskGate: sampleHighRiskGateFail,
      });

      expect(pack.state).toBe("not_required");
      expect(pack.pack).toBe("subject");
      expect(pack.body_plain).toBe("");
      expect(pack.exemption).toBeNull();

      const parsed = SubjectNoticePackSchema.safeParse(pack);
      expect(parsed.success).toBe(true);
    });

    it("returns notice with state: 'exempted' when exemption is provided", () => {
      const exemption = {
        letter: "a" as const,
        evidence_refs: ["config:encryption", "forensics:verified_proof"],
        approval_id: "00000000-0000-0000-0000-000000000002",
        public_artifact: null,
      };

      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        exemption,
      });

      expect(pack.state).toBe("exempted");
      expect(pack.exemption).toEqual(exemption);

      const parsed = SubjectNoticePackSchema.safeParse(pack);
      expect(parsed.success).toBe(true);
    });

    it("validates body_plain with PlainLanguageValidator and returns state: 'draft' when high risk and not exempt", () => {
      const pack = NoticeComposer.composeSubjectNotice(baseSubjectNoticeParams);

      expect(pack.state).toBe("draft");
      expect(pack.body_plain).toBe(baseSubjectNoticeParams.bodyPlain);
      expect(pack.exemption).toBeNull();

      const parsed = SubjectNoticePackSchema.safeParse(pack);
      expect(parsed.success).toBe(true);
    });

    it("throws PlainLanguageViolationError if bodyPlain contains a sentence exceeding 25 words", () => {
      const invalidBody =
        "Esta frase inicial es infinitamente larga y contiene una enorme cantidad de palabras innecesarias que superan claramente el umbral máximo de veinticinco palabras por frase previsto en las directrices de comunicación directa a interesados bajo el RGPD.";

      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          bodyPlain: invalidBody,
        }),
      ).toThrow(PlainLanguageViolationError);
    });

    it("throws SubjectCountForbiddenError if bodyPlain includes subject counts", () => {
      const invalidBody =
        "La brecha afectó a 500 personas en su totalidad. Por favor renueve sus credenciales.";

      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          bodyPlain: invalidBody,
        }),
      ).toThrow(SubjectCountForbiddenError);
    });

    it("passes validation when waivers are specified", () => {
      const longBodyWithSubjects =
        "El incidente técnico afectó a 500 personas según las comprobaciones preliminares realizadas por los analistas forenses durante la madrugada tras detectarse la vulnerabilidad en el repositorio central de usuarios.";

      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        bodyPlain: longBodyWithSubjects,
        waivers: {
          plainLanguageWaiver: true,
          allowSubjectCounts: true,
        },
      });

      expect(pack.state).toBe("draft");
      expect(pack.body_plain).toBe(longBodyWithSubjects);
    });
  });
});
