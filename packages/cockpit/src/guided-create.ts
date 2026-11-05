import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { toChatCitations } from "@pims/cockpit/chat-tools.ts";
import type { AgentConfig } from "@pims/config";
import type { RAGService } from "@pims/rag";
import {
  type GuidedDraftRequest,
  type GuidedDraftResponse,
  type GuidedExplainOption,
  type GuidedExplainRequest,
  type GuidedExplainResponse,
  type GuidedProvenance,
  GuidedReportingSchema,
} from "@pims/types/cockpit.ts";
import { MODEL_ROUTE_FAST } from "@pims/types/constants.ts";
import { FormNarrativeTooLongError } from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import {
  AFFECTED_CID,
  ALL_AFFECTED_DATA_TYPES,
  ALL_SECURITY_MEASURES,
  INCIDENT_TYPES,
} from "@pims/types/pims.ts";

export interface GuidedCreateDependencies {
  config: AgentConfig;
  modelClient: AgentModelClient;
  presidioClient: PresidioClient;
  ragService: RAGService;
  now?: () => Date;
}

const GUIDED_DRAFT_SYSTEM = `You are an expert incident response and privacy compliance assistant for GESTITEL PIMS.
Extract incident reporting fields from the operator narrative and partial values into strict JSON conforming to the reporting schema.
Only extract reporting fields:
- title: concise title string (max 150 chars)
- description: string or null (max 1000 chars)
- incident_date: YYYY-MM-DD (cannot be null)
- incident_time: HH:MM:SS or null
- detection_date: YYYY-MM-DD or null
- detection_time: HH:MM:SS or null
- incident_type: one of UA, DL, MW, PH, DS, HE, DV, OT
- involves_personal_data: boolean
- affected_data_types: array of codes strictly from: ${JSON.stringify(ALL_AFFECTED_DATA_TYPES)}
- num_affected_subjects: number or null
- affected_treatment: string or null
- compromised_system: string or null
- affected_url: string or null
- security_measures_adopted: array of codes strictly from: ${JSON.stringify(ALL_SECURITY_MEASURES)}
- affected_cid: array strictly subset of: ["C", "I", "D"]
- rep_document_number, rep_first_name, rep_last_name_p, rep_email, rep_phone, rep_position: string or null
Never invent dates or facts not mentioned in the text.`;

const ENUM_FIELD_CATALOGS: Record<string, GuidedExplainOption[]> = {
  incident_type: [
    {
      code: "UA",
      label: "Acceso no autorizado",
      description:
        "Credenciales comprometidas, bypass de autenticación o intrusión no autorizada",
    },
    {
      code: "DL",
      label: "Fuga o pérdida de datos",
      description:
        "Exfiltración, divulgación indebida o pérdida accidental de datos personales",
    },
    {
      code: "MW",
      label: "Malware o ransomware",
      description:
        "Software malicioso, cifrado no autorizado o infección por virus",
    },
    {
      code: "PH",
      label: "Phishing o ingeniería social",
      description:
        "Suplantación de identidad, correos maliciosos o señuelos de engaño",
    },
    {
      code: "DS",
      label: "Denegación de servicio",
      description:
        "Ataques de saturación de red o indisponibilidad forzada de sistemas",
    },
    {
      code: "HE",
      label: "Error humano",
      description:
        "Configuración errónea o acción involuntaria sin dolo ni malware",
    },
    {
      code: "DV",
      label: "Robo o pérdida de dispositivo",
      description:
        "Pérdida física o robo de laptops, discos o equipos institucionales",
    },
    {
      code: "OT",
      label: "Otro",
      description:
        "Otros tipos de incidentes no clasificados en los anteriores",
    },
  ],
  affected_cid: [
    {
      code: "C",
      label: "Confidencialidad",
      description:
        "Acceso o divulgación no autorizada de información o datos personales",
    },
    {
      code: "I",
      label: "Integridad",
      description:
        "Alteración, modificación o corrupción no autorizada de información",
    },
    {
      code: "D",
      label: "Disponibilidad",
      description:
        "Pérdida de acceso o destrucción de servicios y repositorios",
    },
  ],
  entity_type: [
    {
      code: "U",
      label: "Pública / Universitaria",
      description: "Universidad o institución de derecho público",
    },
    {
      code: "R",
      label: "Privada",
      description: "Empresa o persona jurídica de derecho privado",
    },
  ],
  affected_data_types: [
    { code: "names", label: "Nombres y apellidos" },
    { code: "id_doc", label: "Documento de identidad (DNI/CE/NIE)" },
    { code: "address", label: "Dirección domiciliaria" },
    { code: "phone", label: "Teléfono / Celular" },
    { code: "email", label: "Correo electrónico" },
    { code: "financial", label: "Datos financieros / bancarios" },
    { code: "health", label: "Datos de salud" },
    { code: "biometric", label: "Datos biométricos" },
    { code: "geolocation", label: "Datos de geolocalización" },
    { code: "credentials", label: "Credenciales de acceso" },
    { code: "minors", label: "Datos de menores de edad" },
    {
      code: "sensitive",
      label: "Datos sensibles (origen racial, político, etc.)",
    },
  ],
  security_measures_adopted: [
    { code: "encrypt_rest", label: "Cifrado en reposo" },
    { code: "encrypt_transit", label: "Cifrado en tránsito" },
    { code: "mfa", label: "Doble factor de autenticación (MFA)" },
    { code: "network_seg", label: "Segmentación de red" },
    { code: "rbac", label: "Control de acceso basado en roles" },
    { code: "siem", label: "Monitoreo SIEM / detección de intrusos" },
    { code: "training", label: "Capacitación a personal" },
    { code: "patching", label: "Actualización de parches" },
    { code: "backups", label: "Backups y plan de recuperación" },
    { code: "dlp", label: "DLP (prevención de fuga de datos)" },
  ],
  severity: [
    { code: "L", label: "Baja", description: "Impacto mínimo o nulo" },
    { code: "M", label: "Media", description: "Impacto acotado" },
    { code: "H", label: "Alta", description: "Compromiso de datos personales" },
    {
      code: "C",
      label: "Crítica",
      description: "Alto volumen o datos sensibles comprometidos",
    },
  ],
  impact: [
    { code: "L", label: "Bajo", description: "Afectación negligible" },
    { code: "M", label: "Medio", description: "Afectación contenible" },
    { code: "H", label: "Alto", description: "Disrupción operativa" },
    {
      code: "V",
      label: "Muy alto",
      description: "Afectación masiva o crítica",
    },
  ],
};

function formatTodayDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function draftGuidedIncident(
  request: GuidedDraftRequest,
  deps: GuidedCreateDependencies,
  username: string,
): Promise<GuidedDraftResponse> {
  const narrative = request.narrative?.trim() ?? "";
  const partialStr = JSON.stringify(request.partial ?? {});
  const totalChars = narrative.length + partialStr.length;

  if (totalChars > deps.config.FORM_NARRATIVE_MAX_CHARS) {
    throw new FormNarrativeTooLongError(
      deps.config.FORM_NARRATIVE_MAX_CHARS,
      totalChars,
    );
  }

  const combined = narrative
    ? `${narrative}\n\n[VALORES PARCIALES ACTUALES]:\n${partialStr}`
    : `[VALORES PARCIALES ACTUALES]:\n${partialStr}`;

  const { redactedText, spans } = await deps.presidioClient.redact(combined);

  const now = deps.now ? deps.now() : new Date();
  const today = formatTodayDate(now);

  const chatResponse = await deps.modelClient.chat_json({
    route: MODEL_ROUTE_FAST,
    system: `${GUIDED_DRAFT_SYSTEM}\nPrompt SHA: GUIDED_DRAFT_v1.0`,
    messages: [
      {
        role: "user",
        content: `Extraiga los campos del siguiente reporte:\n${redactedText}`,
      },
    ],
    max_tokens: 4096,
    temperature: deps.config.TEMP_CLASSIFIER,
  });

  const extracted = (chatResponse.content ?? {}) as JsonObject;
  const partial = request.partial ?? {};

  const provenance: Record<string, GuidedProvenance> = {};
  const warnings: string[] = [];

  const rawIncidentType = (partial.incident_type ??
    extracted.incident_type) as string;
  const incidentType = (INCIDENT_TYPES as readonly string[]).includes(
    rawIncidentType,
  )
    ? rawIncidentType
    : "OT";

  const rawAffectedCid = Array.isArray(partial.affected_cid)
    ? partial.affected_cid
    : Array.isArray(extracted.affected_cid)
      ? extracted.affected_cid
      : [];
  const affectedCid = rawAffectedCid.filter((c) =>
    (AFFECTED_CID as readonly string[]).includes(String(c)),
  );

  const rawDataTypes = Array.isArray(partial.affected_data_types)
    ? partial.affected_data_types
    : Array.isArray(extracted.affected_data_types)
      ? extracted.affected_data_types
      : [];
  const affectedDataTypes = rawDataTypes.filter((t) =>
    (ALL_AFFECTED_DATA_TYPES as readonly string[]).includes(String(t)),
  );

  const rawMeasures = Array.isArray(partial.security_measures_adopted)
    ? partial.security_measures_adopted
    : Array.isArray(extracted.security_measures_adopted)
      ? extracted.security_measures_adopted
      : [];
  const securityMeasures = rawMeasures.filter((m) =>
    (ALL_SECURITY_MEASURES as readonly string[]).includes(String(m)),
  );

  const rawIncidentDate =
    partial.incident_date ?? (extracted.incident_date as string);
  const incidentDate =
    typeof rawIncidentDate === "string" && rawIncidentDate.length > 0
      ? rawIncidentDate.slice(0, 10)
      : typeof extracted.detection_date === "string" &&
          extracted.detection_date.length > 0
        ? (extracted.detection_date as string).slice(0, 10)
        : today;

  const draftObj: Record<string, unknown> = {
    title:
      partial.title ?? (extracted.title as string) ?? "Incidente reportado",
    description:
      partial.description ?? (extracted.description as string) ?? null,
    incident_date: incidentDate,
    incident_time:
      partial.incident_time ?? (extracted.incident_time as string) ?? null,
    detection_date:
      partial.detection_date ?? (extracted.detection_date as string) ?? today,
    detection_time:
      partial.detection_time ?? (extracted.detection_time as string) ?? null,
    incident_type: incidentType,
    involves_personal_data:
      partial.involves_personal_data ??
      (typeof extracted.involves_personal_data === "boolean"
        ? extracted.involves_personal_data
        : false),
    affected_data_types: affectedDataTypes,
    num_affected_subjects:
      partial.num_affected_subjects ??
      (typeof extracted.num_affected_subjects === "number"
        ? extracted.num_affected_subjects
        : null),
    affected_treatment:
      partial.affected_treatment ??
      (extracted.affected_treatment as string) ??
      null,
    compromised_system:
      partial.compromised_system ??
      (extracted.compromised_system as string) ??
      null,
    affected_url:
      partial.affected_url ?? (extracted.affected_url as string) ?? null,
    security_measures_adopted: securityMeasures,
    affected_cid: affectedCid,
    rep_document_number:
      partial.rep_document_number ??
      (extracted.rep_document_number as string) ??
      null,
    rep_document_expiry:
      partial.rep_document_expiry ??
      (extracted.rep_document_expiry as string) ??
      null,
    rep_first_name:
      partial.rep_first_name ?? (extracted.rep_first_name as string) ?? null,
    rep_last_name_p:
      partial.rep_last_name_p ?? (extracted.rep_last_name_p as string) ?? null,
    rep_last_name_m:
      partial.rep_last_name_m ?? (extracted.rep_last_name_m as string) ?? null,
    rep_position:
      partial.rep_position ?? (extracted.rep_position as string) ?? null,
    rep_phone: partial.rep_phone ?? (extracted.rep_phone as string) ?? null,
    rep_email: partial.rep_email ?? (extracted.rep_email as string) ?? null,
    entity_type:
      partial.entity_type ?? (extracted.entity_type as string) ?? "U",
    entity_ruc: partial.entity_ruc ?? (extracted.entity_ruc as string) ?? null,
    entity_name:
      partial.entity_name ??
      (extracted.entity_name as string) ??
      "Universidad Nacional de San Agustín",
    entity_phone:
      partial.entity_phone ?? (extracted.entity_phone as string) ?? null,
    entity_extension:
      partial.entity_extension ??
      (extracted.entity_extension as string) ??
      null,
    entity_department:
      partial.entity_department ??
      (extracted.entity_department as string) ??
      "Arequipa",
    entity_province:
      partial.entity_province ??
      (extracted.entity_province as string) ??
      "Arequipa",
    entity_district:
      partial.entity_district ??
      (extracted.entity_district as string) ??
      "Arequipa",
    reported_by: partial.reported_by ?? username,
    dpo_contact_name:
      partial.dpo_contact_name ??
      (extracted.dpo_contact_name as string) ??
      null,
    dpo_contact_email:
      partial.dpo_contact_email ??
      (extracted.dpo_contact_email as string) ??
      null,
    dpo_contact_phone:
      partial.dpo_contact_phone ??
      (extracted.dpo_contact_phone as string) ??
      null,
  };

  for (const [key, _val] of Object.entries(draftObj)) {
    if (partial[key as keyof typeof partial] !== undefined) {
      provenance[key] = "partial";
    } else if (extracted[key] !== undefined && extracted[key] !== null) {
      provenance[key] = "narrative";
    } else {
      provenance[key] = "default";
    }
  }

  if (
    partial.involves_personal_data === undefined &&
    extracted.involves_personal_data === undefined
  ) {
    warnings.push(
      "El campo 'involves_personal_data' requiere confirmación explícita (sí/no) antes de enviar.",
    );
  }

  const parsedDraft = GuidedReportingSchema.parse(draftObj);

  return {
    draft: parsedDraft,
    provenance,
    redaction_report: {
      total_spans: spans.length,
      entities_found: Array.from(new Set(spans.map((s) => s.entity_type))),
    },
    warnings,
  };
}

export async function explainField(
  request: GuidedExplainRequest,
  deps: GuidedCreateDependencies,
): Promise<GuidedExplainResponse> {
  const field = request.field;

  const catalogOptions = ENUM_FIELD_CATALOGS[field];
  if (catalogOptions !== undefined) {
    return {
      field,
      type: "enum",
      explanation: `Catálogo de opciones para '${field}' según especificación técnica §3.5.`,
      options: catalogOptions,
    };
  }

  // Semantic or legal field: query RAG
  const ragResult = await deps.ragService.query(
    `normative ISO 27701 GDPR guidance for incident reporting field ${field}`,
    {
      normative_only: true,
    },
  );

  if (ragResult.citations.length === 0) {
    return {
      field,
      type: "semantic",
      explanation: "RAG_NO_EVIDENCE",
      citations: [],
    };
  }

  const chatCitations = toChatCitations(
    ragResult.passages,
    ragResult.citations,
  );

  const explainPrompt = `Explain the regulatory significance (GDPR Art 33/34, ISO 27701) and instructions for the incident reporting field "${field}". Ground your explanation in the citations.`;
  const response = await deps.modelClient.chat_json({
    route: MODEL_ROUTE_FAST,
    system: `You are an expert incident privacy officer. Answer in concise Spanish explaining the field. Prompt SHA: GUIDED_EXPLAIN_v1.0. Citations: ${ragResult.citations.join("; ")}`,
    messages: [{ role: "user", content: explainPrompt }],
    max_tokens: 1024,
    temperature: 0.0,
  });

  const reply =
    typeof response.content.reply === "string"
      ? response.content.reply
      : typeof response.content.explanation === "string"
        ? response.content.explanation
        : "Definición normativa aplicable a la recolección de este campo.";

  return {
    field,
    type: "semantic",
    explanation: reply,
    citations: chatCitations,
  };
}
