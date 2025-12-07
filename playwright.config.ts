import { defineConfig, devices } from "@playwright/test";

const host = process.env.PLAYWRIGHT_WEB_SERVER_HOST ?? "127.0.0.1";
const port = process.env.PLAYWRIGHT_WEB_SERVER_PORT ?? "4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [["github"], ["list"]]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ],
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    trace: isCI ? "retain-on-failure" : "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  metadata: {
    framework: "playwright",
    requirement: "REQ-007",
    usesLocalOllama: !isCI,
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
      `yarn dev --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
