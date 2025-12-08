import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const isTest = process.env.VITEST === "true";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ fastRefresh: !isTest })],
  resolve: {
    alias: {
      vfile: "vfile/index.js",
      "#minpath": "vfile/lib/minpath.browser.js",
      "#minproc": "vfile/lib/minproc.browser.js",
      "#minurl": "vfile/lib/minurl.browser.js",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
