import type { EventType } from "@pims/types/pims.ts";

export const DEFAULT_PIMS_BASE_URL = "https://unsa.27k.pe";
export const DEFAULT_PIMS_SCHEMA = "unsa";
export const DEFAULT_PIMS_TIMEOUT_MS = 15000;
export const DEFAULT_PIMS_MAX_RETRIES = 3;
export const DEFAULT_IDEMPOTENCY_KEY_PREFIX = "agi1";
export const DEFAULT_RETRY_BACKOFF_MS = [1000, 5000, 30000] as const;
export const MAX_ATTACHMENT_SIZE_MB = 10;
export const MAX_INCIDENT_DESCRIPTION_LENGTH = 1000;

export const ATTACHMENT_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "tif",
  "bmp",
  "pdf",
  "doc",
  "docx",
  "txt",
  "json",
] as const;

export const ATTACHMENT_VISUAL_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg",
  "jpeg",
  "png",
  "tif",
  "bmp",
  "pdf",
]);
export const ATTACHMENT_TEXT_EXTENSIONS: ReadonlySet<string> = new Set(["txt"]);
export const ATTACHMENT_WORD_EXTENSIONS: ReadonlySet<string> = new Set([
  "doc",
  "docx",
]);

export const HIGH_RISK_SUBJECT_THRESHOLD = 100;
export const PLAIN_LANGUAGE_MAX_WORDS = 25;
export const PII_PHONE_REGIONS = ["ES", "PE", "US", "GB"] as const;
export const AUDIT_TRAIL_ALLOWED_ARG_KEYS = [
  "incident_code",
  "status",
] as const;

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  created: "Creado",
  updated: "Actualizado",
  notified: "Notificado",
  status_changed: "Cambio de estado",
  closed: "Cerrado",
  reopened: "Reabierto",
};

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_EMBEDDING_DIM = 1024;
export const DEFAULT_RAG_TOP_K = 8;
export const DEFAULT_RAG_RERANK_K = 4;
export const DEFAULT_RAG_MIN_SCORE = 0.35;
export const DEFAULT_RAG_TIMEOUT_MS = 5000;

export const PIMS_TEST_SEED_PASSWORD = "password123";
export const DEFAULT_CHUNK_MAX_TOKENS = 450;
export const DEFAULT_CHUNK_OVERLAP = 1;
export const MODEL_ROUTE_FAST = "FAST_MODEL";
export const MODEL_ROUTE_REASONING = "REASONING_MODEL";
export const MODEL_ROUTE_VISION = "VISION_MODEL";
export const MODEL_ROUTE_EMBEDDINGS = "EMBEDDINGS_MODEL";
export const MODEL_ROUTE_RERANKER = "RERANKER_MODEL";
export const MODEL_ROUTE_OPENAI = "OPENAI";
export const MODEL_ROUTE_RAG = "rag";
export const DEFAULT_COHERE_BASE_URL = "https://api.cohere.com";
export const DEFAULT_COHERE_RERANK_MODEL = "rerank-v3.5";
export const RRF_K = 60;
export const RRF_WEIGHT_DENSE = 1.0;
export const RRF_WEIGHT_BM25 = 1.2;
export const RAG_DENSE_K = 30;
export const RAG_BM25_K = 80;
export const RAG_EMBED_BATCH_SIZE = 25;
export const RAG_EMBED_CONCURRENCY = 2;
export const DEFAULT_CORPUS_DIR = "corpus";
export const DEFAULT_WATCHER_POLL_INTERVAL_MS = 5000;
export const DEFAULT_AUTO_NOTIFY = false;
export const DEFAULT_MODEL_LOGPROBS = true;
export const DEFAULT_PHASE_DUE_HOURS = 24;
export const DEFAULT_REVIEW_CHALLENGE_BLOCKING = true;
export const BUNDLE_ATTACHMENT_NAME = "bundle.json.txt";

export const PIMS_PERMISSION_MODULES = [
  "Incidentes",
  "Seguridad",
  "Auditorías",
  "Riesgos (DPIIA)",
  "Usuarios y Roles",
  "Activos",
  "Amenazas",
  "Vulnerabilidades",
  "Salvaguardas",
  "Controles Anexo A",
  "Documentos",
  "Consentimientos",
  "ARCO-P",
  "Periodos de Riesgo",
  "Dashboard",
  "Configuración",
] as const;
export type PimsPermissionModule = (typeof PIMS_PERMISSION_MODULES)[number];
export const CORPUS_HEADER_PREFIX = "[DOC:";
export const MAX_CHAT_MAX_TOKENS = 4096;
export const AGENT_VERSION = "1.0.0";
export const PIMS_ACCESS_TOKEN_TTL_S = 3600;
export const ROLE_PROMPT_VERSION = "1.0";
export const CONFORMAL_ALPHA = 0.1;
export const CONFORMAL_MIN_SAMPLES = 20;
export const DEDUPE_MAX_CANDIDATES = 100;
export const EVIDENCE_REFS_MAX_CHARS = 1000;
export const PERU_ADVISORY_H = 48;

export function formatCorpusHeader(
  docId: string,
  clause: string,
  normative: boolean,
): string {
  return `${CORPUS_HEADER_PREFIX}${docId} | CLAUSE:${clause} | NORMATIVE:${normative}]`;
}
