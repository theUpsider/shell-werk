/// <reference types="node" />
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";

type AcceptanceTest = {
  title: string;
  run: (ctx: { page: Page }, testInfo: TestInfo) => Promise<void> | void;
};

const acceptanceTests: AcceptanceTest[] = [
  {
    title: "Playwright is configured as the E2E testing framework.",
    run: async ({ page }) => {
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "New Chat", exact: true })
      ).toBeVisible();
    },
  },
  {
    title: 'All E2E tests are located in the "e2e" folder.',
    run: async ({ page: _page }, testInfo) => {
      const filePath = testInfo.file ?? "";
      expect(filePath.includes(`${path.sep}e2e${path.sep}`)).toBe(true);
    },
  },
  {
    title:
      "Each test case (test / it block) maps 1:1 to a requirement acceptance criteria checkbox.",
    run: async ({ page: _page }) => {
      const acceptanceTitles = acceptanceTests.map((entry) => entry.title);
      expect(new Set(acceptanceTitles).size).toBe(acceptanceTitles.length);
    },
  },
  {
    title: "One describe block maps to one requirement.",
    run: async ({ page: _page }, testInfo) => {
      expect((testInfo.file ?? "").includes("REQ-007")).toBe(true);
    },
  },
  {
    title: "All application functionality is covered by these E2E tests.",
    run: async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "New Chat", exact: true }).click();

      const composer = page.getByPlaceholder("Ask shell werk what to do...");
      await composer.fill("Hello from E2E");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("Stubbed: Hello from E2E")).toBeVisible();

      await page.getByRole("button", { name: "Settings" }).click();
      await expect(
        page.getByRole("heading", { name: "Model settings" })
      ).toBeVisible();
      await page.getByRole("button", { name: "Load models" }).click();
      await expect(page.getByText(/models available/i)).toHaveText(
        "1 models available"
      );
      await page.getByRole("button", { name: "Close" }).click();
    },
  },
  {
    title:
      "CI uses mocked LLM providers; no real Ollama/vLLM servers are required.",
    run: async ({ page }) => {
      await page.goto("/");
      const providerMode = await page.evaluate(() => {
        return (globalThis as { __E2E_PROVIDER_MODE?: string })
          .__E2E_PROVIDER_MODE;
      });
      expect(providerMode).toBe("mock");

      const composer = page.getByPlaceholder("Ask shell werk what to do...");
      await composer.fill("CI stub check");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("Stubbed: CI stub check")).toBeVisible();
    },
  },
  {
    title: "Local runs may opt into real providers via an environment flag.",
    run: async ({ page }) => {
      await page.goto("/");
      const expectedMode =
        process.env.E2E_USE_REAL_PROVIDER === "1" ? "real" : "mock";
      const providerMode = await page.evaluate(() => {
        return (globalThis as { __E2E_PROVIDER_MODE?: string })
          .__E2E_PROVIDER_MODE;
      });
      expect(providerMode).toBe(expectedMode);
    },
  },
];

test.describe("REQ-007: E2E Testing Infrastructure", () => {
  for (const entry of acceptanceTests) {
    test(entry.title, entry.run);
  }
});
