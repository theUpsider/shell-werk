import type { FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  // Touch the config so TypeScript's noUnusedParameters check passes.
  config.projects.length;

  const isCI = Boolean(process.env.CI);
  process.env.OLLAMA_BASE_URL ??= "http://localhost:11434";
  process.env.OLLAMA_MODEL ??= "qwen3:4b";
  process.env.OLLAMA_USE_MOCKS = isCI ? "true" : "false";
  process.env.OLLAMA_PROVIDER = isCI ? "mock" : "ollama";
}
