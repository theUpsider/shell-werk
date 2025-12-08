import { expect, test } from "./fixtures";

test.describe("REQ-011: Tool UI Visibility Configuration", () => {
  test("hidden tool defaults and can be globally disabled", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Chat Only mode (disable tools)").uncheck();

    const shellToggle = page.getByLabel(/Shell \(hidden tool\)/);
    await expect(shellToggle).toBeChecked();
    await page.getByRole("button", { name: "Save" }).click();

    await page
      .getByPlaceholder("Message shell-werk")
      .fill("Hidden tool default");
    await page.getByRole("button", { name: "Send" }).click();
    let payload = await page.evaluate(
      () =>
        (globalThis as { __LAST_CHAT_PAYLOAD__?: any }).__LAST_CHAT_PAYLOAD__
    );
    expect(payload?.tools).toContain("shell");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel(/Shell \(hidden tool\)/).uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    await page
      .getByPlaceholder("Message shell-werk")
      .fill("Hidden tool disabled");
    await page.getByRole("button", { name: "Send" }).click();
    payload = await page.evaluate(
      () =>
        (globalThis as { __LAST_CHAT_PAYLOAD__?: any }).__LAST_CHAT_PAYLOAD__
    );
    expect(payload?.tools ?? []).not.toContain("shell");
  });
});
