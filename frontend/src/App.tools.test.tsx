import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import App from "./App";
import { Chat } from "../wailsjs/go/main/App";
import { SETTINGS_KEY, defaultSettings } from "./settings";

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
    {
      id: "shell",
      name: "Shell",
      description: "Run shell commands",
      uiVisible: false,
      enabled: true,
    },
  ]),
}));

const mockChat = Chat as unknown as Mock;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("tool toggles", () => {
  it("shows UI-visible tool and sends enabled tools in chat payload", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...defaultSettings, chatOnly: false })
    );
    const user = userEvent.setup();
    render(<App />);

    const toggle = await screen.findByRole("button", { name: /browser/i });
    expect(toggle).toBeEnabled();

    await user.type(
      screen.getByPlaceholderText(/message shell-werk/i),
      "Hello tools"
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining(["browser"]),
        tools: expect.not.arrayContaining(["web_search"]),
        chatOnly: false,
      })
    );
  });

  it("disables tool toggles when Chat Only mode is on", async () => {
    render(<App />);

    const toggleRow = await screen.findByLabelText(/tool toggles/i);
    const toggle = within(toggleRow).getByRole("button", { name: /browser/i });

    expect(toggle).toBeDisabled();
  });

  it("excludes non-visible tools when globally disabled in settings", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        chatOnly: false,
        hiddenToolsDisabled: ["shell"],
      })
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(
      screen.getByPlaceholderText(/message shell-werk/i),
      "Hello hidden"
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(mockChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.arrayContaining(["shell"]) })
    );
  });

  it("enables web search when an API key is provided", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        chatOnly: false,
        webSearchApiKey: "token-123",
      })
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(
      screen.getByPlaceholderText(/message shell-werk/i),
      "Search the web"
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining(["web_search", "browser"]),
      })
    );
  });
});
