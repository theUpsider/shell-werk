import {defineConfig, devices} from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4173)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `npm run dev -- --host --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
})
