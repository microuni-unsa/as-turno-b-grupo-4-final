import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { draftGuidedIncident } from "@pims/cockpit/guided-create.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import { type WatcherState, WatcherStateSchema } from "@pims/types/agent.ts";
import type {
  ChatCitation,
  ChatFormMutation,
  CockpitIncidentSummary,
  CockpitSession,
  CockpitTimer,
  ComplianceFinding,
  GuidedReporting,
  PendingDecision,
} from "@pims/types/cockpit.ts";
import { PimsNotFoundError, PimsValidationError } from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import type { RetrievalPassage } from "@pims/types/rag.ts";

export const REGULATORY_TIMER_TYPES: Readonly<Record<string, true>> = {
  T72_AUTHORITY: true,
  T_REVIEW_SLA: true,
  T_SUBJECT: true,
  T_PROCESSOR: true,
  T_PERU_ADVISORY: true,
  T_PHASE_FOLLOWUP: true,
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
  // Countdown shows live timers only. Fired deadlines stay visible through
  // the deadline_breached decision cards (listTimers), not as 00:00:00 rows.
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

export function blockedReasonToSpanish(code: string | null): string {
  if (!code) {
    return "El ciclo autónomo se detuvo con error.";
  }
  if (code.startsWith("MODEL_UNAVAILABLE")) {
    return "El modelo de lenguaje no respondió (tiempo de espera o servicio no disponible). Se conserva la última propuesta válida.";
  }
  if (code.startsWith("MODEL_SCHEMA_VIOLATION")) {
    return "El modelo devolvió un formato inválido. Se conserva la última propuesta válida.";
  }
  if (code.startsWith("RAG_NO_EVIDENCE")) {
    return "Sin evidencia normativa sobre el umbral mínimo.";
  }
  if (code.startsWith("PACK_STALE_RETRY")) {
    return "La propuesta quedó desactualizada durante la generación.";
  }
  return "El ciclo autónomo se detuvo con error.";
}

export function anchorFindingToIncident(
  passage: RetrievalPassage,
  _incident?: unknown,
): string {
  const target =
    `${passage.article_or_clause} ${passage.text.slice(0, 150)}`.toLowerCase();
  if (/risk|assessment/i.test(target)) {
    return "Evaluación de riesgo (severidad/impacto)";
  }
  if (/breach|notification/i.test(target)) {
    return "Notificación y plazos";
  }
  if (/encrypt|security measure/i.test(target)) {
    return "Medidas de seguridad adoptadas";
  }
  return "Descripción del incidente";
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
      const [authRow, subjRow, timers, rootCause, ragRecords] =
        await Promise.all([
          store.getDraftPack(incident.incident_code, "authority"),
          store.getDraftPack(incident.incident_code, "subject"),
          store.listTimers(incident.incident_code),
          store.getRootCause(incident.incident_code),
          store.listRagRetrievals(incident.incident_code, 20),
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

      const allPassages: RetrievalPassage[] = ragRecords.flatMap(
        (record) => record.passages,
      );

      const draftPacks: Array<{
        pack_type: "authority" | "subject";
        pack_id: string | null;
        approval_id: string | null;
        state: string;
        proposal: JsonObject | null;
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
            proposal:
              typeof row.payload === "object" &&
              row.payload !== null &&
              !Array.isArray(row.payload)
                ? (row.payload as JsonObject)
                : null,
          });
        }
      }

      const activeProposal =
        draftPacks.find((p) => p.proposal !== null)?.proposal ?? null;
      const activeProposalState =
        draftPacks.find((p) => p.proposal !== null)?.state ?? null;

      function resolvePackFindings(
        proposal: JsonObject | null,
      ): ComplianceFinding[] {
        if (!proposal || !Array.isArray(proposal.citations)) {
          return [];
        }
        const citations = proposal.citations as string[];
        const findings: ComplianceFinding[] = [];
        for (const citation of citations) {
          try {
            const [chatCite] = toChatCitations(allPassages, [citation]);
            if (chatCite) {
              const passage = allPassages.find(
                (p) =>
                  `${p.doc_id}:${p.chunk_id}:${p.lines}` === citation ||
                  p.chunk_id === chatCite.chunk_id,
              );
              const anchor = passage
                ? anchorFindingToIncident(passage, incident)
                : "Descripción del incidente";
              findings.push({
                citation: chatCite.citation,
                doc_id: chatCite.doc_id,
                chunk_id: chatCite.chunk_id,
                lines: chatCite.lines,
                chunk_sha256: chatCite.chunk_sha256,
                dense_score: chatCite.dense_score,
                bm25_rank: chatCite.bm25_rank,
                rrf_score: chatCite.rrf_score,
                rerank_score: chatCite.rerank_score,
                text: chatCite.text,
                incident_anchor: anchor,
                framework:
                  chatCite.doc_id === "iso27701" ? "iso27701" : "gdpr-full",
              });
            }
          } catch {
            // CITATION_WITHOUT_PASSAGE: skip missing citation
          }
        }
        return findings;
      }

      const activeFindings = resolvePackFindings(activeProposal);

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
          proposal: activeProposal,
          proposal_state: activeProposalState,
          root_cause: rootCause,
          findings: activeFindings,
        });
      }

      if (state === null) {
        return out.length > 0 ? out : null;
      }

      // A watcher parked in blocked stage is operator-actionable: the retry
      // loop alone may never converge (e.g. deterministic model failure).
      if (state.stage === "blocked") {
        const rawCode =
          state.last_error_code ?? state.blocked_reason ?? "UNKNOWN";
        out.push({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "agent_blocked" as const,
          pack_type: null,
          approval_id: null,
          blocked_reason: blockedReasonToSpanish(rawCode),
          error_code: rawCode,
          actionable,
          proposal: activeProposal,
          proposal_state: activeProposalState,
          root_cause: rootCause,
          findings: activeFindings,
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
            proposal: activeProposal,
            proposal_state: activeProposalState,
            root_cause: rootCause,
            findings: activeFindings,
          },
        ];
      }

      const drafts = draftPacks.filter((pack) => pack.state === "draft");
      if (drafts.length > 0) {
        return drafts.map((pack) => ({
          incident_id: incident.id,
          incident_code: incident.incident_code,
          kind: "notice_approval" as const,
          pack_type: pack.pack_type,
          approval_id: null,
          blocked_reason: null,
          actionable,
          proposal: pack.proposal,
          proposal_state: pack.state,
          root_cause: rootCause,
          findings: resolvePackFindings(pack.proposal),
        }));
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
            proposal: activeProposal,
            proposal_state: activeProposalState,
            root_cause: rootCause,
            findings: activeFindings,
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
        proposal: pack.proposal,
        proposal_state: pack.state,
        root_cause: rootCause,
        findings: resolvePackFindings(pack.proposal),
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

const FORM_CREATE_KEYWORDS: readonly string[] = [
  "crear incidente",
  "nuevo incidente",
  "reporte de brecha",
  "incidente nuevo",
  "filtración",
  "filtracion",
  "ransomware",
  "afectó a",
  "afecto a",
  "vulnerabilidad",
  "ataque",
  "compromiso",
  "exfiltración",
  "exfiltracion",
];

const FORM_UPDATE_KEYWORDS: readonly string[] = [
  "cambiar",
  "actualizar",
  "modificar",
  "poner",
  "asignar",
  "establecer",
  "severidad",
  "impacto",
  "datos personales",
  "sujetos afectados",
  "título",
  "titulo",
  "descripcion",
  "descripción",
];

const MANDATORY_FORM_FIELDS: readonly (keyof GuidedReporting)[] = [
  "title",
  "incident_date",
  "incident_type",
  "involves_personal_data",
];

export function detectFormIntent(
  message: string,
  formContext?: Partial<GuidedReporting>,
): boolean {
  if (
    formContext !== undefined &&
    formContext !== null &&
    Object.keys(formContext).length > 0
  ) {
    return true;
  }
  const lower = message.toLowerCase();
  for (const kw of FORM_CREATE_KEYWORDS) {
    if (lower.includes(kw)) {
      return true;
    }
  }
  for (const kw of FORM_UPDATE_KEYWORDS) {
    if (lower.includes(kw)) {
      return true;
    }
  }
  return false;
}

export async function analyzeFormMutation(
  deps: {
    config: AgentConfig;
    modelClient: AgentModelClient;
    presidioClient: PresidioClient;
    ragService: RAGService;
    now?: () => Date;
  },
  message: string,
  formContext?: Partial<GuidedReporting>,
  username?: string,
): Promise<ChatFormMutation | undefined> {
  if (!detectFormIntent(message, formContext)) {
    return undefined;
  }

  const draftResponse = await draftGuidedIncident(
    { narrative: message, partial: formContext ?? {} },
    deps,
    username ?? "operador",
  );

  const changedFields: string[] = [];
  if (formContext !== undefined && formContext !== null) {
    for (const [key, value] of Object.entries(draftResponse.draft)) {
      const prev = (formContext as Record<string, unknown>)[key];
      if (JSON.stringify(value) !== JSON.stringify(prev)) {
        changedFields.push(key);
      }
    }
  }

  const lower = message.toLowerCase();
  const asksToChangeFields = FORM_UPDATE_KEYWORDS.some((kw) =>
    lower.includes(kw),
  );
  const isUpdate =
    formContext !== undefined &&
    formContext !== null &&
    Object.keys(formContext).length > 2 &&
    asksToChangeFields;
  const action: ChatFormMutation["action"] = isUpdate ? "update" : "draft";

  const missingFields: string[] = [];
  for (const field of MANDATORY_FORM_FIELDS) {
    const value = draftResponse.draft[field];
    if (value === null || value === undefined || value === "") {
      missingFields.push(field);
    }
  }

  const summary =
    action === "update"
      ? "Se actualizaron campos del formulario"
      : "Borrador de incidente generado a partir de la narrativa";

  return {
    action,
    fields: draftResponse.draft,
    provenance: draftResponse.provenance,
    summary,
    missing_mandatory_fields: missingFields,
  };
}
