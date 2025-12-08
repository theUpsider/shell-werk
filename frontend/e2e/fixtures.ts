import { config as loadEnv } from "dotenv";
import { test as base } from "@playwright/test";

loadEnv({ path: "./.env" });

declare global {
  interface Window {
    __E2E_PROVIDER_MODE?: "mock" | "real";
    go?: Record<string, unknown>;
    __LAST_CHAT_PAYLOAD__?: unknown;
  }
}

const useMockProvider = process.env.E2E_USE_REAL_PROVIDER !== "1";
const realEndpoint =
  process.env.VITE_VLLM_URL ||
  process.env.VITE_VLLM_ENDPOINT ||
  "https://vllm-32b.haski.app";
const realApiKey = process.env.VITE_VLLM_API_KEY || "";

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
      await page.exposeFunction(
        "__realChat",
        async (payload: { message: string; model?: string; tools?: string[] }) => {
          const tools = buildToolDefinitions(payload.tools ?? []);
          const sys = {
            role: "system",
            content:
              "You are shell-werk. Use tools and finalize with request_fullfilled when done.",
          };
          const messages: any[] = [sys, { role: "user", content: payload.message }];

          for (let i = 0; i < 4; i++) {
            const body = {
              model: payload.model || "qwen-32b",
              messages,
              stream: false,
              tools,
              tool_choice: "auto",
              temperature: 0,
            };

            const res = await fetch(`${realEndpoint}/v1/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(realApiKey ? { Authorization: `Bearer ${realApiKey}` } : {}),
              },
              body: JSON.stringify(body),
            });

            const data: any = await res.json();
            const choice = data?.choices?.[0];
            const toolCalls: any[] = choice?.message?.tool_calls || [];
            const content: string = choice?.message?.content || "";
            if (!toolCalls.length) {
              return { message: { role: "assistant", content }, latencyMs: 20, trace: [] };
            }

            messages.push(choice.message);

            for (const tc of toolCalls) {
              const args = safeParseArgs(tc.function?.arguments) || {};
              if (tc.function?.name === "request_fullfilled") {
                const summary = args.summary || content || "Request complete.";
                return {
                  message: { role: "assistant", content: summary },
                  latencyMs: 20,
                  trace: [
                    {
                      id: `trace-${Date.now()}`,
                      role: "assistant",
                      kind: "final",
                      content: summary,
                      status: "complete",
                      createdAt: new Date().toISOString(),
                    },
                  ],
                };
              }

              if (tc.function?.name === "browser" && args.url) {
                const preview = await fetchPreview(args.url as string);
                messages.push({
                  role: "tool",
                  name: "browser",
                  content: preview,
                  tool_call_id: tc.id,
                });
              } else {
                messages.push({
                  role: "tool",
                  name: tc.function?.name || "unknown",
                  content: "(tool stubbed in E2E)",
                  tool_call_id: tc.id,
                });
              }
            }
          }

          throw new Error("Real provider did not finish within 4 iterations");
        }
      );

      await page.addInitScript(() => {
        globalThis.__E2E_PROVIDER_MODE = "real";
        globalThis.go = {
          main: {
            App: {
              Chat: (payload: any) =>
                (globalThis as { __realChat?: (input: any) => Promise<any> })
                  .__realChat?.(payload),
              Models: () => Promise.resolve({ models: [] }),
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
    }

    await use(page);
  },
});

export { expect } from "@playwright/test";

function buildToolDefinitions(enabled: string[]) {
  const defs: any[] = [];
  if (enabled.includes("browser")) {
    defs.push({
      type: "function",
      function: {
        name: "browser",
        description: "Fetch a URL and return preview text",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            maxBytes: { type: "number" },
          },
          required: ["url"],
        },
      },
    });
  }

  defs.push({
    type: "function",
    function: {
      name: "request_fullfilled",
      description: "Mark the request complete and provide a summary.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
        },
        required: ["summary"],
      },
    },
  });

  return defs;
}

async function fetchPreview(url: string): Promise<string> {
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return text.slice(0, 512) || "(empty response)";
  } catch (err) {
    return `browser failed: ${(err as Error).message}`;
  }
}

function safeParseArgs(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return undefined;
  }
}
