import { expect, test } from "./fixtures";

test.describe("REQ-013: Dialogue Feedback Loop", () => {
  test("renders partial tool progress as separate cards", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      const now = new Date().toISOString();
      const trace = [
        {
          id: "trace-plan",
          role: "assistant",
          kind: "plan",
          status: "running",
          content: "Assessing which tool to use",
          createdAt: now,
        },
        {
          id: "trace-call",
          role: "tool",
          kind: "tool_call",
          title: "browser",
          status: "running",
          content: "Fetch https://example.com",
          createdAt: now,
        },
        {
          id: "trace-result",
          role: "tool",
          kind: "tool_result",
          title: "browser",
          status: "done",
          content: "Example Domain preview",
          createdAt: now,
        },
      ];

      if (!globalThis.go) return;
      globalThis.go.main.App.Chat = (payload: any) => {
        globalThis.__LAST_CHAT_PAYLOAD__ = payload;
        return Promise.resolve({
          message: { role: "assistant", content: "Browsing finished." },
          latencyMs: 8,
          trace,
        });
      };
    });

    await page
      .getByPlaceholder("Ask shell werk what to do...")
      .fill("Trigger trace");
    await page.getByRole("button", { name: "Send" }).click();
    // Expand the trace group to reveal trace items
    await page.getByRole("button", { name: /Tool calls/i }).click();

    await expect(page.getByText(/tool_call · .*browser/i)).toBeVisible();
    await expect(page.getByText(/Example Domain preview/i)).toBeVisible();
    await expect(page.getByText(/Browsing finished/i)).toBeVisible();
  });

  test("real vLLM endpoint responds when enabled", async ({ page }) => {
    test.skip(
      process.env.E2E_USE_REAL_PROVIDER !== "1",
      "Real provider disabled"
    );

    await page.goto("/");
    await page
      .getByPlaceholder("Ask shell werk what to do...")
      .fill("Say 'hello from vllm' and then call request_fullfilled.");
    await page.getByRole("button", { name: "Send" }).click();

    const finalAssistant = page
      .locator(".message-assistant .message-body")
      .last();
    await expect(finalAssistant).toBeVisible({ timeout: 60_000 });
    await expect(finalAssistant).not.toHaveText(
      /Assistant replies will appear/i,
      {
        timeout: 120_000,
      }
    );
    await finalAssistant.innerText();
  });
});
