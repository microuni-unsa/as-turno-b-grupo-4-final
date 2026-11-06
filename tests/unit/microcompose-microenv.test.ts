import {
  createStack,
  DEFAULT_STACK_PORT_RANGE,
  matrix,
  schema,
  stack,
} from "@pims/config";
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
    expect(schema.flatKeys.length).toBe(51);
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
});
