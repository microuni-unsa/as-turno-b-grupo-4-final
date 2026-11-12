import {
  createContext,
  defineConfig,
  type MicrodevContext,
} from "@microx-technologies/microdev";
import rootConfig from "microdev-config";
import { z } from "zod";

const services = rootConfig.services;
if (services === undefined) {
  throw new Error("microdev.config.ts declares no services");
}
const defaultPortRange = rootConfig.defaultPortRange;
if (defaultPortRange === undefined) {
  throw new Error("microdev.config.ts declares no defaultPortRange");
}

const testConfig = defineConfig({
  schema: {
    EVIDENCE_DB_URL: z.string().min(1),
    PRESIDIO_URL: z.string().min(1).default("http://127.0.0.1:1"),
  },
  envs: ["test"] as const,
  presets: { test: { EVIDENCE_DB_URL: "test", PRESIDIO_URL: "test" } },
  services,
  defaultPortRange,
});

export type TestMicrodevContext = MicrodevContext<typeof testConfig>;

export function testServiceNames(includePresidio: boolean): string[] {
  if (includePresidio) {
    return ["evidence_db", "presidio"];
  }
  return ["evidence_db"];
}

export function createTestContext(includePresidio = true): TestMicrodevContext {
  return createContext(testConfig, {
    preset: "test",
    services: testServiceNames(includePresidio),
    staticsLoader: () => ({}),
  });
}
