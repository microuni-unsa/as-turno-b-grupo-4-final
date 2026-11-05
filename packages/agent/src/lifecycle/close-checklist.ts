import { readMarkers } from "@pims/agent/lifecycle/markers.ts";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import {
  CLOSE_CHECKLIST_ITEMS,
  type CloseChecklistItem,
} from "@pims/types/agent.ts";
import { PimsClientBugError } from "@pims/types/errors.ts";
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
  } else {
    return null;
  }
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
    const skipped = new Set<CloseChecklistItem>(
      opts !== undefined && opts.skip !== undefined ? opts.skip : [],
    );
    const markers = readMarkers(incident.evidence_refs);
    const epochActions = await this.epochActions(incident);

    const items: CloseChecklistItemResult[] = [];
    for (const item of CLOSE_CHECKLIST_ITEMS) {
      if (skipped.has(item)) {
      } else {
        items.push(
          await this.evaluateItem(item, incident, markers, epochActions),
        );
      }
    }

    const allPassed = items.every((entry) => entry.passed);
    return { passed: allPassed, items };
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
      default: {
        const _exhaustive: never = item;
        throw new PimsClientBugError(
          `Unhandled close checklist item: ${_exhaustive}`,
        );
      }
    }
  }

  private async epochActions(
    incident: PimsIncident,
  ): Promise<PimsIncidentAction[]> {
    let actions: PimsIncidentAction[];
    if (incident.actions !== undefined) {
      actions = incident.actions;
    } else {
      actions = [];
    }
    const baseline = await this.evidenceStore.getAgentState(
      `REOPEN_BASELINE:${incident.incident_code}`,
    );
    if (baseline === null) {
      return actions;
    } else {
      const actionCount = readsActionCount(baseline);
      if (actionCount === null) {
        return actions;
      } else {
        return actions.slice(actionCount);
      }
    }
  }

  private analysisAction(
    item: CloseChecklistItem,
    epochActions: PimsIncidentAction[],
  ): CloseChecklistItemResult {
    const present = epochActions.some((action) => action.action_type === "A");
    if (present) {
      return resultOf(item, true, "ok");
    } else {
      return resultOf(item, false, "no_analysis_action");
    }
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
    } else {
      const considered =
        incident.measure_considered_resolved === "Y" &&
        epochActions.some(
          (action) => action.action_type === "A" && nonEmpty(action.evidence),
        );
      if (considered) {
        return resultOf(item, true, "ok");
      } else {
        return resultOf(item, false, "no_resolution_action_or_consideration");
      }
    }
  }

  private async reviewerSignoff(
    item: CloseChecklistItem,
    markers: string[],
  ): Promise<CloseChecklistItemResult> {
    const approvalId = lastMarkerWithPrefix(markers, CLOSE_APPROVED_PREFIX);
    if (approvalId === null) {
      return resultOf(item, false, "no_close_approved_marker");
    } else {
      const approval = await this.evidenceStore.getReviewApproval(approvalId);
      if (approval === null) {
        return resultOf(item, false, "approval_not_found");
      } else if (approval.consumed_at_utc !== null) {
        return resultOf(item, false, "approval_consumed");
      } else if (approval.pack_type !== "resolution") {
        return resultOf(item, false, "approval_not_resolution");
      } else {
        return resultOf(item, true, "ok");
      }
    }
  }

  private art33Documentation(
    item: CloseChecklistItem,
    incident: PimsIncident,
    markers: string[],
    epochActions: PimsIncidentAction[],
  ): CloseChecklistItemResult {
    if (!nonEmpty(incident.description)) {
      return resultOf(item, false, "missing_description");
    } else if (incident.affected_cid.length === 0) {
      return resultOf(item, false, "missing_affected_cid");
    } else {
      const phasedPending = markers.some((marker) =>
        marker.startsWith(PHASED_PENDING_PREFIX),
      );
      const countKnown =
        !incident.involves_personal_data ||
        typeof incident.num_affected_subjects === "number" ||
        phasedPending;
      if (!countKnown) {
        return resultOf(item, false, "missing_subject_count");
      } else {
        const documented = epochActions.some(
          (action) =>
            (action.action_type === "C" || action.action_type === "A") &&
            nonEmpty(action.evidence),
        );
        if (documented) {
          return resultOf(item, true, "ok");
        } else {
          return resultOf(item, false, "missing_evidence_action");
        }
      }
    }
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
      } else if (subject !== null && subject.state !== "not_required") {
        return resultOf(item, false, "subject_pack_not_terminal");
      } else {
        return resultOf(item, true, "ok");
      }
    } else {
      if (authority === null || authority.state !== "sent") {
        return resultOf(item, false, "authority_pack_not_sent");
      } else if (
        subject === null ||
        (subject.state !== "sent" &&
          subject.state !== "exempted" &&
          subject.state !== "not_required")
      ) {
        return resultOf(item, false, "subject_pack_not_terminal");
      } else {
        const activeTimers = await this.evidenceStore.listActiveTimers(
          incident.incident_code,
        );
        const pendingPhase = activeTimers.some(
          (timer) => timer.timer_type === "T_PHASE_FOLLOWUP",
        );
        if (pendingPhase) {
          return resultOf(item, false, "phase_followup_pending");
        } else {
          return resultOf(item, true, "ok");
        }
      }
    }
  }

  private resolvedDate(
    item: CloseChecklistItem,
    incident: PimsIncident,
  ): CloseChecklistItemResult {
    if (!nonEmpty(incident.resolved_date)) {
      return resultOf(item, false, "missing_resolved_date");
    } else if (incident.measure_considered_resolved !== "Y") {
      return resultOf(item, false, "not_considered_resolved");
    } else if (!Array.isArray(incident.security_measures_adopted)) {
      return resultOf(item, false, "missing_security_measures");
    } else {
      return resultOf(item, true, "ok");
    }
  }

  private correctiveAction(
    item: CloseChecklistItem,
    markers: string[],
  ): CloseChecklistItemResult {
    if (markers.some((marker) => AUDIT_LINK_PATTERN.test(marker))) {
      return resultOf(item, true, "ok");
    } else if (
      markers.some((marker) => marker.startsWith(AUDIT_LINK_SKIPPED_PREFIX))
    ) {
      return resultOf(item, true, "ok");
    } else {
      const notSystemic = markers.includes("systemic:false");
      if (notSystemic) {
        return resultOf(item, true, "ok");
      } else {
        return resultOf(item, false, "no_corrective_action");
      }
    }
  }

  private async bundleSealed(
    item: CloseChecklistItem,
    incident: PimsIncident,
    markers: string[],
  ): Promise<CloseChecklistItemResult> {
    const sealedSha = lastMarkerWithPrefix(markers, BUNDLE_SEALED_PREFIX);
    if (sealedSha === null) {
      return resultOf(item, false, "no_bundle_sealed_marker");
    } else {
      const manifest = await this.evidenceStore.getBundleManifest(
        incident.incident_code,
      );
      if (manifest === null || manifest.seal_sha256 !== sealedSha) {
        return resultOf(item, false, "manifest_seal_mismatch");
      } else {
        return resultOf(item, true, "ok");
      }
    }
  }
}
