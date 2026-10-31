import { ExemptionEngine } from "@pims/notices";
import { ExemptionUngroundedError } from "@pims/types";
import { describe, expect, it } from "vitest";

describe("GDPR Article 34(3) Statutory Exemption Engine", () => {
  describe("Art 34(4) Supervisory Authority Override", () => {
    it("returns { exempted: false, exemption: null, reason: 'AUTHORITY_OVERRIDE' } when authorityOrdered is true, even if encryption measures are verified", () => {
      const input = {
        securityMeasuresAdopted: ["encrypt_rest"],
        encryptionProofVerified: true,
        authorityOrdered: true,
      };

      const result = ExemptionEngine.evaluate(input);

      expect(result.exempted).toBe(false);
      expect(result.exemption).toBeNull();
      expect(result.reason).toBe("AUTHORITY_OVERRIDE");

      const engine = new ExemptionEngine();
      const instanceResult = engine.evaluate(input);
      expect(instanceResult.exempted).toBe(false);
      expect(instanceResult.reason).toBe("AUTHORITY_OVERRIDE");
    });
  });

  describe("Article 34(3)(a) Exemption: Unintelligibility / Technical Protection", () => {
    it("returns letter 'a' exemption with approval_id when security measures contain 'encrypt_rest' and encryption proof is verified", () => {
      const input = {
        securityMeasuresAdopted: ["encrypt_rest"],
        encryptionProofVerified: true,
      };

      const result = ExemptionEngine.evaluate(input);

      expect(result.exempted).toBe(true);
      expect(result.exemption).not.toBeNull();
      expect(result.exemption?.letter).toBe("a");
      expect(result.exemption?.approval_id).toBeDefined();
      expect(result.exemption?.public_artifact).toBeNull();
      expect(result.exemption?.evidence_refs).toEqual([
        "config:encryption",
        "forensics:verified_proof",
      ]);
    });

    it("returns letter 'a' exemption when 'encrypt_transit' is adopted with verified proof", () => {
      const input = {
        securityMeasuresAdopted: ["encrypt_transit"],
        encryptionProofVerified: true,
      };

      const result = ExemptionEngine.evaluate(input);

      expect(result.exempted).toBe(true);
      expect(result.exemption?.letter).toBe("a");
    });

    it("throws ExemptionUngroundedError with letter 'a' when 'encrypt_rest' is claimed but encryptionProofVerified is false or missing", () => {
      const unverifiedInputs = [
        {
          securityMeasuresAdopted: ["encrypt_rest"],
          encryptionProofVerified: false,
        },
        {
          securityMeasuresAdopted: ["encrypt_rest"],
        },
        {
          securityMeasuresAdopted: ["encrypt_transit"],
          encryptionProofVerified: undefined,
        },
      ];

      for (const input of unverifiedInputs) {
        expect(() => ExemptionEngine.evaluate(input)).toThrow(
          ExemptionUngroundedError,
        );

        try {
          ExemptionEngine.evaluate(input);
          expect.unreachable("Should have thrown ExemptionUngroundedError");
        } catch (err) {
          expect(err).toBeInstanceOf(ExemptionUngroundedError);
          const error = err as ExemptionUngroundedError;
          expect(error.letter).toBe("a");
          expect(error.reason).toBe("encryption_proof_missing_or_unverified");
          expect(error.code).toBe(
            "EXEMPTION_UNGROUNDED:a:encryption_proof_missing_or_unverified",
          );
        }
      }
    });
  });

  describe("Article 34(3)(b) Exemption: Subsequent Mitigation Measures", () => {
    it("returns letter 'b' exemption when subsequentResolutionActions contains resolution measures", () => {
      const input = {
        securityMeasuresAdopted: [],
        subsequentResolutionActions: [
          "action:remote_wipe_performed",
          "action:stolen_token_revoked_at_idp",
        ],
      };

      const result = ExemptionEngine.evaluate(input);

      expect(result.exempted).toBe(true);
      expect(result.exemption).not.toBeNull();
      expect(result.exemption?.letter).toBe("b");
      expect(result.exemption?.approval_id).toBeDefined();
      expect(result.exemption?.public_artifact).toBeNull();
      expect(result.exemption?.evidence_refs).toEqual([
        "action:remote_wipe_performed",
        "action:stolen_token_revoked_at_idp",
      ]);
    });
  });

  describe("Article 34(3)(c) Exemption: Disproportionate Effort & Public Notice", () => {
    it("throws ExemptionUngroundedError with letter 'c' when disproportionate effort analysis is present but public communication artifact is not attached", () => {
      const invalidInputs = [
        {
          securityMeasuresAdopted: [],
          disproportionateEffortAnalysis:
            "Individual notification would involve contacting 2,000,000 unregistered pseudonymous app visitors.",
          publicCommunicationArtifactAttached: false,
        },
        {
          securityMeasuresAdopted: [],
          disproportionateEffortAnalysis:
            "Disproportionate cost and lack of contact details.",
        },
      ];

      for (const input of invalidInputs) {
        expect(() => ExemptionEngine.evaluate(input)).toThrow(
          ExemptionUngroundedError,
        );

        try {
          ExemptionEngine.evaluate(input);
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
      }
    });

    it("returns letter 'c' exemption with public_artifact when publicCommunicationArtifactAttached is true", () => {
      const input = {
        securityMeasuresAdopted: [],
        disproportionateEffortAnalysis:
          "High effort due to legacy archived data lacking email contacts.",
        publicCommunicationArtifactAttached: true,
      };

      const result = ExemptionEngine.evaluate(input);

      expect(result.exempted).toBe(true);
      expect(result.exemption).not.toBeNull();
      expect(result.exemption?.letter).toBe("c");
      expect(result.exemption?.approval_id).toBeDefined();
      expect(result.exemption?.public_artifact).toBe("public-notice.txt");
      expect(result.exemption?.evidence_refs).toEqual([
        "analysis:disproportionate_effort",
      ]);
    });
  });

  describe("Default / No Exemption Qualified", () => {
    it("returns { exempted: false, exemption: null } when no statutory exemption conditions are met", () => {
      const nonExemptInput = {
        securityMeasuresAdopted: [],
        subsequentResolutionActions: [],
        disproportionateEffortAnalysis: "",
        publicCommunicationArtifactAttached: false,
      };

      const result = ExemptionEngine.evaluate(nonExemptInput);

      expect(result.exempted).toBe(false);
      expect(result.exemption).toBeNull();
    });
  });
});
