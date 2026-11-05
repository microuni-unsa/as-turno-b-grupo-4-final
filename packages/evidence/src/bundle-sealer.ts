import crypto from "node:crypto";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
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
import type { JsonObject } from "@pims/types/models.ts";

export const BUNDLE_ATTACHMENT_NAME = CONSTANTS.BUNDLE_ATTACHMENT_NAME;

const ALLOWED_TRAIL_ARG_KEYS: ReadonlySet<string> = new Set(
  CONSTANTS.AUDIT_TRAIL_ALLOWED_ARG_KEYS,
);

export class BundleSealer {
  static readonly BUNDLE_ATTACHMENT_NAME = CONSTANTS.BUNDLE_ATTACHMENT_NAME;

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
    if (!stagedItems) {
      throw new ArtifactIncompleteError("evidence-bundle", "items");
    }

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
      if (issue !== undefined && issue.path.length > 0) {
        throw new ArtifactIncompleteError(
          "evidence-bundle",
          issue.path.join("."),
        );
      } else {
        throw new ArtifactIncompleteError("evidence-bundle", "manifest");
      }
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
    if (!staged) {
      throw new EvidenceNotFoundError("staged_attachments", incidentCode);
    }

    for (const attachment of staged) {
      const pimsAttachmentId = attachment.pims_attachment_id;
      if (pimsAttachmentId === undefined) {
        throw new BundlePimsMismatchError(attachment.file_name);
      } else if (!pimsAttachmentIds.includes(pimsAttachmentId)) {
        throw new BundlePimsMismatchError(attachment.file_name);
      } else {
        // Staged attachment reconciled with PIMS attachment id
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
    } else if (manifest.seal_sha256) {
      throw new BundleAlreadySealedError();
    } else if (!manifest.items) {
      throw new ArtifactIncompleteError("evidence-bundle", "items");
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

  async getSealedBundle(incidentCode: string): Promise<{
    manifest: EvidenceBundleManifest;
    sealSha256: string;
    marker: string;
  }> {
    const manifest = await this.evidenceStore.getBundleManifest(incidentCode);
    if (!manifest) {
      throw new EvidenceNotFoundError("bundle_manifest", incidentCode);
    } else if (manifest.seal_sha256 === null) {
      throw new ArtifactIncompleteError("evidence-bundle", "seal_sha256");
    } else if (!manifest.items) {
      throw new ArtifactIncompleteError("evidence-bundle", "items");
    } else {
      return {
        manifest,
        sealSha256: manifest.seal_sha256,
        marker: `BUNDLE_SEALED:${manifest.seal_sha256}`,
      };
    }
  }

  async exportAuditTrail(
    incidentCode: string,
    timeline: JsonObject[],
    timerLedger: JsonObject[],
  ): Promise<AuditTrailExport> {
    const rawToolLedger = await this.evidenceStore.listToolLedger(incidentCode);
    if (!rawToolLedger) {
      throw new EvidenceNotFoundError("tool_ledger", incidentCode);
    }

    const redactedToolLedger = rawToolLedger.map((entry) => {
      const redactedArgs: JsonObject = {};
      for (const [key, value] of Object.entries(entry.args_redacted)) {
        if (ALLOWED_TRAIL_ARG_KEYS.has(key)) {
          redactedArgs[key] = value;
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
      if (issue !== undefined && issue.path.length > 0) {
        throw new ArtifactIncompleteError("audit-trail", issue.path.join("."));
      } else {
        throw new ArtifactIncompleteError("audit-trail", "export");
      }
    }

    return exportRecord;
  }
}
