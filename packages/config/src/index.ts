import {
  DEFAULT_AUTO_NOTIFY,
  DEFAULT_CORPUS_DIR,
  DEFAULT_IDEMPOTENCY_KEY_PREFIX,
  DEFAULT_MODEL_LOGPROBS,
  DEFAULT_PHASE_DUE_HOURS,
  DEFAULT_PIMS_BASE_URL,
  DEFAULT_PIMS_MAX_RETRIES,
  DEFAULT_PIMS_SCHEMA,
  DEFAULT_PIMS_TIMEOUT_MS,
  DEFAULT_REVIEW_CHALLENGE_BLOCKING,
  DEFAULT_WATCHER_POLL_INTERVAL_MS,
  MAX_ATTACHMENT_SIZE_MB,
} from "@pims/types/constants.ts";
import { ConfigError } from "@pims/types/errors.ts";
import { z } from "zod";

export const ModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  endpoint: z.string().optional(),
  auth_env: z.string().min(1),
  timeout_ms: z.number().int().positive(),
  max_retries: z.number().int().nonnegative(),
  fallback: z.literal("none"),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const JurisdictionDeadlinesSchema = z.record(
  z.string(),
  z.object({
    authority_h: z.union([z.number(), z.string()]),
    processor_to_controller: z.string().optional(),
  }),
);
export type JurisdictionDeadlines = z.infer<typeof JurisdictionDeadlinesSchema>;

export interface AgentConfig {
  PIMS_BASE_URL: string;
  PIMS_SCHEMA: string;
  PIMS_USERNAME: string;
  PIMS_PASSWORD: string;
  PIMS_TIMEOUT_MS: number;
  PIMS_MAX_RETRIES: number;
  PIMS_PAGE_SIZE: { default: number; max: number };
  PIMS_EXTRA_HEADERS_JSON?: string;
  PIMS_COOKIES_JSON?: string;
  IDEMPOTENCY_KEY_PREFIX: string;
  JURISDICTION_DEADLINES_JSON: JurisdictionDeadlines;
  SUBJECT_NOTICE_POLICY: "high_risk_only";
  HUMAN_VETO_WINDOW_MIN: number;
  ASSIGNEES: string[];
  REASONING_MODEL: ModelConfig;
  FAST_MODEL: ModelConfig;
  VISION_MODEL?: ModelConfig;
  EMBEDDINGS_MODEL: ModelConfig;
  RERANKER_MODEL: ModelConfig;
  TEMP_CLASSIFIER: number;
  TEMP_REASONING: number;
  MAX_REVIEW_CYCLES: number;
  PLAIN_LANG_MAX_WORDS: number;
  DEDUPE_TRIGRAM_THRESHOLD: number;
  DEDUPE_COSINE_THRESHOLD: number;
  SLA_PROCESSOR_H: number;
  SLA_SUBJECT_H: number;
  SLA_REVIEW_H: number;
  CORRECTIVE_DEFAULT_DUE_DAYS: number;
  CIRCUIT_BREAKER_FAILS: number;
  CIRCUIT_BREAKER_WINDOW_S: number;
  CIRCUIT_BREAKER_OPEN_S: number;
  RAG_CORPUS_PATHS: Record<string, string>;
  RAG_CHUNK_NORMATIVE: { size: number; overlap: number };
  RAG_CHUNK_OTHER: { size: number; overlap: number };
  RAG_CORPUS_DIR: string;
  RAG_TOP_K: number;
  RAG_RERANK_K: number;
  RAG_MIN_SCORE: number;
  RAG_TIMEOUT_MS: number;
  SCHEDULER_TICK_S: number;
  SCHEDULER_JITTER_S: number;
  SCHEDULER_MAX_TIMERS: number;
  EVIDENCE_HASH: "sha256";
  EVIDENCE_KEY_ENV: string;
  EVIDENCE_DB_URL: string;
  AUTO_NOTIFY: boolean;
  MODEL_LOGPROBS: boolean;
  PHASE_DUE_HOURS: number;
  REVIEW_CHALLENGE_BLOCKING: boolean;
  WATCHER_POLL_INTERVAL_MS: number;
  WEBHOOK_INGEST_SECRET_ENV: string;
  ATTACHMENT_MAX_MB: number;
  RETENTION_NOTICE_YEARS: number;
  INDICATOR_WEBHOOK_URL?: string;
  INDICATOR_WEBHOOK_SECRET_ENV?: string;
  INDICATOR_SPOOL_MAX: number;
  LOG_PII: false;
  LEASE_TTL_S: number;
  LEASE_RENEW_S: number;
  DEPLOY_PORT: number;
  DEPLOY_DATA_DIR: string;
}

export function loadModelProviderOptions(credentials: Record<string, string>): {
  apiKey: string;
  cohereApiKey?: string;
  baseURL?: string;
} {
  const apiKey = credentials.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "")
    throw new ConfigError(
      "OPENAI_API_KEY is missing or empty in credentials",
      "CONFIG_MISSING:OPENAI_API_KEY",
    );
  const out: { apiKey: string; cohereApiKey?: string; baseURL?: string } = {
    apiKey,
  };
  const cohere = credentials.COHERE_API_KEY;
  if (cohere !== undefined && cohere !== "") out.cohereApiKey = cohere;
  const base = credentials.OPENAI_BASE_URL;
  if (base !== undefined && base !== "") out.baseURL = base;
  return out;
}

function parseModelConfig(
  raw: unknown,
  key: string,
  env: Record<string, string | undefined>,
): ModelConfig {
  if (typeof raw === "string") {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length < 7) {
      throw new ConfigError(
        `Invalid model config format for ${key}. Expected: provider,model,endpoint,auth_env,timeout_ms,max_retries,fallback:none`,
        `CONFIG_TYPE:${key}`,
      );
    }
    const [
      provider,
      model,
      endpoint,
      auth_env,
      timeoutStr,
      retryStr,
      fallbackStr,
    ] = parts;
    const timeout_ms = Number.parseInt(timeoutStr ?? "", 10);
    const max_retries = Number.parseInt(retryStr ?? "", 10);
    if (Number.isNaN(timeout_ms) || Number.isNaN(max_retries)) {
      throw new ConfigError(
        `Invalid numbers in model config for ${key}`,
        `CONFIG_TYPE:${key}`,
      );
    }
    if (fallbackStr !== "fallback:none") {
      throw new ConfigError(
        `Invalid fallback spec in ${key}: must be fallback:none`,
        `CONFIG_TYPE:${key}`,
      );
    }
    const candidate = {
      provider,
      model,
      endpoint: endpoint === "" ? undefined : endpoint,
      auth_env,
      timeout_ms,
      max_retries,
      fallback: "none" as const,
    };
    const result = ModelConfigSchema.safeParse(candidate);
    if (!result.success) {
      throw new ConfigError(
        `Invalid model config for ${key}: ${result.error.message}`,
        `CONFIG_TYPE:${key}`,
      );
    }
    if (!auth_env || !env[auth_env]) {
      throw new ConfigError(
        `Referenced auth env ${auth_env} for ${key} is missing or empty`,
        `CONFIG_MISSING:${auth_env}`,
      );
    }
    return result.data;
  }

  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const candidate = {
      provider: obj.provider,
      model: obj.model,
      endpoint:
        typeof obj.endpoint === "string" && obj.endpoint !== ""
          ? obj.endpoint
          : undefined,
      auth_env: obj.auth_env,
      timeout_ms: obj.timeout_ms,
      max_retries: obj.max_retries,
      fallback: obj.fallback,
    };
    const result = ModelConfigSchema.safeParse(candidate);
    if (!result.success) {
      throw new ConfigError(
        `Invalid model config for ${key}: ${result.error.message}`,
        `CONFIG_TYPE:${key}`,
      );
    }
    if (!result.data.auth_env || !env[result.data.auth_env]) {
      throw new ConfigError(
        `Referenced auth env ${result.data.auth_env} for ${key} is missing or empty`,
        `CONFIG_MISSING:${result.data.auth_env}`,
      );
    }
    return result.data;
  }

  throw new ConfigError(`Invalid type for ${key}`, `CONFIG_TYPE:${key}`);
}

export function loadConfig(
  envOverride?: Record<string, string | undefined>,
): AgentConfig {
  const env = envOverride ?? process.env;

  if (
    env.LOG_PII !== undefined &&
    (env.LOG_PII === "true" || (env.LOG_PII as unknown) === true)
  ) {
    throw new ConfigError(
      "LOG_PII must be strictly false and can never be enabled",
      "CONFIG_REJECTED:LOG_PII",
    );
  }

  const pimsBaseUrl = env.PIMS_BASE_URL ?? DEFAULT_PIMS_BASE_URL;
  try {
    new URL(pimsBaseUrl);
  } catch {
    throw new ConfigError(
      "PIMS_BASE_URL must be a valid URL",
      "CONFIG_TYPE:PIMS_BASE_URL",
    );
  }

  const pimsSchema = env.PIMS_SCHEMA ?? DEFAULT_PIMS_SCHEMA;

  const usernameRaw = env.PIMS_USERNAME?.trim();
  const passwordRaw = env.PIMS_PASSWORD;
  const hasUsername = usernameRaw !== undefined && usernameRaw !== "";
  const hasPassword = passwordRaw !== undefined && passwordRaw.trim() !== "";

  if (!hasUsername || !hasPassword) {
    throw new ConfigError(
      "Password auth requires both PIMS_USERNAME and PIMS_PASSWORD",
      "CONFIG_MISSING:PIMS_AUTH",
    );
  }

  let jurisdictionDeadlines: JurisdictionDeadlines;
  const rawJurisdiction =
    env.JURISDICTION_DEADLINES_JSON ??
    '{"EU_GDPR":{"authority_h":72,"processor_to_controller":"without_undue_delay"},"PE_PDP":{"authority_h":"48_unverified"}}';
  try {
    const rawParsed = JSON.parse(rawJurisdiction);
    const valid = JurisdictionDeadlinesSchema.safeParse(rawParsed);
    if (!valid.success) {
      throw new Error();
    }
    jurisdictionDeadlines = valid.data;
  } catch {
    throw new ConfigError(
      "JURISDICTION_DEADLINES_JSON must be valid JSON matching deadline schema",
      "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON",
    );
  }

  if (!env.REASONING_MODEL) {
    throw new ConfigError(
      "REASONING_MODEL is required",
      "CONFIG_MISSING:REASONING_MODEL",
    );
  }
  if (!env.FAST_MODEL) {
    throw new ConfigError(
      "FAST_MODEL is required",
      "CONFIG_MISSING:FAST_MODEL",
    );
  }
  if (!env.EMBEDDINGS_MODEL) {
    throw new ConfigError(
      "EMBEDDINGS_MODEL is required",
      "CONFIG_MISSING:EMBEDDINGS_MODEL",
    );
  }
  if (!env.RERANKER_MODEL) {
    throw new ConfigError(
      "RERANKER_MODEL is required",
      "CONFIG_MISSING:RERANKER_MODEL",
    );
  }

  const reasoningModel = parseModelConfig(
    env.REASONING_MODEL,
    "REASONING_MODEL",
    env,
  );
  const fastModel = parseModelConfig(env.FAST_MODEL, "FAST_MODEL", env);
  const visionModel =
    env.VISION_MODEL === undefined
      ? undefined
      : parseModelConfig(env.VISION_MODEL, "VISION_MODEL", env);
  const embeddingsModel = parseModelConfig(
    env.EMBEDDINGS_MODEL,
    "EMBEDDINGS_MODEL",
    env,
  );
  const rerankerModel = parseModelConfig(
    env.RERANKER_MODEL,
    "RERANKER_MODEL",
    env,
  );

  const evidenceKeyEnv = env.EVIDENCE_KEY_ENV ?? "EVIDENCE_KEY";
  if (!env[evidenceKeyEnv]) {
    throw new ConfigError(
      `Referenced EVIDENCE_KEY_ENV (${evidenceKeyEnv}) is missing or empty`,
      `CONFIG_MISSING:${evidenceKeyEnv}`,
    );
  }

  const evidenceDbUrlRaw = env.EVIDENCE_DB_URL?.trim();
  if (evidenceDbUrlRaw === undefined || evidenceDbUrlRaw === "") {
    throw new ConfigError(
      "EVIDENCE_DB_URL is required",
      "CONFIG_MISSING:EVIDENCE_DB_URL",
    );
  }
  try {
    new URL(evidenceDbUrlRaw);
  } catch {
    throw new ConfigError(
      "EVIDENCE_DB_URL must be a valid URL",
      "CONFIG_TYPE:EVIDENCE_DB_URL",
    );
  }

  const modelLogprobsRaw = env.MODEL_LOGPROBS;
  if (
    modelLogprobsRaw !== undefined &&
    modelLogprobsRaw !== "true" &&
    modelLogprobsRaw !== "false"
  ) {
    throw new ConfigError(
      "MODEL_LOGPROBS must be either 'true' or 'false'",
      "CONFIG_TYPE:MODEL_LOGPROBS",
    );
  }
  const modelLogprobs =
    modelLogprobsRaw === undefined
      ? DEFAULT_MODEL_LOGPROBS
      : modelLogprobsRaw === "true";

  const phaseDueHours = env.PHASE_DUE_HOURS
    ? Number.parseInt(env.PHASE_DUE_HOURS, 10)
    : DEFAULT_PHASE_DUE_HOURS;
  if (!Number.isInteger(phaseDueHours) || phaseDueHours <= 0) {
    throw new ConfigError(
      "PHASE_DUE_HOURS must be a positive integer",
      "CONFIG_TYPE:PHASE_DUE_HOURS",
    );
  }

  const reviewChallengeBlockingRaw = env.REVIEW_CHALLENGE_BLOCKING;
  if (
    reviewChallengeBlockingRaw !== undefined &&
    reviewChallengeBlockingRaw !== "true" &&
    reviewChallengeBlockingRaw !== "false"
  ) {
    throw new ConfigError(
      "REVIEW_CHALLENGE_BLOCKING must be either 'true' or 'false'",
      "CONFIG_TYPE:REVIEW_CHALLENGE_BLOCKING",
    );
  }
  const reviewChallengeBlocking =
    reviewChallengeBlockingRaw === undefined
      ? DEFAULT_REVIEW_CHALLENGE_BLOCKING
      : reviewChallengeBlockingRaw === "true";

  const autoNotifyRaw = env.AUTO_NOTIFY;
  if (
    autoNotifyRaw !== undefined &&
    autoNotifyRaw !== "true" &&
    autoNotifyRaw !== "false"
  ) {
    throw new ConfigError(
      "AUTO_NOTIFY must be either 'true' or 'false'",
      "CONFIG_TYPE:AUTO_NOTIFY",
    );
  }
  const autoNotify =
    autoNotifyRaw === undefined
      ? DEFAULT_AUTO_NOTIFY
      : autoNotifyRaw === "true";

  const watcherPollRaw = env.WATCHER_POLL_INTERVAL_MS;
  let watcherPollIntervalMs = DEFAULT_WATCHER_POLL_INTERVAL_MS;
  if (watcherPollRaw !== undefined) {
    const parsed = Number(watcherPollRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ConfigError(
        "WATCHER_POLL_INTERVAL_MS must be a positive integer",
        "CONFIG_TYPE:WATCHER_POLL_INTERVAL_MS",
      );
    }
    watcherPollIntervalMs = parsed;
  }

  const ragCorpusDirRaw = env.RAG_CORPUS_DIR?.trim();
  const ragCorpusDir =
    ragCorpusDirRaw === undefined || ragCorpusDirRaw === ""
      ? DEFAULT_CORPUS_DIR
      : ragCorpusDirRaw;

  const subjectNoticePolicy = env.SUBJECT_NOTICE_POLICY ?? "high_risk_only";
  if (subjectNoticePolicy !== "high_risk_only") {
    throw new ConfigError(
      `Invalid SUBJECT_NOTICE_POLICY: ${subjectNoticePolicy}`,
      "CONFIG_REJECTED:SUBJECT_NOTICE_POLICY",
    );
  }

  const attachmentMaxMb = env.ATTACHMENT_MAX_MB
    ? Number.parseInt(env.ATTACHMENT_MAX_MB, 10)
    : MAX_ATTACHMENT_SIZE_MB;
  if (Number.isNaN(attachmentMaxMb)) {
    throw new ConfigError(
      "ATTACHMENT_MAX_MB must be an integer",
      "CONFIG_TYPE:ATTACHMENT_MAX_MB",
    );
  }
  if (attachmentMaxMb > MAX_ATTACHMENT_SIZE_MB) {
    throw new ConfigError(
      `ATTACHMENT_MAX_MB (${attachmentMaxMb}) exceeds PIMS maximum of ${MAX_ATTACHMENT_SIZE_MB} MB`,
      "CONFIG_REJECTED:ATTACHMENT_MAX_MB",
    );
  }

  const evidenceHash = env.EVIDENCE_HASH ?? "sha256";
  if (evidenceHash !== "sha256") {
    throw new ConfigError(
      `Invalid EVIDENCE_HASH: ${evidenceHash}`,
      "CONFIG_REJECTED:EVIDENCE_HASH",
    );
  }

  const pimsTimeoutMs = env.PIMS_TIMEOUT_MS
    ? Number.parseInt(env.PIMS_TIMEOUT_MS, 10)
    : DEFAULT_PIMS_TIMEOUT_MS;
  if (Number.isNaN(pimsTimeoutMs)) {
    throw new ConfigError(
      "PIMS_TIMEOUT_MS must be an integer",
      "CONFIG_TYPE:PIMS_TIMEOUT_MS",
    );
  }

  const pimsMaxRetries = env.PIMS_MAX_RETRIES
    ? Number.parseInt(env.PIMS_MAX_RETRIES, 10)
    : DEFAULT_PIMS_MAX_RETRIES;
  if (Number.isNaN(pimsMaxRetries)) {
    throw new ConfigError(
      "PIMS_MAX_RETRIES must be an integer",
      "CONFIG_TYPE:PIMS_MAX_RETRIES",
    );
  }

  let pimsPageSize = { default: 50, max: 100 };
  if (env.PIMS_PAGE_SIZE) {
    const parts = env.PIMS_PAGE_SIZE.split("/").map((s) =>
      Number.parseInt(s.trim(), 10),
    );
    if (
      parts.length === 2 &&
      !Number.isNaN(parts[0]) &&
      !Number.isNaN(parts[1])
    ) {
      pimsPageSize = { default: parts[0] as number, max: parts[1] as number };
    } else {
      throw new ConfigError(
        "PIMS_PAGE_SIZE must be in default/max format (e.g. 50/100)",
        "CONFIG_TYPE:PIMS_PAGE_SIZE",
      );
    }
  }

  let assignees: string[] = [];
  if (env.ASSIGNEES) {
    try {
      assignees = JSON.parse(env.ASSIGNEES);
      if (!Array.isArray(assignees)) {
        throw new Error();
      }
    } catch {
      throw new ConfigError(
        "ASSIGNEES must be a JSON array of strings",
        "CONFIG_TYPE:ASSIGNEES",
      );
    }
  }

  const extraHeadersRaw = env.PIMS_EXTRA_HEADERS_JSON;
  if (extraHeadersRaw !== undefined && extraHeadersRaw.trim() !== "") {
    try {
      const parsed = JSON.parse(extraHeadersRaw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error();
      }
      if (Object.values(parsed).some((value) => typeof value !== "string")) {
        throw new Error();
      }
    } catch {
      throw new ConfigError(
        "PIMS_EXTRA_HEADERS_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
      );
    }
  }

  const cookiesRaw = env.PIMS_COOKIES_JSON;
  if (cookiesRaw !== undefined && cookiesRaw.trim() !== "") {
    try {
      const parsed = JSON.parse(cookiesRaw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error();
      }
      if (Object.values(parsed).some((value) => typeof value !== "string")) {
        throw new Error();
      }
    } catch {
      throw new ConfigError(
        "PIMS_COOKIES_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_COOKIES_JSON",
      );
    }
  }

  return {
    PIMS_BASE_URL: pimsBaseUrl,
    PIMS_SCHEMA: pimsSchema,
    PIMS_USERNAME: usernameRaw as string,
    PIMS_PASSWORD: passwordRaw as string,
    PIMS_TIMEOUT_MS: pimsTimeoutMs,
    PIMS_MAX_RETRIES: pimsMaxRetries,
    PIMS_PAGE_SIZE: pimsPageSize,
    PIMS_EXTRA_HEADERS_JSON: extraHeadersRaw,
    PIMS_COOKIES_JSON: cookiesRaw,
    IDEMPOTENCY_KEY_PREFIX:
      env.IDEMPOTENCY_KEY_PREFIX ?? DEFAULT_IDEMPOTENCY_KEY_PREFIX,
    JURISDICTION_DEADLINES_JSON: jurisdictionDeadlines,
    SUBJECT_NOTICE_POLICY: "high_risk_only",
    HUMAN_VETO_WINDOW_MIN: env.HUMAN_VETO_WINDOW_MIN
      ? Number.parseInt(env.HUMAN_VETO_WINDOW_MIN, 10)
      : 0,
    ASSIGNEES: assignees,
    REASONING_MODEL: reasoningModel,
    FAST_MODEL: fastModel,
    VISION_MODEL: visionModel,
    EMBEDDINGS_MODEL: embeddingsModel,
    RERANKER_MODEL: rerankerModel,
    TEMP_CLASSIFIER: env.TEMP_CLASSIFIER
      ? Number.parseFloat(env.TEMP_CLASSIFIER)
      : 0.0,
    TEMP_REASONING: env.TEMP_REASONING
      ? Number.parseFloat(env.TEMP_REASONING)
      : 0.2,
    MAX_REVIEW_CYCLES: env.MAX_REVIEW_CYCLES
      ? Number.parseInt(env.MAX_REVIEW_CYCLES, 10)
      : 3,
    PLAIN_LANG_MAX_WORDS: env.PLAIN_LANG_MAX_WORDS
      ? Number.parseInt(env.PLAIN_LANG_MAX_WORDS, 10)
      : 25,
    DEDUPE_TRIGRAM_THRESHOLD: env.DEDUPE_TRIGRAM_THRESHOLD
      ? Number.parseFloat(env.DEDUPE_TRIGRAM_THRESHOLD)
      : 0.85,
    DEDUPE_COSINE_THRESHOLD: env.DEDUPE_COSINE_THRESHOLD
      ? Number.parseFloat(env.DEDUPE_COSINE_THRESHOLD)
      : 0.9,
    SLA_PROCESSOR_H: env.SLA_PROCESSOR_H
      ? Number.parseInt(env.SLA_PROCESSOR_H, 10)
      : 1,
    SLA_SUBJECT_H: env.SLA_SUBJECT_H
      ? Number.parseInt(env.SLA_SUBJECT_H, 10)
      : 4,
    SLA_REVIEW_H: env.SLA_REVIEW_H ? Number.parseInt(env.SLA_REVIEW_H, 10) : 4,
    CORRECTIVE_DEFAULT_DUE_DAYS: env.CORRECTIVE_DEFAULT_DUE_DAYS
      ? Number.parseInt(env.CORRECTIVE_DEFAULT_DUE_DAYS, 10)
      : 30,
    CIRCUIT_BREAKER_FAILS: env.CIRCUIT_BREAKER_FAILS
      ? Number.parseInt(env.CIRCUIT_BREAKER_FAILS, 10)
      : 5,
    CIRCUIT_BREAKER_WINDOW_S: env.CIRCUIT_BREAKER_WINDOW_S
      ? Number.parseInt(env.CIRCUIT_BREAKER_WINDOW_S, 10)
      : 60,
    CIRCUIT_BREAKER_OPEN_S: env.CIRCUIT_BREAKER_OPEN_S
      ? Number.parseInt(env.CIRCUIT_BREAKER_OPEN_S, 10)
      : 300,
    RAG_CORPUS_PATHS: env.RAG_CORPUS_PATHS
      ? JSON.parse(env.RAG_CORPUS_PATHS)
      : {},
    RAG_CORPUS_DIR: ragCorpusDir,
    RAG_CHUNK_NORMATIVE: { size: 512, overlap: 64 },
    RAG_CHUNK_OTHER: { size: 1024, overlap: 128 },
    RAG_TOP_K: env.RAG_TOP_K ? Number.parseInt(env.RAG_TOP_K, 10) : 8,
    RAG_RERANK_K: env.RAG_RERANK_K ? Number.parseInt(env.RAG_RERANK_K, 10) : 4,
    RAG_MIN_SCORE: env.RAG_MIN_SCORE
      ? Number.parseFloat(env.RAG_MIN_SCORE)
      : 0.35,
    RAG_TIMEOUT_MS: env.RAG_TIMEOUT_MS
      ? Number.parseInt(env.RAG_TIMEOUT_MS, 10)
      : 3000,
    SCHEDULER_TICK_S: env.SCHEDULER_TICK_S
      ? Number.parseInt(env.SCHEDULER_TICK_S, 10)
      : 60,
    SCHEDULER_JITTER_S: env.SCHEDULER_JITTER_S
      ? Number.parseInt(env.SCHEDULER_JITTER_S, 10)
      : 10,
    SCHEDULER_MAX_TIMERS: env.SCHEDULER_MAX_TIMERS
      ? Number.parseInt(env.SCHEDULER_MAX_TIMERS, 10)
      : 10000,
    EVIDENCE_HASH: "sha256",
    EVIDENCE_KEY_ENV: evidenceKeyEnv,
    EVIDENCE_DB_URL: evidenceDbUrlRaw,
    AUTO_NOTIFY: autoNotify,
    MODEL_LOGPROBS: modelLogprobs,
    PHASE_DUE_HOURS: phaseDueHours,
    REVIEW_CHALLENGE_BLOCKING: reviewChallengeBlocking,
    WATCHER_POLL_INTERVAL_MS: watcherPollIntervalMs,
    WEBHOOK_INGEST_SECRET_ENV:
      env.WEBHOOK_INGEST_SECRET_ENV ?? "WEBHOOK_INGEST_SECRET",
    ATTACHMENT_MAX_MB: attachmentMaxMb,
    RETENTION_NOTICE_YEARS: env.RETENTION_NOTICE_YEARS
      ? Number.parseInt(env.RETENTION_NOTICE_YEARS, 10)
      : 6,
    INDICATOR_WEBHOOK_URL: env.INDICATOR_WEBHOOK_URL,
    INDICATOR_WEBHOOK_SECRET_ENV: env.INDICATOR_WEBHOOK_SECRET_ENV,
    INDICATOR_SPOOL_MAX: env.INDICATOR_SPOOL_MAX
      ? Number.parseInt(env.INDICATOR_SPOOL_MAX, 10)
      : 10000,
    LOG_PII: false,
    LEASE_TTL_S: env.LEASE_TTL_S ? Number.parseInt(env.LEASE_TTL_S, 10) : 300,
    LEASE_RENEW_S: env.LEASE_RENEW_S
      ? Number.parseInt(env.LEASE_RENEW_S, 10)
      : 60,
    DEPLOY_PORT: env.DEPLOY_PORT ? Number.parseInt(env.DEPLOY_PORT, 10) : 8080,
    DEPLOY_DATA_DIR: env.DEPLOY_DATA_DIR ?? "/app/data",
  };
}
