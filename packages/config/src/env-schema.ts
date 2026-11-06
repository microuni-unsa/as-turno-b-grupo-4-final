import { defineSchema } from "@microx-technologies/microenv";
import { z } from "@pims/config/zod-microenv.ts";
import { CONSTANTS } from "@pims/types/constants.ts";

const booleanSchema = (defaultValue = false) =>
  z.preprocess((v: unknown) => {
    if (typeof v === "boolean") {
      return v;
    }
    if (typeof v === "string") {
      const trimmed = v.trim().toLowerCase();
      if (trimmed === "true") {
        return true;
      }
      if (trimmed === "false") {
        return false;
      }
      return v;
    }
    return v;
  }, z.boolean().default(defaultValue));

const numberSchema = (defaultValue: number) =>
  z.preprocess((v: unknown) => {
    if (typeof v === "number" && !Number.isNaN(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim() !== "") {
      const parsed = Number(v);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
      return v;
    }
    return v;
  }, z.number().default(defaultValue));

export const schema = defineSchema({
  // --- Model Provider & API Credentials ---
  OPENAI_API_KEY: z.string().min(1),
  MISTRAL_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url(),

  REASONING_MODEL: z.string().min(1),
  REASONING_MODEL_ENDPOINT: z.string().url(),
  REASONING_MODEL_API_KEY: z.string().min(1),

  FAST_MODEL: z.string().min(1),
  FAST_MODEL_ENDPOINT: z.string().url(),
  FAST_MODEL_API_KEY: z.string().min(1),

  VISION_MODEL: z.string().min(1),
  VISION_MODEL_ENDPOINT: z.string().url(),
  VISION_MODEL_API_KEY: z.string().min(1),

  EMBEDDINGS_MODEL: z.string().min(1),
  EMBEDDINGS_MODEL_ENDPOINT: z.string().url(),
  EMBEDDINGS_MODEL_API_KEY: z.string().min(1),

  RERANKER_MODEL: z.string().min(1),
  RERANKER_MODEL_ENDPOINT: z.string().url(),
  RERANKER_MODEL_API_KEY: z.string().min(1),

  MODEL_LOGPROBS: booleanSchema(false),

  // --- PIMS API Connection Settings ---
  PIMS_BASE_URL: z.string().url(),
  PIMS_SCHEMA: z.string().min(1),
  PIMS_USERNAME: z.string().min(1),
  PIMS_PASSWORD: z.string().min(1),
  PIMS_TIMEOUT_MS: numberSchema(CONSTANTS.DEFAULT_PIMS_TIMEOUT_MS),
  PIMS_MAX_RETRIES: numberSchema(CONSTANTS.DEFAULT_PIMS_MAX_RETRIES),
  PIMS_PAGE_SIZE: z.string().default("50/100"),
  IDEMPOTENCY_KEY_PREFIX: z
    .string()
    .default(CONSTANTS.DEFAULT_IDEMPOTENCY_KEY_PREFIX),

  // --- Autonomous Watcher Daemon & Compliance Gates ---
  AUTO_NOTIFY: booleanSchema(false),
  PHASE_DUE_HOURS: numberSchema(CONSTANTS.DEFAULT_PHASE_DUE_HOURS),
  REVIEW_CHALLENGE_BLOCKING: booleanSchema(true),
  WATCHER_POLL_INTERVAL_MS: numberSchema(
    CONSTANTS.DEFAULT_WATCHER_POLL_INTERVAL_MS,
  ),

  // --- Evidence Store, HMAC & Security Invariants ---
  EVIDENCE_HASH: z.literal("sha256").default("sha256"),
  EVIDENCE_KEY_ENV: z.string().default(CONSTANTS.EVIDENCE_KEY_ENV),
  EVIDENCE_KEY: z.string().min(1),
  EVIDENCE_DB_URL: z.string().min(1),
  WEBHOOK_INGEST_SECRET_ENV: z
    .string()
    .default(CONSTANTS.WEBHOOK_INGEST_SECRET_ENV),
  WEBHOOK_INGEST_SECRET: z.string().min(1),
  LOG_PII: z.literal("false").default("false"),

  // --- Deploy & Data Directory Settings ---
  DEPLOY_PORT: numberSchema(CONSTANTS.DEPLOY_PORT),
  DEPLOY_DATA_DIR: z.string().default(CONSTANTS.DEPLOY_DATA_DIR),

  // --- Dual-Modal RAG Subsystem ---
  RAG_CORPUS_DIR: z.string().default(CONSTANTS.DEFAULT_CORPUS_DIR),
  RAG_TOP_K: numberSchema(CONSTANTS.DEFAULT_RAG_TOP_K),
  RAG_RERANK_K: numberSchema(CONSTANTS.DEFAULT_RAG_RERANK_K),
  RAG_MIN_SCORE: numberSchema(CONSTANTS.DEFAULT_RAG_MIN_SCORE),
  RAG_TIMEOUT_MS: numberSchema(CONSTANTS.DEFAULT_RAG_TIMEOUT_MS),

  // --- Guided Creation & PII Redaction ---
  PRESIDIO_URL: z.string().url().default(CONSTANTS.PRESIDIO_URL),
  PRESIDIO_IMAGE: z.string().default(CONSTANTS.PRESIDIO_IMAGE),
  PRESIDIO_MODEL: z.string().default(CONSTANTS.PRESIDIO_MODEL),
  PRESIDIO_TIMEOUT_MS: numberSchema(CONSTANTS.PRESIDIO_TIMEOUT_MS),
  PRESIDIO_MIN_SCORE: numberSchema(CONSTANTS.PRESIDIO_MIN_SCORE),
  FORM_NARRATIVE_MAX_CHARS: numberSchema(CONSTANTS.FORM_NARRATIVE_MAX_CHARS),
});

export type AppSchema = typeof schema;
export default schema;
