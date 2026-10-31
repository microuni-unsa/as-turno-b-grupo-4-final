import crypto from "node:crypto";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import {
  ArtifactIncompleteError,
  BundleAlreadySealedError,
  BundlePimsMismatchError,
  EvidenceNotFoundError,
} from "@pims/types/errors.ts";
import {
  type AuditTrailExport,
  AuditTrailExportSchema,
  type EvidenceBundleIncident,
  type EvidenceBundleManifest,
  EvidenceBundleManifestSchema,
  type EvidenceBundleRootCause,
} from "@pims/types/evidence.ts";

function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalizeJson((obj as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

export class BundleSealer {
  constructor(private readonly evidenceStore: EvidenceStore) {}

  async createManifest(
    incidentCode: string,
    incidentFacts: EvidenceBundleIncident,
    rootCause: EvidenceBundleRootCause,
    citations: string[],
    packs: string[],
  ): Promise<EvidenceBundleManifest> {
    const stagedItems =
      await this.evidenceStore.listStagedAttachments(incidentCode);

    const manifestCandidate: EvidenceBundleManifest = {
      manifest: "evidence-bundle",
      incident_code: incidentCode,
      sealed_at_utc: null,
      seal_sha256: null,
      incident: incidentFacts,
      items: stagedItems,
      citations,
      packs,
      root_cause: rootCause,
    };

    const validation =
      EvidenceBundleManifestSchema.safeParse(manifestCandidate);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      const field = issue ? issue.path.join(".") : "manifest";
      throw new ArtifactIncompleteError("evidence-bundle", field);
    }

    await this.evidenceStore.saveBundleManifest(
      incidentCode,
      manifestCandidate,
    );
    return manifestCandidate;
  }

  async reconcileWithPims(
    incidentCode: string,
    pimsAttachmentIds: number[],
  ): Promise<void> {
    const staged = await this.evidenceStore.listStagedAttachments(incidentCode);

    for (const attachment of staged) {
      if (
        attachment.pims_attachment_id !== undefined &&
        attachment.pims_attachment_id !== null
      ) {
        if (!pimsAttachmentIds.includes(attachment.pims_attachment_id)) {
          throw new BundlePimsMismatchError(attachment.file_name);
        }
      }
    }
  }

  async sealBundle(incidentCode: string): Promise<{
    sealSha256: string;
    marker: string;
    manifest: EvidenceBundleManifest;
  }> {
    const manifest = await this.evidenceStore.getBundleManifest(incidentCode);
    if (!manifest) {
      throw new EvidenceNotFoundError("bundle_manifest", incidentCode);
    }

    if (manifest.seal_sha256) {
      throw new BundleAlreadySealedError();
    }

    const sealedAtUtc = new Date().toISOString();
    const manifestToSeal: EvidenceBundleManifest = {
      ...manifest,
      sealed_at_utc: sealedAtUtc,
      seal_sha256: null,
    };

    const canonicalString = canonicalizeJson(manifestToSeal);
    const sealSha256 = crypto
      .createHash("sha256")
      .update(canonicalString)
      .digest("hex");

    const sealedManifest: EvidenceBundleManifest = {
      ...manifestToSeal,
      seal_sha256: sealSha256,
    };

    await this.evidenceStore.saveBundleManifest(
      incidentCode,
      sealedManifest,
      sealSha256,
    );

    return {
      sealSha256,
      marker: `BUNDLE_SEALED:${sealSha256}`,
      manifest: sealedManifest,
    };
  }

  async exportAuditTrail(
    incidentCode: string,
    timeline: Record<string, unknown>[],
    timerLedger: Record<string, unknown>[],
  ): Promise<AuditTrailExport> {
    const rawToolLedger = await this.evidenceStore.listToolLedger(incidentCode);

    const redactedToolLedger = rawToolLedger.map((entry) => {
      const redactedArgs: Record<string, unknown> = {};
      const args = entry.args_redacted as Record<string, unknown>;
      for (const key of Object.keys(args)) {
        if (key === "incident_code" || key === "status") {
          redactedArgs[key] = args[key];
        } else {
          redactedArgs[key] = "[REDACTED]";
        }
      }

      return {
        at_utc: entry.at_utc,
        role: entry.role,
        tool: entry.tool,
        args_redacted: redactedArgs,
        result_ref: entry.result_ref,
        idempotency_key: entry.idempotency_key,
      };
    });

    const exportRecord: AuditTrailExport = {
      export_version: "1.0",
      incident_code: incidentCode,
      exported_at_utc: new Date().toISOString(),
      timeline,
      tool_ledger: redactedToolLedger,
      timer_ledger: timerLedger,
    };

    const validation = AuditTrailExportSchema.safeParse(exportRecord);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      const field = issue ? issue.path.join(".") : "audit-trail";
      throw new ArtifactIncompleteError("audit-trail", field);
    }

    return exportRecord;
  }
}
