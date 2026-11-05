import { ExemptionEngine } from "@pims/notices";
import type { ExemptionEvaluationInput } from "@pims/types";
import { ExemptionUngroundedError, PimsValidationError } from "@pims/types";
import { TEST_INCIDENT_CODE } from "@tests/helpers/test-constants.ts";
import { describe, expect, it } from "vitest";

describe("GDPR Article 34(3) Statutory Exemption Engine", () => {
  const reviewApprovalId = "00000000-0000-0000-0000-000000000002";
  const sourceFileSha256 = "a".repeat(64);
  const verifiedAtUtc = "2026-10-30T12:00:00.000Z";

  const emptyInput: ExemptionEvaluationInput = {
    incidentCode: TEST_INCIDENT_CODE,
    securityMeasuresAdopted: [],
    encryptionProofs: [],
    subsequentMeasures: [],
    disproportionateEffort: null,
    authorityInstruction: null,
  };

  const encryptionProof = {
    incident_code: TEST_INCIDENT_CODE,
    source_file_sha256: sourceFileSha256,
    scope: "encrypt_rest" as const,
    algorithm: "AES-256-GCM",
    key_management_ref: "kms:evidence/2026",
    applies_to_affected_data: true,
    evidence_refs: ["file:encryption-config-export.json"],
    verified_by: "security-reviewer-1",
    verified_at_utc: verifiedAtUtc,
    review_approval_id: reviewApprovalId,
  };

  describe("Art 34(4) supervisory authority override", () => {
    it("returns authority_override before any exemption is considered", () => {
      const result = ExemptionEngine.evaluate({
        ...emptyInput,
        securityMeasuresAdopted: ["encrypt_rest"],
        encryptionProofs: [encryptionProof],
        authorityInstruction: {
          instruction_ref: "AEPD-ORDER-2026-77",
          ordered_at_utc: verifiedAtUtc,
        },
      });

      expect(result).toEqual({
        kind: "authority_override",
        reason: "AUTHORITY_OVERRIDE",
        instruction_ref: "AEPD-ORDER-2026-77",
      });

      const instanceResult = new ExemptionEngine().evaluate({
        ...emptyInput,
        authorityInstruction: {
          instruction_ref: "AEPD-ORDER-2026-77",
          ordered_at_utc: verifiedAtUtc,
        },
      });
      expect(instanceResult.kind).toBe("authority_override");
    });
  });

  describe("Article 34(3)(a): encryption renders data unintelligible", () => {
    it("grounds letter 'a' in the attestation's own evidence refs and approval id", () => {
      const result = ExemptionEngine.evaluate({
        ...emptyInput,
        securityMeasuresAdopted: ["encrypt_rest"],
        encryptionProofs: [encryptionProof],
      });

      expect(result).toEqual({
        kind: "exempted",
        reason: "ENCRYPTION_VERIFIED",
        exemption: {
          letter: "a",
          evidence_refs: ["file:encryption-config-export.json"],
          approval_id: reviewApprovalId,
          public_artifact: null,
        },
      });
    });

    it("throws when an encryption measure is adopted without a matching attestation", () => {
      const ungroundedInputs: ExemptionEvaluationInput[] = [
        { ...emptyInput, securityMeasuresAdopted: ["encrypt_rest"] },
        {
          ...emptyInput,
          securityMeasuresAdopted: ["encrypt_rest"],
          encryptionProofs: [{ ...encryptionProof, scope: "encrypt_transit" }],
        },
        {
          ...emptyInput,
          securityMeasuresAdopted: ["encrypt_transit"],
          encryptionProofs: [
            { ...encryptionProof, incident_code: "INC-OTHER" },
          ],
        },
        {
          ...emptyInput,
          securityMeasuresAdopted: ["encrypt_rest"],
          encryptionProofs: [
            { ...encryptionProof, applies_to_affected_data: false },
          ],
        },
      ];
      for (const input of ungroundedInputs) {
        try {
          ExemptionEngine.evaluate(input);
          expect.unreachable("Should have thrown ExemptionUngroundedError");
        } catch (err) {
          expect(err).toBeInstanceOf(ExemptionUngroundedError);
          const error = err as ExemptionUngroundedError;
          expect(error.letter).toBe("a");
          expect(error.reason).toBe("encryption_proof_missing_or_unverified");
        }
      }
    });
  });

  describe("Article 34(3)(b): subsequent measures eliminate the risk", () => {
    it("grants letter 'b' only for a risk-eliminating remediation action", () => {
      const result = ExemptionEngine.evaluate({
        ...emptyInput,
        subsequentMeasures: [
          {
            action_type: "R",
            description: "Rotated all exposed credentials and revoked sessions",
            risk_eliminated: true,
            evidence_refs: ["action:R:credential-rotation"],
            review_approval_id: reviewApprovalId,
          },
        ],
      });

      expect(result).toEqual({
        kind: "exempted",
        reason: "RISK_ELIMINATED",
        exemption: {
          letter: "b",
          evidence_refs: ["action:R:credential-rotation"],
          approval_id: reviewApprovalId,
          public_artifact: null,
        },
      });
    });

    it("does not grant letter 'b' for non-remediation or non-eliminating measures", () => {
      for (const action_type of ["C", "A"] as const) {
        const result = ExemptionEngine.evaluate({
          ...emptyInput,
          subsequentMeasures: [
            {
              action_type,
              description: "Containment action",
              risk_eliminated: true,
              evidence_refs: ["action:containment"],
              review_approval_id: reviewApprovalId,
            },
          ],
        });
        expect(result.kind).toBe("notice_required");
      }

      const notEliminated = ExemptionEngine.evaluate({
        ...emptyInput,
        subsequentMeasures: [
          {
            action_type: "R",
            description: "Partial remediation",
            risk_eliminated: false,
            evidence_refs: ["action:partial"],
            review_approval_id: reviewApprovalId,
          },
        ],
      });
      expect(notEliminated.kind).toBe("notice_required");
    });
  });

  describe("Article 34(3)(c): disproportionate effort", () => {
    it("throws when no public communication artifact is attached", () => {
      try {
        ExemptionEngine.evaluate({
          ...emptyInput,
          disproportionateEffort: {
            analysis_ref: "analysis:disproportionate-effort",
            public_artifact_ref: null,
            published_at_utc: verifiedAtUtc,
            review_approval_id: reviewApprovalId,
          },
        });
        expect.unreachable("Should have thrown ExemptionUngroundedError");
      } catch (err) {
        expect(err).toBeInstanceOf(ExemptionUngroundedError);
        const error = err as ExemptionUngroundedError;
        expect(error.letter).toBe("c");
        expect(error.reason).toBe("public_communication_artifact_required");
        expect(error.code).toBe(
          "EXEMPTION_UNGROUNDED:c:public_communication_artifact_required",
        );
      }
    });

    it("grants letter 'c' with the published artifact reference", () => {
      const result = ExemptionEngine.evaluate({
        ...emptyInput,
        disproportionateEffort: {
          analysis_ref: "analysis:disproportionate-effort",
          public_artifact_ref: "file:public-notice-2026-10-30.pdf",
          published_at_utc: verifiedAtUtc,
          review_approval_id: reviewApprovalId,
        },
      });

      expect(result).toEqual({
        kind: "exempted",
        reason: "DISPROPORTIONATE_EFFORT",
        exemption: {
          letter: "c",
          evidence_refs: ["analysis:disproportionate-effort"],
          approval_id: reviewApprovalId,
          public_artifact: "file:public-notice-2026-10-30.pdf",
        },
      });
    });
  });

  describe("Determinism and validation", () => {
    it("produces identical output for identical input (no random approval ids)", () => {
      const input: ExemptionEvaluationInput = {
        ...emptyInput,
        securityMeasuresAdopted: ["encrypt_rest"],
        encryptionProofs: [encryptionProof],
      };

      expect(ExemptionEngine.evaluate(input)).toEqual(
        ExemptionEngine.evaluate(input),
      );
    });

    it("returns notice_required when no exemption qualifies", () => {
      expect(ExemptionEngine.evaluate(emptyInput)).toEqual({
        kind: "notice_required",
        reason: "NO_EXEMPTION_QUALIFIED",
      });
    });

    it("rejects inputs outside the typed contract", () => {
      expect(() =>
        ExemptionEngine.evaluate({
          ...emptyInput,
          securityMeasuresAdopted: ["totally_unknown_measure"],
        } as unknown as ExemptionEvaluationInput),
      ).toThrow(PimsValidationError);

      expect(() =>
        ExemptionEngine.evaluate({
          ...emptyInput,
          encryptionProofVerified: true,
        } as unknown as ExemptionEvaluationInput),
      ).toThrow(PimsValidationError);
    });
  });
});
