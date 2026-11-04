import {
  type AgentModelClient,
  redactForPrompt,
} from "@pims/agent/llm/safe-prompt.ts";
import {
  checkPendingDecisions,
  getIncidentStatus,
  getRagCitations,
  getRegulatoryTimers,
  listActiveIncidents,
  toChatCitations,
} from "@pims/cockpit/chat-tools.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { extractIocs, extractPii } from "@pims/evidence/forensic-patterns.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type {
  ChatCitation,
  ChatPersona,
  ChatRequest,
  ChatResponse,
  CockpitIncidentSummary,
  CockpitSession,
} from "@pims/types/cockpit.ts";
import { MODEL_ROUTE_REASONING } from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CockpitChatInvalidError,
  CockpitPermissionDeniedError,
  CockpitPiiBlockedError,
} from "@pims/types/errors.ts";
import {
  type JsonObject,
  JsonObjectSchema,
  type JsonValue,
} from "@pims/types/models.ts";
import type { RetrievalPassage } from "@pims/types/rag.ts";

const PERSONA_PROMPTS: Record<ChatPersona, string> = {
  auditor:
    "You are a compliance auditor assistant. Answer clause by clause with exact normative citations and sealed evidence-bundle hashes. State only what the supplied tool results prove. Never paraphrase a normative obligation as if it were a quote.",
  executive:
    "You are an executive incident-response assistant. Summarise business risk, SLA exposure and containment status in plain language. Avoid legalese, but never omit a missed or imminent regulatory deadline.",
  dpo: "You are the Data Protection Officer assistant. Focus on GDPR Article 33 and Article 34 deadlines, data-subject rights, plain-language obligations, and the Article 34(3) statutory exemptions. Cite the exact normative evidence supplied.",
};

const RESPONSE_CONTRACT =
  'Answer only from the provided tool results. Return strict JSON {"reply": string, "citations_used": string[], "suggested_actions": string[]}. In citations_used, return ONLY the exact citation_id strings (e.g. ["C1", "C2"]) copied from the citations list, or [] if none apply. Never put statute names or article numbers in citations_used. Never invent citations.';

export function resolvePersona(
  session: CockpitSession,
  requested: ChatPersona | undefined,
): ChatPersona {
  if (requested === undefined) {
    return session.default_persona;
  }
  if (requested === session.default_persona) {
    return requested;
  }
  if (!session.can_switch_persona) {
    throw new CockpitPermissionDeniedError("persona_switch");
  }
  return requested;
}

function extractIncidentCode(message: string): string | null {
  const match = message.match(/\b[A-Z]{2,}-\d+\b/i);
  return match === null ? null : match[0].toUpperCase();
}

function redactSummary(
  summary: CockpitIncidentSummary,
): CockpitIncidentSummary {
  return { ...summary, title: redactForPrompt(summary.title) };
}

function sanitizeForPrompt(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return redactForPrompt(value);
  }
  if (typeof value === "number") {
    const text = String(value);
    const redacted = redactForPrompt(text);
    return redacted === text ? value : redacted;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForPrompt(entry));
  }
  if (typeof value === "object" && value !== null) {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeForPrompt(entry);
    }
    return out;
  }
  return value;
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
  config: AgentConfig;
  clock: () => Date;
}

export async function handleChat(
  deps: HandleChatDeps,
  session: CockpitSession,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (!session.permissions.includes("view_incident")) {
    throw new CockpitPermissionDeniedError("view_incident");
  }
  const persona = resolvePersona(session, request.persona);
  const redactedMessage = redactForPrompt(request.message);

  const toolCalls: string[] = [];
  const activeIncidents = await listActiveIncidents(deps.adapter);
  toolCalls.push("list_active_incidents");

  const timers = await getRegulatoryTimers(deps.store, deps.clock);
  toolCalls.push("get_regulatory_timers");

  const pendingDecisions = await checkPendingDecisions(
    deps.adapter,
    deps.store,
    session,
  );
  toolCalls.push("check_pending_decisions");

  const code = request.incident_code ?? extractIncidentCode(request.message);
  let incidentStatus: JsonValue = null;
  const citationEntries: JsonValue[] = [];
  const citationById = new Map<string, ChatCitation>();
  let ragCitations: { passages: RetrievalPassage[]; citations: string[] } = {
    passages: [],
    citations: [],
  };

  if (code !== null) {
    const status = await getIncidentStatus(deps.adapter, code);
    toolCalls.push("get_incident_status");
    incidentStatus = {
      summary: redactSummary(status.summary),
      timestamps: status.timestamps,
      actions_count: status.actions_count,
      attachments_count: status.attachments_count,
    };

    ragCitations = await getRagCitations(deps.store, code);
    toolCalls.push("get_rag_citations");
    const chatCitations = toChatCitations(
      ragCitations.passages,
      ragCitations.citations,
    );
    citationEntries.push(
      ...chatCitations.map((citation, index) => {
        const citationId = `C${index + 1}`;
        citationById.set(citationId, citation);
        citationById.set(citation.chunk_id, citation);
        citationById.set(citation.doc_id, citation);
        citationById.set(citation.citation, citation);
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
  }

  const context = JsonObjectSchema.parse({
    persona,
    user_message: redactedMessage,
    incident_code: code,
    incident: incidentStatus,
    active_incidents: activeIncidents.map((summary) => redactSummary(summary)),
    timers,
    citations: citationEntries,
    pending_decisions: pendingDecisions,
  });

  const safeContext = JsonObjectSchema.parse(sanitizeForPrompt(context));
  const serializedContext = JSON.stringify(safeContext);
  const response = await deps.modelClient.chat_json({
    route: MODEL_ROUTE_REASONING,
    system: `${PERSONA_PROMPTS[persona]} ${RESPONSE_CONTRACT}`,
    messages: [{ role: "user", content: serializedContext }],
    max_tokens: 4096,
    temperature: deps.config.TEMP_REASONING,
  });

  const reply = normalizeReplyText(response.content.reply);
  if (reply === null) {
    throw new CockpitChatInvalidError(
      `Model response did not contain a non-empty reply (keys: ${Object.keys(response.content).join(",")})`,
    );
  }

  const citationsUsed = readStringArray(
    response.content.citations_used,
    "citations_used",
  );
  const resolved: ChatCitation[] = [];
  for (const citationId of citationsUsed) {
    let citation = citationById.get(citationId);
    if (citation === undefined) {
      const lower = citationId.toLowerCase();
      for (const [key, val] of citationById.entries()) {
        if (key.toLowerCase() === lower) {
          citation = val;
          break;
        }
      }
    }
    if (citation === undefined) {
      throw new CitationFabricatedError(
        citationId,
        `Chat reply cited '${citationId}' which is absent from the supplied retrieval context`,
      );
    }
    if (!resolved.some((r) => r.chunk_sha256 === citation.chunk_sha256)) {
      resolved.push(citation);
    }
  }
  readTextArray(response.content.suggested_actions, "suggested_actions");

  const piiHits = extractPii(reply);
  const iocHits = extractIocs(reply).filter(
    (value) => !/^[0-9a-fA-F]{32,64}$/.test(value),
  );
  if (piiHits.length > 0 || iocHits.length > 0) {
    const fields: string[] = [];
    if (piiHits.length > 0) {
      fields.push("pii");
    }
    if (iocHits.length > 0) {
      fields.push("ioc");
    }
    throw new CockpitPiiBlockedError(fields);
  }

  return {
    reply,
    persona,
    citations: resolved,
    pending_decisions: pendingDecisions,
    tool_calls: toolCalls,
  };
}
