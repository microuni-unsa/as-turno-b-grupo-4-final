import {
  type ExemptionEvaluationInput,
  ExemptionEvaluationInputSchema,
  type ExemptionEvaluationResult,
  ExemptionEvaluationResultSchema,
  ExemptionUngroundedError,
  PimsValidationError,
} from "@pims/types";
import { zodIssuesToDetails } from "@pims/types/validation.ts";

const ENCRYPTION_SCOPES = ["encrypt_rest", "encrypt_transit"] as const;

type ExemptionCategory =
  | "encryption_proof"
  | "subsequent_measure"
  | "disproportionate_effort";

const EXEMPTION_CATEGORIES: readonly ExemptionCategory[] = [
  "encryption_proof",
  "subsequent_measure",
  "disproportionate_effort",
] as const;

function assertNever(x: never): never {
  throw new Error(`Unhandled exemption category: ${JSON.stringify(x)}`);
}

export class ExemptionEngine {
  evaluate(input: ExemptionEvaluationInput): ExemptionEvaluationResult {
    const parsed = ExemptionEvaluationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PimsValidationError(
        "exemption_input",
        "Invalid exemption evaluation input",
        { issues: zodIssuesToDetails(parsed.error) },
      );
    }
    const data = parsed.data;

    if (data.authorityInstruction !== null) {
      return ExemptionEvaluationResultSchema.parse({
        kind: "authority_override",
        reason: "AUTHORITY_OVERRIDE",
        instruction_ref: data.authorityInstruction.instruction_ref,
      });
    }

    for (const category of EXEMPTION_CATEGORIES) {
      switch (category) {
        case "encryption_proof": {
          const adoptedEncryptionScopes = ENCRYPTION_SCOPES.filter((scope) =>
            data.securityMeasuresAdopted.includes(scope),
          );

          if (adoptedEncryptionScopes.length > 0) {
            const matchedProof = data.encryptionProofs.find(
              (proof) =>
                proof.incident_code === data.incidentCode &&
                proof.applies_to_affected_data &&
                adoptedEncryptionScopes.includes(proof.scope),
            );
            if (matchedProof === undefined) {
              throw new ExemptionUngroundedError(
                "a",
                "encryption_proof_missing_or_unverified",
              );
            }
            return ExemptionEvaluationResultSchema.parse({
              kind: "exempted",
              reason: "ENCRYPTION_VERIFIED",
              exemption: {
                letter: "a",
                evidence_refs: matchedProof.evidence_refs,
                approval_id: matchedProof.review_approval_id,
                public_artifact: null,
              },
            });
          }
          break;
        }

        case "subsequent_measure": {
          const riskEliminatingMeasure = data.subsequentMeasures.find(
            (measure) => measure.action_type === "R" && measure.risk_eliminated,
          );
          if (riskEliminatingMeasure !== undefined) {
            return ExemptionEvaluationResultSchema.parse({
              kind: "exempted",
              reason: "RISK_ELIMINATED",
              exemption: {
                letter: "b",
                evidence_refs: riskEliminatingMeasure.evidence_refs,
                approval_id: riskEliminatingMeasure.review_approval_id,
                public_artifact: null,
              },
            });
          }
          break;
        }

        case "disproportionate_effort": {
          if (data.disproportionateEffort !== null) {
            const effort = data.disproportionateEffort;
            if (effort.public_artifact_ref === null) {
              throw new ExemptionUngroundedError(
                "c",
                "public_communication_artifact_required",
              );
            }
            return ExemptionEvaluationResultSchema.parse({
              kind: "exempted",
              reason: "DISPROPORTIONATE_EFFORT",
              exemption: {
                letter: "c",
                evidence_refs: [effort.analysis_ref],
                approval_id: effort.review_approval_id,
                public_artifact: effort.public_artifact_ref,
              },
            });
          }
          break;
        }

        default:
          return assertNever(category);
      }
    }

    return ExemptionEvaluationResultSchema.parse({
      kind: "notice_required",
      reason: "NO_EXEMPTION_QUALIFIED",
    });
  }

  static evaluate(input: ExemptionEvaluationInput): ExemptionEvaluationResult {
    return new ExemptionEngine().evaluate(input);
  }
}
