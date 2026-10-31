import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import { EVIDENCE_REFS_MAX_CHARS } from "@pims/types/constants.ts";
import { PimsNotFoundError } from "@pims/types/errors.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

const EVIDENCE_INDEX_FILE_NAME = "evidence-index.txt";

export function readMarkers(evidenceRefs: string | null | undefined): string[] {
  if (evidenceRefs === null || evidenceRefs === undefined) {
    return [];
  }
  return evidenceRefs
    .split(";")
    .map((marker) => marker.trim())
    .filter((marker) => marker.length > 0);
}

export async function appendEvidenceMarker(
  adapter: PimsAdapter,
  evidenceStore: EvidenceStore,
  incident: PimsIncident,
  token: string,
  schema: string,
): Promise<PimsIncident> {
  const markers = readMarkers(incident.evidence_refs);
  if (markers.includes(token)) {
    return incident;
  }

  const next = [...markers, token].join(";");
  if (next.length <= EVIDENCE_REFS_MAX_CHARS) {
    return adapter.updateIncident(incident.id, { evidence_refs: next });
  }

  const indexBytes = Buffer.from(markers.join("\n"), "utf8");
  const staged = await evidenceStore.stageAttachment(
    schema,
    incident.incident_code,
    EVIDENCE_INDEX_FILE_NAME,
    indexBytes,
    "text/plain",
    "orchestrator",
    null,
  );

  const uploaded = await adapter.uploadIncidentAttachment(
    incident.id,
    indexBytes,
    EVIDENCE_INDEX_FILE_NAME,
    { incidentCode: incident.incident_code },
  );
  const attachment = uploaded.find(
    (candidate) => candidate.file_name === EVIDENCE_INDEX_FILE_NAME,
  );
  if (attachment === undefined) {
    throw new PimsNotFoundError("IncidentAttachment", EVIDENCE_INDEX_FILE_NAME);
  }

  await evidenceStore.markStagedAttachmentUploaded(
    incident.incident_code,
    EVIDENCE_INDEX_FILE_NAME,
    staged.sha256,
    attachment.id,
  );

  return adapter.updateIncident(incident.id, {
    evidence_refs: `overflow:${EVIDENCE_INDEX_FILE_NAME}:${staged.sha256.slice(0, 8)};${token}`,
  });
}
