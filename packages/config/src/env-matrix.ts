import {
  defineMatrix,
  type InferEnv,
  type InferFlatEnv,
} from "@microx-technologies/microenv";
import { schema } from "@pims/config/env-schema.ts";

export const matrix = defineMatrix({
  schema,
  envs: ["dev", "prod"] as const,
  presets: {
    dev: Object.fromEntries(schema.flatKeys.map((k) => [k, "dev"])),
    prod: Object.fromEntries(schema.flatKeys.map((k) => [k, "prod"])),
  },
});

export type AppEnv = InferEnv<typeof matrix>;
export type AppFlatEnv = InferFlatEnv<typeof matrix>;

export async function initAppEnv(
  preset: "dev" | "prod" = "dev",
  opts?: { allowLocal?: boolean },
): Promise<void> {
  await matrix.up(preset, { allowLocal: opts?.allowLocal ?? true });
}

export default matrix;
