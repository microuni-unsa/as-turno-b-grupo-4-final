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
  type PresidioRecognizerResult,
} from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
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

const JOB_TITLE_KEYWORDS = [
  "jefe",
  "jefa",
  "director",
  "directora",
  "gerente",
  "responsable",
  "oficial",
  "coordinador",
  "coordinadora",
  "analista",
  "auditor",
  "auditora",
  "especialista",
  "administrador",
  "administradora",
  "seguridad",
  "ciso",
  "dpo",
  "soc",
  "oficial de seguridad",
];

export function isJobTitle(str: string): boolean {
  const lower = str.toLowerCase();
  return JOB_TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

export function parseSpanishPersonName(fullName: string): {
  firstName: string;
  lastNameP: string;
  lastNameM: string | null;
} {
  const cleaned = fullName.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return { firstName: "", lastNameP: "", lastNameM: null };
  }

  // Strip common honorific titles (e.g. "Dra. Elena Ramos", "Ing. Carlos Mendoza")
  const stripped = cleaned.replace(
    /^(ing|lic|dr|dra|abg|mag|sr|sra|don|doña)\.?\s+/i,
    "",
  );
  const words = stripped.split(" ");

  if (words.length <= 1) {
    return { firstName: words[0] ?? "", lastNameP: "", lastNameM: null };
  }
  if (words.length === 2) {
    return {
      firstName: words[0] ?? "",
      lastNameP: words[1] ?? "",
      lastNameM: null,
    };
  }

  const isPrefix = (w: string) => /^(de|del|la|las|los|san|santa)$/i.test(w);

  if (words.length === 3) {
    if (isPrefix(words[1] ?? "")) {
      return {
        firstName: words[0] ?? "",
        lastNameP: `${words[1]} ${words[2]}`,
        lastNameM: null,
      };
    }
    return {
      firstName: words[0] ?? "",
      lastNameP: words[1] ?? "",
      lastNameM: words[2] ?? null,
    };
  }

  if (words.length === 4) {
    if (isPrefix(words[2] ?? "")) {
      return {
        firstName: `${words[0]} ${words[1]}`,
        lastNameP: `${words[2]} ${words[3]}`,
        lastNameM: null,
      };
    }
    return {
      firstName: `${words[0]} ${words[1]}`,
      lastNameP: words[2] ?? "",
      lastNameM: words[3] ?? null,
    };
  }

  // For 5+ words:
  const mIdx = words.length - 1;
  let pIdx = words.length - 2;
  while (pIdx > 1 && isPrefix(words[pIdx - 1] ?? "")) {
    pIdx--;
  }
  return {
    firstName: words.slice(0, pIdx).join(" "),
    lastNameP: words.slice(pIdx, mIdx).join(" "),
    lastNameM: words.slice(mIdx).join(" ") || null,
  };
}

export interface IndexedSpanToken {
  token: string;
  original: string;
  entityType: string;
}

export async function redactForGuidedDraft(
  text: string,
  presidioClient: PresidioClient,
): Promise<{
  redactedText: string;
  spans: PresidioRecognizerResult[];
  tokenMap: Map<string, IndexedSpanToken>;
  originalPersons: IndexedSpanToken[];
  originalEmails: IndexedSpanToken[];
  originalPhones: IndexedSpanToken[];
  originalIds: IndexedSpanToken[];
  originalUrls: IndexedSpanToken[];
}> {
  if (!text) {
    return {
      redactedText: text,
      spans: [],
      tokenMap: new Map(),
      originalPersons: [],
      originalEmails: [],
      originalPhones: [],
      originalIds: [],
      originalUrls: [],
    };
  }

  const spans = await presidioClient.analyze(text);
  if (spans.length === 0) {
    return {
      redactedText: text,
      spans: [],
      tokenMap: new Map(),
      originalPersons: [],
      originalEmails: [],
      originalPhones: [],
      originalIds: [],
      originalUrls: [],
    };
  }

  // Filter overlapping spans: longest span first (matching PresidioClient logic)
  const sorted = [...spans].sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) {
      return lenDiff;
    }
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.start - b.start;
  });

  const selected: PresidioRecognizerResult[] = [];
  for (const span of sorted) {
    const overlaps = selected.some(
      (existing) =>
        Math.max(span.start, existing.start) < Math.min(span.end, existing.end),
    );
    if (!overlaps) {
      selected.push(span);
    }
  }

  // Sort by start ascending to assign indexed tokens in reading order
  selected.sort((a, b) => a.start - b.start);

  const tokenMap = new Map<string, IndexedSpanToken>();
  const originalPersons: IndexedSpanToken[] = [];
  const originalEmails: IndexedSpanToken[] = [];
  const originalPhones: IndexedSpanToken[] = [];
  const originalIds: IndexedSpanToken[] = [];
  const originalUrls: IndexedSpanToken[] = [];

  const indexedSpans: Array<{ span: PresidioRecognizerResult; token: string }> =
    [];

  let personCount = 1;
  let emailCount = 1;
  let phoneCount = 1;
  let idCount = 1;
  let urlCount = 1;
  let descCount = 1;

  for (const span of selected) {
    const original = text.slice(span.start, span.end);
    let token: string;
    if (span.entity_type === "PERSON") {
      token = `[REPORTANTE_${personCount++}]`;
      const item: IndexedSpanToken = {
        token,
        original,
        entityType: span.entity_type,
      };
      tokenMap.set(token, item);
      originalPersons.push(item);
    } else if (span.entity_type === "EMAIL_ADDRESS") {
      token = `[CONTACTO_EMAIL_${emailCount++}]`;
      const item: IndexedSpanToken = {
        token,
        original,
        entityType: span.entity_type,
      };
      tokenMap.set(token, item);
      originalEmails.push(item);
    } else if (span.entity_type === "PHONE_NUMBER") {
      token = `[CONTACTO_TEL_${phoneCount++}]`;
      const item: IndexedSpanToken = {
        token,
        original,
        entityType: span.entity_type,
      };
      tokenMap.set(token, item);
      originalPhones.push(item);
    } else if (
      span.entity_type === "PE_DNI" ||
      span.entity_type === "PE_RUC" ||
      span.entity_type === "ES_NIF" ||
      span.entity_type === "ES_NIE" ||
      span.entity_type === "ES_PASSPORT"
    ) {
      token = `[ID_${idCount++}]`;
      const item: IndexedSpanToken = {
        token,
        original,
        entityType: span.entity_type,
      };
      tokenMap.set(token, item);
      originalIds.push(item);
    } else if (
      span.entity_type === "URL" ||
      span.entity_type === "IP_ADDRESS" ||
      span.entity_type === "LOCATION"
    ) {
      token = `[SISTEMA_${urlCount++}]`;
      const item: IndexedSpanToken = {
        token,
        original,
        entityType: span.entity_type,
      };
      tokenMap.set(token, item);
      originalUrls.push(item);
    } else {
      token = `[DESCRIPCION_${descCount++}]`;
      const item: IndexedSpanToken = {
        token,
        original,
        entityType: span.entity_type,
      };
      tokenMap.set(token, item);
    }

    indexedSpans.push({ span, token });
  }

  // Sort descending by start to perform right-to-left string replacement
  indexedSpans.sort((a, b) => b.span.start - a.span.start);

  let redactedText = text;
  for (const { span, token } of indexedSpans) {
    redactedText =
      redactedText.slice(0, span.start) + token + redactedText.slice(span.end);
  }

  return {
    redactedText,
    spans: selected,
    tokenMap,
    originalPersons,
    originalEmails,
    originalPhones,
    originalIds,
    originalUrls,
  };
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
- severity: one of L, M, H, C or null
- impact: one of L, M, H, V or null
- status: one of O, P, C (default O)
- rep_first_name, rep_last_name_p, rep_last_name_m: string or null
- rep_position: string or null (organizational role / job title, e.g. "Jefe de Seguridad de la Información", "Director de TI", "Auditor")
- rep_document_number, rep_email, rep_phone: string or null
- dpo_contact_name, dpo_contact_email, dpo_contact_phone: string or null
- entity_name, entity_ruc, entity_type, entity_department, entity_province, entity_district: string or null

Rules:
1. NEVER confuse job titles or organizational positions (e.g. "Jefe de Seguridad de la Información", "Director", "Gerente") with surnames. Always assign job titles to rep_position.
2. If text contains pseudonym tokens like [REPORTANTE_1], [CONTACTO_EMAIL_1], [CONTACTO_TEL_1], [ID_1], [SISTEMA_1], copy the EXACT token placeholder into the corresponding field.
3. If [REPORTANTE_1] represents the reporting person, you may assign it to rep_first_name or rep_last_name_p, and if [REPORTANTE_2] represents the DPO, assign it to dpo_contact_name.
4. Never invent dates or facts not mentioned in the text.`;

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
  status: [
    {
      code: "O",
      label: "Abierto",
      description: "Incidente recién registrado o en triaje inicial",
    },
    {
      code: "P",
      label: "En proceso",
      description: "Contención, investigación o notificación en curso",
    },
    {
      code: "C",
      label: "Cerrado",
      description: "Incidente resuelto con checklist y evidencia sellada",
    },
  ],
  measure_updated_registry: [
    {
      code: "Y",
      label: "Sí",
      description: "El registro de incidentes fue actualizado formalmente",
    },
    {
      code: "N",
      label: "No",
      description: "No se actualizó el registro de incidentes",
    },
    {
      code: "U",
      label: "En evaluación",
      description: "Estado pendiente de verificación por el agente",
    },
  ],
  measure_new_security: [
    {
      code: "Y",
      label: "Sí",
      description:
        "Se adoptaron nuevas medidas de seguridad técnicas u organizativas",
    },
    {
      code: "N",
      label: "No",
      description: "No se implementaron nuevas medidas de seguridad",
    },
    {
      code: "U",
      label: "En evaluación",
      description: "Medidas en proceso de implementación",
    },
  ],
  measure_improved_policies: [
    {
      code: "Y",
      label: "Sí",
      description:
        "Se mejoraron procedimientos, políticas o planes de contingencia",
    },
    {
      code: "N",
      label: "No",
      description: "No se requirieron cambios en políticas",
    },
    {
      code: "U",
      label: "En evaluación",
      description: "Revisión de políticas en curso",
    },
  ],
  measure_considered_resolved: [
    {
      code: "Y",
      label: "Sí",
      description: "El incidente ha sido mitigado y resuelto completamente",
    },
    {
      code: "N",
      label: "No",
      description: "El incidente permanece activo o bajo mitigación",
    },
    {
      code: "U",
      label: "En evaluación",
      description: "Verificación de resolución en curso",
    },
  ],
  measure_reported_authorities: [
    {
      code: "Y",
      label: "Sí",
      description: "Notificado a la autoridad de protección de datos (Art 33)",
    },
    {
      code: "N",
      label: "No",
      description: "No reportado o exento formalmente",
    },
    {
      code: "U",
      label: "En evaluación",
      description: "Evaluación de umbral de riesgo en curso",
    },
  ],
  action_type: [
    {
      code: "C",
      label: "Contención",
      description: "Acción inmediata de mitigación o aislamiento",
    },
    {
      code: "A",
      label: "Análisis",
      description: "Investigación de causa raíz, alcance o evaluación legal",
    },
    {
      code: "R",
      label: "Resolución",
      description: "Medida correctiva definitiva y cierre",
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

  const {
    redactedText,
    spans,
    tokenMap,
    originalPersons,
    originalEmails,
    originalPhones,
    originalIds,
    originalUrls,
  } = await redactForGuidedDraft(combined, deps.presidioClient);

  const now = deps.now ? deps.now() : new Date();
  const today = formatTodayDate(now);

  const chatResponse = await deps.modelClient.chat_json({
    route: CONSTANTS.MODEL_ROUTE_FAST,
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

  // Restore all placeholder tokens
  const restoreTokenString = (raw: unknown): string | null => {
    if (typeof raw !== "string" || raw.trim() === "") {
      return null;
    }
    let str = raw.trim();
    for (const [token, item] of tokenMap.entries()) {
      str = str.replaceAll(token, item.original);
    }
    return str;
  };

  // De-anonymize all extracted string fields
  for (const [k, v] of Object.entries(extracted)) {
    if (typeof v === "string") {
      const restored = restoreTokenString(v);
      if (restored !== null) {
        extracted[k] = restored;
      }
    }
  }

  // Safety check on rep_last_name_p / rep_position
  if (
    typeof extracted.rep_last_name_p === "string" &&
    isJobTitle(extracted.rep_last_name_p)
  ) {
    if (!extracted.rep_position || typeof extracted.rep_position !== "string") {
      extracted.rep_position = extracted.rep_last_name_p;
    }
    extracted.rep_last_name_p = null;
  }

  // De-anonymize and parse reporter person name
  if (originalPersons.length > 0) {
    const repPerson = originalPersons[0];
    if (repPerson) {
      const parsed = parseSpanishPersonName(repPerson.original);
      const isPlaceholder = (val: unknown) =>
        typeof val === "string" && val.includes("[REPORTANTE");

      if (
        !extracted.rep_first_name ||
        isPlaceholder(extracted.rep_first_name)
      ) {
        extracted.rep_first_name = parsed.firstName;
      }
      if (
        !extracted.rep_last_name_p ||
        isPlaceholder(extracted.rep_last_name_p) ||
        isJobTitle(String(extracted.rep_last_name_p))
      ) {
        extracted.rep_last_name_p = parsed.lastNameP;
      }
      if (
        !extracted.rep_last_name_m ||
        isPlaceholder(extracted.rep_last_name_m)
      ) {
        extracted.rep_last_name_m = parsed.lastNameM;
      }
    }
  }

  // De-anonymize DPO name
  if (originalPersons.length > 1) {
    const dpoPerson = originalPersons[1];
    if (
      dpoPerson &&
      (!extracted.dpo_contact_name ||
        (typeof extracted.dpo_contact_name === "string" &&
          extracted.dpo_contact_name.includes("[REPORTANTE")))
    ) {
      extracted.dpo_contact_name = dpoPerson.original;
    }
  }

  // Fallback contacts from original token lists if LLM left them null or generic [CONTACTO] / [ID]
  const isGenericToken = (val: unknown) =>
    typeof val === "string" &&
    (val === "[CONTACTO]" ||
      val === "[ID]" ||
      val === "[REPORTANTE]" ||
      val === "[SISTEMA]" ||
      val === "[DESCRIPCION]");

  if (
    (!extracted.rep_email || isGenericToken(extracted.rep_email)) &&
    originalEmails.length > 0
  ) {
    const emailItem = originalEmails[0];
    if (emailItem) {
      extracted.rep_email = emailItem.original;
    }
  }
  if (
    (!extracted.dpo_contact_email ||
      isGenericToken(extracted.dpo_contact_email)) &&
    originalEmails.length > 1
  ) {
    const dpoEmailItem = originalEmails[1];
    if (dpoEmailItem) {
      extracted.dpo_contact_email = dpoEmailItem.original;
    }
  }

  if (
    (!extracted.rep_phone || isGenericToken(extracted.rep_phone)) &&
    originalPhones.length > 0
  ) {
    const phoneItem = originalPhones[0];
    if (phoneItem) {
      extracted.rep_phone = phoneItem.original;
    }
  }

  if (
    (!extracted.rep_document_number ||
      isGenericToken(extracted.rep_document_number)) &&
    originalIds.length > 0
  ) {
    const idItem = originalIds[0];
    if (idItem) {
      extracted.rep_document_number = idItem.original;
    }
  }

  if (
    (!extracted.affected_url || isGenericToken(extracted.affected_url)) &&
    originalUrls.length > 0
  ) {
    const urlItem = originalUrls.find((u) => u.original.startsWith("http"));
    if (urlItem) {
      extracted.affected_url = urlItem.original;
    }
  }

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
    assigned_to:
      partial.assigned_to ?? (extracted.assigned_to as string) ?? null,
    status: (partial.status ?? (extracted.status as string) ?? "O") as
      | "O"
      | "P"
      | "C",
    severity: (partial.severity ?? (extracted.severity as string) ?? null) as
      | "L"
      | "M"
      | "H"
      | "C"
      | null,
    impact: (partial.impact ?? (extracted.impact as string) ?? null) as
      | "L"
      | "M"
      | "H"
      | "V"
      | null,
    evidence_refs:
      partial.evidence_refs ?? (extracted.evidence_refs as string) ?? null,
    measure_updated_registry: (partial.measure_updated_registry ??
      (extracted.measure_updated_registry as string) ??
      null) as "Y" | "N" | "U" | null,
    measure_new_security: (partial.measure_new_security ??
      (extracted.measure_new_security as string) ??
      null) as "Y" | "N" | "U" | null,
    measure_improved_policies: (partial.measure_improved_policies ??
      (extracted.measure_improved_policies as string) ??
      null) as "Y" | "N" | "U" | null,
    measure_considered_resolved: (partial.measure_considered_resolved ??
      (extracted.measure_considered_resolved as string) ??
      null) as "Y" | "N" | "U" | null,
    measure_reported_authorities: (partial.measure_reported_authorities ??
      (extracted.measure_reported_authorities as string) ??
      null) as "Y" | "N" | "U" | null,
    resolved_date:
      partial.resolved_date ?? (extracted.resolved_date as string) ?? null,
    actions: Array.isArray(partial.actions)
      ? partial.actions
      : Array.isArray(extracted.actions)
        ? extracted.actions
        : [],
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
    route: CONSTANTS.MODEL_ROUTE_FAST,
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
