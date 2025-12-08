import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("../wailsjs/go/main/App", () => ({
  Chat: vi.fn().mockResolvedValue({
    message: { role: "assistant", content: "ok" },
    latencyMs: 1,
  }),
  Models: vi.fn().mockResolvedValue({ models: ["llama3"] }),
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
});
