import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chat, Models } from "../wailsjs/go/main/App";
import { loadSettings, persistSettings, type SettingsState } from "./settings";
import "./App.css";

type Role = "user" | "assistant" | "tool";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface ChatRequestPayload {
  sessionId: string;
  provider: string;
  endpoint: string;
  model: string;
  message: string;
}

interface ChatResponsePayload {
  message: { role: string; content: string };
  latencyMs: number;
}

const STORAGE_KEY = "shellwerk:sessions";

const createId = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const createEmptySession = (): ChatSession => {
  const timestamp = new Date().toISOString();
  return {
    id: createId(),
    title: "New Chat",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  };
};

const applyAssistantContent = (
  sessionId: string,
  placeholderId: string,
  content: string,
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession
  ) => void
) => {
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((msg) =>
      msg.id === placeholderId ? { ...msg, content } : msg
    ),
    updatedAt: new Date().toISOString(),
  }));
};

function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as ChatSession[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // ignore broken cache
      }
    }
    return [createEmptySession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(
    sessions[0].id
  );
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SettingsState>(() =>
    loadSettings(globalThis.localStorage)
  );
  const [isSending, setIsSending] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    persistSettings(globalThis.localStorage, settings);
  }, [settings]);

  useEffect(() => {
    setModels([]);
    setModelError(null);
  }, [settings.provider, settings.endpoint]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [activeSession?.messages.length]);

  const updateSession = (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession
  ) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? updater(session) : session
      )
    );
  };

  const ensureTitle = (
    session: ChatSession,
    nextMessages: ChatMessage[]
  ): string => {
    if (session.title !== "New Chat") return session.title;
    const firstUser = nextMessages.find((m) => m.role === "user");
    return firstUser
      ? firstUser.content.slice(0, 32) || "New Chat"
      : "New Chat";
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !activeSession || isSending) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const assistantPlaceholder: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "Assistant replies will appear here once connected.",
      createdAt: new Date().toISOString(),
    };

    updateSession(activeSession.id, (session) => {
      const nextMessages = [
        ...session.messages,
        userMessage,
        assistantPlaceholder,
      ];
      const nextTitle = ensureTitle(session, nextMessages);
      return {
        ...session,
        messages: nextMessages,
        title: nextTitle,
        updatedAt: new Date().toISOString(),
      };
    });

    setDraft("");
    setIsSending(true);
    const payload: ChatRequestPayload = {
      sessionId: activeSession.id,
      provider: settings.provider,
      endpoint: settings.endpoint,
      model: settings.model,
      message: text,
    };

    Chat(payload)
      .then((response: ChatResponsePayload) => {
        applyAssistantContent(
          activeSession.id,
          assistantPlaceholder.id,
          response.message.content,
          updateSession
        );
        setLastLatencyMs(response.latencyMs ?? null);
      })
      .catch((err: unknown) => {
        const errorText = err instanceof Error ? err.message : "Unknown error";
        applyAssistantContent(
          activeSession.id,
          assistantPlaceholder.id,
          `Failed to reach provider: ${errorText}`,
          updateSession
        );
        setLastLatencyMs(null);
      })
      .finally(() => setIsSending(false));
  };

  const handleEnterKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    const next = createEmptySession();
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(next.id);
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  const handleSettingsSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setShowSettings(false);
  };

  const handleSettingsChange = (key: keyof SettingsState, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleLoadModels = () => {
    setIsLoadingModels(true);
    setModelError(null);
    Models({ provider: settings.provider, endpoint: settings.endpoint })
      .then((res) => {
        const next = res?.models ?? [];
        setModels(next);
        if (next.length && !settings.model) {
          setSettings((prev) => ({ ...prev, model: next[0] }));
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load models";
        setModelError(message);
      })
      .finally(() => setIsLoadingModels(false));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>shell-werk</h1>
          <p className="muted">Local LLM assistant</p>
        </div>
        <button className="primary" onClick={handleNewChat}>
          New Chat
        </button>
        <nav className="session-list" aria-label="Past chats">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`session-item ${
                session.id === activeSession?.id ? "active" : ""
              }`}
              onClick={() => handleSelectSession(session.id)}
            >
              <span className="session-title">
                {session.title || "New Chat"}
              </span>
              <span className="session-meta">
                {new Date(session.updatedAt).toLocaleString()}
              </span>
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </aside>

      <main className="chat-pane">
        <div className="chat-header">
          <div>
            <p className="label">Active chat</p>
            <h2>{activeSession?.title || "New Chat"}</h2>
          </div>
          <div className="chip-row">
            <div className="chip">Provider: {settings.provider}</div>
            <div className={`chip ${isSending ? "chip-warn" : "chip-ghost"}`}>
              {isSending
                ? "Sending..."
                : lastLatencyMs
                ? `Last response: ${lastLatencyMs} ms`
                : "Idle"}
            </div>
          </div>
        </div>

        <div className="chat-feed" ref={chatScrollRef}>
          {activeSession?.messages.length ? (
            activeSession.messages.map((message) => (
              <div
                key={message.id}
                className={`message message-${message.role}`}
              >
                <div className="message-meta">
                  <span className="role-label">{message.role}</span>
                  <span className="time">
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-body">{message.content}</div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>Start by asking a question or describing a task.</p>
              <p className="muted">
                Messages stay local and persist across restarts.
              </p>
            </div>
          )}
        </div>

        <div className="composer" aria-label="Chat input">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleEnterKey}
            placeholder="Message shell-werk"
            rows={3}
          />
          <button
            className="primary"
            onClick={handleSend}
            disabled={!draft.trim()}
          >
            Send
          </button>
        </div>
      </main>

      {showSettings && (
        <div className="modal-backdrop">
          <dialog
            className="modal"
            open
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="modal-header">
              <h3 id="settings-title">Model settings</h3>
              <button className="ghost" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
            <form className="modal-body" onSubmit={handleSettingsSubmit}>
              <label>
                <span className="label-text">Provider</span>
                <select
                  value={settings.provider}
                  onChange={(e) =>
                    handleSettingsChange("provider", e.target.value)
                  }
                >
                  <option value="ollama">Ollama</option>
                  <option value="vllm">vLLM</option>
                  <option value="mock">Mock</option>
                </select>
              </label>
              <label>
                <span className="label-text">Endpoint</span>
                <input
                  type="text"
                  value={settings.endpoint}
                  onChange={(e) =>
                    handleSettingsChange("endpoint", e.target.value)
                  }
                  placeholder="http://localhost:11434"
                />
              </label>
              <label>
                <span className="label-text">Model</span>
                {models.length ? (
                  <select
                    value={settings.model}
                    onChange={(e) =>
                      handleSettingsChange("model", e.target.value)
                    }
                  >
                    {models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={settings.model}
                    onChange={(e) =>
                      handleSettingsChange("model", e.target.value)
                    }
                    placeholder="qwen-3"
                  />
                )}
              </label>
              <div className="inline-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={handleLoadModels}
                  disabled={isLoadingModels}
                >
                  {isLoadingModels ? "Loading models..." : "Load models"}
                </button>
                {modelError && <span className="error-text">{modelError}</span>}
                {!modelError && models.length > 0 && (
                  <span className="muted">{models.length} models available</span>
                )}
              </div>
              <p className="muted">
                Full provider wiring coming in later milestones.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Save
                </button>
              </div>
            </form>
          </dialog>
        </div>
      )}
    </div>
  );
}

export default App;
