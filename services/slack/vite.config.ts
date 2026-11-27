import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { slackEmoji } from "./emoji-plugin";

export default defineConfig({
  root: "ui",
  plugins: [react(), slackEmoji()],
  build: { outDir: "dist", emptyOutDir: true },
});
