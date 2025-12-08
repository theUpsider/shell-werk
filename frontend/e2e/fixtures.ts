import { test as base } from "@playwright/test";

declare global {
  interface Window {
    __E2E_PROVIDER_MODE?: "mock" | "real";
    go?: Record<string, unknown>;
  }
}

const useMockProvider = process.env.E2E_USE_REAL_PROVIDER !== "1";

export const test = base.extend({
  page: async ({ page }, use) => {
    if (useMockProvider) {
      await page.addInitScript(() => {
        const respond = (content: string) => ({
          message: { role: "assistant", content },
          latencyMs: 12,
        });

        globalThis.__E2E_PROVIDER_MODE = "mock";
        globalThis.go = {
          main: {
            App: {
              Chat: (payload: { message: string }) =>
                Promise.resolve(respond(`Stubbed: ${payload.message}`)),
              Models: () => Promise.resolve({ models: ["mock-model"] }),
              Greet: (name: string) => Promise.resolve(`Hello ${name}`),
            },
          },
        };
      });
    } else {
      await page.addInitScript(() => {
        globalThis.__E2E_PROVIDER_MODE = "real";
      });
    }

    await use(page);
  },
});

export { expect } from "@playwright/test";
