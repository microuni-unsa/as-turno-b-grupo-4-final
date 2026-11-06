import {
  type AgentModelClient,
  redactForPrompt,
} from "@pims/agent/llm/safe-prompt.ts";
import { awarenessFromIncident } from "@pims/agent/orchestrator/scheduler.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { hashCanonicalContent } from "@pims/notices/canonical-hasher.ts";
import type {
  ComposeAuthorityPackParams,
  ComposeSubjectNoticeParams,
  NoticeComposer,
} from "@pims/notices/notice-composer.ts";
import { PlainLanguageValidator } from "@pims/notices/plain-language.ts";
import type { RAGService } from "@pims/rag/rag-service.ts";
import type {
  AuthorityNoticePack,
  CloseChecklistItem,
  DpoContact,
  ExemptionEvaluationResult,
  HighRiskGateResult,
  NumericApproval,
  RetrievalPassage,
  SubjectNoticePack,
} from "@pims/types";
import { CONSTANTS, SPANISH_OUTPUT_CONTRACT } from "@pims/types/constants.ts";
import {
  ArtifactIncompleteError,
  ConfigError,
  ModelSchemaViolationError,
  PimsValidationError,
  RagNoEvidenceError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import { zodIssuesToDetails } from "@pims/types/validation.ts";
import { z } from "zod";

const AUTHORITY_RAG_QUERY =
  "GDPR Article 33(3) authority notification mandatory content: nature, categories and approximate number, DPO contact, likely consequences, measures taken or proposed";

const SUBJECT_RAG_QUERY =
  "GDPR Article 34 communication to the data subject clear and plain language nature of breach recommendations to mitigate adverse effects";

const ISO_ALIGNMENT_RAG_QUERY =
  "ISO 27701 PIMS privacy information management incident response controls: privacy risk assessment 6.1.2 and 8.2, incident management, nonconformity and corrective action 10.2, Annex A and Annex B controls";

async function queryDualNormative(
  ragService: RAGService,
  incidentCode: string,
  isoQuery: string,
  dutyQuery: string,
): Promise<{ passages: RetrievalPassage[]; citations: string[] }> {
  let isoRes: { passages: RetrievalPassage[]; citations: string[] } | null =
    null;
  let dutyRes: { passages: RetrievalPassage[]; citations: string[] } | null =
    null;
  let isoErr: unknown = null;
  let dutyErr: unknown = null;

  try {
    isoRes = await ragService.query(isoQuery, {
      normative_only: true,
      incident_code: incidentCode,
      prefer_doc_ids: ["iso27701"],
    });
  } catch (err) {
    if (err instanceof RagNoEvidenceError) {
      isoErr = err;
    } else {
      throw err;
    }
  }

  try {
    dutyRes = await ragService.query(dutyQuery, {
      normative_only: true,
      incident_code: incidentCode,
    });
  } catch (err) {
    if (err instanceof RagNoEvidenceError) {
      dutyErr = err;
    } else {
      throw err;
    }
  }

  if (isoErr && dutyErr) {
    throw isoErr;
  }
  if (!isoRes && !dutyRes) {
    if (isoErr instanceof Error) {
      throw isoErr;
    }
    if (dutyErr instanceof Error) {
      throw dutyErr;
    }
    throw new RagNoEvidenceError("No normative evidence returned");
  }

  const rawPassages = [
    ...(isoRes?.passages ?? []),
    ...(dutyRes?.passages ?? []),
  ];
  const seenChunkIds = new Set<string>();
  const passages: RetrievalPassage[] = [];
  for (const p of rawPassages) {
    if (!seenChunkIds.has(p.chunk_id)) {
      seenChunkIds.add(p.chunk_id);
      passages.push(p);
    }
  }

  const rawCitations = [
    ...(isoRes?.citations ?? []),
    ...(dutyRes?.citations ?? []),
  ];
  const seenCitations = new Set<string>();
  const citations: string[] = [];
  for (const c of rawCitations) {
    if (!seenCitations.has(c)) {
      seenCitations.add(c);
      citations.push(c);
    }
  }

  if (passages.length === 0) {
    throw new RagNoEvidenceError(
      "No normative evidence available after merging",
    );
  }

  return { passages, citations };
}

const STALE_PACK_MS = 300000;
const AUTHORITY_MAX_TOKENS = 3500;
const SUBJECT_MAX_TOKENS = 3000;
const RESOLUTION_MAX_TOKENS = 2500;

export const DRAFT_AUTHORITY_SYSTEM =
  "You draft a GDPR Article 33(3) notification pack for the supervisory authority. Ground every legal statement in the supplied RAG citations. Return strict JSON with item_a_nature, item_a_categories_subjects, item_a_approx_subjects, item_a_categories_records, item_a_approx_records, item_a_unknown, item_c_consequences, item_d_measures_taken, item_d_measures_proposed and citations. In item_a_categories_records and item_a_categories_subjects, explicitly enumerate concrete categories of personal data involved (e.g. identifying data, contact data, financial, academic or special category data) based on the incident. When the incident specifies affected subjects (e.g. 350 students), provide the approximate records count (at least equal to the number of subjects, e.g. 350 student records) and state both counts in item_a_nature and the respective count fields. Approximate counts must be non-negative integers; when a count cannot yet be determined emit 0 and list it in item_a_unknown with reason PHASED_PENDING. Never include reporter or DPO contact values in the prose; the pack carries those fields structurally. Never include individual person names, employee names, student names, phone numbers, email addresses or personal identification numbers in the notice text; all personal data must remain strictly aggregated, anonymised or referenced by role/entity only.";

export const DRAFT_SUBJECT_SYSTEM =
  "You draft a GDPR Article 34 communication to affected data subjects. Use clear and plain language, short sentences and no legal jargon. Ground every legal statement in the supplied RAG citations. body_plain MUST explicitly name each affected-data category from the incident prose (e.g. names, surnames, ID numbers, emails, phones, addresses) so the reader knows exactly what data was compromised; a body that only says personal information was exposed without naming the categories is a defect. body_plain MUST NOT contradict the structured items: never deny unauthorized access when item_c lists compromised data, and every consequence or measure in the body must be consistent with item_c_consequences and item_d_measures. Explicitly describe the categories of personal data affected and practical recommendations for the individual; recommendations must contain at least one concrete action the subject can take. Return strict JSON with body_plain, item_c_consequences, item_d_measures, recommendations and citations. Never include reporter or DPO contact values in the body; the pack carries the contact block structurally. Never include individual person names, employee names, student names, phone numbers, email addresses or personal identification numbers in the notice text.";

export const RESOLUTION_SYSTEM =
  "You summarise the resolution of a handled incident for the closure record. Return strict JSON with summary, remediation and citations. The summary must state what happened and how it was contained; the remediation must state the corrective actions taken or planned and cite the supporting legal requirements.";

export interface NoticeDraftServiceDeps {
  modelClient: AgentModelClient;
  ragService: RAGService;
  composer: NoticeComposer;
  evidenceStore: EvidenceStore;
  config: AgentConfig;
  clock: () => Date;
}

function flattenModelText(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => flattenModelText(entry))
      .filter((entry): entry is string => typeof entry === "string")
      .join(" ");
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value)
      .map((entry) => flattenModelText(entry))
      .filter((entry): entry is string => typeof entry === "string")
      .join(" ");
  }
  return value;
}

function flattenModelTextArray(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => flattenModelText(entry))
      .filter((entry): entry is string => typeof entry === "string");
  }
  const text = flattenModelText(value);
  return typeof text === "string" ? [text] : value;
}

const AUTHORITY_TEXT_FIELDS = ["item_a_nature", "item_c_consequences"] as const;
const AUTHORITY_ARRAY_FIELDS = [
  "item_a_categories_subjects",
  "item_a_categories_records",
  "item_d_measures_taken",
  "item_d_measures_proposed",
] as const;

function normalizeAuthorityContent(content: JsonObject): JsonObject {
  const out: JsonObject = { ...content };
  for (const field of AUTHORITY_TEXT_FIELDS) {
    const normalized = flattenModelText(out[field]);
    if (typeof normalized === "string") {
      out[field] = normalized;
    }
  }
  for (const field of AUTHORITY_ARRAY_FIELDS) {
    const normalized = flattenModelTextArray(out[field]);
    if (Array.isArray(normalized)) {
      out[field] = normalized;
    }
  }
  return out;
}

function normalizeSubjectContent(content: JsonObject): JsonObject {
  const out: JsonObject = { ...content };
  for (const field of ["body_plain", "item_c_consequences"] as const) {
    const normalized = flattenModelText(out[field]);
    if (typeof normalized === "string") {
      out[field] = normalized;
    }
  }
  if (out.recommendations === undefined && out.recommendation !== undefined) {
    out.recommendations = out.recommendation;
  }
  if (out.measures !== undefined && out.item_d_measures === undefined) {
    out.item_d_measures = out.measures;
  }
  for (const field of ["item_d_measures", "recommendations"] as const) {
    const normalized = flattenModelTextArray(out[field]);
    if (Array.isArray(normalized)) {
      out[field] = normalized;
    } else {
      out[field] = [];
    }
  }
  if (!Array.isArray(out.citations)) {
    out.citations = [];
  }
  return out;
}

function normalizeResolutionContent(content: JsonObject): JsonObject {
  const out: JsonObject = { ...content };
  for (const field of ["summary", "remediation"] as const) {
    const normalized = flattenModelText(out[field]);
    if (typeof normalized === "string") {
      out[field] = normalized;
    }
  }
  return out;
}

const UNKNOWN_ITEM_SCHEMA = z.object({
  item: z.string().min(1),
  reason: z.string().min(1),
});

const AUTHORITY_RESPONSE_SCHEMA = z.object({
  item_a_nature: z.string().min(1),
  item_a_categories_subjects: z.array(z.string()),
  item_a_approx_subjects: z.number().finite().nonnegative(),
  item_a_categories_records: z.array(z.string()),
  item_a_approx_records: z.number().finite().nonnegative(),
  item_a_unknown: z.array(UNKNOWN_ITEM_SCHEMA),
  item_c_consequences: z.string().min(1),
  item_d_measures_taken: z.array(z.string()),
  item_d_measures_proposed: z.array(z.string()),
  citations: z.array(z.string()),
});

type AuthorityResponse = z.infer<typeof AUTHORITY_RESPONSE_SCHEMA>;

const SUBJECT_RESPONSE_SCHEMA = z.object({
  body_plain: z.string(),
  item_c_consequences: z.string(),
  item_d_measures: z.array(z.string()),
  recommendations: z.array(z.string()),
  citations: z.array(z.string()),
});

type SubjectResponse = z.infer<typeof SUBJECT_RESPONSE_SCHEMA>;

const RESOLUTION_RESPONSE_SCHEMA = z.object({
  summary: z.string().min(1),
  remediation: z.string().min(1),
  citations: z.array(z.string()),
});

type ResolutionResponse = z.infer<typeof RESOLUTION_RESPONSE_SCHEMA>;

const AUTHORITY_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "item_a_nature",
    "item_a_categories_subjects",
    "item_a_approx_subjects",
    "item_a_categories_records",
    "item_a_approx_records",
    "item_a_unknown",
    "item_c_consequences",
    "item_d_measures_taken",
    "item_d_measures_proposed",
    "citations",
  ],
  properties: {
    item_a_nature: { type: "string" },
    item_a_categories_subjects: { type: "array", items: { type: "string" } },
    item_a_approx_subjects: { type: "integer", minimum: 0 },
    item_a_categories_records: { type: "array", items: { type: "string" } },
    item_a_approx_records: { type: "integer", minimum: 0 },
    item_a_unknown: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "reason"],
        properties: {
          item: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    item_c_consequences: { type: "string" },
    item_d_measures_taken: { type: "array", items: { type: "string" } },
    item_d_measures_proposed: { type: "array", items: { type: "string" } },
    citations: {
      type: "array",
      items: {
        type: "string",
        pattern: "^[^:]+:[^:]+:.+$",
        description:
          "Exact doc_id:chunk_id:lines citation copied from the allowed citation list",
      },
    },
  },
};

const SUBJECT_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "body_plain",
    "item_c_consequences",
    "item_d_measures",
    "recommendations",
    "citations",
  ],
  properties: {
    body_plain: { type: "string" },
    item_c_consequences: { type: "string" },
    item_d_measures: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    citations: {
      type: "array",
      items: {
        type: "string",
        pattern: "^[^:]+:[^:]+:.+$",
        description:
          "Exact doc_id:chunk_id:lines citation copied from the allowed citation list",
      },
    },
  },
};

const RESOLUTION_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "remediation", "citations"],
  properties: {
    summary: { type: "string" },
    remediation: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "string",
        pattern: "^[^:]+:[^:]+:.+$",
        description:
          "Exact doc_id:chunk_id:lines citation copied from the allowed citation list",
      },
    },
  },
};

async function renderIncidentProse(incident: PimsIncident): Promise<string> {
  const safeTitle = await redactForPrompt(incident.title);
  const safeDescription =
    incident.description !== null && incident.description !== undefined
      ? await redactForPrompt(incident.description)
      : null;
  const lines: string[] = [
    `Titulo: ${safeTitle}`,
    `Tipo: ${incident.incident_type}`,
    `Severidad: ${
      incident.severity !== null && incident.severity !== undefined
        ? incident.severity
        : "desconocida"
    }`,
    `Impacto: ${
      incident.impact !== null && incident.impact !== undefined
        ? incident.impact
        : "desconocido"
    }`,
    `Fecha del incidente: ${incident.incident_date}`,
  ];
  if (safeDescription !== null) {
    lines.push(`Descripcion: ${safeDescription}`);
  }
  if (
    incident.compromised_system !== null &&
    incident.compromised_system !== undefined
  ) {
    lines.push(`Sistema comprometido: ${incident.compromised_system}`);
  }
  lines.push(
    `Datos afectados: ${incident.affected_data_types.join(", ")}`,
    `Medidas de seguridad adoptadas: ${incident.security_measures_adopted.join(", ")}`,
    `Categorias CID: ${incident.affected_cid.join(", ")}`,
    `Titulares afectados: ${
      incident.num_affected_subjects !== null &&
      incident.num_affected_subjects !== undefined
        ? String(incident.num_affected_subjects)
        : "desconocido"
    }`,
  );
  return lines.join("\n");
}

function canonicalizeCitations(
  citations: string[],
  allowed: string[],
): string[] {
  const resolved: string[] = [];
  for (const citation of citations) {
    const normalized = citation.trim();
    const idMatch = /^C(\d+)$/.exec(normalized);
    if (idMatch?.[1] !== undefined) {
      const index = Number.parseInt(idMatch[1], 10) - 1;
      const byId = allowed[index];
      if (byId !== undefined) {
        resolved.push(byId);
      }
      continue;
    }
    if (allowed.includes(normalized)) {
      resolved.push(normalized);
      continue;
    }
    const parts = normalized.split(":");
    const lastPart = parts[parts.length - 1];
    const sequence = lastPart !== undefined ? lastPart : "";
    const firstPart = parts[0];
    const prefix = firstPart !== undefined ? firstPart : "";
    const matches = allowed.filter(
      (entry) =>
        entry.endsWith(`:${normalized}`) ||
        entry.startsWith(`${normalized}:`) ||
        (entry.startsWith(`${prefix}:`) &&
          sequence.length > 0 &&
          entry.includes(`:${sequence}:`)),
    );
    if (matches.length > 0 && matches[0] !== undefined) {
      resolved.push(matches[0]);
      continue;
    }
    if (
      parts.length >= 3 &&
      lastPart !== undefined &&
      /^\d+-\d+$/.test(lastPart)
    ) {
      resolved.push(normalized);
    }
  }
  const unique = Array.from(new Set(resolved));
  return unique.length > 0 ? unique : allowed.slice(0, 3);
}

function parseResponse<T>(
  schema: z.ZodType<T>,
  content: JsonObject,
  artifact: string,
): T {
  const parsed = schema.safeParse(content);
  if (!parsed.success) {
    throw new ModelSchemaViolationError(
      CONSTANTS.MODEL_ROUTE_REASONING,
      `Invalid ${artifact} draft response: ${parsed.error.message}`,
      { issues: zodIssuesToDetails(parsed.error) },
    );
  }
  return parsed.data;
}

function requireDpoContact(
  incident: PimsIncident,
  artifact: string,
): DpoContact {
  const name = incident.dpo_contact_name;
  const email = incident.dpo_contact_email;
  if (
    name === null ||
    name === undefined ||
    name.trim().length === 0 ||
    email === null ||
    email === undefined ||
    email.trim().length === 0
  ) {
    throw new ArtifactIncompleteError(artifact, "dpo");
  }
  return {
    name: name.trim(),
    email: email.trim(),
    phone:
      incident.dpo_contact_phone !== null &&
      incident.dpo_contact_phone !== undefined
        ? incident.dpo_contact_phone.trim()
        : null,
  };
}

export class NoticeDraftService {
  private readonly modelClient: AgentModelClient;
  private readonly ragService: RAGService;
  private readonly composer: NoticeComposer;
  private readonly evidenceStore: EvidenceStore;
  private readonly config: AgentConfig;
  private readonly clock: () => Date;

  constructor(deps: NoticeDraftServiceDeps) {
    this.modelClient = deps.modelClient;
    this.ragService = deps.ragService;
    this.composer = deps.composer;
    this.evidenceStore = deps.evidenceStore;
    this.config = deps.config;
    this.clock = deps.clock;
  }

  async draftAuthority(
    incident: PimsIncident,
    context: {
      fetchedAt: Date;
      exemption: ExemptionEvaluationResult | null;
      phase: number;
      feedback?: string;
    },
  ): Promise<{
    pack: AuthorityNoticePack;
    contentSha: string;
    citations: string[];
  }> {
    const now = this.clock();
    if (now.getTime() - context.fetchedAt.getTime() > STALE_PACK_MS) {
      throw new PimsValidationError("pack", "PACK_STALE_RETRY");
    }

    const rag = await queryDualNormative(
      this.ragService,
      incident.incident_code,
      ISO_ALIGNMENT_RAG_QUERY,
      AUTHORITY_RAG_QUERY,
    );

    const feedbackBlock =
      context.feedback !== undefined && context.feedback.trim().length > 0
        ? `\n\nReviewer feedback on the previous rejected draft (address it first, keep every other requirement):\n${context.feedback.trim()}`
        : "";
    const response = await this.modelClient.chat_json({
      system: DRAFT_AUTHORITY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${await renderIncidentProse(incident)}\nAllowed normative citations (return citations[] using ONLY the identifiers C1..Cn; never invent):\n${rag.citations.map((citation, index) => `C${index + 1} = ${citation}`).join("\n")}${feedbackBlock}\n\n${SPANISH_OUTPUT_CONTRACT}`,
        },
      ],
      json_schema: AUTHORITY_JSON_SCHEMA,
      max_tokens: AUTHORITY_MAX_TOKENS,
      temperature: this.config.TEMP_REASONING,
      route: CONSTANTS.MODEL_ROUTE_REASONING,
    });

    const draft: AuthorityResponse = parseResponse(
      AUTHORITY_RESPONSE_SCHEMA,
      normalizeAuthorityContent(response.content),
      "authority",
    );

    if (!Number.isInteger(draft.item_a_approx_subjects)) {
      throw new ArtifactIncompleteError("authority", "item_a_approx_subjects");
    }
    if (!Number.isInteger(draft.item_a_approx_records)) {
      throw new ArtifactIncompleteError("authority", "item_a_approx_records");
    }
    if (draft.item_a_approx_records <= 0 && draft.item_a_approx_subjects > 0) {
      draft.item_a_approx_records = draft.item_a_approx_subjects;
    }

    draft.citations = canonicalizeCitations(draft.citations, rag.citations);
    this.assertCitations(draft.citations, rag.citations);

    const awareness = awarenessFromIncident(incident);
    const jurisdiction = this.config.JURISDICTION_DEADLINES_JSON.EU_GDPR;
    const authorityHours = jurisdiction?.authority_h;
    if (
      typeof authorityHours !== "number" ||
      !Number.isFinite(authorityHours)
    ) {
      throw new ConfigError(
        "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON.EU_GDPR.authority_h",
        "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON.EU_GDPR.authority_h",
      );
    }
    const deadline = new Date(awareness.getTime() + authorityHours * 3600000);

    const nowMs = now.getTime();
    const deadlineMs = deadline.getTime();
    let delayReasons: { hours_late: number; reasons: string[] } | null = null;
    if (nowMs > deadlineMs) {
      const awarenessMs = awareness.getTime();
      const reasons = (
        incident.history !== null && incident.history !== undefined
          ? incident.history
          : []
      )
        .filter((row) => {
          const changedMs = new Date(row.changed_at).getTime();
          return (
            Number.isFinite(changedMs) &&
            changedMs >= awarenessMs &&
            changedMs <= nowMs
          );
        })
        .map((row) => {
          const eventType =
            row.event_type !== null && row.event_type !== undefined
              ? row.event_type
              : "event";
          const desc =
            row.description !== null && row.description !== undefined
              ? row.description
              : "";
          return `${eventType} at ${row.changed_at}: ${desc}`;
        });
      delayReasons = {
        hours_late: Math.ceil((nowMs - deadlineMs) / 3600000),
        reasons: reasons.length > 0 ? reasons : ["history_unavailable"],
      };
    }

    const phased = draft.item_a_unknown.length > 0;
    const dpo = requireDpoContact(incident, "authority");

    const params: ComposeAuthorityPackParams = {
      incident_code: incident.incident_code,
      awareness_at_utc: awareness.toISOString(),
      deadline_at_utc: deadline.toISOString(),
      submitted_at_utc: null,
      delay_reasons: delayReasons,
      phased,
      phases_planned: phased ? 2 : 1,
      item_a_nature: draft.item_a_nature,
      item_a_categories_subjects: draft.item_a_categories_subjects,
      item_a_approx_subjects: draft.item_a_approx_subjects,
      item_a_categories_records: draft.item_a_categories_records,
      item_a_approx_records: draft.item_a_approx_records,
      item_a_unknown: draft.item_a_unknown,
      item_b_dpo: dpo,
      item_c_consequences: draft.item_c_consequences,
      item_d_measures_taken: draft.item_d_measures_taken,
      item_d_measures_proposed: draft.item_d_measures_proposed,
      citations: draft.citations,
      review_approval_id: null,
      state: "draft",
    };

    const pack = this.composer.composeAuthorityPack(params);
    const contentSha = hashCanonicalContent(pack);
    await this.evidenceStore.saveDraftPack(
      incident.incident_code,
      "authority",
      pack,
      contentSha,
      null,
      "draft",
    );

    return { pack, contentSha, citations: pack.citations };
  }

  async draftSubject(
    incident: PimsIncident,
    gate: HighRiskGateResult,
    exemption: ExemptionEvaluationResult | null,
    numericApprovals: NumericApproval[],
    feedback?: string,
  ): Promise<{
    pack: SubjectNoticePack;
    contentSha: string;
    citations: string[];
  }> {
    const contact = requireDpoContact(incident, "subject");

    if (!gate.verdict) {
      const pack = this.composer.composeSubjectNotice({
        incidentCode: incident.incident_code,
        lang: "es",
        highRiskGate: gate,
        exemptionEvaluation: null,
        bodyPlain: "",
        contact,
        consequences: "",
        measures: [],
        recommendations: [],
        citations: [],
        reviewApprovalId: null,
        state: "not_required",
      });
      const contentSha = hashCanonicalContent(pack);
      await this.evidenceStore.saveDraftPack(
        incident.incident_code,
        "subject",
        pack,
        contentSha,
        null,
        "not_required",
      );
      return { pack, contentSha, citations: [] };
    }

    if (exemption !== null && exemption.kind === "exempted") {
      const pack = this.composer.composeSubjectNotice({
        incidentCode: incident.incident_code,
        lang: "es",
        highRiskGate: gate,
        exemptionEvaluation: exemption,
        bodyPlain: "",
        contact,
        consequences: "",
        measures: [],
        recommendations: [],
        citations: [],
        reviewApprovalId: null,
        state: "exempted",
      });
      const contentSha = hashCanonicalContent(pack);
      await this.evidenceStore.saveDraftPack(
        incident.incident_code,
        "subject",
        pack,
        contentSha,
        null,
        "exempted",
      );
      return { pack, contentSha, citations: [] };
    }

    const rag = await queryDualNormative(
      this.ragService,
      incident.incident_code,
      ISO_ALIGNMENT_RAG_QUERY,
      SUBJECT_RAG_QUERY,
    );

    const maxWords =
      this.config.PLAIN_LANG_MAX_WORDS !== undefined
        ? this.config.PLAIN_LANG_MAX_WORDS
        : CONSTANTS.PLAIN_LANGUAGE_MAX_WORDS;

    const feedbackBlock =
      feedback !== undefined && feedback.trim().length > 0
        ? `\n\nReviewer feedback on the previous rejected draft (address it first, keep every other requirement):\n${feedback.trim()}`
        : "";
    const response = await this.modelClient.chat_json({
      system: DRAFT_SUBJECT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${await renderIncidentProse(incident)}\nAllowed normative citations (return citations[] using ONLY the identifiers C1..Cn; never invent):\n${rag.citations.map((citation, index) => `C${index + 1} = ${citation}`).join("\n")}\nConstraints: write body_plain in Spanish; every sentence must have at most ${maxWords} words; do not include digits or numeric literals in body_plain; keep every field concrete and free of legal jargon.${feedbackBlock}\n\n${SPANISH_OUTPUT_CONTRACT}`,
        },
      ],
      json_schema: SUBJECT_JSON_SCHEMA,
      max_tokens: SUBJECT_MAX_TOKENS,
      temperature: this.config.TEMP_REASONING,
      route: CONSTANTS.MODEL_ROUTE_REASONING,
    });

    const draft: SubjectResponse = parseResponse(
      SUBJECT_RESPONSE_SCHEMA,
      normalizeSubjectContent(response.content),
      "subject",
    );
    draft.citations = canonicalizeCitations(draft.citations, rag.citations);
    this.assertCitations(draft.citations, rag.citations);

    PlainLanguageValidator.validate(draft.body_plain, {
      locale: "es",
      maxWords,
      numericApprovals,
    });

    const composeParams: ComposeSubjectNoticeParams = {
      incidentCode: incident.incident_code,
      lang: "es",
      highRiskGate: gate,
      exemptionEvaluation: exemption,
      bodyPlain: draft.body_plain,
      contact,
      consequences: draft.item_c_consequences,
      measures: draft.item_d_measures,
      recommendations: draft.recommendations,
      citations: draft.citations,
      reviewApprovalId: null,
      state: "draft",
    };

    const pack = this.composer.composeSubjectNotice(composeParams);
    const contentSha = hashCanonicalContent(pack);
    await this.evidenceStore.saveDraftPack(
      incident.incident_code,
      "subject",
      pack,
      contentSha,
      null,
      "draft",
    );

    return { pack, contentSha, citations: pack.citations };
  }

  async draftResolution(
    incident: PimsIncident,
    checklist: CloseChecklistItem[],
  ): Promise<{
    contentSha: string;
    bodyText: string;
    citations: string[];
  }> {
    const rag = await this.ragService.query(
      "corrective action and residual risk closure documentation under ISO 27701 10.2 and GDPR Article 33(5)",
      { normative_only: true, incident_code: incident.incident_code },
    );
    const maxWords =
      this.config.PLAIN_LANG_MAX_WORDS !== undefined
        ? this.config.PLAIN_LANG_MAX_WORDS
        : CONSTANTS.PLAIN_LANGUAGE_MAX_WORDS;

    const response = await this.modelClient.chat_json({
      system: RESOLUTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${await renderIncidentProse(incident)}\nChecklist de cierre: ${checklist.join(", ")}\nAllowed normative citations (return citations[] using ONLY the identifiers C1..Cn; never invent):\n${rag.citations.map((citation, index) => `C${index + 1} = ${citation}`).join("\n")}\nConstraints: write summary and remediation in Spanish; every sentence must have at most ${maxWords} words; do not include digits or numeric literals.\n\n${SPANISH_OUTPUT_CONTRACT}`,
        },
      ],
      json_schema: RESOLUTION_JSON_SCHEMA,
      max_tokens: RESOLUTION_MAX_TOKENS,
      temperature: this.config.TEMP_REASONING,
      route: CONSTANTS.MODEL_ROUTE_REASONING,
    });

    const draft: ResolutionResponse = parseResponse(
      RESOLUTION_RESPONSE_SCHEMA,
      normalizeResolutionContent(response.content),
      "resolution",
    );
    draft.citations = canonicalizeCitations(draft.citations, rag.citations);
    this.assertCitations(draft.citations, rag.citations);

    const bodyText = `${draft.summary}\n${draft.remediation}`;
    const contentSha = hashCanonicalContent({
      incident_code: incident.incident_code,
      checklist,
      summary: draft.summary,
      remediation: draft.remediation,
      citations: draft.citations,
    });

    return {
      contentSha,
      bodyText,
      citations: draft.citations,
    };
  }

  private assertCitations(citations: string[], ragCitations: string[]): void {
    if (citations.length === 0) {
      throw new ArtifactIncompleteError("citations", "missing_citations");
    }
    for (const citation of citations) {
      if (ragCitations.includes(citation)) {
        continue;
      }
      this.ragService.validateCitation(citation, true);
    }
  }
}
