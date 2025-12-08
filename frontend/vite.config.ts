import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const isTest = process.env.VITEST === "true";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ fastRefresh: !isTest })],
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
  },
});
