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
  SubjectNoticePack,
} from "@pims/types";
import { MODEL_ROUTE_REASONING } from "@pims/types/constants.ts";
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

const STALE_PACK_MS = 300000;
const AUTHORITY_MAX_TOKENS = 2500;
const SUBJECT_MAX_TOKENS = 2000;
const RESOLUTION_MAX_TOKENS = 2000;

export const DRAFT_AUTHORITY_SYSTEM =
  "You draft a GDPR Article 33(3) notification pack for the supervisory authority. Ground every legal statement in the supplied RAG citations. Return strict JSON with item_a_nature, item_a_categories_subjects, item_a_approx_subjects, item_a_categories_records, item_a_approx_records, item_a_unknown, item_c_consequences, item_d_measures_taken, item_d_measures_proposed and citations. Approximate counts must be non-negative integers; when a count cannot yet be determined emit 0 and list it in item_a_unknown with reason PHASED_PENDING. Never include reporter or DPO contact values in the prose; the pack carries those fields structurally.";

export const DRAFT_SUBJECT_SYSTEM =
  "You draft a GDPR Article 34 communication to affected data subjects. Use clear and plain language, short sentences and no legal jargon. Ground every legal statement in the supplied RAG citations. Return strict JSON with body_plain, item_c_consequences, item_d_measures, recommendations and citations. Never include reporter or DPO contact values in the body; the pack carries the contact block structurally.";

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
    citations: { type: "array", items: { type: "string" } },
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
    citations: { type: "array", items: { type: "string" } },
  },
};

const RESOLUTION_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "remediation", "citations"],
  properties: {
    summary: { type: "string" },
    remediation: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
  },
};

function renderIncidentProse(incident: PimsIncident): string {
  const lines: string[] = [
    `Titulo: ${incident.title}`,
    `Tipo: ${incident.incident_type}`,
    `Severidad: ${incident.severity ?? "desconocida"}`,
    `Impacto: ${incident.impact ?? "desconocido"}`,
    `Fecha del incidente: ${incident.incident_date}`,
  ];
  if (incident.description !== null && incident.description !== undefined) {
    lines.push(`Descripcion: ${incident.description}`);
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
      incident.num_affected_subjects === null ||
      incident.num_affected_subjects === undefined
        ? "desconocido"
        : String(incident.num_affected_subjects)
    }`,
  );
  return redactForPrompt(lines.join("\n"));
}

function parseResponse<T>(
  schema: z.ZodType<T>,
  content: JsonObject,
  artifact: string,
): T {
  const parsed = schema.safeParse(content);
  if (!parsed.success) {
    throw new ModelSchemaViolationError(
      MODEL_ROUTE_REASONING,
      `Invalid ${artifact} draft response`,
      { issues: zodIssuesToDetails(parsed.error) },
    );
  }
  return parsed.data;
}

function requireDpoContact(
  incident: PimsIncident,
  artifact: string,
): DpoContact {
  const name = incident.dpo_contact_name ?? null;
  const email = incident.dpo_contact_email ?? null;
  if (
    name === null ||
    name.length === 0 ||
    email === null ||
    email.length === 0
  ) {
    throw new ArtifactIncompleteError(artifact, "dpo");
  }
  return {
    name,
    email,
    phone: incident.dpo_contact_phone ?? null,
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

    const rag = await this.ragService.query(AUTHORITY_RAG_QUERY, {
      normative_only: true,
    });
    if (rag.passages.length === 0) {
      throw new RagNoEvidenceError(
        "No normative evidence available for the Article 33(3) draft",
      );
    }

    const response = await this.modelClient.chat_json({
      system: DRAFT_AUTHORITY_SYSTEM,
      messages: [{ role: "user", content: renderIncidentProse(incident) }],
      json_schema: AUTHORITY_JSON_SCHEMA,
      max_tokens: AUTHORITY_MAX_TOKENS,
      temperature: this.config.TEMP_REASONING,
      route: MODEL_ROUTE_REASONING,
    });

    const draft: AuthorityResponse = parseResponse(
      AUTHORITY_RESPONSE_SCHEMA,
      response.content,
      "authority",
    );

    if (!Number.isInteger(draft.item_a_approx_subjects)) {
      throw new ArtifactIncompleteError("authority", "item_a_approx_subjects");
    }
    if (!Number.isInteger(draft.item_a_approx_records)) {
      throw new ArtifactIncompleteError("authority", "item_a_approx_records");
    }

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
      const reasons = (incident.history ?? [])
        .filter((row) => {
          const changedMs = new Date(row.changed_at).getTime();
          return (
            Number.isFinite(changedMs) &&
            changedMs >= awarenessMs &&
            changedMs <= nowMs
          );
        })
        .map(
          (row) =>
            `${row.event_type ?? "event"} at ${row.changed_at}: ${
              row.description ?? ""
            }`,
        );
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

    const rag = await this.ragService.query(SUBJECT_RAG_QUERY, {
      normative_only: true,
    });
    if (rag.passages.length === 0) {
      throw new RagNoEvidenceError(
        "No normative evidence available for the Article 34 draft",
      );
    }

    const response = await this.modelClient.chat_json({
      system: DRAFT_SUBJECT_SYSTEM,
      messages: [{ role: "user", content: renderIncidentProse(incident) }],
      json_schema: SUBJECT_JSON_SCHEMA,
      max_tokens: SUBJECT_MAX_TOKENS,
      temperature: this.config.TEMP_REASONING,
      route: MODEL_ROUTE_REASONING,
    });

    const draft: SubjectResponse = parseResponse(
      SUBJECT_RESPONSE_SCHEMA,
      response.content,
      "subject",
    );

    PlainLanguageValidator.validate(draft.body_plain, {
      locale: "es",
      maxWords: this.config.PLAIN_LANG_MAX_WORDS,
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
    const response = await this.modelClient.chat_json({
      system: RESOLUTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${renderIncidentProse(incident)}\nChecklist de cierre: ${checklist.join(", ")}`,
        },
      ],
      json_schema: RESOLUTION_JSON_SCHEMA,
      max_tokens: RESOLUTION_MAX_TOKENS,
      temperature: this.config.TEMP_REASONING,
      route: MODEL_ROUTE_REASONING,
    });

    const draft: ResolutionResponse = parseResponse(
      RESOLUTION_RESPONSE_SCHEMA,
      response.content,
      "resolution",
    );

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
    for (const citation of citations) {
      if (ragCitations.includes(citation)) {
        continue;
      }
      this.ragService.validateCitation(citation, true);
    }
  }
}
