import { expect, test } from "./fixtures";

const CONFIG_LIST = "Model configurations";

const getPayload = async (page: any) =>
  page.evaluate(
    () =>
      (globalThis as { __LAST_CHAT_PAYLOAD__?: any }).__LAST_CHAT_PAYLOAD__
  );

test.describe("REQ-009: LLM Provider Configuration", () => {
  test("adds config cards, loads models, sets active config, and sends with selection", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Model settings" })
    ).toBeVisible();

    const configList = page.getByRole("list", { name: CONFIG_LIST });
    await expect(configList.getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: "Add configuration" }).click();
    await expect(configList.getByRole("listitem")).toHaveCount(2);

    const newCard = configList.getByRole("listitem").nth(1);

    await newCard.getByLabel("Name").fill("Alt config");
    await newCard.getByLabel("Provider").selectOption("mock");
    await newCard.getByLabel("Endpoint").fill("http://localhost:9999");
    await newCard.getByLabel("API key (Bearer)").fill("abc123");
    await newCard.getByLabel("Model").fill("custom-model");

    await newCard.getByRole("button", { name: "Load models" }).click();
    await expect(newCard.getByText("1 models available")).toBeVisible();

    await newCard.getByLabel("Active").check();
    await page.getByRole("button", { name: "Save" }).click();

    const configChip = page.getByText(/Config:/).first();
    await expect(configChip).toContainText("Alt config");
    await expect(configChip).toContainText("mock");

    await page
      .getByPlaceholder("Message shell-werk")
      .fill("Use selected config");
    await page.getByRole("button", { name: "Send" }).click();

    const payload = await getPayload(page);
    expect(payload?.provider).toBe("mock");
    expect(payload?.endpoint).toBe("http://localhost:9999");
    expect(payload?.model).toBe("mock-model");
  });
});
