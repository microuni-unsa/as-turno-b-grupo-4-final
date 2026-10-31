import crypto from "node:crypto";
import type { Art34Exemption } from "@pims/types";
import { ExemptionUngroundedError } from "@pims/types";

export interface ExemptionEvaluationInput {
  securityMeasuresAdopted: string[];
  encryptionProofVerified?: boolean;
  subsequentResolutionActions?: string[];
  disproportionateEffortAnalysis?: string;
  publicCommunicationArtifactAttached?: boolean;
  authorityOrdered?: boolean;
}

export interface ExemptionEvaluationResult {
  exempted: boolean;
  exemption: Art34Exemption | null;
  reason?: string;
}

export class ExemptionEngine {
  evaluate(input: ExemptionEvaluationInput): ExemptionEvaluationResult {
    if (input.authorityOrdered === true) {
      return {
        exempted: false,
        exemption: null,
        reason: "AUTHORITY_OVERRIDE",
      };
    }

    if (
      input.securityMeasuresAdopted.includes("encrypt_rest") ||
      input.securityMeasuresAdopted.includes("encrypt_transit")
    ) {
      if (input.encryptionProofVerified !== true) {
        throw new ExemptionUngroundedError(
          "a",
          "encryption_proof_missing_or_unverified",
        );
      }
      return {
        exempted: true,
        exemption: {
          letter: "a",
          evidence_refs: ["config:encryption", "forensics:verified_proof"],
          approval_id: crypto.randomUUID(),
          public_artifact: null,
        },
      };
    }

    if (
      input.subsequentResolutionActions &&
      input.subsequentResolutionActions.length > 0
    ) {
      return {
        exempted: true,
        exemption: {
          letter: "b",
          evidence_refs: input.subsequentResolutionActions,
          approval_id: crypto.randomUUID(),
          public_artifact: null,
        },
      };
    }

    if (
      input.disproportionateEffortAnalysis &&
      input.disproportionateEffortAnalysis.trim().length > 0
    ) {
      if (input.publicCommunicationArtifactAttached !== true) {
        throw new ExemptionUngroundedError(
          "c",
          "public_communication_artifact_required",
        );
      }
      return {
        exempted: true,
        exemption: {
          letter: "c",
          evidence_refs: ["analysis:disproportionate_effort"],
          approval_id: crypto.randomUUID(),
          public_artifact: "public-notice.txt",
        },
      };
    }

    return {
      exempted: false,
      exemption: null,
    };
  }

  static evaluate(input: ExemptionEvaluationInput): ExemptionEvaluationResult {
    return new ExemptionEngine().evaluate(input);
  }
}
