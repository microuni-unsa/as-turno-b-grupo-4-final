import childProcess from "node:child_process";
import fs from "node:fs";
import { decryptSopsFile, loadConfig } from "@pims/config";
import { ConfigError } from "@pims/types";
import { describe, expect, it, vi } from "vitest";

describe("Configuration Manager", () => {
  const baseValidEnv: Record<string, string> = {
    PIMS_TOKEN_CMD: "bun -e console.log('token')",
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
    MISTRAL_API_KEY: "V392gd36SfruU1rb7Lk5Z13TIWgnunwh",
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
    expect(config.VOICE_PRIMARY_LANG).toBe("es-PE");
    expect(config.LOG_PII).toBe(false);
    expect(config.ATTACHMENT_MAX_MB).toBe(10);
    expect(config.EVIDENCE_HASH).toBe("sha256");
    expect(config.JURISDICTION_DEADLINES_JSON).toBeDefined();
    expect(config.JURISDICTION_DEADLINES_JSON.EU_GDPR?.authority_h).toBe(72);
  });

  it("fails fast when PIMS_TOKEN_CMD is missing", () => {
    const env = { ...baseValidEnv };
    delete env.PIMS_TOKEN_CMD;
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:PIMS_TOKEN_CMD");
    }
  });

  it("fails fast when a required model config is missing", () => {
    const env = { ...baseValidEnv };
    delete env.REASONING_MODEL;
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:REASONING_MODEL");
    }
  });

  it("fails fast when model referenced auth env is missing", () => {
    const env = { ...baseValidEnv };
    delete env.MISTRAL_API_KEY;
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:MISTRAL_API_KEY");
    }
  });

  it("fails fast when EVIDENCE_KEY_ENV referenced variable is missing", () => {
    const env = { ...baseValidEnv };
    delete env.EVIDENCE_KEY;
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_MISSING:EVIDENCE_KEY");
    }
  });

  it("strictly rejects LOG_PII=true", () => {
    const env = { ...baseValidEnv, LOG_PII: "true" };
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_REJECTED:LOG_PII");
    }
  });

  it("strictly rejects ATTACHMENT_MAX_MB > 10", () => {
    const env = { ...baseValidEnv, ATTACHMENT_MAX_MB: "15" };
    expect(() => loadConfig(env)).toThrowError(ConfigError);
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
    expect(() => loadConfig(env)).toThrowError(ConfigError);
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
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe("CONFIG_REJECTED:EVIDENCE_HASH");
    }
  });

  it("validates PIMS_BASE_URL type format", () => {
    const env = { ...baseValidEnv, PIMS_BASE_URL: "not-a-valid-url" };
    expect(() => loadConfig(env)).toThrowError(ConfigError);
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
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as ConfigError).code).toBe(
        "CONFIG_TYPE:JURISDICTION_DEADLINES_JSON",
      );
    }
  });

  describe("SOPS Decryption", () => {
    it("fails fast when SOPS file does not exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(() => decryptSopsFile("secrets/missing.enc.json")).toThrowError(
        ConfigError,
      );
      try {
        decryptSopsFile("secrets/missing.enc.json");
      } catch (err) {
        expect((err as ConfigError).code).toBe("CONFIG_SOPS_NOT_FOUND");
      }
      vi.restoreAllMocks();
    });

    it("decrypts SOPS file with mocked execSync", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(childProcess, "execSync").mockReturnValue(
        JSON.stringify({ SECRET_TOKEN: "decrypted_secret_val" }),
      );

      const secrets = decryptSopsFile("secrets/dev.enc.json");
      expect(secrets.SECRET_TOKEN).toBe("decrypted_secret_val");
      vi.restoreAllMocks();
    });

    it("decrypts credentials.enc.json with valid SOPS age keys", () => {
      if (fs.existsSync("credentials.enc.json")) {
        const creds = decryptSopsFile("credentials.enc.json");
        expect(creds.OPENAI_API_KEY).toBeDefined();
        expect(creds.EVIDENCE_KEY).toBeDefined();
      }
    });
  });
});
