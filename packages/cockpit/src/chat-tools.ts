import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import { type WatcherState, WatcherStateSchema } from "@pims/types/agent.ts";
import type {
  ChatCitation,
  CockpitIncidentSummary,
  CockpitSession,
  CockpitTimer,
  PendingDecision,
} from "@pims/types/cockpit.ts";
import { PimsNotFoundError, PimsValidationError } from "@pims/types/errors.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import type { RetrievalPassage } from "@pims/types/rag.ts";

const REGULATORY_TIMER_TYPES: Readonly<Record<string, true>> = {
  T72_AUTHORITY: true,
  T_REVIEW_SLA: true,
  T_SUBJECT: true,
  T_PROCESSOR: true,
};

export function summarizeIncident(
  incident: PimsIncident,
): CockpitIncidentSummary {
  return {
    id: incident.id,
    incident_code: incident.incident_code,
    status: incident.status,
    severity: incident.severity ?? null,
    impact: incident.impact ?? null,
    incident_type: incident.incident_type,
    title: incident.title,
    detection_date: incident.detection_date ?? null,
    updated_at: incident.updated_at,
  };
}

export async function getIncidentStatus(
  adapter: PimsAdapter,
  code: string,
): Promise<{
  summary: CockpitIncidentSummary;
  timestamps: {
    incident_date: string;
    detection_date: string | null;
    resolved_date: string | null;
    updated_at: string;
  };
  actions_count: number;
  attachments_count: number;
}> {
  const page = await adapter.listIncidents({ search: code });
  const incident = page.results.find(
    (candidate) => candidate.incident_code === code,
  );
  if (incident === undefined) {
    throw new PimsNotFoundError("Incident", code);
  }
  const actionsCount = incident.actions?.length ?? incident.actions_count;
  const attachmentsCount =
    incident.attachments?.length ?? incident.attachments_count;
  if (actionsCount === undefined || attachmentsCount === undefined) {
    throw new PimsValidationError("incident", "INCIDENT_CHILDREN_MISSING");
  }
  return {
    summary: summarizeIncident(incident),
    timestamps: {
      incident_date: incident.incident_date,
      detection_date: incident.detection_date ?? null,
      resolved_date: incident.resolved_date ?? null,
      updated_at: incident.updated_at,
    },
    actions_count: actionsCount,
    attachments_count: attachmentsCount,
  };
}

export async function listActiveIncidents(
  adapter: PimsAdapter,
): Promise<CockpitIncidentSummary[]> {
  const summaries: CockpitIncidentSummary[] = [];
  for (const status of ["O", "P"] as const) {
    const page = await adapter.listIncidents({ status });
    for (const incident of page.results) {
      if (incident.status === status) {
        summaries.push(summarizeIncident(incident));
      }
    }
  }
  return summaries;
}

export async function getRegulatoryTimers(
  store: EvidenceStore,
  clock: () => Date,
  code?: string,
): Promise<CockpitTimer[]> {
  const timers = await store.listActiveTimers(code);
  const now = clock().getTime();
  const out: CockpitTimer[] = [];
  for (const timer of timers) {
    if (REGULATORY_TIMER_TYPES[timer.timer_type] !== true) {
      continue;
    }
    out.push({
      timer_id: timer.timer_id,
      incident_code: timer.incident_code,
      timer_type: timer.timer_type,
      fire_at_utc: timer.fire_at_utc,
      remaining_ms: new Date(timer.fire_at_utc).getTime() - now,
    });
  }
  return out;
}

export async function getRagCitations(
  store: EvidenceStore,
  code: string,
): Promise<{ citations: string[]; passages: RetrievalPassage[] }> {
  const records = await store.listRagRetrievals(code);
  const citations = new Set<string>();
  const passages: RetrievalPassage[] = [];
  for (const record of records) {
    for (const citation of record.citations) {
      citations.add(citation);
    }
    passages.push(...record.passages);
  }
  return { citations: Array.from(citations), passages };
}

export function toChatCitations(
  passages: RetrievalPassage[],
  citations: string[],
): ChatCitation[] {
  const byCitation = new Map<string, RetrievalPassage>();
  for (const passage of passages) {
    byCitation.set(
      `${passage.doc_id}:${passage.chunk_id}:${passage.lines}`,
      passage,
    );
  }
  const out: ChatCitation[] = [];
  for (const citation of citations) {
    const passage = byCitation.get(citation);
    if (passage === undefined) {
      throw new PimsValidationError(
        "chat_citation",
        `CITATION_WITHOUT_PASSAGE:${citation}`,
      );
    }
    out.push({
      citation,
      doc_id: passage.doc_id,
      chunk_id: passage.chunk_id,
      lines: passage.lines,
      chunk_sha256: passage.chunk_sha256,
      dense_score: passage.dense_score,
      bm25_rank: passage.bm25_rank,
      rrf_score: passage.rrf_score,
      rerank_score: passage.rerank_score,
      text: passage.text,
    });
  }
  return out;
}

async function loadWatcherState(
  store: EvidenceStore,
  code: string,
): Promise<WatcherState | null> {
  const raw = await store.getAgentState(`WATCHER:${code}`);
  if (raw === null) {
    return null;
  }
  const parsed = WatcherStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PimsValidationError("watcher_state", "INVALID_WATCHER_STATE");
  }
  return parsed.data;
}

export async function checkPendingDecisions(
  adapter: PimsAdapter,
  store: EvidenceStore,
  session: CockpitSession,
): Promise<PendingDecision[]> {
  const actionable = session.permissions.includes("change_incident");
  const decisions: PendingDecision[] = [];

  for (const status of ["O", "P"] as const) {
    const page = await adapter.listIncidents({ status });
    for (const incident of page.results) {
      if (incident.status !== status) {
        continue;
      }
      const state = await loadWatcherState(store, incident.incident_code);
      if (state === null) {
        continue;
      }

      if (state.blocked_reason === "NOTIFY_NO_RECIPIENTS") {
        decisions.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "recipient_required",
          pack_type: null,
          approval_id: null,
          blocked_reason: state.blocked_reason,
          actionable,
        });
        continue;
      }

      const draftPacks: Array<{
        pack_type: "authority" | "subject";
        pack_id: string | null;
        approval_id: string | null;
        state: string;
      }> = [];
      for (const packType of ["authority", "subject"] as const) {
        const row = await store.getDraftPack(incident.incident_code, packType);
        if (row !== null) {
          draftPacks.push({
            pack_type: packType,
            pack_id:
              typeof row.payload === "object" &&
              row.payload !== null &&
              !Array.isArray(row.payload) &&
              typeof (row.payload as Record<string, unknown>).pack_id ===
                "string"
                ? String((row.payload as Record<string, unknown>).pack_id)
                : null,
            approval_id: row.reviewApprovalId,
            state: row.state,
          });
        }
      }

      if (draftPacks.some((pack) => pack.state === "draft")) {
        decisions.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "revision_required",
          pack_type: null,
          approval_id: null,
          blocked_reason: null,
          actionable,
        });
        continue;
      }

      if (state.stage !== "awaiting_approval") {
        continue;
      }

      const approved = draftPacks.filter((pack) => pack.state === "approved");
      if (approved.length === 0) {
        decisions.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "notice_approval",
          pack_type: null,
          approval_id: null,
          blocked_reason: null,
          actionable,
        });
        continue;
      }
      for (const pack of approved) {
        decisions.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "notice_approval",
          pack_type: pack.pack_type,
          approval_id: pack.approval_id,
          blocked_reason: null,
          actionable,
        });
      }
    }
  }

  return decisions;
}
