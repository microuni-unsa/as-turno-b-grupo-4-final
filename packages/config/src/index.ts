import { CONSTANTS } from "@pims/types/constants.ts";
import { ConfigError } from "@pims/types/errors.ts";
import { z } from "zod";

export const ModelConfigSchema = z.object({
  model: z.string().min(1),
  endpoint: z.string().url(),
  apiKey: z.string().min(1),
  timeout_ms: z.number().int().positive(),
  max_retries: z.number().int().nonnegative(),
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
  PRESIDIO_URL: string;
  PRESIDIO_IMAGE: string;
  PRESIDIO_MODEL: string;
  PRESIDIO_TIMEOUT_MS: number;
  PRESIDIO_MIN_SCORE: number;
  FORM_NARRATIVE_MAX_CHARS: number;
}

export function loadModelProviderOptions(credentials: Record<string, string>): {
  defaultApiKey: string;
  defaultBaseURL?: string;
} {
  const apiKey = credentials.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "")
    throw new ConfigError(
      "OPENAI_API_KEY is missing or empty in credentials",
      "CONFIG_MISSING:OPENAI_API_KEY",
    );
  const out: { defaultApiKey: string; defaultBaseURL?: string } = {
    defaultApiKey: apiKey.trim(),
  };
  const base = credentials.OPENAI_BASE_URL;
  if (base !== undefined && base.trim() !== "") {
    out.defaultBaseURL = base.trim();
  }
  return out;
}

function parseModelConfig(
  key: string,
  env: Record<string, string | undefined>,
  defaultTimeoutMs: number,
  defaultRetries = 2,
): ModelConfig {
  const raw = env[key] as unknown;
  if (typeof raw === "object" && raw !== null) {
    const result = ModelConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        `Invalid model config for ${key}: ${result.error.message}`,
        `CONFIG_TYPE:${key}`,
      );
    }
    return result.data;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError(`${key} is required`, `CONFIG_MISSING:${key}`);
  }

  const model = raw.trim();
  if (model.includes(",")) {
    throw new ConfigError(
      `Legacy comma-separated format is not supported for ${key}. Use independent env vars: ${key}, ${key}_ENDPOINT, ${key}_API_KEY`,
      `CONFIG_TYPE:${key}`,
    );
  }

  const endpointRaw =
    env[`${key}_ENDPOINT`]?.trim() || env.OPENAI_BASE_URL?.trim();
  if (!endpointRaw) {
    throw new ConfigError(
      `${key}_ENDPOINT is required (or set OPENAI_BASE_URL)`,
      `CONFIG_MISSING:${key}_ENDPOINT`,
    );
  }
  try {
    new URL(endpointRaw);
  } catch {
    throw new ConfigError(
      `${key}_ENDPOINT must be a valid URL`,
      `CONFIG_TYPE:${key}_ENDPOINT`,
    );
  }

  const apiKeyRaw = env[`${key}_API_KEY`]?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKeyRaw) {
    throw new ConfigError(
      `${key}_API_KEY is required (or set OPENAI_API_KEY)`,
      `CONFIG_MISSING:${key}_API_KEY`,
    );
  }

  const timeoutRaw = env[`${key}_TIMEOUT_MS`]?.trim();
  const timeout_ms = timeoutRaw
    ? Number.parseInt(timeoutRaw, 10)
    : defaultTimeoutMs;
  if (Number.isNaN(timeout_ms) || timeout_ms <= 0) {
    throw new ConfigError(
      `${key}_TIMEOUT_MS must be a positive integer`,
      `CONFIG_TYPE:${key}_TIMEOUT_MS`,
    );
  }

  const retriesRaw = env[`${key}_MAX_RETRIES`]?.trim();
  const max_retries = retriesRaw
    ? Number.parseInt(retriesRaw, 10)
    : defaultRetries;
  if (Number.isNaN(max_retries) || max_retries < 0) {
    throw new ConfigError(
      `${key}_MAX_RETRIES must be a non-negative integer`,
      `CONFIG_TYPE:${key}_MAX_RETRIES`,
    );
  }

  const candidate = {
    model,
    endpoint: endpointRaw,
    apiKey: apiKeyRaw,
    timeout_ms,
    max_retries,
  };
  const result = ModelConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new ConfigError(
      `Invalid model config for ${key}: ${result.error.message}`,
      `CONFIG_TYPE:${key}`,
    );
  }
  return result.data;
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

  const pimsBaseUrl =
    env.PIMS_BASE_URL !== undefined && env.PIMS_BASE_URL !== ""
      ? env.PIMS_BASE_URL
      : CONSTANTS.DEFAULT_PIMS_BASE_URL;
  try {
    new URL(pimsBaseUrl);
  } catch {
    throw new ConfigError(
      "PIMS_BASE_URL must be a valid URL",
      "CONFIG_TYPE:PIMS_BASE_URL",
    );
  }

  const pimsSchema =
    env.PIMS_SCHEMA !== undefined && env.PIMS_SCHEMA !== ""
      ? env.PIMS_SCHEMA
      : CONSTANTS.DEFAULT_PIMS_SCHEMA;

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

  const rawJurisdiction =
    env.JURISDICTION_DEADLINES_JSON !== undefined &&
    env.JURISDICTION_DEADLINES_JSON !== ""
      ? env.JURISDICTION_DEADLINES_JSON
      : CONSTANTS.JURISDICTION_DEADLINES_JSON;
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawJurisdiction);
  } catch {
    throw new ConfigError(
      "JURISDICTION_DEADLINES_JSON must be valid JSON matching deadline schema",
      "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON",
    );
  }
  const valid = JurisdictionDeadlinesSchema.safeParse(rawParsed);
  if (!valid.success) {
    throw new ConfigError(
      `JURISDICTION_DEADLINES_JSON must match deadline schema: ${valid.error.message}`,
      "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON",
    );
  }
  const jurisdictionDeadlines = valid.data;

  const reasoningModel = parseModelConfig("REASONING_MODEL", env, 30000);
  const fastModel = parseModelConfig("FAST_MODEL", env, 15000);
  const visionModel =
    env.VISION_MODEL === undefined || env.VISION_MODEL === ""
      ? undefined
      : parseModelConfig("VISION_MODEL", env, 30000);
  const embeddingsModel = parseModelConfig("EMBEDDINGS_MODEL", env, 10000);
  const rerankerModel = parseModelConfig("RERANKER_MODEL", env, 15000);

  const evidenceKeyEnv =
    env.EVIDENCE_KEY_ENV !== undefined && env.EVIDENCE_KEY_ENV !== ""
      ? env.EVIDENCE_KEY_ENV
      : CONSTANTS.EVIDENCE_KEY_ENV;
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
      ? CONSTANTS.DEFAULT_MODEL_LOGPROBS
      : modelLogprobsRaw === "true";

  const phaseDueHours =
    env.PHASE_DUE_HOURS !== undefined && env.PHASE_DUE_HOURS !== ""
      ? Number.parseInt(env.PHASE_DUE_HOURS, 10)
      : CONSTANTS.DEFAULT_PHASE_DUE_HOURS;
  if (!Number.isInteger(phaseDueHours) || phaseDueHours <= 0) {
    throw new ConfigError(
      "PHASE_DUE_HOURS must be a positive integer",
      "CONFIG_TYPE:PHASE_DUE_HOURS",
    );
  }
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
      ? CONSTANTS.DEFAULT_AUTO_NOTIFY
      : autoNotifyRaw === "true";

  const watcherPollRaw = env.WATCHER_POLL_INTERVAL_MS;
  let watcherPollIntervalMs: number =
    CONSTANTS.DEFAULT_WATCHER_POLL_INTERVAL_MS;
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
      ? CONSTANTS.DEFAULT_CORPUS_DIR
      : ragCorpusDirRaw;

  const subjectNoticePolicy =
    env.SUBJECT_NOTICE_POLICY !== undefined && env.SUBJECT_NOTICE_POLICY !== ""
      ? env.SUBJECT_NOTICE_POLICY
      : "high_risk_only";
  if (subjectNoticePolicy !== "high_risk_only") {
    throw new ConfigError(
      `Invalid SUBJECT_NOTICE_POLICY: ${subjectNoticePolicy}`,
      "CONFIG_REJECTED:SUBJECT_NOTICE_POLICY",
    );
  }

  const attachmentMaxMb =
    env.ATTACHMENT_MAX_MB !== undefined && env.ATTACHMENT_MAX_MB !== ""
      ? Number.parseInt(env.ATTACHMENT_MAX_MB, 10)
      : CONSTANTS.MAX_ATTACHMENT_SIZE_MB;
  if (Number.isNaN(attachmentMaxMb)) {
    throw new ConfigError(
      "ATTACHMENT_MAX_MB must be an integer",
      "CONFIG_TYPE:ATTACHMENT_MAX_MB",
    );
  }
  if (attachmentMaxMb > CONSTANTS.MAX_ATTACHMENT_SIZE_MB) {
    throw new ConfigError(
      `ATTACHMENT_MAX_MB (${attachmentMaxMb}) exceeds PIMS maximum of ${CONSTANTS.MAX_ATTACHMENT_SIZE_MB} MB`,
      "CONFIG_REJECTED:ATTACHMENT_MAX_MB",
    );
  }

  const evidenceHash =
    env.EVIDENCE_HASH !== undefined && env.EVIDENCE_HASH !== ""
      ? env.EVIDENCE_HASH
      : CONSTANTS.EVIDENCE_HASH;
  if (evidenceHash !== "sha256") {
    throw new ConfigError(
      `Invalid EVIDENCE_HASH: ${evidenceHash}`,
      "CONFIG_REJECTED:EVIDENCE_HASH",
    );
  }

  const pimsTimeoutMs =
    env.PIMS_TIMEOUT_MS !== undefined && env.PIMS_TIMEOUT_MS !== ""
      ? Number.parseInt(env.PIMS_TIMEOUT_MS, 10)
      : CONSTANTS.DEFAULT_PIMS_TIMEOUT_MS;
  if (Number.isNaN(pimsTimeoutMs)) {
    throw new ConfigError(
      "PIMS_TIMEOUT_MS must be an integer",
      "CONFIG_TYPE:PIMS_TIMEOUT_MS",
    );
  }

  const pimsMaxRetries =
    env.PIMS_MAX_RETRIES !== undefined && env.PIMS_MAX_RETRIES !== ""
      ? Number.parseInt(env.PIMS_MAX_RETRIES, 10)
      : CONSTANTS.DEFAULT_PIMS_MAX_RETRIES;
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
    let parsedAssignees: unknown;
    try {
      parsedAssignees = JSON.parse(env.ASSIGNEES);
    } catch {
      throw new ConfigError(
        "ASSIGNEES must be a JSON array of strings",
        "CONFIG_TYPE:ASSIGNEES",
      );
    }
    if (
      !Array.isArray(parsedAssignees) ||
      parsedAssignees.some((item) => typeof item !== "string")
    ) {
      throw new ConfigError(
        "ASSIGNEES must be a JSON array of strings",
        "CONFIG_TYPE:ASSIGNEES",
      );
    }
    assignees = parsedAssignees;
  }

  const extraHeadersRaw = env.PIMS_EXTRA_HEADERS_JSON;
  if (extraHeadersRaw !== undefined && extraHeadersRaw.trim() !== "") {
    let parsedHeaders: unknown;
    try {
      parsedHeaders = JSON.parse(extraHeadersRaw);
    } catch {
      throw new ConfigError(
        "PIMS_EXTRA_HEADERS_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
      );
    }
    if (
      typeof parsedHeaders !== "object" ||
      parsedHeaders === null ||
      Array.isArray(parsedHeaders)
    ) {
      throw new ConfigError(
        "PIMS_EXTRA_HEADERS_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
      );
    }
    if (
      Object.values(parsedHeaders as Record<string, unknown>).some(
        (value) => typeof value !== "string",
      )
    ) {
      throw new ConfigError(
        "PIMS_EXTRA_HEADERS_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
      );
    }
  }

  const cookiesRaw = env.PIMS_COOKIES_JSON;
  if (cookiesRaw !== undefined && cookiesRaw.trim() !== "") {
    let parsedCookies: unknown;
    try {
      parsedCookies = JSON.parse(cookiesRaw);
    } catch {
      throw new ConfigError(
        "PIMS_COOKIES_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_COOKIES_JSON",
      );
    }
    if (
      typeof parsedCookies !== "object" ||
      parsedCookies === null ||
      Array.isArray(parsedCookies)
    ) {
      throw new ConfigError(
        "PIMS_COOKIES_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_COOKIES_JSON",
      );
    }
    if (
      Object.values(parsedCookies as Record<string, unknown>).some(
        (value) => typeof value !== "string",
      )
    ) {
      throw new ConfigError(
        "PIMS_COOKIES_JSON must be a valid JSON object string",
        "CONFIG_TYPE:PIMS_COOKIES_JSON",
      );
    }
  }

  const presidioUrl =
    env.PRESIDIO_URL !== undefined && env.PRESIDIO_URL !== ""
      ? env.PRESIDIO_URL
      : CONSTANTS.PRESIDIO_URL;
  try {
    new URL(presidioUrl);
  } catch {
    throw new ConfigError(
      "PRESIDIO_URL must be a valid URL",
      "CONFIG_TYPE:PRESIDIO_URL",
    );
  }

  const presidioImage =
    env.PRESIDIO_IMAGE !== undefined && env.PRESIDIO_IMAGE !== ""
      ? env.PRESIDIO_IMAGE
      : CONSTANTS.PRESIDIO_IMAGE;
  const presidioModel =
    env.PRESIDIO_MODEL !== undefined && env.PRESIDIO_MODEL !== ""
      ? env.PRESIDIO_MODEL
      : CONSTANTS.PRESIDIO_MODEL;

  const presidioTimeoutRaw = env.PRESIDIO_TIMEOUT_MS;
  let presidioTimeoutMs: number = CONSTANTS.PRESIDIO_TIMEOUT_MS;
  if (presidioTimeoutRaw !== undefined) {
    const parsed = Number(presidioTimeoutRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ConfigError(
        "PRESIDIO_TIMEOUT_MS must be a positive integer",
        "CONFIG_TYPE:PRESIDIO_TIMEOUT_MS",
      );
    }
    presidioTimeoutMs = parsed;
  }

  const presidioMinScoreRaw = env.PRESIDIO_MIN_SCORE;
  let presidioMinScore: number = CONSTANTS.PRESIDIO_MIN_SCORE;
  if (presidioMinScoreRaw !== undefined) {
    const parsed = Number.parseFloat(presidioMinScoreRaw);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      throw new ConfigError(
        "PRESIDIO_MIN_SCORE must be a float between 0 and 1",
        "CONFIG_TYPE:PRESIDIO_MIN_SCORE",
      );
    }
    presidioMinScore = parsed;
  }

  const formNarrativeMaxCharsRaw = env.FORM_NARRATIVE_MAX_CHARS;
  let formNarrativeMaxChars: number = CONSTANTS.FORM_NARRATIVE_MAX_CHARS;
  if (formNarrativeMaxCharsRaw !== undefined) {
    const parsed = Number.parseInt(formNarrativeMaxCharsRaw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new ConfigError(
        "FORM_NARRATIVE_MAX_CHARS must be a positive integer",
        "CONFIG_TYPE:FORM_NARRATIVE_MAX_CHARS",
      );
    }
    formNarrativeMaxChars = parsed;
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
      env.IDEMPOTENCY_KEY_PREFIX !== undefined &&
      env.IDEMPOTENCY_KEY_PREFIX !== ""
        ? env.IDEMPOTENCY_KEY_PREFIX
        : CONSTANTS.DEFAULT_IDEMPOTENCY_KEY_PREFIX,
    JURISDICTION_DEADLINES_JSON: jurisdictionDeadlines,
    SUBJECT_NOTICE_POLICY: "high_risk_only",
    HUMAN_VETO_WINDOW_MIN:
      env.HUMAN_VETO_WINDOW_MIN !== undefined &&
      env.HUMAN_VETO_WINDOW_MIN !== ""
        ? Number.parseInt(env.HUMAN_VETO_WINDOW_MIN, 10)
        : CONSTANTS.HUMAN_VETO_WINDOW_MIN,
    ASSIGNEES: assignees,
    REASONING_MODEL: reasoningModel,
    FAST_MODEL: fastModel,
    VISION_MODEL: visionModel,
    EMBEDDINGS_MODEL: embeddingsModel,
    RERANKER_MODEL: rerankerModel,
    TEMP_CLASSIFIER:
      env.TEMP_CLASSIFIER !== undefined && env.TEMP_CLASSIFIER !== ""
        ? Number.parseFloat(env.TEMP_CLASSIFIER)
        : CONSTANTS.TEMP_CLASSIFIER,
    TEMP_REASONING:
      env.TEMP_REASONING !== undefined && env.TEMP_REASONING !== ""
        ? Number.parseFloat(env.TEMP_REASONING)
        : CONSTANTS.TEMP_REASONING,
    PLAIN_LANG_MAX_WORDS:
      env.PLAIN_LANG_MAX_WORDS !== undefined && env.PLAIN_LANG_MAX_WORDS !== ""
        ? Number.parseInt(env.PLAIN_LANG_MAX_WORDS, 10)
        : CONSTANTS.PLAIN_LANGUAGE_MAX_WORDS,
    DEDUPE_TRIGRAM_THRESHOLD:
      env.DEDUPE_TRIGRAM_THRESHOLD !== undefined &&
      env.DEDUPE_TRIGRAM_THRESHOLD !== ""
        ? Number.parseFloat(env.DEDUPE_TRIGRAM_THRESHOLD)
        : CONSTANTS.DEDUPE_TRIGRAM_THRESHOLD,
    DEDUPE_COSINE_THRESHOLD:
      env.DEDUPE_COSINE_THRESHOLD !== undefined &&
      env.DEDUPE_COSINE_THRESHOLD !== ""
        ? Number.parseFloat(env.DEDUPE_COSINE_THRESHOLD)
        : CONSTANTS.DEDUPE_COSINE_THRESHOLD,
    SLA_PROCESSOR_H:
      env.SLA_PROCESSOR_H !== undefined && env.SLA_PROCESSOR_H !== ""
        ? Number.parseInt(env.SLA_PROCESSOR_H, 10)
        : CONSTANTS.SLA_PROCESSOR_H,
    SLA_SUBJECT_H:
      env.SLA_SUBJECT_H !== undefined && env.SLA_SUBJECT_H !== ""
        ? Number.parseInt(env.SLA_SUBJECT_H, 10)
        : CONSTANTS.SLA_SUBJECT_H,
    SLA_REVIEW_H:
      env.SLA_REVIEW_H !== undefined && env.SLA_REVIEW_H !== ""
        ? Number.parseInt(env.SLA_REVIEW_H, 10)
        : CONSTANTS.SLA_REVIEW_H,
    CORRECTIVE_DEFAULT_DUE_DAYS:
      env.CORRECTIVE_DEFAULT_DUE_DAYS !== undefined &&
      env.CORRECTIVE_DEFAULT_DUE_DAYS !== ""
        ? Number.parseInt(env.CORRECTIVE_DEFAULT_DUE_DAYS, 10)
        : CONSTANTS.CORRECTIVE_DEFAULT_DUE_DAYS,
    CIRCUIT_BREAKER_FAILS:
      env.CIRCUIT_BREAKER_FAILS !== undefined &&
      env.CIRCUIT_BREAKER_FAILS !== ""
        ? Number.parseInt(env.CIRCUIT_BREAKER_FAILS, 10)
        : CONSTANTS.CIRCUIT_BREAKER_FAILS,
    CIRCUIT_BREAKER_WINDOW_S:
      env.CIRCUIT_BREAKER_WINDOW_S !== undefined &&
      env.CIRCUIT_BREAKER_WINDOW_S !== ""
        ? Number.parseInt(env.CIRCUIT_BREAKER_WINDOW_S, 10)
        : CONSTANTS.CIRCUIT_BREAKER_WINDOW_S,
    CIRCUIT_BREAKER_OPEN_S:
      env.CIRCUIT_BREAKER_OPEN_S !== undefined &&
      env.CIRCUIT_BREAKER_OPEN_S !== ""
        ? Number.parseInt(env.CIRCUIT_BREAKER_OPEN_S, 10)
        : CONSTANTS.CIRCUIT_BREAKER_OPEN_S,
    RAG_CORPUS_PATHS:
      env.RAG_CORPUS_PATHS !== undefined && env.RAG_CORPUS_PATHS !== ""
        ? JSON.parse(env.RAG_CORPUS_PATHS)
        : {},
    RAG_CORPUS_DIR: ragCorpusDir,
    RAG_CHUNK_NORMATIVE: CONSTANTS.RAG_CHUNK_NORMATIVE,
    RAG_CHUNK_OTHER: CONSTANTS.RAG_CHUNK_OTHER,
    RAG_TOP_K:
      env.RAG_TOP_K !== undefined && env.RAG_TOP_K !== ""
        ? Number.parseInt(env.RAG_TOP_K, 10)
        : CONSTANTS.DEFAULT_RAG_TOP_K,
    RAG_RERANK_K:
      env.RAG_RERANK_K !== undefined && env.RAG_RERANK_K !== ""
        ? Number.parseInt(env.RAG_RERANK_K, 10)
        : CONSTANTS.DEFAULT_RAG_RERANK_K,
    RAG_MIN_SCORE:
      env.RAG_MIN_SCORE !== undefined && env.RAG_MIN_SCORE !== ""
        ? Number.parseFloat(env.RAG_MIN_SCORE)
        : CONSTANTS.DEFAULT_RAG_MIN_SCORE,
    RAG_TIMEOUT_MS:
      env.RAG_TIMEOUT_MS !== undefined && env.RAG_TIMEOUT_MS !== ""
        ? Number.parseInt(env.RAG_TIMEOUT_MS, 10)
        : CONSTANTS.DEFAULT_RAG_TIMEOUT_MS,
    SCHEDULER_TICK_S:
      env.SCHEDULER_TICK_S !== undefined && env.SCHEDULER_TICK_S !== ""
        ? Number.parseInt(env.SCHEDULER_TICK_S, 10)
        : CONSTANTS.SCHEDULER_TICK_S,
    SCHEDULER_JITTER_S:
      env.SCHEDULER_JITTER_S !== undefined && env.SCHEDULER_JITTER_S !== ""
        ? Number.parseInt(env.SCHEDULER_JITTER_S, 10)
        : CONSTANTS.SCHEDULER_JITTER_S,
    SCHEDULER_MAX_TIMERS:
      env.SCHEDULER_MAX_TIMERS !== undefined && env.SCHEDULER_MAX_TIMERS !== ""
        ? Number.parseInt(env.SCHEDULER_MAX_TIMERS, 10)
        : CONSTANTS.SCHEDULER_MAX_TIMERS,
    EVIDENCE_HASH: "sha256",
    EVIDENCE_KEY_ENV: evidenceKeyEnv,
    EVIDENCE_DB_URL: evidenceDbUrlRaw,
    AUTO_NOTIFY: autoNotify,
    MODEL_LOGPROBS: modelLogprobs,
    PHASE_DUE_HOURS: phaseDueHours,
    WATCHER_POLL_INTERVAL_MS: watcherPollIntervalMs,
    WEBHOOK_INGEST_SECRET_ENV:
      env.WEBHOOK_INGEST_SECRET_ENV !== undefined &&
      env.WEBHOOK_INGEST_SECRET_ENV !== ""
        ? env.WEBHOOK_INGEST_SECRET_ENV
        : CONSTANTS.WEBHOOK_INGEST_SECRET_ENV,
    ATTACHMENT_MAX_MB: attachmentMaxMb,
    RETENTION_NOTICE_YEARS:
      env.RETENTION_NOTICE_YEARS !== undefined &&
      env.RETENTION_NOTICE_YEARS !== ""
        ? Number.parseInt(env.RETENTION_NOTICE_YEARS, 10)
        : CONSTANTS.RETENTION_NOTICE_YEARS,
    INDICATOR_WEBHOOK_URL: env.INDICATOR_WEBHOOK_URL,
    INDICATOR_WEBHOOK_SECRET_ENV: env.INDICATOR_WEBHOOK_SECRET_ENV,
    INDICATOR_SPOOL_MAX:
      env.INDICATOR_SPOOL_MAX !== undefined && env.INDICATOR_SPOOL_MAX !== ""
        ? Number.parseInt(env.INDICATOR_SPOOL_MAX, 10)
        : CONSTANTS.INDICATOR_SPOOL_MAX,
    LOG_PII: false,
    LEASE_TTL_S:
      env.LEASE_TTL_S !== undefined && env.LEASE_TTL_S !== ""
        ? Number.parseInt(env.LEASE_TTL_S, 10)
        : CONSTANTS.LEASE_TTL_S,
    LEASE_RENEW_S:
      env.LEASE_RENEW_S !== undefined && env.LEASE_RENEW_S !== ""
        ? Number.parseInt(env.LEASE_RENEW_S, 10)
        : CONSTANTS.LEASE_RENEW_S,
    DEPLOY_PORT:
      env.DEPLOY_PORT !== undefined && env.DEPLOY_PORT !== ""
        ? Number.parseInt(env.DEPLOY_PORT, 10)
        : CONSTANTS.DEPLOY_PORT,
    DEPLOY_DATA_DIR:
      env.DEPLOY_DATA_DIR !== undefined && env.DEPLOY_DATA_DIR !== ""
        ? env.DEPLOY_DATA_DIR
        : CONSTANTS.DEPLOY_DATA_DIR,
    PRESIDIO_URL: presidioUrl,
    PRESIDIO_IMAGE: presidioImage,
    PRESIDIO_MODEL: presidioModel,
    PRESIDIO_TIMEOUT_MS: presidioTimeoutMs,
    PRESIDIO_MIN_SCORE: presidioMinScore,
    FORM_NARRATIVE_MAX_CHARS: formNarrativeMaxChars,
  };
}

export { CONSTANTS };
