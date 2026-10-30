import { execSync } from "node:child_process";
import fs from "node:fs";
import { ConfigError } from "@pims/types/errors.ts";

export interface ModelConfig {
  provider: string;
  model: string;
  endpoint?: string;
  auth_env: string;
  timeout_ms: number;
  max_retries: number;
  fallback: "none";
}

export interface AgentConfig {
  PIMS_BASE_URL: string;
  PIMS_SCHEMA: string;
  PIMS_TOKEN_CMD: string[];
  PIMS_TIMEOUT_MS: number;
  PIMS_MAX_RETRIES: number;
  PIMS_PAGE_SIZE: { default: number; max: number };
  IDEMPOTENCY_KEY_PREFIX: string;
  JURISDICTION_DEADLINES_JSON: Record<string, unknown>;
  SUBJECT_NOTICE_POLICY: "high_risk_only";
  HUMAN_VETO_WINDOW_MIN: number;
  ASSIGNEES: string[];
  VOICE_PRIMARY_LANG: string;
  VOICE_FALLBACK_LANG: string;
  STT_PROVIDER?: string;
  STT_MODEL?: string;
  STT_AUTH_ENV?: string;
  TTS_PROVIDER?: string;
  TTS_MODEL?: string;
  TTS_VOICE?: string;
  TTS_AUTH_ENV?: string;
  VOICE_RETENTION_DAYS: number;
  VOICE_MAX_AUDIO_MB: number;
  VOICE_MIN_CONFIDENCE: number;
  VOICE_LANG_CONFIDENCE: number;
  VOICE_SPOOF_THRESHOLD: number;
  REASONING_MODEL: ModelConfig;
  FAST_MODEL: ModelConfig;
  VISION_MODEL: ModelConfig;
  EMBEDDINGS_MODEL: ModelConfig;
  RERANKER_MODEL: ModelConfig;
  TEMP_CLASSIFIER: number;
  TEMP_REASONING: number;
  TOT_BRANCH_FACTOR: number;
  MAX_REVIEW_CYCLES: number;
  NLI_ENTAILMENT_MIN: number;
  PLAIN_LANG_MAX_WORDS: number;
  MAX_SEMANTIC_ENTROPY: number;
  DEDUPE_TRIGRAM_THRESHOLD: number;
  DEDUPE_COSINE_THRESHOLD: number;
  SLA_PROCESSOR_H: number;
  SLA_SUBJECT_H: number;
  SLA_REVIEW_H: number;
  SLA_HAZARD_WARN_THRESHOLD: number;
  CORRECTIVE_DEFAULT_DUE_DAYS: number;
  CIRCUIT_BREAKER_FAILS: number;
  CIRCUIT_BREAKER_WINDOW_S: number;
  CIRCUIT_BREAKER_OPEN_S: number;
  RAG_CORPUS_PATHS: Record<string, string>;
  RAG_CHUNK_NORMATIVE: { size: number; overlap: number };
  RAG_CHUNK_OTHER: { size: number; overlap: number };
  RAG_TOP_K: number;
  RAG_RERANK_K: number;
  RAG_MIN_SCORE: number;
  RAG_TIMEOUT_MS: number;
  SCHEDULER_TICK_S: number;
  SCHEDULER_JITTER_S: number;
  SCHEDULER_MAX_TIMERS: number;
  EVIDENCE_HASH: "sha256";
  EVIDENCE_KEY_ENV: string;
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

export function decryptSopsFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(
      `SOPS file does not exist: ${filePath}`,
      "CONFIG_SOPS_NOT_FOUND",
    );
  }

  try {
    const output = execSync(`sops -d "${filePath}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to decrypt SOPS file ${filePath}: ${msg}`,
      "CONFIG_SOPS_DECRYPT_FAILED",
    );
  }
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
    if (!auth_env || !env[auth_env]) {
      throw new ConfigError(
        `Referenced auth env ${auth_env} for ${key} is missing or empty`,
        `CONFIG_MISSING:${auth_env}`,
      );
    }
    return {
      provider: provider ?? "",
      model: model ?? "",
      endpoint: endpoint || undefined,
      auth_env: auth_env,
      timeout_ms,
      max_retries,
      fallback: "none",
    };
  }

  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (
      typeof obj.provider !== "string" ||
      typeof obj.model !== "string" ||
      typeof obj.auth_env !== "string" ||
      typeof obj.timeout_ms !== "number" ||
      typeof obj.max_retries !== "number" ||
      obj.fallback !== "none"
    ) {
      throw new ConfigError(
        `Invalid object shape for ${key}`,
        `CONFIG_TYPE:${key}`,
      );
    }
    if (!obj.auth_env || !env[obj.auth_env]) {
      throw new ConfigError(
        `Referenced auth env ${obj.auth_env} for ${key} is missing or empty`,
        `CONFIG_MISSING:${obj.auth_env}`,
      );
    }
    return {
      provider: obj.provider,
      model: obj.model,
      endpoint: typeof obj.endpoint === "string" ? obj.endpoint : undefined,
      auth_env: obj.auth_env,
      timeout_ms: obj.timeout_ms,
      max_retries: obj.max_retries,
      fallback: "none",
    };
  }

  throw new ConfigError(`Invalid type for ${key}`, `CONFIG_TYPE:${key}`);
}

export function loadConfig(
  customEnv?: Record<string, string | undefined>,
): AgentConfig {
  const env = customEnv ?? process.env;

  // Strict constant enforcement for LOG_PII
  if (
    env.LOG_PII !== undefined &&
    (env.LOG_PII === "true" || (env.LOG_PII as unknown) === true)
  ) {
    throw new ConfigError(
      "LOG_PII must be strictly false and can never be enabled",
      "CONFIG_REJECTED:LOG_PII",
    );
  }

  // Required keys
  const pimsBaseUrl = env.PIMS_BASE_URL ?? "https://unsa.27k.pe";
  try {
    new URL(pimsBaseUrl);
  } catch {
    throw new ConfigError(
      "PIMS_BASE_URL must be a valid URL",
      "CONFIG_TYPE:PIMS_BASE_URL",
    );
  }

  const pimsSchema = env.PIMS_SCHEMA ?? "unsa";

  if (!env.PIMS_TOKEN_CMD) {
    throw new ConfigError(
      "PIMS_TOKEN_CMD is required",
      "CONFIG_MISSING:PIMS_TOKEN_CMD",
    );
  }
  const tokenCmdParts = env.PIMS_TOKEN_CMD.trim().split(/\s+/);

  let jurisdictionDeadlines: Record<string, unknown>;
  const rawJurisdiction =
    env.JURISDICTION_DEADLINES_JSON ??
    '{"EU_GDPR":{"authority_h":72,"processor_to_controller":"without_undue_delay"},"PE_PDP":{"authority_h":"48_unverified"}}';
  try {
    jurisdictionDeadlines = JSON.parse(rawJurisdiction);
  } catch {
    throw new ConfigError(
      "JURISDICTION_DEADLINES_JSON must be valid JSON",
      "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON",
    );
  }

  // Models
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
  if (!env.VISION_MODEL) {
    throw new ConfigError(
      "VISION_MODEL is required",
      "CONFIG_MISSING:VISION_MODEL",
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
  const visionModel = parseModelConfig(env.VISION_MODEL, "VISION_MODEL", env);
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

  // Subject Notice Policy
  const subjectNoticePolicy = env.SUBJECT_NOTICE_POLICY ?? "high_risk_only";
  if (subjectNoticePolicy !== "high_risk_only") {
    throw new ConfigError(
      `Invalid SUBJECT_NOTICE_POLICY: ${subjectNoticePolicy}`,
      "CONFIG_REJECTED:SUBJECT_NOTICE_POLICY",
    );
  }

  // Attachment max mb
  const attachmentMaxMb = env.ATTACHMENT_MAX_MB
    ? Number.parseInt(env.ATTACHMENT_MAX_MB, 10)
    : 10;
  if (Number.isNaN(attachmentMaxMb)) {
    throw new ConfigError(
      "ATTACHMENT_MAX_MB must be an integer",
      "CONFIG_TYPE:ATTACHMENT_MAX_MB",
    );
  }
  if (attachmentMaxMb > 10) {
    throw new ConfigError(
      `ATTACHMENT_MAX_MB (${attachmentMaxMb}) exceeds PIMS maximum of 10 MB`,
      "CONFIG_REJECTED:ATTACHMENT_MAX_MB",
    );
  }

  // Evidence hash
  const evidenceHash = env.EVIDENCE_HASH ?? "sha256";
  if (evidenceHash !== "sha256") {
    throw new ConfigError(
      `Invalid EVIDENCE_HASH: ${evidenceHash}`,
      "CONFIG_REJECTED:EVIDENCE_HASH",
    );
  }

  const pimsTimeoutMs = env.PIMS_TIMEOUT_MS
    ? Number.parseInt(env.PIMS_TIMEOUT_MS, 10)
    : 15000;
  if (Number.isNaN(pimsTimeoutMs)) {
    throw new ConfigError(
      "PIMS_TIMEOUT_MS must be an integer",
      "CONFIG_TYPE:PIMS_TIMEOUT_MS",
    );
  }

  const pimsMaxRetries = env.PIMS_MAX_RETRIES
    ? Number.parseInt(env.PIMS_MAX_RETRIES, 10)
    : 3;
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

  return {
    PIMS_BASE_URL: pimsBaseUrl,
    PIMS_SCHEMA: pimsSchema,
    PIMS_TOKEN_CMD: tokenCmdParts,
    PIMS_TIMEOUT_MS: pimsTimeoutMs,
    PIMS_MAX_RETRIES: pimsMaxRetries,
    PIMS_PAGE_SIZE: pimsPageSize,
    IDEMPOTENCY_KEY_PREFIX: env.IDEMPOTENCY_KEY_PREFIX ?? "agi1",
    JURISDICTION_DEADLINES_JSON: jurisdictionDeadlines,
    SUBJECT_NOTICE_POLICY: "high_risk_only",
    HUMAN_VETO_WINDOW_MIN: env.HUMAN_VETO_WINDOW_MIN
      ? Number.parseInt(env.HUMAN_VETO_WINDOW_MIN, 10)
      : 0,
    ASSIGNEES: assignees,
    VOICE_PRIMARY_LANG: env.VOICE_PRIMARY_LANG ?? "es-PE",
    VOICE_FALLBACK_LANG: env.VOICE_FALLBACK_LANG ?? "en",
    STT_PROVIDER: env.STT_PROVIDER,
    STT_MODEL: env.STT_MODEL,
    STT_AUTH_ENV: env.STT_AUTH_ENV ?? "STT_API_KEY",
    TTS_PROVIDER: env.TTS_PROVIDER,
    TTS_MODEL: env.TTS_MODEL,
    TTS_VOICE: env.TTS_VOICE,
    TTS_AUTH_ENV: env.TTS_AUTH_ENV ?? "TTS_API_KEY",
    VOICE_RETENTION_DAYS: env.VOICE_RETENTION_DAYS
      ? Number.parseInt(env.VOICE_RETENTION_DAYS, 10)
      : 30,
    VOICE_MAX_AUDIO_MB: env.VOICE_MAX_AUDIO_MB
      ? Number.parseInt(env.VOICE_MAX_AUDIO_MB, 10)
      : 25,
    VOICE_MIN_CONFIDENCE: env.VOICE_MIN_CONFIDENCE
      ? Number.parseFloat(env.VOICE_MIN_CONFIDENCE)
      : 0.5,
    VOICE_LANG_CONFIDENCE: env.VOICE_LANG_CONFIDENCE
      ? Number.parseFloat(env.VOICE_LANG_CONFIDENCE)
      : 0.7,
    VOICE_SPOOF_THRESHOLD: env.VOICE_SPOOF_THRESHOLD
      ? Number.parseFloat(env.VOICE_SPOOF_THRESHOLD)
      : 0.8,
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
    TOT_BRANCH_FACTOR: env.TOT_BRANCH_FACTOR
      ? Number.parseInt(env.TOT_BRANCH_FACTOR, 10)
      : 3,
    MAX_REVIEW_CYCLES: env.MAX_REVIEW_CYCLES
      ? Number.parseInt(env.MAX_REVIEW_CYCLES, 10)
      : 3,
    NLI_ENTAILMENT_MIN: env.NLI_ENTAILMENT_MIN
      ? Number.parseFloat(env.NLI_ENTAILMENT_MIN)
      : 0.85,
    PLAIN_LANG_MAX_WORDS: env.PLAIN_LANG_MAX_WORDS
      ? Number.parseInt(env.PLAIN_LANG_MAX_WORDS, 10)
      : 25,
    MAX_SEMANTIC_ENTROPY: env.MAX_SEMANTIC_ENTROPY
      ? Number.parseFloat(env.MAX_SEMANTIC_ENTROPY)
      : 0.65,
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
    SLA_HAZARD_WARN_THRESHOLD: env.SLA_HAZARD_WARN_THRESHOLD
      ? Number.parseFloat(env.SLA_HAZARD_WARN_THRESHOLD)
      : 0.75,
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
