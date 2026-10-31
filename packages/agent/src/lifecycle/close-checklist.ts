import { readMarkers } from "@pims/agent/lifecycle/markers.ts";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import {
  CLOSE_CHECKLIST_ITEMS,
  type CloseChecklistItem,
} from "@pims/types/agent.ts";
import type { JsonValue } from "@pims/types/models.ts";
import type { PimsIncident, PimsIncidentAction } from "@pims/types/pims.ts";

export interface CloseChecklistItemResult {
  item: CloseChecklistItem;
  passed: boolean;
  detail: string;
}

export interface CloseChecklistResult {
  passed: boolean;
  items: CloseChecklistItemResult[];
}

export interface CloseChecklistOptions {
  skip?: CloseChecklistItem[];
}

interface CloseChecklistDependencies {
  evidenceStore: EvidenceStore;
  adapter: PimsAdapter;
  clock: () => Date;
}

const CLOSE_APPROVED_PREFIX = "CLOSE_APPROVED:";
const PHASED_PENDING_PREFIX = "unknown:PHASED_PENDING";
const AUDIT_LINK_SKIPPED_PREFIX = "audit_link_skipped:";
const BUNDLE_SEALED_PREFIX = "BUNDLE_SEALED:";
const AUDIT_LINK_PATTERN = /^AUDIT_LINK:[^:]+:[^:]+:[^:]+$/;

function resultOf(
  item: CloseChecklistItem,
  passed: boolean,
  detail: string,
): CloseChecklistItemResult {
  return { item, passed, detail };
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function readsActionCount(value: JsonValue): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value.action_count;
  if (
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= 0
  ) {
    return candidate;
  }
  return null;
}

function lastMarkerWithPrefix(
  markers: string[],
  prefix: string,
): string | null {
  let found: string | null = null;
  for (const marker of markers) {
    if (marker.startsWith(prefix)) {
      const value = marker.slice(prefix.length).trim();
      if (value.length > 0) {
        found = value;
      }
    }
  }
  return found;
}

export class CloseChecklistVerifier {
  private readonly evidenceStore: EvidenceStore;

  constructor(deps: CloseChecklistDependencies) {
    this.evidenceStore = deps.evidenceStore;
  }

  async verify(
    incident: PimsIncident,
    opts?: CloseChecklistOptions,
  ): Promise<CloseChecklistResult> {
    const skipped = new Set<CloseChecklistItem>(opts?.skip ?? []);
    const markers = readMarkers(incident.evidence_refs);
    const epochActions = await this.epochActions(incident);

    const items: CloseChecklistItemResult[] = [];
    for (const item of CLOSE_CHECKLIST_ITEMS) {
      if (skipped.has(item)) {
        continue;
      }
      items.push(
        await this.evaluateItem(item, incident, markers, epochActions),
      );
    }

    return { passed: items.every((entry) => entry.passed), items };
  }

  private async evaluateItem(
    item: CloseChecklistItem,
    incident: PimsIncident,
    markers: string[],
    epochActions: PimsIncidentAction[],
  ): Promise<CloseChecklistItemResult> {
    switch (item) {
      case "analysis_action":
        return this.analysisAction(item, epochActions);
      case "resolution_action_or_considered":
        return this.resolutionActionOrConsidered(item, incident, epochActions);
      case "reviewer_signoff":
        return this.reviewerSignoff(item, markers);
      case "art33_documentation":
        return this.art33Documentation(item, incident, markers, epochActions);
      case "notices_terminal":
        return this.noticesTerminal(item, incident);
      case "resolved_date":
        return this.resolvedDate(item, incident);
      case "corrective_action":
        return this.correctiveAction(item, markers);
      case "bundle_sealed":
        return this.bundleSealed(item, incident, markers);
    }
  }

  private async epochActions(
    incident: PimsIncident,
  ): Promise<PimsIncidentAction[]> {
    const actions = incident.actions ?? [];
    const baseline = await this.evidenceStore.getAgentState(
      `REOPEN_BASELINE:${incident.incident_code}`,
    );
    if (baseline === null) {
      return actions;
    }
    const actionCount = readsActionCount(baseline);
    if (actionCount === null) {
      return actions;
    }
    return actions.slice(actionCount);
  }

  private analysisAction(
    item: CloseChecklistItem,
    epochActions: PimsIncidentAction[],
  ): CloseChecklistItemResult {
    const present = epochActions.some((action) => action.action_type === "A");
    return resultOf(item, present, present ? "ok" : "no_analysis_action");
  }

  private resolutionActionOrConsidered(
    item: CloseChecklistItem,
    incident: PimsIncident,
    epochActions: PimsIncidentAction[],
  ): CloseChecklistItemResult {
    const hasResolution = epochActions.some(
      (action) => action.action_type === "R",
    );
    if (hasResolution) {
      return resultOf(item, true, "ok");
    }
    const considered =
      incident.measure_considered_resolved === "Y" &&
      epochActions.some(
        (action) => action.action_type === "A" && nonEmpty(action.evidence),
      );
    return resultOf(
      item,
      considered,
      considered ? "ok" : "no_resolution_action_or_consideration",
    );
  }

  private async reviewerSignoff(
    item: CloseChecklistItem,
    markers: string[],
  ): Promise<CloseChecklistItemResult> {
    const approvalId = lastMarkerWithPrefix(markers, CLOSE_APPROVED_PREFIX);
    if (approvalId === null) {
      return resultOf(item, false, "no_close_approved_marker");
    }
    const approval = await this.evidenceStore.getReviewApproval(approvalId);
    if (approval === null) {
      return resultOf(item, false, "approval_not_found");
    }
    if (approval.consumed_at_utc !== null) {
      return resultOf(item, false, "approval_consumed");
    }
    if (approval.pack_type !== "resolution") {
      return resultOf(item, false, "approval_not_resolution");
    }
    return resultOf(item, true, "ok");
  }

  private art33Documentation(
    item: CloseChecklistItem,
    incident: PimsIncident,
    markers: string[],
    epochActions: PimsIncidentAction[],
  ): CloseChecklistItemResult {
    if (!nonEmpty(incident.description)) {
      return resultOf(item, false, "missing_description");
    }
    if (incident.affected_cid.length === 0) {
      return resultOf(item, false, "missing_affected_cid");
    }
    const phasedPending = markers.some((marker) =>
      marker.startsWith(PHASED_PENDING_PREFIX),
    );
    const countKnown =
      !incident.involves_personal_data ||
      typeof incident.num_affected_subjects === "number" ||
      phasedPending;
    if (!countKnown) {
      return resultOf(item, false, "missing_subject_count");
    }
    const documented = epochActions.some(
      (action) =>
        (action.action_type === "C" || action.action_type === "A") &&
        nonEmpty(action.evidence),
    );
    return resultOf(
      item,
      documented,
      documented ? "ok" : "missing_evidence_action",
    );
  }

  private async noticesTerminal(
    item: CloseChecklistItem,
    incident: PimsIncident,
  ): Promise<CloseChecklistItemResult> {
    const authority = await this.evidenceStore.getDraftPack(
      incident.incident_code,
      "authority",
    );
    const subject = await this.evidenceStore.getDraftPack(
      incident.incident_code,
      "subject",
    );

    if (!incident.involves_personal_data) {
      if (authority !== null) {
        return resultOf(item, false, "authority_pack_present_for_non_pii");
      }
      if (subject !== null && subject.state !== "not_required") {
        return resultOf(item, false, "subject_pack_not_terminal");
      }
      return resultOf(item, true, "ok");
    }

    if (authority === null || authority.state !== "sent") {
      return resultOf(item, false, "authority_pack_not_sent");
    }
    if (
      subject === null ||
      (subject.state !== "sent" &&
        subject.state !== "exempted" &&
        subject.state !== "not_required")
    ) {
      return resultOf(item, false, "subject_pack_not_terminal");
    }
    const activeTimers = await this.evidenceStore.listActiveTimers(
      incident.incident_code,
    );
    const pendingPhase = activeTimers.some(
      (timer) => timer.timer_type === "T_PHASE_FOLLOWUP",
    );
    return resultOf(
      item,
      !pendingPhase,
      pendingPhase ? "phase_followup_pending" : "ok",
    );
  }

  private resolvedDate(
    item: CloseChecklistItem,
    incident: PimsIncident,
  ): CloseChecklistItemResult {
    if (!nonEmpty(incident.resolved_date)) {
      return resultOf(item, false, "missing_resolved_date");
    }
    if (incident.measure_considered_resolved !== "Y") {
      return resultOf(item, false, "not_considered_resolved");
    }
    if (!Array.isArray(incident.security_measures_adopted)) {
      return resultOf(item, false, "missing_security_measures");
    }
    return resultOf(item, true, "ok");
  }

  private correctiveAction(
    item: CloseChecklistItem,
    markers: string[],
  ): CloseChecklistItemResult {
    if (markers.some((marker) => AUDIT_LINK_PATTERN.test(marker))) {
      return resultOf(item, true, "ok");
    }
    if (
      markers.some((marker) => marker.startsWith(AUDIT_LINK_SKIPPED_PREFIX))
    ) {
      return resultOf(item, true, "ok");
    }
    const notSystemic = markers.includes("systemic:false");
    return resultOf(
      item,
      notSystemic,
      notSystemic ? "ok" : "no_corrective_action",
    );
  }

  private async bundleSealed(
    item: CloseChecklistItem,
    incident: PimsIncident,
    markers: string[],
  ): Promise<CloseChecklistItemResult> {
    const sealedSha = lastMarkerWithPrefix(markers, BUNDLE_SEALED_PREFIX);
    if (sealedSha === null) {
      return resultOf(item, false, "no_bundle_sealed_marker");
    }
    const manifest = await this.evidenceStore.getBundleManifest(
      incident.incident_code,
    );
    if (manifest === null || manifest.seal_sha256 !== sealedSha) {
      return resultOf(item, false, "manifest_seal_mismatch");
    }
    return resultOf(item, true, "ok");
  }
}
