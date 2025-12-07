import { expect, test, type Page } from "@playwright/test";
import { loadAcceptanceCriteria } from "./utils/requirements";

const requirementId = "REQ-001";
const [
  chatAreaDominates,
  inputBarFixed,
  inputHasTextField,
  inputHasSendButton,
  enterKeySubmits,
  chatAreaScrollable,
  chatAreaAutoScroll,
] = loadAcceptanceCriteria(requirementId);

const pagePath = "/";

test.describe(`${requirementId}: Chat Interface Layout`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pagePath);
  });

  test(chatAreaDominates, async ({ page }) => {
    const chatWindow = page.getByLabel("Chat history");
    await expect(chatWindow).toBeVisible();

    const viewport = page.viewportSize();
    const box = await chatWindow.boundingBox();

    expect(viewport).not.toBeNull();
    expect(box).not.toBeNull();

    if (viewport && box) {
      const widthRatio = box.width / viewport.width;
      expect(widthRatio).toBeGreaterThan(0.5);
    }
  });

  test(inputBarFixed, async ({ page }) => {
    const inputBar = page.locator(".chat-input-bar");
    await expect(inputBar).toBeVisible();

    const viewport = page.viewportSize();
    const box = await inputBar.boundingBox();

    expect(viewport).not.toBeNull();
    expect(box).not.toBeNull();

    if (viewport && box) {
      const distanceFromBottom = viewport.height - (box.y + box.height);
      expect(distanceFromBottom).toBeLessThanOrEqual(24);
    }
  });

  test(inputHasTextField, async ({ page }) => {
    const input = page.getByLabel("Message input");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "Type your message...");
  });

  test(inputHasSendButton, async ({ page }) => {
    const sendButton = page.getByRole("button", { name: "Send" });
    await expect(sendButton).toBeVisible();
  });

  test(enterKeySubmits, async ({ page }) => {
    const messages = page.locator(".message");
    const initialCount = await messages.count();

    const input = page.getByLabel("Message input");
    await input.fill("Message sent via Enter");
    await input.press("Enter");

    await expect(messages).toHaveCount(initialCount + 1);
    await expect(messages.nth(initialCount)).toContainText(
      "Message sent via Enter"
    );
  });

  test(chatAreaScrollable, async ({ page }) => {
    await seedMessages(page, 15);
    const chatWindow = page.locator(".chat-window");

    const isScrollable = await chatWindow.evaluate(
      (element) => element.scrollHeight > element.clientHeight
    );
    expect(isScrollable).toBeTruthy();
  });

  test(chatAreaAutoScroll, async ({ page }) => {
    await seedMessages(page, 15);
    const chatWindow = page.locator(".chat-window");

    await chatWindow.evaluate((element) => {
      element.scrollTop = 0;
    });

    await addMessage(page, "Auto-scroll sentinel");

    await expect
      .poll(async () => {
        return chatWindow.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop
        );
      })
      .toBeLessThan(32);
  });
});

async function addMessage(page: Page, text: string) {
  const input = page.getByLabel("Message input");
  await input.fill(text);
  await input.press("Enter");
}

async function seedMessages(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    await addMessage(page, `Seed message ${index + 1}`);
  }
}
