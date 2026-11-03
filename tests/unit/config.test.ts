import { loadConfig, loadModelProviderOptions } from "@pims/config";
import { ConfigError } from "@pims/types";
import { describe, expect, it, vi } from "vitest";

describe("Configuration Manager", () => {
  const baseValidEnv: Record<string, string> = {
    PIMS_USERNAME: "grupob4",
    PIMS_PASSWORD: "plain-test-password",
    EVIDENCE_DB_URL: "postgres://pims:pims@localhost:5432/pims_evidence",
    REASONING_MODEL:
      "mistral,mistral-large-latest,https://api.mistral.ai,MISTRAL_API_KEY,30000,3,fallback:none",
    FAST_MODEL:
      "mistral,mistral-small-latest,https://api.mistral.ai,MISTRAL_API_KEY,10000,3,fallback:none",
    VISION_MODEL:
      "mistral,pixtral-12b-2409,https://api.mistral.ai,MISTRAL_API_KEY,20000,3,fallback:none",
    EMBEDDINGS_MODEL:
      "mistral,mistral-embed,https://api.mistral.ai,MISTRAL_API_KEY,5000,3,fallback:none",
    RERANKER_MODEL:
      "cohere,rerank-v3.5,https://api.cohere.com,COHERE_API_KEY,5000,3,fallback:none",
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
    expect(config.PIMS_USERNAME).toBe("grupob4");
    expect(config.PIMS_PASSWORD).toBe("plain-test-password");
    expect(config.PIMS_TOKEN_CMD).toBeUndefined();
    expect(config.EVIDENCE_DB_URL).toBe(
      "postgres://pims:pims@localhost:5432/pims_evidence",
    );
    expect(config.AUTO_NOTIFY).toBe(false);
    expect(config.MODEL_LOGPROBS).toBe(true);
    expect(config.WATCHER_POLL_INTERVAL_MS).toBe(5000);
    expect(config.RAG_CORPUS_DIR).toBe("corpus");
  });

  it("accepts token auth mode", () => {
    const env: Record<string, string> = {
      ...baseValidEnv,
      PIMS_TOKEN_CMD: "echo dev-token",
    };
    delete env.PIMS_USERNAME;
    delete env.PIMS_PASSWORD;
    const config = loadConfig(env);
    expect(config.PIMS_TOKEN_CMD).toEqual(["echo", "dev-token"]);
    expect(config.PIMS_USERNAME).toBeUndefined();
    expect(config.PIMS_PASSWORD).toBeUndefined();
  });

  it("rejects mixed token and password auth modes", () => {
    const env = { ...baseValidEnv, PIMS_TOKEN_CMD: "echo dev-token" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_REJECTED:PIMS_AUTH_MODE");
    }
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

  it("fails fast when model referenced auth env is missing", () => {
    const env = { ...baseValidEnv };
    delete env.MISTRAL_API_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:MISTRAL_API_KEY");
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

  it("rejects a malformed VISION_MODEL", () => {
    const env = { ...baseValidEnv, VISION_MODEL: "not-a-model-config" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_TYPE:VISION_MODEL");
    }
  });

  it("ignores ambient process.env for optional extras", () => {
    vi.stubEnv("PIMS_EXTRA_HEADERS_JSON", '{"FromEnv":"1"}');
    vi.stubEnv(
      "VISION_MODEL",
      "mistral,pixtral-12b-2409,https://api.mistral.ai,MISTRAL_API_KEY,20000,3,fallback:none",
    );
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
      expect(opts).toEqual({ apiKey: "sk-test-key" });

      expect(
        loadModelProviderOptions({
          OPENAI_API_KEY: "k",
          COHERE_API_KEY: "c",
          OPENAI_BASE_URL: "u",
        }),
      ).toEqual({ apiKey: "k", cohereApiKey: "c", baseURL: "u" });
      expect(
        loadModelProviderOptions({
          OPENAI_API_KEY: "k",
          COHERE_API_KEY: "",
          OPENAI_BASE_URL: "",
        }),
      ).toEqual({ apiKey: "k" });
      try {
        loadModelProviderOptions({});
        expect.unreachable();
      } catch (err) {
        expect((err as ConfigError).code).toBe("CONFIG_MISSING:OPENAI_API_KEY");
      }
    });
  });
});
