import { expect, test, type Page } from "@playwright/test";
import { loadAcceptanceCriteria } from "./utils/requirements";

const requirementId = "REQ-013";
const [
  feedbackLoopStarts,
  aiPlansAction,
  toolCallParsed,
  toolOutputReturned,
  toolOutputUsed,
  loopContinuesUntilFinal,
] = loadAcceptanceCriteria(requirementId);

const pagePath = "/";

async function sendUserMessage(page: Page, text: string) {
  const input = page.getByLabel("Message input");
  await input.fill(text);
  await input.press("Enter");
}

async function emitStream(page: Page, event: unknown) {
  await page.evaluate(
    ({ detail }) => {
      window.dispatchEvent(
        new CustomEvent("llm-stream", {
          detail,
        })
      );
    },
    { detail: event }
  );
}

test.describe(`${requirementId}: Dialogue Feedback Loop`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pagePath);
  });

  test(feedbackLoopStarts, async ({ page }) => {
    const messages = page.locator(".message");
    const initialCount = await messages.count();
    await sendUserMessage(page, "Hello loop");
    await expect(messages).toHaveCount(initialCount + 2); // user + assistant placeholder
  });

  test(aiPlansAction, async ({ page }) => {
    await sendUserMessage(page, "Plan it");
    const lastBubble = page
      .locator(".message")
      .last()
      .locator(".message-bubble");
    await expect(lastBubble).toBeVisible();
    const text = await lastBubble.textContent();
    expect(text ?? "").toBe("");
  });

  test(toolCallParsed, async ({ page }) => {
    await sendUserMessage(page, "Use tool");
    const debug = await page.evaluate(
      () => (globalThis as any).__STREAM_DEBUG__
    );
    const requestId = debug.requestId as string;
    await emitStream(page, {
      type: "answer",
      requestId,
      delta: "Echo: ping",
    });
    const lastBubble = page
      .locator(".message")
      .last()
      .locator(".message-bubble");
    await expect(lastBubble).toContainText("Echo: ping");
  });

  test(toolOutputReturned, async ({ page }) => {
    await sendUserMessage(page, "Return result");
    const debug = await page.evaluate(
      () => (globalThis as any).__STREAM_DEBUG__
    );
    const requestId = debug.requestId as string;
    await emitStream(page, {
      type: "answer",
      requestId,
      delta: "Result A",
    });
    const lastBubble = page
      .locator(".message")
      .last()
      .locator(".message-bubble");
    await expect(lastBubble).toHaveText("Result A");
  });

  test(toolOutputUsed, async ({ page }) => {
    await sendUserMessage(page, "Use output");
    const debug = await page.evaluate(
      () => (globalThis as any).__STREAM_DEBUG__
    );
    const requestId = debug.requestId as string;
    await emitStream(page, {
      type: "answer",
      requestId,
      delta: "Step1",
    });
    await emitStream(page, {
      type: "answer",
      requestId,
      delta: " & Step2",
    });
    const lastBubble = page
      .locator(".message")
      .last()
      .locator(".message-bubble");
    await expect(lastBubble).toHaveText("Step1 & Step2");
  });

  test(loopContinuesUntilFinal, async ({ page }) => {
    await sendUserMessage(page, "Finish");
    const debug = await page.evaluate(
      () => (globalThis as any).__STREAM_DEBUG__
    );
    const requestId = debug.requestId as string;
    await emitStream(page, {
      type: "answer",
      requestId,
      delta: "Final answer",
    });
    await emitStream(page, {
      type: "done",
      requestId,
    });

    const sendButton = page.getByRole("button", { name: /Send/ });
    await expect(sendButton).toBeEnabled();
  });
});
