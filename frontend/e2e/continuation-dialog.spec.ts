import { expect } from "@playwright/test";
import { test } from "./fixtures";

test.describe("Continuation dialog", () => {
  test("prompts and resolves continue/cancel decisions", async ({ page }) => {
    await page.goto("/");

    // Emit a mock continuation request for iteration limit
    await page.evaluate(() => {
      (globalThis as any).runtime?.EventsEmit?.(
        "dialogue:continuation_request",
        {
          sessionId: "sess-1",
          requestId: "req-1",
          reason: "iteration_limit",
          iteration: 30,
          limit: 30,
        }
      );
    });

    const dialog = page.getByRole("dialog", { name: "Continue generation?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/used 30 tool step/)).toBeVisible();

    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog).toBeHidden();

    const firstResolution = await page.evaluate(
      () => (globalThis as any).__LAST_CONTINUATION__
    );
    expect(firstResolution?.decision).toBe("continue");
    expect(firstResolution?.requestId).toBe("req-1");

    // Emit a second request for repeated tool failures and stop it
    await page.evaluate(() => {
      (globalThis as any).runtime?.EventsEmit?.(
        "dialogue:continuation_request",
        {
          sessionId: "sess-2",
          requestId: "req-2",
          reason: "tool_failures",
          toolName: "shell",
          failureCount: 5,
          failureLimit: 5,
          detail: "mock failure",
        }
      );
    });

    const failureDialog = page.getByRole("dialog", {
      name: "Tool needs guidance",
    });
    await expect(failureDialog).toBeVisible();
    await expect(failureDialog.getByText(/failed 5 time/)).toBeVisible();

    await failureDialog.getByRole("button", { name: "Stop" }).click();
    await expect(failureDialog).toBeHidden();

    const secondResolution = await page.evaluate(
      () => (globalThis as any).__LAST_CONTINUATION__
    );
    expect(secondResolution?.decision).toBe("cancel");
    expect(secondResolution?.requestId).toBe("req-2");
  });
});
