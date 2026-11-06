import fs from "node:fs";
import path from "node:path";
import { initAppEnv, matrix } from "@pims/config/env-matrix.ts";
import { schema } from "@pims/config/env-schema.ts";
import {
  createStack,
  DEFAULT_STACK_PORT_RANGE,
  stack,
} from "@pims/config/stack-def.ts";
import { TEST_OPENAI_API_KEY } from "@tests/helpers/test-constants.ts";
import { describe, expect, it } from "vitest";

describe("Microenv & Microcompose Adoption Suite", () => {
  it("schema defines expected variable keys with exact names", () => {
    expect(schema.flatKeys).toContain("PIMS_BASE_URL");
    expect(schema.flatKeys).toContain(TEST_OPENAI_API_KEY);
    expect(schema.flatKeys).toContain("EVIDENCE_DB_URL");
    expect(schema.flatKeys).toContain("AUTO_NOTIFY");
    expect(schema.flatKeys).toContain("REASONING_MODEL_ENDPOINT");
    expect(schema.flatKeys).toContain("EMBEDDINGS_MODEL_API_KEY");
    expect(schema.flatKeys.length).toBe(50);
  });

  it("matrix defines dev and prod environments and presets", () => {
    expect(matrix.definition.envs).toEqual(["dev", "prod"]);
    expect(matrix.definition.presets?.dev).toBeDefined();
    expect(matrix.definition.presets?.prod).toBeDefined();
  });

  it("createStack constructs a valid microcompose handle with ports and templates", () => {
    const custom = createStack({
      defaultRange: [46000, 46100],
      includePresidio: false,
    });
    expect(custom).toBeDefined();
    expect(typeof custom.up).toBe("function");
    expect(typeof custom.down).toBe("function");
    expect(custom.env).toBeUndefined();
  });

  it("default stack uses declared default port range", () => {
    expect(DEFAULT_STACK_PORT_RANGE).toEqual([43000, 43999]);
    expect(stack).toBeDefined();
    expect(typeof stack.up).toBe("function");
  });

  it("ensures no legacy .enc.env or .env file exists on disk", () => {
    const rootDir = process.cwd();
    expect(fs.existsSync(path.resolve(rootDir, ".enc.env"))).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, ".env"))).toBe(false);
  });

  it("resolves encrypted dev and prod configurations through microenv without .env", async () => {
    const devResolved = await matrix.resolve("dev");
    expect(Object.keys(devResolved.values).length).toBe(50);
    expect(devResolved.values.PIMS_BASE_URL).toBeDefined();
    expect(devResolved.values.OPENAI_API_KEY).toBeDefined();
    expect(devResolved.values.LOG_PII).toBe("false");

    const prodResolved = await matrix.resolve("prod");
    expect(Object.keys(prodResolved.values).length).toBe(50);
    expect(prodResolved.values.PIMS_BASE_URL).toBeDefined();
    expect(prodResolved.values.OPENAI_API_KEY).toBeDefined();
    expect(prodResolved.values.LOG_PII).toBe("false");
  });

  it("hydrates and restores environment via initAppEnv and matrix.down", async () => {
    const preKey = process.env.OPENAI_API_KEY;
    await initAppEnv("dev");
    expect(process.env.OPENAI_API_KEY).toBeDefined();
    expect(matrix.env).toBeDefined();
    await matrix.down();
    expect(process.env.OPENAI_API_KEY).toBe(preKey);
  });
});
