import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

vi.mock("../wailsjs/go/main/App", () => ({
  Chat: vi.fn().mockResolvedValue({
    message: { role: "assistant", content: "ok" },
    latencyMs: 2,
  }),
  Models: vi.fn().mockResolvedValue({ models: ["llama3"] }),
}));

const STORAGE_KEY = "shellwerk:sessions";
const mockChat = Chat as unknown as Mock;

const seedSessions = (sessions: unknown) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const { container } = render(<App />);

    const textbox = screen.getByPlaceholderText(/message shell-werk/i);
    await user.type(textbox, "Hello there{enter}");

    const feed = container.querySelector(".chat-feed") as HTMLDivElement | null;
    if (!feed) throw new Error("chat feed not found");
    expect(await within(feed).findByText("Hello there")).toBeInTheDocument();
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

    expect(await within(feed).findByText("Scroll check")).toBeInTheDocument();
    expect(feed.scrollTop).toBe(feed.scrollHeight);
  });

  it("allows manual scrolling when chat overflow occurs", () => {
    const { container } = render(<App />);

    const feed = container.querySelector(".chat-feed") as HTMLDivElement;
    Object.defineProperty(feed, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(feed, "clientHeight", {
      configurable: true,
      value: 400,
    });

    feed.scrollTop = 0;
    feed.scrollTop = 300;

    expect(feed.scrollTop).toBe(300);
  });

  it("keeps the composer at the bottom of the chat pane", () => {
    const { container } = render(<App />);
    const pane = container.querySelector(".chat-pane");
    expect(pane).toBeInTheDocument();
    if (!pane) return;

    const children = Array.from(pane.children);
    const composer = children.at(-1);
    const feed = children.find((child) =>
      child.classList.contains("chat-feed")
    );

    expect(composer?.classList.contains("composer")).toBe(true);
    expect(feed).toBeDefined();
    if (!feed || !composer) return;

    expect(children.indexOf(composer)).toBeGreaterThan(children.indexOf(feed));
  });

  it("allocates majority width to the chat pane via grid template", () => {
    const cssPath = path.resolve(__dirname, "App.css");
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/grid-template-columns\s*:\s*320px\s+1fr/i);
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
