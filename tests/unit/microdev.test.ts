import fs from "node:fs";
import path from "node:path";
import {
  createContext,
  getValidSchemaKeys,
  type OutputsContext,
} from "@microx-technologies/microdev";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  createTestContext,
  testServiceNames,
} from "@tests/helpers/microdev-test-context.ts";
import {
  TEST_OPENAI_API_KEY,
  TEST_PGVECTOR_IMAGE,
} from "@tests/helpers/test-constants.ts";
import config from "microdev-config";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("Microdev Adoption Suite", () => {
  it("validates schema identity and expected variable keys", () => {
    const keys = getValidSchemaKeys(config.schema);
    expect(keys).toHaveLength(50);
    expect(keys).toContain("PIMS_BASE_URL");
    expect(keys).toContain(TEST_OPENAI_API_KEY);
    expect(keys).toContain("EVIDENCE_DB_URL");
    expect(keys).toContain("AUTO_NOTIFY");
    expect(keys).toContain("REASONING_MODEL_ENDPOINT");
    expect(keys).toContain("EMBEDDINGS_MODEL_API_KEY");
  });

  it("validates presets dev and prod cover all schema keys", () => {
    expect(config.presets).toBeDefined();
    expect(config.presets.dev).toBeDefined();
    expect(config.presets.prod).toBeDefined();

    const schemaKeys = Object.keys(config.schema);
    const devKeys = Object.keys(config.presets.dev);
    const prodKeys = Object.keys(config.presets.prod);

    expect(devKeys.length).toBe(schemaKeys.length);
    for (const key of schemaKeys) {
      expect(config.presets.dev).toHaveProperty(key);
    }

    expect(prodKeys.length).toBe(schemaKeys.length);
    for (const key of schemaKeys) {
      expect(config.presets.prod).toHaveProperty(key);
    }
  });

  it("declares services with expected images, ports, outputs and defaultPortRange", async () => {
    expect(config.services).toBeDefined();
    const services = config.services;
    if (services === undefined) {
      throw new Error("microdev config declares no services");
    }

    expect(services.evidence_db).toBeDefined();
    expect(services.presidio).toBeDefined();
    expect(services.traefik).toBeDefined();

    expect(services.evidence_db.image).toBe(TEST_PGVECTOR_IMAGE);
    expect(services.presidio.image).toBe(CONSTANTS.PRESIDIO_IMAGE);
    expect(services.traefik.image).toBe("traefik:v3.3");

    expect(services.evidence_db.ports).toBeDefined();
    const hasEvidencePort5432 = services.evidence_db.ports?.some(
      (p) => p.container === 5432,
    );
    expect(hasEvidencePort5432).toBe(true);

    expect((services.traefik as { outputs?: unknown }).outputs).toBeUndefined();

    const evidenceOutputsFn = services.evidence_db.outputs;
    expect(typeof evidenceOutputsFn).toBe("function");
    if (typeof evidenceOutputsFn !== "function") {
      throw new Error("evidence_db outputs is not a function");
    }

    const presidioOutputsFn = services.presidio.outputs;
    expect(typeof presidioOutputsFn).toBe("function");
    if (typeof presidioOutputsFn !== "function") {
      throw new Error("presidio outputs is not a function");
    }

    const stubCtx = {
      self: {
        host: "h",
        port: () => 1,
        container: {} as unknown as OutputsContext["self"]["container"],
      },
      services: {},
      staticEnv: {},
    } as unknown as OutputsContext;

    const evidenceOutputs = await evidenceOutputsFn(stubCtx);
    expect(evidenceOutputs.EVIDENCE_DB_URL).toBe(
      "postgres://pims:pims@h:1/pims_evidence",
    );

    const presidioOutputs = await presidioOutputsFn(stubCtx);
    expect(presidioOutputs.PRESIDIO_URL).toBe("http://h:1");

    expect(config.defaultPortRange).toEqual([43000, 43999]);
  });

  it("ensures no legacy .enc.env, .env, or docker-compose files exist in root", () => {
    const rootDir = process.cwd();
    expect(fs.existsSync(path.resolve(rootDir, ".enc.env"))).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, ".env"))).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, "docker-compose.yml"))).toBe(
      false,
    );
    expect(fs.existsSync(path.resolve(rootDir, "docker-compose.dev.yml"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.resolve(rootDir, "docker-compose.prod.yml")),
    ).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, "traefik.dev.yml"))).toBe(false);
    expect(
      fs.existsSync(path.resolve(rootDir, "dev-config/traefik.dev.yml")),
    ).toBe(true);
  });

  it("resolves encrypted dev and prod configurations through static-only up() without Docker", async () => {
    for (const preset of ["dev", "prod"] as const) {
      const ctx = createContext(config, {
        preset,
        services: [],
        configDir: process.cwd(),
      });
      const env = await ctx.up();
      expect(Object.keys(env).length).toBe(50);
      expect(env.PIMS_BASE_URL).toBeDefined();
      expect(env.OPENAI_API_KEY).toBeDefined();
      expect(env.LOG_PII).toBe("false");
      await ctx.down();
    }
  });

  it("provides test context helper with expected service filtering and hermetic construction", () => {
    expect(testServiceNames(true)).toEqual(["evidence_db", "presidio"]);
    expect(testServiceNames(false)).toEqual(["evidence_db"]);

    expect(() => createTestContext()).not.toThrow();
    expect(() => createTestContext(false)).not.toThrow();
  });

  it("verifies zod identity for all schema leaves", () => {
    for (const [key, leaf] of Object.entries(config.schema)) {
      expect(
        leaf instanceof z.ZodType,
        `schema key ${key} should be instanceof z.ZodType`,
      ).toBe(true);
    }
  });
});
