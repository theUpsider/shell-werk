import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { Chat } from "../wailsjs/go/main/App";

vi.mock("../wailsjs/go/main/App", () => ({
  Chat: vi.fn().mockResolvedValue({
    message: { role: "assistant", content: "ok" },
    latencyMs: 2,
  }),
  Models: vi.fn().mockResolvedValue({ models: ["llama3"] }),
}));

const STORAGE_KEY = "shellwerk:sessions";
const mockChat = Chat as unknown as vi.Mock;

const seedSessions = (sessions: unknown) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("REQ-001: chat interface", () => {
  it("renders chat area with input and send controls", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".chat-feed")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/message shell-werk/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("submits a message on Enter and sends to backend", async () => {
    const user = userEvent.setup();
    render(<App />);

    const textbox = screen.getByPlaceholderText(/message shell-werk/i);
    await user.type(textbox, "Hello there{enter}");

    expect(await screen.findByText("Hello there")).toBeInTheDocument();
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Hello there" })
    );
  });

  it("auto-scrolls the chat feed to the latest message", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const feed = container.querySelector(".chat-feed") as HTMLDivElement;
    Object.defineProperty(feed, "scrollHeight", {
      configurable: true,
      value: 500,
    });
    feed.scrollTop = 0;

    await user.type(
      screen.getByPlaceholderText(/message shell-werk/i),
      "Scroll check"
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("Scroll check")).toBeInTheDocument();
    expect(feed.scrollTop).toBe(feed.scrollHeight);
  });
});

describe("REQ-002: sidebar and history", () => {
  it("lists past sessions and loads history when selected", async () => {
    const user = userEvent.setup();
    const timestamp = "2024-01-01T00:00:00.000Z";
    seedSessions([
      {
        id: "alpha",
        title: "Alpha session",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: "m1",
            role: "user",
            content: "First message",
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
    ]);

    render(<App />);

    const list = screen.getByRole("navigation", { name: /past chats/i });
    expect(within(list).getAllByRole("button")).toHaveLength(2);

    await user.click(
      within(list).getByRole("button", { name: /beta session/i })
    );

    expect(await screen.findByText("Beta message")).toBeInTheDocument();
    expect(screen.queryByText("First message")).not.toBeInTheDocument();
  });

  it("creates a new chat, clears the view, and persists the session list", async () => {
    const user = userEvent.setup();
    const timestamp = "2024-01-02T00:00:00.000Z";
    seedSessions([
      {
        id: "existing",
        title: "Existing session",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: "m-existing",
            role: "assistant",
            content: "Persisted message",
            createdAt: timestamp,
          },
        ],
      },
    ]);

    render(<App />);

    expect(screen.getByText("Persisted message")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /new chat/i }));

    expect(screen.getByText(/start by asking/i)).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored.length).toBe(2);
    expect(stored[0].messages).toHaveLength(0);
  });

  it("opens the settings modal from the sidebar button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /settings/i }));

    expect(
      await screen.findByRole("dialog", { name: /model settings/i })
    ).toBeInTheDocument();
  });
});
