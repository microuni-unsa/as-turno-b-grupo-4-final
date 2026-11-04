import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  srcDir: "./src/ui",
  outDir: "./dist/client",
  server: {
    port: 4321,
  },
  vite: {
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/healthz": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/readyz": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@pims/cockpit": fileURLToPath(new URL("./src", import.meta.url)),
        "@pims/types": fileURLToPath(new URL("../types/src", import.meta.url)),
      },
    },
    plugins: [tailwindcss()],
  },
});
