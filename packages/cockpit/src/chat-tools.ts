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

let incidentCache: { data: CockpitIncidentSummary[]; at: number } | null = null;
const INCIDENT_CACHE_TTL_MS = 5000;

export function invalidateIncidentCache(): void {
  incidentCache = null;
}

export async function listAllIncidents(
  adapter: PimsAdapter,
): Promise<CockpitIncidentSummary[]> {
  const now = Date.now();
  if (
    incidentCache !== null &&
    now - incidentCache.at < INCIDENT_CACHE_TTL_MS
  ) {
    return [...incidentCache.data];
  }
  const summaries: CockpitIncidentSummary[] = [];
  const seenIds = new Set<number>();
  let page = 1;
  const MAX_PAGES = 50;

  while (page <= MAX_PAGES) {
    let res: { results: PimsIncident[]; next: string | null };
    try {
      res = await adapter.listIncidents({ page, page_size: 100 });
    } catch (err) {
      // If page > 1 and PIMS returned 404/invalid page, pagination is exhausted
      if (page > 1) {
        break;
      }
      throw err;
    }
    let addedCount = 0;
    for (const incident of res.results) {
      if (!seenIds.has(incident.id)) {
        seenIds.add(incident.id);
        summaries.push(summarizeIncident(incident));
        addedCount += 1;
      }
    }
    if (res.next === null || res.results.length === 0 || addedCount === 0) {
      break;
    }
    page += 1;
  }
  const sorted = summaries.sort((a, b) => b.id - a.id);
  incidentCache = { data: sorted, at: now };
  return [...sorted];
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
  activeIncidentList?: Array<{
    id: number;
    incident_code: string;
    status: string;
  }>,
): Promise<PendingDecision[]> {
  const actionable = session.permissions.includes("change_incident");
  const candidates: Array<{
    id: number;
    incident_code: string;
    status: string;
  }> = [];

  if (activeIncidentList !== undefined) {
    for (const inc of activeIncidentList) {
      if (inc.status === "O" || inc.status === "P") {
        candidates.push(inc);
      }
    }
  } else {
    for (const status of ["O", "P"] as const) {
      const page = await adapter.listIncidents({ status });
      for (const incident of page.results) {
        if (incident.status === status) {
          candidates.push(incident);
        }
      }
    }
  }

  const decisions: PendingDecision[] = [];

  const checks = await Promise.all(
    candidates.map(async (incident) => {
      const state = await loadWatcherState(store, incident.incident_code);
      const out: PendingDecision[] = [];

      // Breached deadlines stay visible: a fired T72/T_REVIEW_SLA with no
      // sent pack is the highest-priority operator signal, not silence.
      const [authRow, subjRow, timers] = await Promise.all([
        store.getDraftPack(incident.incident_code, "authority"),
        store.getDraftPack(incident.incident_code, "subject"),
        store.listTimers(incident.incident_code),
      ]);
      const breached = timers.filter(
        (timer) =>
          (timer.timer_type === "T72_AUTHORITY" ||
            timer.timer_type === "T_REVIEW_SLA") &&
          timer.fired &&
          timer.cancelled_reason === null,
      );
      const authoritySent = authRow !== null && authRow.state === "sent";
      const subjectTerminal =
        subjRow !== null &&
        (subjRow.state === "sent" ||
          subjRow.state === "exempted" ||
          subjRow.state === "not_required");
      const unmetBreach = breached.filter((timer) =>
        timer.timer_type === "T72_AUTHORITY"
          ? !authoritySent
          : !subjectTerminal,
      );
      if (unmetBreach.length > 0) {
        out.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "deadline_breached" as const,
          pack_type: null,
          approval_id: null,
          blocked_reason: unmetBreach
            .map((timer) => timer.timer_type)
            .join(","),
          actionable,
        });
      }

      if (state === null) {
        return out.length > 0 ? out : null;
      }

      // A watcher parked in blocked stage is operator-actionable: the retry
      // loop alone may never converge (e.g. deterministic model failure).
      if (state.stage === "blocked") {
        out.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "agent_blocked" as const,
          pack_type: null,
          approval_id: null,
          blocked_reason:
            state.last_error_code ?? state.blocked_reason ?? "UNKNOWN",
          actionable,
        });
        return out;
      }

      if (state.blocked_reason === "NOTIFY_NO_RECIPIENTS") {
        return [
          {
            incident_id: incident.id,
            incident_code: incident.incident_code,
            kind: "recipient_required" as const,
            pack_type: null,
            approval_id: null,
            blocked_reason: state.blocked_reason,
            actionable,
          },
        ];
      }
      // authRow/subjRow already fetched above for the breach check.

      const draftPacks: Array<{
        pack_type: "authority" | "subject";
        pack_id: string | null;
        approval_id: string | null;
        state: string;
      }> = [];

      for (const [packType, row] of [
        ["authority", authRow] as const,
        ["subject", subjRow] as const,
      ]) {
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
        return [
          {
            incident_id: incident.id,
            incident_code: incident.incident_code,
            kind: "revision_required" as const,
            pack_type: null,
            approval_id: null,
            blocked_reason: null,
            actionable,
          },
        ];
      }

      if (state.stage !== "awaiting_approval") {
        return out.length > 0 ? out : null;
      }

      const approved = draftPacks.filter((pack) => pack.state === "approved");
      if (approved.length === 0) {
        return [
          {
            incident_id: incident.id,
            incident_code: incident.incident_code,
            kind: "notice_approval" as const,
            pack_type: null,
            approval_id: null,
            blocked_reason: null,
            actionable,
          },
        ];
      }
      return approved.map((pack) => ({
        incident_id: incident.id,
        incident_code: incident.incident_code,
        kind: "notice_approval" as const,
        pack_type: pack.pack_type,
        approval_id: pack.approval_id,
        blocked_reason: null,
        actionable,
      }));
    }),
  );

  for (const item of checks) {
    if (item !== null) {
      decisions.push(...item);
    }
  }

  return decisions;
}
