import { loadConfig, loadModelProviderOptions } from "@pims/config";
import { ConfigError } from "@pims/types";
import {
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
  TEST_COHERE_BASE_URL,
  TEST_CORPUS_DIR,
  TEST_EVIDENCE_DB_URL,
  TEST_MISTRAL_BASE_URL,
  TEST_PRESIDIO_IMAGE,
  TEST_PRESIDIO_MODEL,
  TEST_PRESIDIO_URL,
} from "@tests/helpers/test-constants.ts";
import { describe, expect, it, vi } from "vitest";

describe("Configuration Manager", () => {
  const baseValidEnv: Record<string, string> = {
    PIMS_USERNAME: TEST_ADMIN_USERNAME,
    PIMS_PASSWORD: TEST_ADMIN_PASSWORD,
    EVIDENCE_DB_URL: TEST_EVIDENCE_DB_URL,
    REASONING_MODEL: "mistral-large-latest",
    REASONING_MODEL_ENDPOINT: TEST_MISTRAL_BASE_URL,
    REASONING_MODEL_API_KEY: "dummy-mistral-key",
    FAST_MODEL: "mistral-small-latest",
    FAST_MODEL_ENDPOINT: TEST_MISTRAL_BASE_URL,
    FAST_MODEL_API_KEY: "dummy-mistral-key",
    VISION_MODEL: "pixtral-12b-2409",
    VISION_MODEL_ENDPOINT: TEST_MISTRAL_BASE_URL,
    VISION_MODEL_API_KEY: "dummy-mistral-key",
    EMBEDDINGS_MODEL: "mistral-embed",
    EMBEDDINGS_MODEL_ENDPOINT: TEST_MISTRAL_BASE_URL,
    EMBEDDINGS_MODEL_API_KEY: "dummy-mistral-key",
    RERANKER_MODEL: "rerank-v3.5",
    RERANKER_MODEL_ENDPOINT: TEST_COHERE_BASE_URL,
    RERANKER_MODEL_API_KEY: "dummy-cohere-key",
    MISTRAL_API_KEY: "dummy-mistral-key",
    COHERE_API_KEY: "dummy-key",
    EVIDENCE_KEY: "aes-256-gcm-secret-key-32-bytes",
  };

  it("loads valid configuration and sets spec defaults", () => {
    const config = loadConfig(baseValidEnv);
    expect(config.PIMS_BASE_URL).toBe("https://unsa.27k.pe");
    expect(config.PIMS_SCHEMA).toBe("unsa");
    expect(config.PIMS_TIMEOUT_MS).toBe(15000);
    expect(config.PIMS_MAX_RETRIES).toBe(3);
    expect(config.PIMS_PAGE_SIZE).toEqual({ default: 50, max: 100 });
    expect(config.IDEMPOTENCY_KEY_PREFIX).toBe("agi1");
    expect(config.SUBJECT_NOTICE_POLICY).toBe("high_risk_only");
    expect(config.HUMAN_VETO_WINDOW_MIN).toBe(0);
    expect(config.LOG_PII).toBe(false);
    expect(config.ATTACHMENT_MAX_MB).toBe(10);
    expect(config.EVIDENCE_HASH).toBe("sha256");
    expect(config.JURISDICTION_DEADLINES_JSON).toBeDefined();
    expect(config.JURISDICTION_DEADLINES_JSON.EU_GDPR?.authority_h).toBe(72);
    expect(config.PIMS_USERNAME).toBe(TEST_ADMIN_USERNAME);
    expect(config.PIMS_PASSWORD).toBe(TEST_ADMIN_PASSWORD);
    expect(config.EVIDENCE_DB_URL).toBe(TEST_EVIDENCE_DB_URL);
    expect(config.AUTO_NOTIFY).toBe(false);
    expect(config.MODEL_LOGPROBS).toBe(true);
    expect(config.WATCHER_POLL_INTERVAL_MS).toBe(5000);
    expect(config.RAG_CORPUS_DIR).toBe(TEST_CORPUS_DIR);
    expect(config.PRESIDIO_URL).toBe(TEST_PRESIDIO_URL);
    expect(config.PRESIDIO_IMAGE).toBe(TEST_PRESIDIO_IMAGE);
    expect(config.PRESIDIO_MODEL).toBe(TEST_PRESIDIO_MODEL);
    expect(config.PRESIDIO_TIMEOUT_MS).toBe(1500);
    expect(config.PRESIDIO_MIN_SCORE).toBe(0.5);
    expect(config.FORM_NARRATIVE_MAX_CHARS).toBe(4000);
  });

  it("strictly validates PRESIDIO configs and FORM_NARRATIVE_MAX_CHARS", () => {
    try {
      loadConfig({ ...baseValidEnv, PRESIDIO_URL: "not-a-url" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:PRESIDIO_URL");
    }

    try {
      loadConfig({ ...baseValidEnv, PRESIDIO_TIMEOUT_MS: "0" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:PRESIDIO_TIMEOUT_MS");
    }

    try {
      loadConfig({ ...baseValidEnv, PRESIDIO_MIN_SCORE: "2.5" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:PRESIDIO_MIN_SCORE");
    }

    try {
      loadConfig({ ...baseValidEnv, FORM_NARRATIVE_MAX_CHARS: "-10" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_TYPE:FORM_NARRATIVE_MAX_CHARS",
      );
    }

    const validCustom = loadConfig({
      ...baseValidEnv,
      PRESIDIO_URL: "http://presidio:3000",
      PRESIDIO_TIMEOUT_MS: "3000",
      PRESIDIO_MIN_SCORE: "0.7",
      FORM_NARRATIVE_MAX_CHARS: "5000",
    });
    expect(validCustom.PRESIDIO_URL).toBe("http://presidio:3000");
    expect(validCustom.PRESIDIO_TIMEOUT_MS).toBe(3000);
    expect(validCustom.PRESIDIO_MIN_SCORE).toBe(0.7);
    expect(validCustom.FORM_NARRATIVE_MAX_CHARS).toBe(5000);
  });

  it("rejects missing PIMS authentication", () => {
    const env = { ...baseValidEnv };
    delete env.PIMS_USERNAME;
    delete env.PIMS_PASSWORD;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:PIMS_AUTH");
    }
  });

  it("rejects password auth without a password", () => {
    const env = { ...baseValidEnv };
    delete env.PIMS_PASSWORD;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:PIMS_AUTH");
    }
  });

  it("rejects an invalid MODEL_LOGPROBS value", () => {
    const env = { ...baseValidEnv, MODEL_LOGPROBS: "yes" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:MODEL_LOGPROBS");
    }
  });

  it("rejects an invalid AUTO_NOTIFY value", () => {
    const env = { ...baseValidEnv, AUTO_NOTIFY: "yes" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:AUTO_NOTIFY");
    }
  });

  it("accepts AUTO_NOTIFY=true", () => {
    expect(
      loadConfig({ ...baseValidEnv, AUTO_NOTIFY: "true" }).AUTO_NOTIFY,
    ).toBe(true);
  });

  it("rejects a non-positive WATCHER_POLL_INTERVAL_MS", () => {
    for (const value of ["0", "-1", "1.5", "soon"]) {
      const env = { ...baseValidEnv, WATCHER_POLL_INTERVAL_MS: value };
      expect(() => loadConfig(env)).toThrow(ConfigError);
      try {
        loadConfig(env);
      } catch (err) {
        expect((err as ConfigError).code).toBe(
          "CONFIG_TYPE:WATCHER_POLL_INTERVAL_MS",
        );
      }
    }
  });

  it("rejects a missing EVIDENCE_DB_URL", () => {
    const env = { ...baseValidEnv };
    delete env.EVIDENCE_DB_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:EVIDENCE_DB_URL");
    }
  });

  it("rejects a malformed EVIDENCE_DB_URL", () => {
    const env = { ...baseValidEnv, EVIDENCE_DB_URL: "not-a-url" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:EVIDENCE_DB_URL");
    }
  });

  it("fails fast when a required model config is missing", () => {
    const env = { ...baseValidEnv };
    delete env.REASONING_MODEL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:REASONING_MODEL");
    }
  });

  it("fails fast when EVIDENCE_KEY_ENV referenced variable is missing", () => {
    const env = { ...baseValidEnv };
    delete env.EVIDENCE_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:EVIDENCE_KEY");
    }
  });

  it("strictly rejects LOG_PII=true", () => {
    const env = { ...baseValidEnv, LOG_PII: "true" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_REJECTED:LOG_PII");
    }
  });

  it("strictly rejects ATTACHMENT_MAX_MB > 10", () => {
    const env = { ...baseValidEnv, ATTACHMENT_MAX_MB: "15" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_REJECTED:ATTACHMENT_MAX_MB",
      );
    }
  });

  it("strictly rejects invalid SUBJECT_NOTICE_POLICY", () => {
    const env = { ...baseValidEnv, SUBJECT_NOTICE_POLICY: "notify_all" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_REJECTED:SUBJECT_NOTICE_POLICY",
      );
    }
  });

  it("strictly rejects invalid EVIDENCE_HASH", () => {
    const env = { ...baseValidEnv, EVIDENCE_HASH: "md5" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_REJECTED:EVIDENCE_HASH");
    }
  });

  it("treats an omitted VISION_MODEL as undefined", () => {
    const env = { ...baseValidEnv };
    delete env.VISION_MODEL;
    expect(loadConfig(env).VISION_MODEL).toBeUndefined();
  });

  it("rejects legacy comma-separated model format", () => {
    const env = {
      ...baseValidEnv,
      REASONING_MODEL:
        "openai,gpt-4o,https://api.openai.com,OPENAI_API_KEY,30000,2,fallback:none",
    };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:REASONING_MODEL");
    }
  });

  it("rejects an invalid model endpoint URL", () => {
    const env = { ...baseValidEnv, VISION_MODEL_ENDPOINT: "not-a-valid-url" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_TYPE:VISION_MODEL_ENDPOINT",
      );
    }
  });

  it("fails fast when model API key is missing", () => {
    const env = { ...baseValidEnv };
    delete env.REASONING_MODEL_API_KEY;
    delete env.OPENAI_API_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_MISSING:REASONING_MODEL_API_KEY",
      );
    }
  });

  it("ignores ambient process.env for optional extras", () => {
    vi.stubEnv("PIMS_EXTRA_HEADERS_JSON", '{"FromEnv":"1"}');
    vi.stubEnv("VISION_MODEL", "pixtral-12b-2409");
    try {
      const env = { ...baseValidEnv };
      delete env.VISION_MODEL;
      const config = loadConfig(env);
      expect(config.PIMS_EXTRA_HEADERS_JSON).toBeUndefined();
      expect(config.VISION_MODEL).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("validates PIMS_BASE_URL type format", () => {
    const env = { ...baseValidEnv, PIMS_BASE_URL: "not-a-valid-url" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:PIMS_BASE_URL");
    }
  });

  it("strictly validates JURISDICTION_DEADLINES_JSON schema", () => {
    const env = {
      ...baseValidEnv,
      JURISDICTION_DEADLINES_JSON: "invalid-json",
    };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON",
      );
    }
  });

  describe("PIMS_EXTRA_HEADERS_JSON and PIMS_COOKIES_JSON", () => {
    it("successfully parses valid JSON object string for PIMS_EXTRA_HEADERS_JSON and PIMS_COOKIES_JSON", () => {
      const config = loadConfig({
        ...baseValidEnv,
        PIMS_EXTRA_HEADERS_JSON: '{"X-Custom-Header":"test-val"}',
        PIMS_COOKIES_JSON: '{"session":"sess_abc"}',
      });
      expect(config.PIMS_EXTRA_HEADERS_JSON).toBe(
        '{"X-Custom-Header":"test-val"}',
      );
      expect(config.PIMS_COOKIES_JSON).toBe('{"session":"sess_abc"}');
    });

    it("throws ConfigError with code CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON when PIMS_EXTRA_HEADERS_JSON is invalid JSON", () => {
      expect(() =>
        loadConfig({
          ...baseValidEnv,
          PIMS_EXTRA_HEADERS_JSON: "{invalid",
        }),
      ).toThrow(ConfigError);
      try {
        loadConfig({
          ...baseValidEnv,
          PIMS_EXTRA_HEADERS_JSON: "{invalid",
        });
      } catch (err) {
        expect((err as ConfigError).code).toBe(
          "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
        );
      }

      expect(() =>
        loadConfig({
          ...baseValidEnv,
          PIMS_EXTRA_HEADERS_JSON: "123",
        }),
      ).toThrow(ConfigError);
      try {
        loadConfig({
          ...baseValidEnv,
          PIMS_EXTRA_HEADERS_JSON: "123",
        });
      } catch (err) {
        expect((err as ConfigError).code).toBe(
          "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
        );
      }

      expect(() =>
        loadConfig({
          ...baseValidEnv,
          PIMS_EXTRA_HEADERS_JSON: '{"X-Num":1}',
        }),
      ).toThrow(ConfigError);
      try {
        loadConfig({
          ...baseValidEnv,
          PIMS_EXTRA_HEADERS_JSON: '{"X-Num":1}',
        });
      } catch (err) {
        expect((err as ConfigError).code).toBe(
          "CONFIG_TYPE:PIMS_EXTRA_HEADERS_JSON",
        );
      }
    });

    it("throws ConfigError with code CONFIG_TYPE:PIMS_COOKIES_JSON when PIMS_COOKIES_JSON is invalid JSON", () => {
      expect(() =>
        loadConfig({
          ...baseValidEnv,
          PIMS_COOKIES_JSON: "{invalid",
        }),
      ).toThrow(ConfigError);
      try {
        loadConfig({
          ...baseValidEnv,
          PIMS_COOKIES_JSON: "{invalid",
        });
      } catch (err) {
        expect((err as ConfigError).code).toBe("CONFIG_TYPE:PIMS_COOKIES_JSON");
      }

      expect(() =>
        loadConfig({
          ...baseValidEnv,
          PIMS_COOKIES_JSON: "123",
        }),
      ).toThrow(ConfigError);
      try {
        loadConfig({
          ...baseValidEnv,
          PIMS_COOKIES_JSON: "123",
        });
      } catch (err) {
        expect((err as ConfigError).code).toBe("CONFIG_TYPE:PIMS_COOKIES_JSON");
      }

      expect(() =>
        loadConfig({
          ...baseValidEnv,
          PIMS_COOKIES_JSON: '{"n":1}',
        }),
      ).toThrow(ConfigError);
      try {
        loadConfig({
          ...baseValidEnv,
          PIMS_COOKIES_JSON: '{"n":1}',
        });
      } catch (err) {
        expect((err as ConfigError).code).toBe("CONFIG_TYPE:PIMS_COOKIES_JSON");
      }
    });
  });

  describe("loadModelProviderOptions", () => {
    it("builds provider options from credentials", () => {
      const opts = loadModelProviderOptions({
        OPENAI_API_KEY: "sk-test-key",
      });
      expect(opts).toEqual({ defaultApiKey: "sk-test-key" });

      expect(
        loadModelProviderOptions({
          OPENAI_API_KEY: "k",
          OPENAI_BASE_URL: "u",
        }),
      ).toEqual({ defaultApiKey: "k", defaultBaseURL: "u" });
      expect(
        loadModelProviderOptions({
          OPENAI_API_KEY: "k",
          OPENAI_BASE_URL: "",
        }),
      ).toEqual({ defaultApiKey: "k" });
      try {
        loadModelProviderOptions({});
        expect.unreachable();
      } catch (err) {
        expect((err as ConfigError).code).toBe("CONFIG_MISSING:OPENAI_API_KEY");
      }
    });
  });
});
