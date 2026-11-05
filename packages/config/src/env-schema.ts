import { defineSchema } from "@microx-technologies/microenv";
import { z } from "@pims/config/zod-microenv.ts";

const booleanSchema = (defaultValue = false) =>
  z.preprocess(
    (v: unknown) =>
      typeof v === "string" ? v.toLowerCase() === "true" : Boolean(v),
    z.boolean().default(defaultValue),
  );

export const schema = defineSchema({
  // --- Model Provider & API Credentials ---
  OPENAI_API_KEY: z.string().min(1),
  MISTRAL_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url(),
  REASONING_MODEL: z.string().min(1),
  FAST_MODEL: z.string().min(1),
  VISION_MODEL: z.string().min(1),
  EMBEDDINGS_MODEL: z.string().min(1),
  RERANKER_MODEL: z.string().min(1),
  MODEL_LOGPROBS: booleanSchema(false),

  // --- PIMS API Connection Settings ---
  PIMS_BASE_URL: z.string().url(),
  PIMS_SCHEMA: z.string().min(1),
  PIMS_USERNAME: z.string().min(1),
  PIMS_PASSWORD: z.string().min(1),
  PIMS_TIMEOUT_MS: z.coerce.number().default(15000),
  PIMS_MAX_RETRIES: z.coerce.number().default(3),
  PIMS_PAGE_SIZE: z.string().default("50/100"),
  IDEMPOTENCY_KEY_PREFIX: z.string().default("pims_idemp_"),

  // --- Autonomous Watcher Daemon & Compliance Gates ---
  AUTO_NOTIFY: booleanSchema(false),
  PHASE_DUE_HOURS: z.coerce.number().default(24),
  REVIEW_CHALLENGE_BLOCKING: booleanSchema(true),
  WATCHER_POLL_INTERVAL_MS: z.coerce.number().default(5000),

  // --- Evidence Store, HMAC & Security Invariants ---
  EVIDENCE_HASH: z.literal("sha256").default("sha256"),
  EVIDENCE_KEY_ENV: z.string().default("EVIDENCE_KEY"),
  EVIDENCE_KEY: z.string().min(1),
  EVIDENCE_DB_URL: z.string().min(1),
  WEBHOOK_INGEST_SECRET_ENV: z.string().default("WEBHOOK_INGEST_SECRET"),
  WEBHOOK_INGEST_SECRET: z.string().min(1),
  LOG_PII: z.literal("false").default("false"),

  // --- Deploy & Data Directory Settings ---
  DEPLOY_PORT: z.coerce.number().default(3000),
  DEPLOY_DATA_DIR: z.string().default(".evidence_blobs"),

  // --- Dual-Modal RAG Subsystem ---
  RAG_CORPUS_DIR: z.string().default("corpus"),
  RAG_TOP_K: z.coerce.number().default(8),
  RAG_RERANK_K: z.coerce.number().default(4),
  RAG_MIN_SCORE: z.coerce.number().default(0.35),
  RAG_TIMEOUT_MS: z.coerce.number().default(3000),

  // --- Guided Creation & PII Redaction ---
  PRESIDIO_URL: z.string().url().default("http://127.0.0.1:3001"),
  PRESIDIO_IMAGE: z.string().default("presidio-analyzer:2.2.x-es"),
  PRESIDIO_MODEL: z.string().default("es_core_news_md"),
  PRESIDIO_TIMEOUT_MS: z.coerce.number().default(1500),
  PRESIDIO_MIN_SCORE: z.coerce.number().default(0.5),
  FORM_NARRATIVE_MAX_CHARS: z.coerce.number().default(4000),
});

export type AppSchema = typeof schema;
export default schema;
