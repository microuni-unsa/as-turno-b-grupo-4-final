import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@microx-technologies/microdev";
import { Wait } from "testcontainers";
import { z } from "zod";
import { CONSTANTS } from "./packages/types/src/constants.ts";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

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

export const schema = {
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
  PRESIDIO_URL: z.string().min(1).default(CONSTANTS.PRESIDIO_URL),
  PRESIDIO_IMAGE: z.string().default(CONSTANTS.PRESIDIO_IMAGE),
  PRESIDIO_MODEL: z.string().default(CONSTANTS.PRESIDIO_MODEL),
  PRESIDIO_TIMEOUT_MS: numberSchema(CONSTANTS.PRESIDIO_TIMEOUT_MS),
  PRESIDIO_MIN_SCORE: numberSchema(CONSTANTS.PRESIDIO_MIN_SCORE),
  FORM_NARRATIVE_MAX_CHARS: numberSchema(CONSTANTS.FORM_NARRATIVE_MAX_CHARS),
};

const devPreset = Object.fromEntries(
  Object.keys(schema).map((k) => [k, "dev"]),
) as Record<keyof typeof schema, "dev">;

const prodPreset = Object.fromEntries(
  Object.keys(schema).map((k) => [k, "prod"]),
) as Record<keyof typeof schema, "prod">;

export const config = defineConfig({
  schema,
  envs: ["dev", "prod"] as const,
  defaultPreset: "dev",
  defaultPortRange: [43000, 43999] as const,
  presets: {
    dev: devPreset,
    prod: prodPreset,
  },
  services: {
    evidence_db: {
      image: "pgvector/pgvector:pg16",
      ports: [{ container: 5432 }],
      env: {
        POSTGRES_USER: "pims",
        POSTGRES_PASSWORD: "pims",
        POSTGRES_DB: "pims_evidence",
      },
      waitFor: Wait.forAll([
        Wait.forHealthCheck().withStartupTimeout(120_000),
        Wait.forListeningPorts(),
      ]),
      customize: (c) =>
        c
          .withHealthCheck({
            test: [
              "CMD-SHELL",
              "PGPASSWORD=pims pg_isready --host localhost --username pims --dbname pims_evidence",
            ],
            interval: 250,
            timeout: 1000,
            retries: 1000,
          })
          .withBindMounts([
            {
              source: path.resolve(
                projectRoot,
                "data/gestitel_base_de_datos.sql",
              ),
              target: "/docker-entrypoint-initdb.d/01-gestitel.sql",
              mode: "ro",
            },
            {
              source: path.resolve(projectRoot, "data/02-init-unsa-seed.sql"),
              target: "/docker-entrypoint-initdb.d/02-seed.sql",
              mode: "ro",
            },
          ]),
      outputs: ({ self }) => ({
        EVIDENCE_DB_URL: `postgres://pims:pims@${self.host}:${self.port(5432)}/pims_evidence`,
      }),
    },
    presidio: {
      image: CONSTANTS.PRESIDIO_IMAGE,
      ports: [{ container: 3000 }],
      env: {
        PORT: "3000",
      },
      waitFor: Wait.forHealthCheck().withStartupTimeout(120_000),
      customize: (c) =>
        c.withHealthCheck({
          test: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
          interval: 500,
          timeout: 2000,
          retries: 60,
        }),
      outputs: ({ self }) => ({
        PRESIDIO_URL: `http://${self.host}:${self.port(3000)}`,
      }),
    },
    traefik: {
      image: "traefik:v3.3",
      ports: [{ container: 80 }, { container: 8080 }],
      waitFor: Wait.forHealthCheck().withStartupTimeout(120_000),
      customize: (c) =>
        c
          .withExtraHosts([
            { host: "host.docker.internal", ipAddress: "host-gateway" },
          ])
          .withCommand([
            "--global.checknewversion=false",
            "--global.sendanonymoususage=false",
            "--entrypoints.web.address=:80",
            "--entrypoints.traefik.address=:8080",
            "--api.dashboard=true",
            "--api.insecure=true",
            "--ping=true",
            "--ping.entrypoint=traefik",
            "--providers.file.filename=/etc/traefik/dynamic.yml",
            "--providers.file.watch=true",
          ])
          .withHealthCheck({
            test: ["CMD-SHELL", "traefik healthcheck --ping || exit 1"],
            interval: 500,
            timeout: 1000,
            retries: 30,
          })
          .withBindMounts([
            {
              source: path.resolve(projectRoot, "dev-config/traefik.dev.yml"),
              target: "/etc/traefik/dynamic.yml",
              mode: "ro",
            },
          ]),
    },
  },
});

export default config;
