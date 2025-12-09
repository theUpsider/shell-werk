import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const TOOL_DESCRIPTION = "Fetch web content for context.";

const openSettings = async (page: Page) => {
  await test.step("open settings", async () => {
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Model settings" })
    ).toBeVisible();
  });
};

const disableChatOnly = async (page: Page) => {
  await test.step("disable chat only", async () => {
    await page.getByLabel("Chat Only mode (disable tools)").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
  });
};

test.describe("REQ-012: Tool Toggling in Chat Interface", () => {
  test("chat-only disables tool pills and omits tools", async ({ page }) => {
    await page.goto("/");

    const toggleRow = page.getByLabel("Tool toggles");
    await expect(
      toggleRow.getByRole("button", { name: "Disable Browser" })
    ).toBeDisabled();

    const composer = page.getByPlaceholder("Ask shell werk what to do...");
    await composer.fill("Chat-only check");
    await page.getByRole("button", { name: "Send" }).click();

    const payload = await page.evaluate(
      () =>
        (globalThis as { __LAST_CHAT_PAYLOAD__?: any }).__LAST_CHAT_PAYLOAD__
    );
    expect(payload?.chatOnly).toBe(true);
    expect(payload?.tools ?? []).toHaveLength(0);
  });

  test("UI-visible tool pill toggles via remove/add and tools reach payload", async ({
    page,
  }) => {
    await page.goto("/");

    const toggleRow = page.getByLabel("Tool toggles");
    const browserPill = toggleRow.getByRole("button", {
      name: "Disable Browser",
    });
    await expect(browserPill).toHaveAttribute("title", TOOL_DESCRIPTION);

    await openSettings(page);
    await disableChatOnly(page);

    await expect(browserPill).toBeEnabled();
    await browserPill.click(); // remove Browser from enabled list

    const addButton = toggleRow.getByRole("button", { name: "Add tools" });
    await addButton.click();
    await toggleRow.getByRole("menuitem", { name: "Enable Browser" }).click();

    const composer = page.getByPlaceholder("Ask shell werk what to do...");
    await composer.fill("Tools enabled");
    await page.getByRole("button", { name: "Send" }).click();

    const payload = await page.evaluate(
      () =>
        (globalThis as { __LAST_CHAT_PAYLOAD__?: any }).__LAST_CHAT_PAYLOAD__
    );
    expect(payload?.chatOnly).toBe(false);
    expect(payload?.tools).toContain("browser");
  });
});
