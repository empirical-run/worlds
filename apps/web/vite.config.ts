import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8790 },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [{ configPath: "../api/wrangler.jsonc" }],
    }),
    reactRouter(),
  ],
});
