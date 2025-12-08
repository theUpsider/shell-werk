import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("../wailsjs/go/main/App", () => ({
  Chat: vi.fn().mockResolvedValue({
    message: { role: "assistant", content: "ok" },
    latencyMs: 1,
  }),
  Models: vi.fn().mockResolvedValue({ models: ["llama3"] }),
  GetTools: vi.fn().mockResolvedValue([
    {
      id: "browser",
      name: "Browser",
      description: "Fetch web content for context.",
      uiVisible: true,
      enabled: true,
    },
    {
      id: "web_search",
      name: "Web Search",
      description: "Search the web",
      uiVisible: true,
      enabled: true,
    },
  ]),
}));

afterEach(() => cleanup());

describe("settings modal", () => {
  it("opens and closes from the Settings button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /settings/i }));

    expect(
      screen.getByRole("dialog", { name: /model settings/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads models and shows a select", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /settings/i }));

    await user.click(screen.getByRole("button", { name: /load models/i }));

    expect(
      await screen.findByRole("option", { name: "llama3" })
    ).toBeInTheDocument();
  });

  it("adds, activates, and deletes model configs", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /settings/i }));

    const dialog = screen.getByRole("dialog", { name: /model settings/i });

    expect(
      within(dialog).getAllByRole("radio", { name: /active/i })
    ).toHaveLength(1);

    await user.click(
      within(dialog).getByRole("button", { name: /add configuration/i })
    );

    const radios = within(dialog).getAllByRole("radio", { name: /active/i });
    expect(radios).toHaveLength(2);

    await user.click(radios[1]);

    const nameInputs = within(dialog).getAllByLabelText(/name/i);
    await user.clear(nameInputs[1]);
    await user.type(nameInputs[1], "Alt config");

    const deleteButtons = within(dialog).getAllByRole("button", {
      name: /delete/i,
    });
    await user.click(deleteButtons[0]);

    expect(
      within(dialog).getAllByRole("radio", { name: /active/i })
    ).toHaveLength(1);
    expect(nameInputs[1]).toHaveValue("Alt config");
  });

  it("shows a Brave API key field for web search", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /settings/i }));

    const apiInput = await screen.findByLabelText(/brave api key/i);
    await user.type(apiInput, "abc123");

    expect(apiInput).toHaveValue("abc123");
  });
});
