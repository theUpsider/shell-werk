import { expect, test } from "./fixtures";

const STORAGE_KEY = "shellwerk:sessions";

test.describe("REQ-002: Chat Sidebar and History Management", () => {
  test("renames chat via right-click and keeps the title after reload", async ({
    page,
  }) => {
    const timestamp = new Date().toISOString();
    const seeded = [
      {
        id: "alpha",
        title: "Alpha session",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: "m1",
            role: "user",
            content: "Alpha message",
            createdAt: timestamp,
          },
        ],
      },
      {
        id: "beta",
        title: "Beta session",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: "m2",
            role: "user",
            content: "Beta message",
            createdAt: timestamp,
          },
        ],
      },
    ];

    await page.goto("/");
    await page.evaluate(
      ({ key, payload }) => {
        localStorage.setItem(key, payload);
      },
      { key: STORAGE_KEY, payload: JSON.stringify(seeded) }
    );
    await page.addInitScript(
      ({ key, payload }) => {
        if (payload) {
          localStorage.setItem(key, payload);
        }
      },
      { key: STORAGE_KEY, payload: JSON.stringify(seeded) }
    );
    await page.reload();

    const nav = page.getByRole("navigation", { name: /past chats/i });
    await nav.waitFor();
    const betaRow = nav.locator(".session-row", { hasText: /beta session/i });
    const betaButton = betaRow.locator(".session-item").first();
    await betaButton.click({ button: "right" });

    const renameInput = page.getByLabel("Rename chat");
    await renameInput.fill("Renamed Beta");
    await page.getByRole("button", { name: "Save name" }).click();

    const renamedRow = nav.locator(".session-row", {
      hasText: /renamed beta/i,
    });
    const renamedButton = renamedRow.locator(".session-item").first();
    await expect(renamedButton).toBeVisible();
    await renamedButton.click();

    await expect(page.getByText(/beta message/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /renamed beta/i })
    ).toBeVisible();

    const serialized = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEY
    );
    await page.addInitScript(
      ({ key, payload }) => {
        if (payload) {
          localStorage.setItem(key, payload);
        }
      },
      { key: STORAGE_KEY, payload: serialized ?? "" }
    );
    await page.reload();
    const navAfterReload = page.getByRole("navigation", {
      name: /past chats/i,
    });
    await navAfterReload.waitFor();
    const renamedRowAfterReload = navAfterReload.locator(".session-row", {
      hasText: /renamed beta/i,
    });
    await expect(
      renamedRowAfterReload.locator(".session-item").first()
    ).toBeVisible();
  });
});
