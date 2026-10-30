import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@pims\/types\/(.*)$/, replacement: path.resolve(import.meta.dirname, "./packages/types/src/$1") },
      { find: "@pims/types", replacement: path.resolve(import.meta.dirname, "./packages/types/src/index.ts") },
      { find: /^@pims\/config\/(.*)$/, replacement: path.resolve(import.meta.dirname, "./packages/config/src/$1") },
      { find: "@pims/config", replacement: path.resolve(import.meta.dirname, "./packages/config/src/index.ts") },
      { find: /^@pims\/pims-mock\/(.*)$/, replacement: path.resolve(import.meta.dirname, "./packages/pims-mock/src/$1") },
      { find: "@pims/pims-mock", replacement: path.resolve(import.meta.dirname, "./packages/pims-mock/src/index.ts") },
      { find: /^@pims\/pims-adapter\/(.*)$/, replacement: path.resolve(import.meta.dirname, "./packages/pims-adapter/src/$1") },
      { find: "@pims/pims-adapter", replacement: path.resolve(import.meta.dirname, "./packages/pims-adapter/src/index.ts") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
