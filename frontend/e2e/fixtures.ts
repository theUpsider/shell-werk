import { test as base } from "@playwright/test";

declare global {
  interface Window {
    __E2E_PROVIDER_MODE?: "mock" | "real";
    go?: Record<string, unknown>;
    __LAST_CHAT_PAYLOAD__?: unknown;
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
              Chat: (payload: { message: string }) => {
                globalThis.__LAST_CHAT_PAYLOAD__ = payload;
                return Promise.resolve(respond(`Stubbed: ${payload.message}`));
              },
              Models: () => Promise.resolve({ models: ["mock-model"] }),
              GetTools: () =>
                Promise.resolve([
                  {
                    id: "browser",
                    name: "Browser",
                    description: "Fetch web content for context.",
                    uiVisible: true,
                    enabled: true,
                  },
                  {
                    id: "shell",
                    name: "Shell",
                    description: "Run shell commands",
                    uiVisible: false,
                    enabled: true,
                  },
                ]),
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
