import { hashCanonicalContent, NoticeComposer } from "@pims/notices";
import {
  type AffectedDataType,
  ArtifactIncompleteError,
  AuthorityNoticePackSchema,
  type DpoContact,
  type HighRiskGateInput,
  type HighRiskGateResult,
  PimsValidationError,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
  SubjectNoticePackSchema,
} from "@pims/types";
import { describe, expect, it } from "vitest";

describe("Notice Composer (GDPR Art 33 Authority Pack & Art 34 Subject Notice)", () => {
  const fixedNow = new Date("2026-10-30T12:00:00.000Z");
  const reviewApprovalId = "00000000-0000-0000-0000-000000000001";
  const exemptionApprovalId = "00000000-0000-0000-0000-000000000002";

  const sampleDpoContact: DpoContact = {
    name: "Oficina del DPO",
    email: "dpo@example.com",
    phone: "+34910000000",
  };

  const sampleHighRiskGatePass: HighRiskGateResult = {
    verdict: true,
    triggers: ["severity:C"],
    determined_at_utc: fixedNow.toISOString(),
    reviewer: "sec-auditor-1",
  };

  const sampleHighRiskGateFail: HighRiskGateResult = {
    verdict: false,
    triggers: [],
    determined_at_utc: fixedNow.toISOString(),
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
      review_approval_id: reviewApprovalId,
      state: "draft" as const,
    };

    it("generates a valid pack matching AuthorityNoticePackSchema", () => {
      const composer = new NoticeComposer();
      const pack = composer.composeAuthorityPack(baseAuthorityParams);

      expect(pack.pack).toBe("authority");
      expect(pack.jurisdiction).toBe("EU_GDPR");
      expect(pack.pack_id).toBeDefined();
      expect(AuthorityNoticePackSchema.safeParse(pack).success).toBe(true);

      const staticPack =
        NoticeComposer.composeAuthorityPack(baseAuthorityParams);
      expect(staticPack.incident_code).toBe(baseAuthorityParams.incident_code);
    });

    it("keeps a caller-supplied pack_id", () => {
      const pack = new NoticeComposer().composeAuthorityPack({
        ...baseAuthorityParams,
        pack_id: exemptionApprovalId,
      });
      expect(pack.pack_id).toBe(exemptionApprovalId);
    });

    it("requires phased=true when item_a_unknown is non-empty", () => {
      const paramsWithUnknown = {
        ...baseAuthorityParams,
        item_a_unknown: [
          {
            item: "approx_records",
            reason: "Forensic analysis of binary logs in progress",
          },
        ],
      };

      try {
        new NoticeComposer().composeAuthorityPack(paramsWithUnknown);
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
      const pack = NoticeComposer.composeAuthorityPack({
        ...baseAuthorityParams,
        phased: true,
        phases_planned: 2,
        item_a_unknown: [
          { item: "approx_records", reason: "Forensic analysis in progress" },
        ],
      });
      expect(pack.phased).toBe(true);
      expect(pack.item_a_unknown).toHaveLength(1);
    });

    it("requires delay_reasons when submitted after the deadline", () => {
      const lateParams = {
        ...baseAuthorityParams,
        deadline_at_utc: "2026-10-31T10:00:00.000Z",
        submitted_at_utc: "2026-11-01T14:00:00.000Z",
      };

      try {
        new NoticeComposer().composeAuthorityPack(lateParams);
        expect.unreachable("Should have thrown ArtifactIncompleteError");
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactIncompleteError);
        expect((err as ArtifactIncompleteError).field).toBe(
          "delay_reasons_required_when_late",
        );
      }
    });

    it("passes when submitted late with factual delay_reasons", () => {
      const pack = NoticeComposer.composeAuthorityPack({
        ...baseAuthorityParams,
        deadline_at_utc: "2026-10-31T10:00:00.000Z",
        submitted_at_utc: "2026-11-01T14:00:00.000Z",
        delay_reasons: {
          hours_late: 28,
          reasons: ["Forensic extraction from encrypted volumes."],
        },
      });
      expect(pack.delay_reasons?.hours_late).toBe(28);
    });

    it("fails fast on out-of-contract input", () => {
      expect(() =>
        NoticeComposer.composeAuthorityPack({
          ...baseAuthorityParams,
          item_a_approx_subjects: -1,
        }),
      ).toThrow(PimsValidationError);

      expect(() =>
        NoticeComposer.composeAuthorityPack({
          ...baseAuthorityParams,
          submitted_at_utc: "not-a-datetime",
        }),
      ).toThrow(PimsValidationError);
    });
  });

  describe("Canonical content hashing (hashCanonicalContent)", () => {
    const canonicalBasePack = {
      incident_code: "INC-2026-001",
      pack: "authority" as const,
      jurisdiction: "EU_GDPR" as const,
      awareness_at_utc: "2026-10-30T10:00:00.000Z",
      deadline_at_utc: "2026-11-02T10:00:00.000Z",
      submitted_at_utc: "2026-10-31T08:00:00.000Z",
      review_approval_id: reviewApprovalId,
      state: "draft" as const,
      item_a_nature: "Base nature text",
    };

    it("ignores envelope fields when hashing", () => {
      const hash1 = hashCanonicalContent(canonicalBasePack);
      const hash2 = hashCanonicalContent({
        ...canonicalBasePack,
        state: "sent" as const,
        review_approval_id: exemptionApprovalId,
        submitted_at_utc: "2026-11-01T12:00:00.000Z",
      });

      expect(hash1).toBe(hash2);
    });

    it("changes when substantive fields change", () => {
      const hashOriginal = hashCanonicalContent(canonicalBasePack);
      const hashModified = hashCanonicalContent({
        ...canonicalBasePack,
        item_a_nature: "Altered nature text reflecting new forensic scope",
      });

      expect(hashOriginal).not.toBe(hashModified);
    });
  });

  describe("evaluateHighRiskGate", () => {
    const baseGateParams: HighRiskGateInput = {
      severity: "M",
      impact: "M",
      affectedDataTypes: ["email", "names"],
      numAffectedSubjects: 25,
      unencryptedExfiltration: false,
      authorityOrdered: false,
      reviewer: "dpo-officer",
    };

    it("triggers 'severity:C' on the typed severity enum", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        severity: "C",
      });

      expect(result.verdict).toBe(true);
      expect(result.triggers).toEqual(["severity:C"]);
    });

    it("triggers 'impact:V' on the typed impact enum", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        impact: "V",
      });

      expect(result.verdict).toBe(true);
      expect(result.triggers).toEqual(["impact:V"]);
    });

    it("recognises both the bundle and the ES sensitive catalogs", () => {
      const sensitiveCodes: AffectedDataType[] = [
        "sensitive",
        "health",
        "biometric",
        "financial",
        "credentials",
        "minors",
        "categorias_especiales",
        "economicos_financieros",
        "datos_relativos_condenas_infracciones",
      ];
      for (const dataType of sensitiveCodes) {
        const result = NoticeComposer.evaluateHighRiskGate({
          ...baseGateParams,
          affectedDataTypes: [dataType],
        });

        expect(result.verdict).toBe(true);
        expect(result.triggers).toEqual(["sensitive_data_types"]);
      }
    });

    it("does not trigger for non-sensitive catalog entries below the subject threshold", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        affectedDataTypes: ["identificativos", "contacto"],
        numAffectedSubjects: 25,
      });

      expect(result.verdict).toBe(false);
      expect(result.triggers).toHaveLength(0);
      expect(result.reviewer).toBe("dpo-officer");
    });

    it("triggers 'num_affected_subjects>=100' at the threshold and skips null", () => {
      const atThreshold = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        numAffectedSubjects: 100,
      });
      expect(atThreshold.triggers).toContain("num_affected_subjects>=100");

      const unknown = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        numAffectedSubjects: null,
      });
      expect(unknown.verdict).toBe(false);

      const below = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        numAffectedSubjects: 99,
      });
      expect(below.triggers).toHaveLength(0);
    });

    it("triggers the boolean flags", () => {
      const exfil = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        unencryptedExfiltration: true,
      });
      expect(exfil.triggers).toEqual(["unencrypted_exfiltration"]);

      const authority = NoticeComposer.evaluateHighRiskGate({
        ...baseGateParams,
        authorityOrdered: true,
      });
      expect(authority.triggers).toEqual(["authority_ordered"]);
    });

    it("orders multiple triggers deterministically", () => {
      const result = NoticeComposer.evaluateHighRiskGate({
        severity: "C",
        impact: "V",
        affectedDataTypes: ["health"],
        numAffectedSubjects: 5000,
        unencryptedExfiltration: true,
        authorityOrdered: true,
        reviewer: "dpo-officer",
      });

      expect(result.triggers).toEqual([
        "severity:C",
        "impact:V",
        "sensitive_data_types",
        "num_affected_subjects>=100",
        "unencrypted_exfiltration",
        "authority_ordered",
      ]);
    });

    it("stamps determined_at_utc from the injected clock", () => {
      const composer = new NoticeComposer({ now: () => fixedNow });
      const result = composer.evaluateHighRiskGate(baseGateParams);

      expect(result.determined_at_utc).toBe(fixedNow.toISOString());
    });

    it("rejects enum values outside the PIMS catalog", () => {
      expect(() =>
        NoticeComposer.evaluateHighRiskGate({
          ...baseGateParams,
          severity: "Z",
        } as unknown as HighRiskGateInput),
      ).toThrow(PimsValidationError);

      expect(() =>
        NoticeComposer.evaluateHighRiskGate({
          ...baseGateParams,
          affectedDataTypes: ["not_a_catalog_code"],
        } as unknown as HighRiskGateInput),
      ).toThrow(PimsValidationError);
    });
  });

  describe("composeSubjectNotice", () => {
    const bodyPlain =
      "Le comunicamos que hemos detectado un incidente de seguridad. Nuestro equipo ha restablecido los accesos. Le sugerimos cambiar su contraseña.";

    const baseSubjectNoticeParams = {
      incidentCode: "INC-2026-001",
      highRiskGate: sampleHighRiskGatePass,
      bodyPlain,
      contact: sampleDpoContact,
      consequences: "Riesgo de acceso a información de contacto.",
      measures: ["Contraseñas reseteadas", "Canal de soporte habilitado"],
      recommendations: ["Renovar clave de acceso", "Revisar movimientos"],
      citations: ["Art. 34 RGPD"],
    };

    it("returns state 'not_required' when the gate verdict is false", () => {
      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        highRiskGate: sampleHighRiskGateFail,
      });

      expect(pack.state).toBe("not_required");
      expect(pack.pack).toBe("subject");
      expect(pack.body_plain).toBe("");
      expect(pack.exemption).toBeNull();
      expect(SubjectNoticePackSchema.safeParse(pack).success).toBe(true);
    });

    it("returns state 'exempted' from an exempted evaluation", () => {
      const exemption = {
        letter: "a" as const,
        evidence_refs: ["file:encryption-config-export.json"],
        approval_id: exemptionApprovalId,
        public_artifact: null,
      };

      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        exemptionEvaluation: {
          kind: "exempted",
          reason: "ENCRYPTION_VERIFIED",
          exemption,
        },
      });

      expect(pack.state).toBe("exempted");
      expect(pack.exemption).toEqual(exemption);
      expect(SubjectNoticePackSchema.safeParse(pack).success).toBe(true);
    });

    it("forces 'draft' with no exemption on an authority override", () => {
      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        state: "exempted",
        exemptionEvaluation: {
          kind: "authority_override",
          reason: "AUTHORITY_OVERRIDE",
          instruction_ref: "AEPD-ORDER-2026-77",
        },
      });

      expect(pack.state).toBe("draft");
      expect(pack.exemption).toBeNull();
    });

    it("validates body_plain and returns state 'draft' when high risk and not exempt", () => {
      const pack = NoticeComposer.composeSubjectNotice(baseSubjectNoticeParams);

      expect(pack.state).toBe("draft");
      expect(pack.body_plain).toBe(bodyPlain);
      expect(pack.exemption).toBeNull();
      expect(SubjectNoticePackSchema.safeParse(pack).success).toBe(true);
    });

    it("throws when state 'exempted' has no exempted evaluation", () => {
      try {
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          state: "exempted",
        });
        expect.unreachable("Should have thrown ArtifactIncompleteError");
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactIncompleteError);
        expect((err as ArtifactIncompleteError).field).toBe(
          "state_inconsistent",
        );
      }
    });

    it("throws when the gate verdict disagrees with its triggers", () => {
      try {
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          highRiskGate: { ...sampleHighRiskGatePass, triggers: [] },
        });
        expect.unreachable("Should have thrown ArtifactIncompleteError");
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactIncompleteError);
        expect((err as ArtifactIncompleteError).field).toBe(
          "high_risk_gate_inconsistent",
        );
      }
    });

    it("requires a non-empty body_plain on the draft path", () => {
      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          bodyPlain: "   ",
        }),
      ).toThrow(ArtifactIncompleteError);
    });

    it("requires the public artifact for a letter 'c' exemption", () => {
      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          exemptionEvaluation: {
            kind: "exempted",
            reason: "DISPROPORTIONATE_EFFORT",
            exemption: {
              letter: "c",
              evidence_refs: ["analysis:disproportionate-effort"],
              approval_id: exemptionApprovalId,
              public_artifact: null,
            },
          },
        }),
      ).toThrow(ArtifactIncompleteError);
    });

    it("rejects an exemption on a non-high-risk incident", () => {
      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          highRiskGate: sampleHighRiskGateFail,
          exemptionEvaluation: {
            kind: "exempted",
            reason: "ENCRYPTION_VERIFIED",
            exemption: {
              letter: "a",
              evidence_refs: ["file:encryption-config-export.json"],
              approval_id: exemptionApprovalId,
              public_artifact: null,
            },
          },
        }),
      ).toThrow(ArtifactIncompleteError);
    });

    it("throws PlainLanguageViolationError for an over-long sentence", () => {
      const invalidBody =
        "Esta frase inicial es infinitamente larga y contiene una enorme cantidad de palabras innecesarias que superan claramente el umbral máximo de veinticinco palabras por frase previsto en las directrices de comunicación directa a interesados bajo el RGPD.";

      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          bodyPlain: invalidBody,
        }),
      ).toThrow(PlainLanguageViolationError);
    });

    it("honours the composer maxWords override", () => {
      const composer = new NoticeComposer({ maxWords: 3 });
      try {
        composer.composeSubjectNotice(baseSubjectNoticeParams);
        expect.unreachable("Should have thrown PlainLanguageViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(PlainLanguageViolationError);
        expect((err as PlainLanguageViolationError).maxWords).toBe(3);
      }
    });

    it("throws SubjectCountForbiddenError for an unapproved numeric literal", () => {
      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          bodyPlain:
            "La brecha afectó a 500 personas en su totalidad. Renueve sus credenciales.",
        }),
      ).toThrow(SubjectCountForbiddenError);
    });

    it("accepts an approved numeric literal together with a waiver", () => {
      const longBodyWithSubjects =
        "El incidente técnico afectó a 500 personas según las comprobaciones preliminares realizadas por los analistas forenses durante la madrugada tras detectarse la vulnerabilidad en el repositorio central de usuarios.";

      const pack = NoticeComposer.composeSubjectNotice({
        ...baseSubjectNoticeParams,
        bodyPlain: longBodyWithSubjects,
        reviewApprovalId,
        waivers: {
          plainLanguageWaiver: {
            reason: "technical incident wording",
            approval_id: reviewApprovalId,
          },
          numericApprovals: [
            {
              value: "500",
              occurrence: 0,
              reason: "reviewed context",
              approval_id: reviewApprovalId,
            },
          ],
        },
      });

      expect(pack.state).toBe("draft");
      expect(pack.body_plain).toBe(longBodyWithSubjects);
    });

    it("requires a review approval id when waivers are requested", () => {
      expect(() =>
        NoticeComposer.composeSubjectNotice({
          ...baseSubjectNoticeParams,
          waivers: {
            plainLanguageWaiver: {
              reason: "technical incident wording",
              approval_id: reviewApprovalId,
            },
          },
        }),
      ).toThrow(ArtifactIncompleteError);
    });
  });
});
