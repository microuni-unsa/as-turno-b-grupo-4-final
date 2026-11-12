import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import {
  analyzeFormMutation,
  checkPendingDecisions,
  detectFormIntent,
  getIncidentStatus,
  getRagCitations,
  getRegulatoryTimers,
  listActiveIncidents,
  toChatCitations,
} from "@pims/cockpit/chat-tools.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import type {
  ChatCitation,
  ChatFormMutation,
  ChatPersona,
  ChatRequest,
  ChatResponse,
  ChatToolAggregate,
  ChatTrace,
  ChatTraceSpan,
  CockpitSession,
  GuidedReporting,
} from "@pims/types/cockpit.ts";
import { CONSTANTS, SPANISH_OUTPUT_CONTRACT } from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CockpitChatInvalidError,
  CockpitPermissionDeniedError,
  CockpitPiiBlockedError,
  PimsNotFoundError,
} from "@pims/types/errors.ts";
import { JsonObjectSchema, type JsonValue } from "@pims/types/models.ts";
import type { RetrievalPassage } from "@pims/types/rag.ts";

const PERSONA_PROMPTS: Record<ChatPersona, string> = {
  auditor:
    "You are a compliance auditor assistant. Answer clause by clause with exact normative citations and sealed evidence-bundle hashes. State only what the supplied tool results prove. Never paraphrase a normative obligation as if it were a quote.",
  executive:
    "You are an executive incident-response assistant. Summarise business risk, SLA exposure and containment status in plain language. Avoid legalese, but never omit a missed or imminent regulatory deadline.",
  dpo: "You are the Data Protection Officer assistant. Focus on GDPR Article 33 and Article 34 deadlines, data-subject rights, plain-language obligations, and the Article 34(3) statutory exemptions. Cite the exact normative evidence supplied.",
};

const RESPONSE_CONTRACT =
  'Answer only from the provided tool results. Return strict JSON {"reply": string, "citations_used": string[], "suggested_actions": string[]}. In citations_used, return ONLY the exact citation_id strings (e.g. ["C1", "C2"]) copied from the citations list, or [] if none apply. Never put statute names, headers, or article numbers in citations_used. Never invent citations.';

export function resolvePersona(
  session: CockpitSession,
  requested: ChatPersona | undefined,
): ChatPersona {
  if (requested === undefined) {
    return session.default_persona;
  }
  switch (requested) {
    case "auditor":
    case "executive":
    case "dpo": {
      if (requested === session.default_persona) {
        return requested;
      }
      if (!session.can_switch_persona) {
        throw new CockpitPermissionDeniedError("persona_switch");
      }
      return requested;
    }
    default: {
      const _exhaustive: never = requested;
      throw new CockpitChatInvalidError(`Unsupported persona: ${_exhaustive}`);
    }
  }
}

export function getPersonaPrompt(persona: ChatPersona): string {
  switch (persona) {
    case "auditor":
      return PERSONA_PROMPTS.auditor;
    case "executive":
      return PERSONA_PROMPTS.executive;
    case "dpo":
      return PERSONA_PROMPTS.dpo;
    default: {
      const _exhaustive: never = persona;
      throw new CockpitChatInvalidError(`Unsupported persona: ${_exhaustive}`);
    }
  }
}

export type ChatMessageIntent =
  | "form_mutation"
  | "incident_query"
  | "general_query";

export function detectMessageIntent(
  message: string,
  formContext?: Partial<GuidedReporting>,
  incidentCode?: string | null,
): ChatMessageIntent {
  if (detectFormIntent(message, formContext)) {
    return "form_mutation";
  }
  if (
    incidentCode !== null &&
    incidentCode !== undefined &&
    incidentCode !== ""
  ) {
    return "incident_query";
  }
  return "general_query";
}

function extractIncidentCode(message: string): string | null {
  const match = message.match(/\bINC-\d+(?:-\d+)?\b/i);
  return match === null ? null : match[0].toUpperCase();
}

function normalizeReplyText(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    return value.trim() === "" ? null : value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => normalizeReplyText(entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length === 0 ? null : parts.join(" ");
  }
  if (typeof value === "object" && value !== null) {
    const parts: string[] = [];
    for (const entry of Object.values(value)) {
      const text = normalizeReplyText(entry);
      if (text !== null) {
        parts.push(text);
      }
    }
    return parts.length === 0 ? null : parts.join(" ");
  }
  return null;
}

function readTextArray(value: JsonValue | undefined, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new CockpitChatInvalidError(
      `Model field '${field}' must be an array`,
    );
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = normalizeReplyText(entry);
    if (text !== null) {
      out.push(text);
    }
  }
  return out;
}

function readStringArray(
  value: JsonValue | undefined,
  field: string,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new CockpitChatInvalidError(
      `Model field '${field}' must be an array of strings`,
    );
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new CockpitChatInvalidError(
        `Model field '${field}' must contain only strings`,
      );
    }
    out.push(entry);
  }
  return out;
}

export interface HandleChatDeps {
  adapter: PimsAdapter;
  store: EvidenceStore;
  modelClient: AgentModelClient;
  presidioClient?: PresidioClient;
  ragService?: RAGService;
  config: AgentConfig;
  clock: () => Date;
}

export async function handleChat(
  deps: HandleChatDeps,
  session: CockpitSession,
  request: ChatRequest,
): Promise<ChatResponse> {
  const overallStart = performance.now();
  const startIso = deps.clock().toISOString();
  if (!session.permissions.includes("view_incident")) {
    throw new CockpitPermissionDeniedError("view_incident");
  }
  const persona = resolvePersona(session, request.persona);

  const spans: ChatTraceSpan[] = [];
  const toolStats = new Map<
    string,
    { calls: number; errors: number; total_ms: number; max_ms: number }
  >();

  async function instrumentSpan<T>(
    name: string,
    type: "turn" | "tool" | "model" | "agent",
    args: Record<string, unknown>,
    fn: () => Promise<T>,
    summarizeResult: (res: T) => Record<string, unknown> | string,
  ): Promise<T> {
    const spanStart = performance.now();
    const relativeStartMs = Number((spanStart - overallStart).toFixed(2));
    let status: "ok" | "error" = "ok";
    let errorMessage: string | undefined;
    let res: T;
    try {
      res = await fn();
    } catch (err: unknown) {
      status = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      const spanEnd = performance.now();
      const durationMs = Number((spanEnd - spanStart).toFixed(2));
      spans.push({
        id: `span-${spans.length + 1}-${name}`,
        name,
        type,
        status,
        start_ms: Number(spanStart.toFixed(2)),
        end_ms: Number(spanEnd.toFixed(2)),
        duration_ms: durationMs,
        relative_start_ms: relativeStartMs,
        args,
        error: errorMessage,
        track: type === "tool" ? "Tools" : type === "model" ? "Model" : "Main",
      });

      if (type === "tool") {
        const existing = toolStats.get(name) || {
          calls: 0,
          errors: 0,
          total_ms: 0,
          max_ms: 0,
        };
        existing.calls += 1;
        existing.errors += 1;
        existing.total_ms += durationMs;
        existing.max_ms = Math.max(existing.max_ms, durationMs);
        toolStats.set(name, existing);
      }
      throw err;
    }

    const spanEnd = performance.now();
    const durationMs = Number((spanEnd - spanStart).toFixed(2));
    const resultSummary = summarizeResult(res);

    spans.push({
      id: `span-${spans.length + 1}-${name}`,
      name,
      type,
      status,
      start_ms: Number(spanStart.toFixed(2)),
      end_ms: Number(spanEnd.toFixed(2)),
      duration_ms: durationMs,
      relative_start_ms: relativeStartMs,
      args,
      result: resultSummary,
      track: type === "tool" ? "Tools" : type === "model" ? "Model" : "Main",
    });

    if (type === "tool") {
      const existing = toolStats.get(name) || {
        calls: 0,
        errors: 0,
        total_ms: 0,
        max_ms: 0,
      };
      existing.calls += 1;
      existing.total_ms += durationMs;
      existing.max_ms = Math.max(existing.max_ms, durationMs);
      toolStats.set(name, existing);
    }

    return res;
  }

  // Turn span
  spans.push({
    id: "span-1-turn",
    name: "user_turn",
    type: "turn",
    status: "ok",
    start_ms: Number(overallStart.toFixed(2)),
    end_ms: Number(overallStart.toFixed(2)),
    duration_ms: 0.1,
    relative_start_ms: 0,
    args: {
      message: request.message,
      persona,
      incident_code: request.incident_code,
    },
    result: "User query received",
    track: "Main",
  });

  const toolCalls: string[] = [];
  const activeIncidents = await instrumentSpan(
    "list_active_incidents",
    "tool",
    {},
    () => listActiveIncidents(deps.adapter),
    (res) => ({ active_incidents_count: res.length }),
  );
  toolCalls.push("list_active_incidents");

  const timers = await instrumentSpan(
    "get_regulatory_timers",
    "tool",
    {},
    () => getRegulatoryTimers(deps.store, deps.clock),
    (res) => ({ timers_count: res.length }),
  );
  toolCalls.push("get_regulatory_timers");

  const pendingDecisions = await instrumentSpan(
    "check_pending_decisions",
    "tool",
    { user_role: session.native_role },
    () => checkPendingDecisions(deps.adapter, deps.store, session),
    (res) => ({ pending_decisions_count: res.length }),
  );
  toolCalls.push("check_pending_decisions");

  const isFormIntent = detectFormIntent(request.message, request.form_context);
  const explicitCode =
    request.incident_code !== undefined &&
    request.incident_code !== null &&
    request.incident_code !== ""
      ? request.incident_code
      : null;
  const inferredCode =
    explicitCode === null && !isFormIntent
      ? extractIncidentCode(request.message)
      : null;
  let code = explicitCode ?? inferredCode;
  let incidentStatus: JsonValue = null;
  const citationEntries: JsonValue[] = [];
  const citationById = new Map<string, ChatCitation>();

  function registerCitation(citation: ChatCitation, citationId?: string): void {
    if (citationId !== undefined) {
      citationById.set(citationId, citation);
      citationById.set(citationId.toLowerCase(), citation);
    }
    citationById.set(citation.chunk_id, citation);
    citationById.set(citation.chunk_id.toLowerCase(), citation);
    citationById.set(citation.doc_id, citation);
    citationById.set(citation.doc_id.toLowerCase(), citation);
    citationById.set(citation.citation, citation);
    citationById.set(citation.citation.toLowerCase(), citation);

    if (
      citation.citation.startsWith(`${citation.doc_id}:${citation.doc_id}:`)
    ) {
      const single = citation.citation.slice(citation.doc_id.length + 1);
      citationById.set(single, citation);
      citationById.set(single.toLowerCase(), citation);
    }
    const double = `${citation.doc_id}:${citation.citation}`;
    citationById.set(double, citation);
    citationById.set(double.toLowerCase(), citation);

    const headerMatch = citation.text.match(
      /^\[DOC:([^|]+)\s*\|\s*CLAUSE:([^|]+)\s*\|\s*NORMATIVE:([^\]]+)\]/i,
    );
    if (headerMatch !== null && headerMatch[2] !== undefined) {
      const clause = headerMatch[2].trim();
      const docId = citation.doc_id;
      citationById.set(`${docId} | CLAUSE:${clause}`, citation);
      citationById.set(`${docId} | CLAUSE:${clause}`.toLowerCase(), citation);
      citationById.set(`${docId}:${docId} | CLAUSE:${clause}`, citation);
      citationById.set(
        `${docId}:${docId} | CLAUSE:${clause}`.toLowerCase(),
        citation,
      );
      citationById.set(`${docId}:${clause}`, citation);
      citationById.set(`${docId}:${clause}`.toLowerCase(), citation);
      citationById.set(`DOC:${docId} | CLAUSE:${clause}`, citation);
      citationById.set(
        `DOC:${docId} | CLAUSE:${clause}`.toLowerCase(),
        citation,
      );
      citationById.set(clause, citation);
      citationById.set(clause.toLowerCase(), citation);
    }
  }

  for (const decision of pendingDecisions) {
    if (Array.isArray(decision.findings)) {
      for (const finding of decision.findings) {
        registerCitation(finding);
      }
    }
    if (
      decision.proposal !== null &&
      decision.proposal !== undefined &&
      typeof decision.proposal === "object" &&
      Array.isArray((decision.proposal as Record<string, unknown>).citations)
    ) {
      const citations = (decision.proposal as Record<string, unknown>)
        .citations as unknown[];
      for (const rawCitation of citations) {
        if (typeof rawCitation === "string" && deps.ragService !== undefined) {
          try {
            const { chunk } = deps.ragService.getPassageByCitation(rawCitation);
            registerCitation({
              citation: rawCitation,
              doc_id: chunk.doc_id,
              chunk_id: chunk.chunk_id,
              lines: chunk.lines,
              chunk_sha256: chunk.sha256,
              dense_score: null,
              bm25_rank: null,
              rrf_score: 1.0,
              rerank_score: 1.0,
              text: chunk.text,
            });
          } catch {
            // Unindexed proposal citation; skip registration
          }
        }
      }
    }
  }

  let ragCitations: { passages: RetrievalPassage[]; citations: string[] } = {
    passages: [],
    citations: [],
  };

  if (code !== null) {
    const targetCode = code;
    try {
      const status = await instrumentSpan(
        "get_incident_status",
        "tool",
        { code: targetCode },
        () => getIncidentStatus(deps.adapter, targetCode),
        (res) => ({ summary: res.summary, actions_count: res.actions_count }),
      );
      toolCalls.push("get_incident_status");
      incidentStatus = {
        summary: status.summary,
        timestamps: status.timestamps,
        actions_count: status.actions_count,
        attachments_count: status.attachments_count,
      };

      ragCitations = await instrumentSpan(
        "get_rag_citations",
        "tool",
        { code: targetCode },
        () => getRagCitations(deps.store, targetCode),
        (res) => ({
          citations_count: res.citations.length,
          passages_count: res.passages.length,
        }),
      );
      toolCalls.push("get_rag_citations");
      const chatCitations = toChatCitations(
        ragCitations.passages,
        ragCitations.citations,
      );
      citationEntries.push(
        ...chatCitations.map((citation, index) => {
          const citationId = `C${index + 1}`;
          registerCitation(citation, citationId);

          return {
            citation_id: citationId,
            doc_id: citation.doc_id,
            chunk_id: citation.chunk_id,
            chunk_sha256: citation.chunk_sha256,
            dense_score: citation.dense_score,
            bm25_rank: citation.bm25_rank,
            rrf_score: citation.rrf_score,
            rerank_score: citation.rerank_score,
            text: citation.text,
          };
        }),
      );
    } catch (err: unknown) {
      if (err instanceof PimsNotFoundError && explicitCode === null) {
        code = null;
      } else {
        throw err;
      }
    }
  }

  if (citationEntries.length === 0 && deps.ragService !== undefined) {
    const ragService = deps.ragService;
    try {
      const generalRag = await instrumentSpan(
        "query_rag_knowledge",
        "tool",
        { query: request.message },
        () => ragService.query(request.message),
        (res) => ({
          citations_count: res.citations.length,
          passages_count: res.passages.length,
        }),
      );
      toolCalls.push("query_rag_knowledge");
      const chatCitations = toChatCitations(
        generalRag.passages,
        generalRag.citations,
      );
      citationEntries.push(
        ...chatCitations.map((citation, index) => {
          const citationId = `C${citationEntries.length + index + 1}`;
          registerCitation(citation, citationId);

          return {
            citation_id: citationId,
            doc_id: citation.doc_id,
            chunk_id: citation.chunk_id,
            chunk_sha256: citation.chunk_sha256,
            dense_score: citation.dense_score,
            bm25_rank: citation.bm25_rank,
            rrf_score: citation.rrf_score,
            rerank_score: citation.rerank_score,
            text: citation.text,
          };
        }),
      );
    } catch {
      // General RAG query failed or corpus empty; proceed without fatal interruption
    }
  }

  let formMutation: ChatFormMutation | undefined;
  const presidioClient = deps.presidioClient;
  const ragService = deps.ragService;
  const intent = detectMessageIntent(
    request.message,
    request.form_context,
    code,
  );
  switch (intent) {
    case "form_mutation": {
      if (presidioClient !== undefined && ragService !== undefined) {
        const mutation = await instrumentSpan(
          "form_mutation",
          "tool",
          { message: request.message },
          () =>
            analyzeFormMutation(
              {
                config: deps.config,
                modelClient: deps.modelClient,
                presidioClient,
                ragService,
                now: deps.clock,
              },
              request.message,
              request.form_context,
              session.username,
            ),
          (res) => ({
            action: res?.action,
            summary: res?.summary,
            missing_count: res?.missing_mandatory_fields?.length ?? 0,
          }),
        );
        toolCalls.push("form_mutation");
        if (mutation !== undefined) {
          formMutation = mutation;
        }
      }
      break;
    }
    case "incident_query": {
      break;
    }
    case "general_query": {
      break;
    }
    default: {
      const _exhaustive: never = intent;
      throw new CockpitChatInvalidError(
        `Unhandled message intent: ${_exhaustive}`,
      );
    }
  }

  const contextData: Record<string, JsonValue> = {
    persona,
    user_message: request.message,
    incident_code: code,
    incident: incidentStatus,
    active_incidents: activeIncidents,
    timers,
    citations: citationEntries,
    pending_decisions: pendingDecisions,
  };
  if (formMutation !== undefined) {
    contextData.form_mutation = JSON.parse(
      JSON.stringify(formMutation),
    ) as JsonValue;
  }
  const context = JsonObjectSchema.parse(contextData);

  const serializedContext = JSON.stringify(context);
  const response = await instrumentSpan(
    "model_reasoning",
    "model",
    {
      route: CONSTANTS.MODEL_ROUTE_REASONING,
      persona,
      max_tokens: CONSTANTS.MAX_CHAT_MAX_TOKENS,
    },
    () =>
      deps.modelClient.chat_json({
        route: CONSTANTS.MODEL_ROUTE_REASONING,
        system: `${getPersonaPrompt(persona)} ${RESPONSE_CONTRACT}`,
        messages: [
          {
            role: "user",
            content: `${serializedContext}\n\n${SPANISH_OUTPUT_CONTRACT}`,
          },
        ],
        max_tokens: CONSTANTS.MAX_CHAT_MAX_TOKENS,
        temperature: deps.config.TEMP_REASONING,
      }),
    (res) => ({
      has_reply: typeof res.content.reply === "string",
      keys: Object.keys(res.content),
    }),
  );

  const reply = normalizeReplyText(response.content.reply);
  if (reply === null) {
    throw new CockpitChatInvalidError(
      `Model response did not contain a non-empty reply (keys: ${Object.keys(response.content).join(",")})`,
    );
  }

  if (deps.presidioClient !== undefined) {
    const findings = await deps.presidioClient.analyze(reply);
    if (findings.length > 0) {
      throw new CockpitPiiBlockedError(findings.map((f) => f.entity_type));
    }
  }

  const citationsUsed = readStringArray(
    response.content.citations_used,
    "citations_used",
  );
  const resolved: ChatCitation[] = [];
  for (const rawCitationId of citationsUsed) {
    const trimmed = rawCitationId.trim();
    let citation =
      citationById.get(trimmed) ?? citationById.get(trimmed.toLowerCase());
    if (citation === undefined) {
      const stripped = trimmed.replace(/^\[+|\]+$/g, "").trim();
      citation =
        citationById.get(stripped) ?? citationById.get(stripped.toLowerCase());
    }
    if (citation === undefined && deps.ragService !== undefined) {
      const candidates: string[] = [
        trimmed,
        trimmed.replace(/^\[+|\]+$/g, "").trim(),
      ];
      const doubleMatch = trimmed.match(/^([a-z0-9_-]+):\1:(.+)$/i);
      if (doubleMatch?.[1] && doubleMatch[2]) {
        candidates.push(`${doubleMatch[1]}:${doubleMatch[2]}`);
      }
      const singleMatch = trimmed.match(/^([a-z0-9_-]+):(\d{4}):(.+)$/i);
      if (singleMatch?.[1] && singleMatch[2] && singleMatch[3]) {
        candidates.push(
          `${singleMatch[1]}:${singleMatch[1]}:${singleMatch[2]}:${singleMatch[3]}`,
        );
      }

      for (const candidate of candidates) {
        try {
          const { chunk } = deps.ragService.getPassageByCitation(candidate);
          citation = {
            citation: candidate,
            doc_id: chunk.doc_id,
            chunk_id: chunk.chunk_id,
            lines: chunk.lines,
            chunk_sha256: chunk.sha256,
            dense_score: null,
            bm25_rank: null,
            rrf_score: 1.0,
            rerank_score: 1.0,
            text: chunk.text,
          };
          registerCitation(citation);
          break;
        } catch {
          // Candidate citation could not be resolved from RAG corpus
        }
      }

      if (citation === undefined) {
        const normalizedChunkId = trimmed.replace(/^([a-z0-9_-]+):\1:/i, "$1:");
        const directChunk =
          deps.ragService.getChunk(trimmed) ??
          deps.ragService.getChunk(normalizedChunkId) ??
          deps.ragService.getChunk(`gdpr-full:${normalizedChunkId}`) ??
          deps.ragService.getChunk(`iso27701:${normalizedChunkId}`);
        if (directChunk !== undefined) {
          citation = {
            citation: `${directChunk.doc_id}:${directChunk.chunk_id}:${directChunk.lines}`,
            doc_id: directChunk.doc_id,
            chunk_id: directChunk.chunk_id,
            lines: directChunk.lines,
            chunk_sha256: directChunk.sha256,
            dense_score: null,
            bm25_rank: null,
            rrf_score: 1.0,
            rerank_score: 1.0,
            text: directChunk.text,
          };
          registerCitation(citation);
        }
      }
    }
    if (citation === undefined) {
      throw new CitationFabricatedError(
        rawCitationId,
        `Chat reply cited '${rawCitationId}' which is absent from verified RAG retrieval chunks`,
      );
    }
    if (citation.chunk_sha256.length !== CONSTANTS.SHA256_HEX_LENGTH) {
      throw new CitationFabricatedError(
        rawCitationId,
        `Chat reply cited '${rawCitationId}' with invalid chunk hash`,
      );
    }
    if (!resolved.some((r) => r.chunk_sha256 === citation.chunk_sha256)) {
      resolved.push(citation);
    }
  }
  readTextArray(response.content.suggested_actions, "suggested_actions");

  // Extract or synthesize reasoning
  let reasoning: string | undefined;
  if (
    typeof response.content.reasoning === "string" &&
    response.content.reasoning.trim().length > 0
  ) {
    reasoning = response.content.reasoning.trim();
  } else {
    const steps: string[] = [];
    switch (persona) {
      case "auditor":
        steps.push(
          `Análisis regulatorio y normativo ejecutado con perfil auditor (${persona}).`,
        );
        break;
      case "executive":
        steps.push(
          `Resumen de impacto operativo y riesgo de negocio ejecutado con perfil ejecutivo (${persona}).`,
        );
        break;
      case "dpo":
        steps.push(
          `Evaluación de derechos del interesado y plazos GDPR ejecutada con perfil DPO (${persona}).`,
        );
        break;
      default: {
        const _exhaustive: never = persona;
        throw new CockpitChatInvalidError(`Unknown persona: ${_exhaustive}`);
      }
    }
    if (code !== null) {
      steps.push(`Contexto focalizado en incidente '${code}'.`);
    }
    steps.push(
      `Consultadas ${toolCalls.length} fuentes de datos y ${citationEntries.length} citas normativas.`,
    );
    if (pendingDecisions.length > 0) {
      steps.push(
        `Identificadas ${pendingDecisions.length} decisiones regulatorias pendientes de revisión humana.`,
      );
    }
    reasoning = steps.join(" ");
  }

  const overallEnd = performance.now();
  const wallTimeMs = Number((overallEnd - overallStart).toFixed(2));
  const toolTimeMs = Number(
    spans
      .filter((s) => s.type === "tool")
      .reduce((acc, s) => acc + s.duration_ms, 0)
      .toFixed(2),
  );
  const modelTimeMs = Number(
    spans
      .filter((s) => s.type === "model")
      .reduce((acc, s) => acc + s.duration_ms, 0)
      .toFixed(2),
  );
  const idleTimeMs = Number(
    Math.max(0, wallTimeMs - toolTimeMs - modelTimeMs).toFixed(2),
  );
  const tokensEstimate = Math.round(
    (serializedContext.length + reply.length) / 4,
  );
  const costEstimateUsd = Number(
    ((tokensEstimate / CONSTANTS.MS_PER_SECOND) * 0.00015).toFixed(5),
  );

  const aggregates: ChatToolAggregate[] = Array.from(toolStats.entries()).map(
    ([tool, stats]) => ({
      tool,
      calls: stats.calls,
      errors: stats.errors,
      total_ms: Number(stats.total_ms.toFixed(2)),
      avg_ms: Number((stats.total_ms / stats.calls).toFixed(2)),
      max_ms: Number(stats.max_ms.toFixed(2)),
    }),
  );

  const trace: ChatTrace = {
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: code
      ? `Consulta ${persona.toUpperCase()} [${code}]`
      : `Consulta ${persona.toUpperCase()}`,
    start_iso: startIso,
    wall_time_ms: wallTimeMs,
    model_time_ms: modelTimeMs,
    tool_time_ms: toolTimeMs,
    idle_time_ms: idleTimeMs,
    turns_count: 1,
    requests_count: 1,
    tool_calls_count: toolCalls.length,
    tokens_estimate: tokensEstimate,
    cost_estimate_usd: costEstimateUsd,
    spans,
    aggregates,
  };

  const chatResponse: ChatResponse = {
    reply,
    persona,
    citations: resolved,
    pending_decisions: pendingDecisions,
    tool_calls: toolCalls,
    reasoning,
    trace,
  };
  if (formMutation !== undefined) {
    chatResponse.form_mutation = formMutation;
  }
  return chatResponse;
}
