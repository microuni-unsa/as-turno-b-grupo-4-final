import type { EventType } from "@pims/types/pims.ts";

export const DEFAULT_PIMS_BASE_URL = "https://unsa.27k.pe";
export const DEFAULT_PIMS_SCHEMA = "unsa";
export const DEFAULT_PIMS_TIMEOUT_MS = 15000;
export const DEFAULT_PIMS_MAX_RETRIES = 3;
export const DEFAULT_IDEMPOTENCY_KEY_PREFIX = "agi1";
export const DEFAULT_RETRY_BACKOFF_MS = [1000, 5000, 30000] as const;
export const MAX_ATTACHMENT_SIZE_MB = 10;
export const MAX_INCIDENT_DESCRIPTION_LENGTH = 1000;

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
export const DEFAULT_ANCHOR_SIMILARITY_THRESHOLD = 0.55;

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
export const DEFAULT_CRAG_SUPPORTED_THRESHOLD = 0.65;
export const RERANK_PPR_WEIGHT = 0.85;
export const RERANK_PPR_COMPLEMENT = 0.15;
export const RERANK_PPR_SCALE = 2.5;
export const RRF_K = 60;
export const RRF_WEIGHT_DENSE = 1.0;
export const RRF_WEIGHT_BM25 = 1.2;
export const RRF_WEIGHT_PPR = 1.5;
export const PPR_ALPHA = 0.85;
export const PPR_MAX_ITER = 25;
export const RAG_DENSE_K = 30;
export const RAG_BM25_K = 40;
export const RAG_REWRITE_BM25_K = 20;
export const RAG_EMBED_BATCH_SIZE = 25;
export const RAG_EMBED_CONCURRENCY = 2;
export const KG_LINK_TOP_K = 3;
export const KG_ANCHOR_TOP_K = 5;
export const KG_NODE_EMBEDDINGS_MISSING_MESSAGE =
  "Knowledge graph node embeddings have not been indexed. Call indexNodeEmbeddings() first.";
export const RAG_DECOMPOSE_MAX_TOKENS = 1500;
export const DEFAULT_CORPUS_DIR = "corpus";
export const CORPUS_HEADER_PREFIX = "[DOC:";
export const MAX_CHAT_MAX_TOKENS = 4096;
export const DEFAULT_RAG_DECOMPOSITION_PROMPT = `You are an expert regulatory, legal, and technical query analyst.
Given a query, return strict JSON with:
1. "sub_queries": Array of 1-3 targeted short sub-queries breaking down compound elements.
2. "hyde_clause": A concise 1-2 sentence hypothetical normative clause snippet (under 50 words).
3. "graph_anchors": Key domain entity anchors (e.g. "gdpr:art33.1", "gdpr:art33.5", "iso:b.3.12", "iso:10.2").
Keep the response concise and strictly valid JSON.`;
export function formatCorpusHeader(
  docId: string,
  clause: string,
  normative: boolean,
): string {
  return `${CORPUS_HEADER_PREFIX}${docId} | CLAUSE:${clause} | NORMATIVE:${normative}]`;
}
