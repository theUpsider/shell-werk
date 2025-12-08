import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { EventsOn } from "../wailsjs/runtime/runtime";
import {
  Chat,
  GetTools,
  Models,
  RunShellCommand,
} from "../wailsjs/go/main/App";
import { llm } from "../wailsjs/go/models";
import {
  createModelConfig,
  loadSettings,
  persistSettings,
  type ModelConfig,
  type SettingsState,
} from "./settings";
import { describeError, formatProviderTarget } from "./errors";
import { ToolTraceMessage } from "./ToolTraceMessage";
import "./App.css";
import "./tool-calls.css";

type Role = "user" | "assistant" | "tool";

interface ToolCallFunction {
  name: string;
  arguments: string;
}

interface ToolCall {
  id?: string;
  type: string;
  function: ToolCallFunction;
}

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  isTrace?: boolean;
  traceKind?: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  toolChoices: Record<string, boolean>;
}

interface ChatResponsePayload {
  message: { role: string; content: string; tool_calls?: ToolCall[] };
  latencyMs: number;
  trace?: DialogueTrace[];
}

interface DialogueTrace {
  id: string;
  role: string;
  kind: string;
  title?: string;
  content: string;
  status?: string;
  createdAt?: string;
}

interface ToolMetadata {
  id: string;
  name: string;
  description: string;
  uiVisible: boolean;
  enabled: boolean;
}

const THINKING_START_EVENT = "thinking:start";
const THINKING_UPDATE_EVENT = "thinking:update";
const THINKING_END_EVENT = "thinking:end";
const ANSWER_UPDATE_EVENT = "answer:update";

const markdownComponents = {
  a: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props} target="_blank" rel="noreferrer">
      {children ?? props.href}
    </a>
  ),
};

interface ThinkingEventPayload {
  sessionId: string;
  chunk?: string;
}

interface AnswerEventPayload {
  sessionId: string;
  chunk: string;
}

const formatElapsed = (elapsedMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const STORAGE_KEY = "shellwerk:sessions";

const createId = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const createEmptySession = (
  toolDefaults: Record<string, boolean>
): ChatSession => {
  const timestamp = new Date().toISOString();
  return {
    id: createId(),
    title: "New Chat",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    toolChoices: { ...toolDefaults },
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
  const [toolCatalog, setToolCatalog] = useState<ToolMetadata[]>([]);
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
    return [createEmptySession({})];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(
    sessions[0].id
  );
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [pendingDeletionId, setPendingDeletionId] = useState<string | null>(
    null
  );
  const [settings, setSettings] = useState<SettingsState>(() =>
    loadSettings(globalThis.localStorage)
  );
  const [isSending, setIsSending] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [modelsByConfig, setModelsByConfig] = useState<
    Record<string, string[]>
  >({});
  const [modelErrors, setModelErrors] = useState<Record<string, string | null>>(
    {}
  );
  const [isLoadingModels, setIsLoadingModels] = useState<
    Record<string, boolean>
  >({});
  const [toolError, setToolError] = useState<string | null>(null);
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [thinking, setThinking] = useState<{
    sessionId: string;
    startedAt: number;
  } | null>(null);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const placeholderMap = useRef<
    Record<string, { id: string; content: string }>
  >({});
  const thinkingStreamsRef = useRef<Record<string, string>>({});
  const activeSessionIdRef = useRef(activeSessionId);
  const [thinkingStreamText, setThinkingStreamText] = useState("");

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );

  const hiddenDisabled = useMemo(
    () => new Set(settings.hiddenToolsDisabled ?? []),
    [settings.hiddenToolsDisabled]
  );

  const webSearchReady = useMemo(
    () => settings.webSearchApiKey.trim().length > 0,
    [settings.webSearchApiKey]
  );

  const activeConfig = useMemo(() => {
    if (!settings.configs?.length) return null;
    return (
      settings.configs.find(
        (config) => config.id === settings.activeConfigId
      ) ?? settings.configs[0]
    );
  }, [settings.activeConfigId, settings.configs]);

  useEffect(() => {
    if (settings.configs.length === 0) {
      setSettings((prev) => {
        if (prev.configs.length) return prev;
        const fallback = createModelConfig();
        return { ...prev, configs: [fallback], activeConfigId: fallback.id };
      });
      return;
    }

    if (!activeConfig) {
      setSettings((prev) => ({
        ...prev,
        activeConfigId: prev.configs[0]?.id ?? prev.activeConfigId,
      }));
    }
  }, [activeConfig, settings.configs]);

  const pendingDeletionSession = pendingDeletionId
    ? sessions.find((session) => session.id === pendingDeletionId) ?? null
    : null;

  const toolDefaults = useMemo(() => {
    const entries: Record<string, boolean> = {};
    toolCatalog.forEach((tool) => {
      const baseEnabled = tool.enabled;
      const hiddenFlag = !tool.uiVisible && hiddenDisabled.has(tool.id);
      const available = tool.id !== "web_search" || webSearchReady;
      entries[tool.id] = baseEnabled && !hiddenFlag && available;
    });
    return entries;
  }, [toolCatalog, hiddenDisabled, webSearchReady]);

  const activeToolChoices = activeSession?.toolChoices ?? toolDefaults;

  const visibleTools = useMemo(
    () => toolCatalog.filter((tool) => tool.uiVisible),
    [toolCatalog]
  );
  const enabledVisibleTools = useMemo(
    () => visibleTools.filter((tool) => !!activeToolChoices[tool.id]),
    [activeToolChoices, visibleTools]
  );
  const disabledVisibleTools = useMemo(
    () => visibleTools.filter((tool) => !activeToolChoices[tool.id]),
    [activeToolChoices, visibleTools]
  );
  const missingWebSearchKey =
    visibleTools.some((tool) => tool.id === "web_search") && !webSearchReady;

  useEffect(() => {
    GetTools()
      .then((tools) => {
        setToolCatalog(tools ?? []);
      })
      .catch((err: unknown) => {
        const message = describeError(err, "Failed to load tools");
        console.error("[Tools] Failed to load tool catalog", err);
        setToolError(message);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (!toolCatalog.length) return;
    setSessions((prev) =>
      prev.map((session) => {
        const merged: Record<string, boolean> = {
          ...toolDefaults,
          ...session.toolChoices,
        };
        return { ...session, toolChoices: merged };
      })
    );
  }, [toolCatalog, toolDefaults]);

  useEffect(() => {
    if (webSearchReady) return;
    setSessions((prev) =>
      prev.map((session) => ({
        ...session,
        toolChoices: { ...(session.toolChoices ?? {}), web_search: false },
      }))
    );
  }, [webSearchReady]);

  useEffect(() => {
    persistSettings(globalThis.localStorage, settings);
  }, [settings]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [activeSession?.messages.length]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    setThinkingStreamText(thinkingStreamsRef.current[activeSessionId] ?? "");
  }, [activeSessionId]);

  useEffect(() => {
    if (settings.chatOnly) {
      setIsToolMenuOpen(false);
    }
  }, [settings.chatOnly]);

  useEffect(() => {
    if (!thinking) return;
    const tick = () =>
      setThinkingElapsed(Date.now() - (thinking?.startedAt ?? Date.now()));

    tick();
    const intervalId = window.setInterval(tick, 300);

    return () => {
      window.clearInterval(intervalId);
      setThinkingElapsed(0);
    };
  }, [thinking]);

  useEffect(() => {
    const runtimeAvailable =
      typeof globalThis !== "undefined" &&
      (globalThis as { runtime?: unknown }).runtime;
    if (!runtimeAvailable) return;

    const disposers = [
      EventsOn(THINKING_START_EVENT, (payload: ThinkingEventPayload) => {
        if (!payload?.sessionId) return;
        thinkingStreamsRef.current[payload.sessionId] = "";
        if (payload.sessionId !== activeSessionIdRef.current) return;
        setThinking({ sessionId: payload.sessionId, startedAt: Date.now() });
        setThinkingElapsed(0);
        setThinkingStreamText("");
      }),
      EventsOn(THINKING_UPDATE_EVENT, (payload: ThinkingEventPayload) => {
        if (!payload?.sessionId || !payload.chunk) return;
        const next =
          (thinkingStreamsRef.current[payload.sessionId] ?? "") + payload.chunk;
        thinkingStreamsRef.current[payload.sessionId] = next;
        if (payload.sessionId === activeSessionIdRef.current) {
          setThinkingStreamText(next);
        }
      }),
      EventsOn(THINKING_END_EVENT, (payload: ThinkingEventPayload) => {
        if (!payload?.sessionId) return;
        thinkingStreamsRef.current[payload.sessionId] = "";
        if (payload.sessionId === activeSessionIdRef.current) {
          setThinking(null);
          setThinkingStreamText("");
        }
      }),
      EventsOn(ANSWER_UPDATE_EVENT, (payload: AnswerEventPayload) => {
        if (!payload?.sessionId || !payload.chunk) return;
        const placeholder = placeholderMap.current[payload.sessionId];
        if (!placeholder) return;
        placeholder.content += payload.chunk;
        applyAssistantContent(
          payload.sessionId,
          placeholder.id,
          placeholder.content,
          updateSession
        );
      }),
    ];

    return () => disposers.forEach((dispose) => dispose());
  }, []);

  useEffect(() => {
    if (!thinking || thinking.sessionId !== activeSession?.id) return;
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [thinking, activeSession?.id]);

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

  const handleRunTool = async (toolCall: ToolCall) => {
    if (toolCall.function.name !== "shell") {
      alert("Only shell tool is implemented for manual execution.");
      return;
    }

    let argsObj: any = {};
    try {
      argsObj = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse arguments", e);
      return;
    }

    const command = argsObj.command;
    const args = argsObj.args || [];

    if (!command) {
      alert("Invalid command arguments");
      return;
    }

    try {
      const output = await RunShellCommand(command, args, settings.chatOnly);

      // Append tool result to chat
      const toolMessage: ChatMessage = {
        id: createId(),
        role: "tool",
        content: output,
        createdAt: new Date().toISOString(),
      };

      updateSession(activeSession!.id, (session) => ({
        ...session,
        messages: [...session.messages, toolMessage],
        updatedAt: new Date().toISOString(),
      }));
    } catch (err) {
      alert("Error executing command: " + err);
    }
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !activeSession || isSending) return;
    if (!activeConfig) {
      alert("Add a model configuration before sending a message.");
      return;
    }
    const sessionId = activeSession.id;

    const selectedTools = settings.chatOnly
      ? []
      : toolCatalog
          .filter((tool) => tool.enabled)
          .filter((tool) => tool.id !== "web_search" || webSearchReady)
          .filter((tool) => {
            if (!tool.uiVisible) {
              return !hiddenDisabled.has(tool.id);
            }
            return !!(activeSession.toolChoices ?? toolDefaults)[tool.id];
          })
          .map((tool) => tool.id);

    const history = (activeSession?.messages ?? [])
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => ({ role: msg.role, content: msg.content }));

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const assistantPlaceholder: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "Assistant is thinking...",
      createdAt: new Date().toISOString(),
    };

    updateSession(sessionId, (session) => {
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

    placeholderMap.current[sessionId] = {
      id: assistantPlaceholder.id,
      content: "",
    };
    setDraft("");
    setIsSending(true);
    setThinking({ sessionId, startedAt: Date.now() });
    const payload = llm.ChatRequest.createFrom({
      sessionId: activeSession.id,
      provider: activeConfig.provider,
      endpoint: activeConfig.endpoint,
      apiKey: activeConfig.apiKey,
      model: activeConfig.model,
      message: text,
      history,
      tools: selectedTools,
      chatOnly: settings.chatOnly,
      webSearchApiKey: settings.webSearchApiKey,
    });

    console.log("[Chat Request]", {
      provider: payload.provider,
      endpoint: payload.endpoint,
      model: payload.model,
      toolCount: payload.tools.length,
      chatOnly: payload.chatOnly,
    });

    Chat(payload)
      .then((response: ChatResponsePayload) => {
        const traceMessages = (response.trace ?? []).map((step) => {
          const createdAt = step.createdAt ?? new Date().toISOString();
          const role: Role = step.role === "tool" ? "tool" : "assistant";
          const statusPrefix = step.status ? `[${step.status}] ` : "";
          const titlePrefix = step.title ? `${step.title}: ` : "";
          const kindPrefix = step.kind ? `${step.kind} · ` : "";
          return {
            id: createId(),
            role,
            content:
              `${kindPrefix}${statusPrefix}${titlePrefix}${step.content}`.trim(),
            createdAt,
            isTrace: true,
            traceKind: step.kind,
          } satisfies ChatMessage;
        });

        updateSession(activeSession.id, (session) => {
          const now = new Date().toISOString();
          const withoutPlaceholder = session.messages.filter(
            (msg) => msg.id !== assistantPlaceholder.id
          );
          const finalMessage: ChatMessage = {
            id: assistantPlaceholder.id,
            role: (response.message.role as Role) ?? "assistant",
            content: response.message.content,
            createdAt: now,
            toolCalls: response.message.tool_calls,
          };

          return {
            ...session,
            messages: [...withoutPlaceholder, ...traceMessages, finalMessage],
            updatedAt: now,
          };
        });

        setLastLatencyMs(response.latencyMs ?? null);
      })
      .catch((err: unknown) => {
        const errorText = describeError(err);
        const providerHint = formatProviderTarget(
          activeConfig?.provider,
          activeConfig?.endpoint
        );
        console.error("[Chat] Provider request failed", err);
        applyAssistantContent(
          sessionId,
          assistantPlaceholder.id,
          `${
            providerHint ? `Provider error (${providerHint})` : "Provider error"
          }: ${errorText}`,
          updateSession
        );
        setLastLatencyMs(null);
      })
      .finally(() => {
        setIsSending(false);
        setThinking(null);
        delete placeholderMap.current[sessionId];
        if (activeSessionIdRef.current === sessionId) {
          setThinkingStreamText("");
        }
      });
  };

  const handleEnterKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    const next = createEmptySession(toolDefaults);
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(next.id);
  };

  const handleRequestDeleteSession = (
    sessionId: string,
    event?: React.MouseEvent<HTMLButtonElement>
  ) => {
    event?.stopPropagation();
    event?.preventDefault();
    setPendingDeletionId(sessionId);
  };

  const handleCancelDelete = () => setPendingDeletionId(null);

  const handleConfirmDelete = () => {
    if (!pendingDeletionId) return;
    const targetId = pendingDeletionId;
    setPendingDeletionId(null);

    setSessions((prev) => {
      const remaining = prev.filter((session) => session.id !== targetId);
      if (!remaining.length) {
        const fallback = createEmptySession(toolDefaults);
        setActiveSessionId(fallback.id);
        return [fallback];
      }

      if (activeSessionId === targetId) {
        const nextActive = [...remaining].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        setActiveSessionId(nextActive.id);
      }

      return remaining;
    });
  };

  const handleDeleteDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDialogElement>
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelDelete();
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  const handleSettingsSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setShowSettings(false);
  };

  const handleSelectConfig = (configId: string) => {
    setSettings((prev) => ({ ...prev, activeConfigId: configId }));
  };

  const handleConfigChange = (
    configId: string,
    key: keyof ModelConfig,
    value: string
  ) => {
    setSettings((prev) => {
      const nextConfigs = prev.configs.map((config) =>
        config.id === configId ? { ...config, [key]: value } : config
      );
      return { ...prev, configs: nextConfigs };
    });

    if (key === "provider" || key === "endpoint" || key === "apiKey") {
      setModelsByConfig((prev) => {
        const next = { ...prev };
        delete next[configId];
        return next;
      });
      setModelErrors((prev) => {
        const next = { ...prev };
        delete next[configId];
        return next;
      });
    }
  };

  const handleAddConfig = () => {
    setSettings((prev) => {
      const template =
        prev.configs[prev.configs.length - 1] ??
        prev.configs.find((cfg) => cfg.id === prev.activeConfigId) ??
        createModelConfig();

      const next = createModelConfig({
        provider: template.provider,
        endpoint: template.endpoint,
        apiKey: template.apiKey,
        model: template.model,
        name: `Config ${prev.configs.length + 1}`,
      });

      return {
        ...prev,
        configs: [...prev.configs, next],
        activeConfigId: next.id,
      };
    });
  };

  const handleDeleteConfig = (configId: string) => {
    setSettings((prev) => {
      if (prev.configs.length <= 1) return prev;
      const filtered = prev.configs.filter((config) => config.id !== configId);
      const nextActiveId =
        prev.activeConfigId === configId
          ? filtered[0]?.id ?? prev.activeConfigId
          : prev.activeConfigId;

      return {
        ...prev,
        configs: filtered,
        activeConfigId: nextActiveId,
      };
    });

    setModelsByConfig((prev) => {
      const next = { ...prev };
      delete next[configId];
      return next;
    });
    setModelErrors((prev) => {
      const next = { ...prev };
      delete next[configId];
      return next;
    });
    setIsLoadingModels((prev) => {
      const next = { ...prev };
      delete next[configId];
      return next;
    });
  };

  const handleToggleChatOnly = (checked: boolean) => {
    setSettings((prev) => ({ ...prev, chatOnly: checked }));
  };

  const handleToggleTool = (toolId: string) => {
    if (settings.chatOnly) return;
    if (toolId === "web_search" && !webSearchReady) return;
    setIsToolMenuOpen(false);
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== activeSessionId) return session;
        const next = { ...(session.toolChoices ?? toolDefaults) };
        next[toolId] = !next[toolId];
        return {
          ...session,
          toolChoices: next,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };

  const handleToggleHiddenTool = (toolId: string) => {
    setSettings((prev) => {
      const disabled = new Set(prev.hiddenToolsDisabled ?? []);
      if (disabled.has(toolId)) {
        disabled.delete(toolId);
      } else {
        disabled.add(toolId);
      }
      return { ...prev, hiddenToolsDisabled: Array.from(disabled) };
    });
  };

  const handleLoadModels = (configId: string) => {
    const config = settings.configs.find((item) => item.id === configId);
    if (!config) return;

    setIsLoadingModels((prev) => ({ ...prev, [configId]: true }));
    setModelErrors((prev) => ({ ...prev, [configId]: null }));

    Models({
      provider: config.provider,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
    })
      .then((res) => {
        const next = res?.models ?? [];
        setModelsByConfig((prev) => ({ ...prev, [configId]: next }));
        setSettings((prev) => {
          const configs = prev.configs.map((item) => {
            if (item.id !== configId) return item;
            if (
              next.length > 0 &&
              (!item.model || !next.includes(item.model))
            ) {
              return { ...item, model: next[0] };
            }
            return item;
          });
          return { ...prev, configs };
        });
      })
      .catch((err: unknown) => {
        const message = describeError(err, "Failed to load models");
        console.error(
          `[Models] Failed to load models for config ${config.name}`,
          err
        );
        setModelErrors((prev) => ({ ...prev, [configId]: message }));
      })
      .finally(() =>
        setIsLoadingModels((prev) => ({ ...prev, [configId]: false }))
      );
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
          {sessions.map((session) => {
            const isActive = session.id === activeSession?.id;
            return (
              <div
                key={session.id}
                className={`session-row ${isActive ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="session-item"
                  onClick={() => handleSelectSession(session.id)}
                >
                  <span className="session-title">
                    {session.title || "New Chat"}
                  </span>
                  <span className="session-meta">
                    {new Date(session.updatedAt).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="session-delete"
                  onClick={(event) =>
                    handleRequestDeleteSession(session.id, event)
                  }
                  aria-label={`Delete chat ${session.title || "chat"}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            );
          })}
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
            <div className="chip">
              Config: {activeConfig?.name || "No config"} ·{" "}
              {activeConfig?.provider || "unset"}
            </div>
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
            activeSession.messages.map((message) => {
              if (message.isTrace) {
                // Hide final trace if it's just a duplicate of the final answer
                if (message.traceKind === "final") return null;
                return (
                  <ToolTraceMessage
                    key={message.id}
                    content={message.content}
                    kind={message.traceKind}
                  />
                );
              }

              // Try to parse JSON content for assistant messages if it looks like a tool result
              let displayContent = message.content;
              if (
                message.role === "assistant" &&
                displayContent.trim().startsWith("{")
              ) {
                try {
                  const parsed = JSON.parse(displayContent);
                  if (parsed.summary) {
                    displayContent = parsed.summary;
                  }
                } catch {
                  // ignore
                }
              }

              return (
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
                  <div className="message-body">
                    <ReactMarkdown skipHtml components={markdownComponents}>
                      {displayContent}
                    </ReactMarkdown>
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="tool-calls">
                        {message.toolCalls.map((tc, idx) => (
                          <div key={idx} className="tool-call-card">
                            <div className="tool-call-header">
                              Tool Request: {tc.function.name}
                            </div>
                            <pre className="tool-call-args">
                              {tc.function.arguments}
                            </pre>
                            <button onClick={() => handleRunTool(tc)}>
                              Run Command
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty-state">
              <p>Start by asking a question or describing a task.</p>
              <p className="muted">
                Messages stay local and persist across restarts.
              </p>
            </div>
          )}

          {thinking?.sessionId === activeSession?.id && (
            <div
              className="message thinking message-assistant"
              role="status"
              aria-label="Thinking indicator"
            >
              <div
                className="thinking-icon"
                aria-hidden="true"
                data-testid="idea-bulb"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  role="img"
                  aria-hidden="true"
                >
                  <path
                    d="M12 2.5c-3 0-5.5 2.43-5.5 5.42 0 1.95 1.08 3.63 2.62 4.57l.38.23v2.13c0 .36.29.65.65.65h3.9c.36 0 .65-.29.65-.65v-2.13l.38-.23c1.54-.94 2.62-2.62 2.62-4.57C17.5 4.93 15 2.5 12 2.5Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M10 19.75h4M10.5 22h3"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M9.75 15h4.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="thinking-copy">
                <div className="thinking-row">
                  <span className="thinking-label">Thinking</span>
                  <span className="thinking-timer" data-testid="thinking-timer">
                    {formatElapsed(thinkingElapsed)}
                  </span>
                </div>
                <p className="thinking-hint">
                  The assistant is working on your request.
                </p>
                {thinkingStreamText && (
                  <p className="thinking-stream" aria-live="polite">
                    {thinkingStreamText}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="composer" aria-label="Chat input">
          <div className="composer-box">
            <div className="tool-pill-row" aria-label="Tool toggles">
              {enabledVisibleTools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="tool-pill"
                  onClick={() => handleToggleTool(tool.id)}
                  title={tool.description}
                  aria-label={`Disable ${tool.name}`}
                  disabled={
                    settings.chatOnly ||
                    (tool.id === "web_search" && !webSearchReady)
                  }
                >
                  <span className="pill-label">{tool.name}</span>
                  <span aria-hidden="true" className="pill-close">
                    x
                  </span>
                </button>
              ))}
              <div className="tool-add-wrapper">
                <button
                  type="button"
                  className="tool-add"
                  aria-label="Add tools"
                  aria-expanded={isToolMenuOpen}
                  onClick={() => setIsToolMenuOpen((open) => !open)}
                  disabled={settings.chatOnly}
                >
                  +
                </button>
                {isToolMenuOpen && (
                  <div className="tool-menu" role="menu">
                    {disabledVisibleTools.length ? (
                      disabledVisibleTools.map((tool) => (
                        <button
                          key={tool.id}
                          type="button"
                          role="menuitem"
                          onClick={() => handleToggleTool(tool.id)}
                          disabled={
                            settings.chatOnly ||
                            (tool.id === "web_search" && !webSearchReady)
                          }
                        >
                          Enable {tool.name}
                        </button>
                      ))
                    ) : (
                      <span className="tool-menu-empty">All tools enabled</span>
                    )}
                  </div>
                )}
              </div>
              {toolError && <span className="error-text">{toolError}</span>}
              {missingWebSearchKey && (
                <span className="error-text">
                  Add your Brave Search API key in Settings to enable Web Search.
                </span>
              )}
            </div>
            <div className="composer-input-row">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleEnterKey}
                placeholder="Message shell-werk"
                rows={3}
              />
              <button
                className="send-button"
                onClick={handleSend}
                disabled={!draft.trim()}
                aria-label="Send"
              >
                <svg
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M4.5 12L5.5 11L17 5.5C17.6 5.2 18.3 5.8 18 6.4L13.5 18.5C13.2 19.1 12.3 19.1 12 18.5L10.2 14.6C10 14.2 10.3 13.7 10.8 13.7H17"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
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
              <div className="modal-section">
                <div className="config-header-row">
                  <div>
                    <p className="section-title">Model configurations</p>
                    <p className="section-hint">
                      Create cards for each provider + endpoint + model combo
                      and pick one as the active chat target.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleAddConfig}
                  >
                    Add configuration
                  </button>
                </div>
                <div
                  className="config-card-list"
                  role="list"
                  aria-label="Model configurations"
                >
                  {settings.configs.map((config, index) => {
                    const models = modelsByConfig[config.id] ?? [];
                    const modelError = modelErrors[config.id];
                    const loading = isLoadingModels[config.id] ?? false;
                    const isActive = config.id === settings.activeConfigId;
                    return (
                      <div
                        key={config.id}
                        className={`config-card ${isActive ? "active" : ""}`}
                        role="listitem"
                      >
                        <div className="config-card-top">
                          <label>
                            <span className="label-text">Name</span>
                            <input
                              type="text"
                              value={config.name}
                              placeholder={`Config ${index + 1}`}
                              onChange={(e) =>
                                handleConfigChange(
                                  config.id,
                                  "name",
                                  e.target.value
                                )
                              }
                            />
                          </label>
                          <div className="config-card-actions">
                            <label className="inline-toggle">
                              <input
                                type="radio"
                                name="active-config"
                                checked={isActive}
                                onChange={() => handleSelectConfig(config.id)}
                              />
                              <span>Active</span>
                            </label>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleDeleteConfig(config.id)}
                              disabled={settings.configs.length <= 1}
                              aria-label={`Delete ${
                                config.name || `config ${index + 1}`
                              }`}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="config-grid">
                          <label>
                            <span className="label-text">Provider</span>
                            <select
                              value={config.provider}
                              onChange={(e) =>
                                handleConfigChange(
                                  config.id,
                                  "provider",
                                  e.target.value
                                )
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
                              value={config.endpoint}
                              onChange={(e) =>
                                handleConfigChange(
                                  config.id,
                                  "endpoint",
                                  e.target.value
                                )
                              }
                              placeholder="http://localhost:11434"
                            />
                          </label>
                          <label>
                            <span className="label-text">API key (Bearer)</span>
                            <input
                              type="password"
                              value={config.apiKey}
                              onChange={(e) =>
                                handleConfigChange(
                                  config.id,
                                  "apiKey",
                                  e.target.value
                                )
                              }
                              placeholder="sk-..."
                              autoComplete="off"
                            />
                          </label>
                          <label>
                            <span className="label-text">Model</span>
                            {models.length ? (
                              <select
                                value={config.model}
                                onChange={(e) =>
                                  handleConfigChange(
                                    config.id,
                                    "model",
                                    e.target.value
                                  )
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
                                value={config.model}
                                onChange={(e) =>
                                  handleConfigChange(
                                    config.id,
                                    "model",
                                    e.target.value
                                  )
                                }
                                placeholder="qwen-3"
                              />
                            )}
                          </label>
                        </div>
                        <div className="inline-actions config-card-footer">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleLoadModels(config.id)}
                            disabled={loading}
                          >
                            {loading ? "Loading models..." : "Load models"}
                          </button>
                          {modelError && (
                            <span className="error-text">{modelError}</span>
                          )}
                          {!modelError && models.length > 0 && (
                            <span className="muted">
                              {models.length} models available
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="modal-section">
                <p className="section-title">Conversation defaults</p>
                <p className="section-hint">
                  Apply global chat behaviors before sending messages.
                </p>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={settings.chatOnly}
                    onChange={(e) => handleToggleChatOnly(e.target.checked)}
                  />
                  <span>Chat Only mode (disable tools)</span>
                </label>
              </div>
              {visibleTools.some((tool) => tool.id === "web_search") && (
                <div className="modal-section">
                  <p className="section-title">Web search</p>
                  <p className="section-hint">
                    Uses Brave Search. Add your API key to enable this tool.
                  </p>
                  <label>
                    <span className="label-text">Brave API key</span>
                    <input
                      type="password"
                      value={settings.webSearchApiKey}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          webSearchApiKey: e.target.value,
                        }))
                      }
                      placeholder="X-Subscription-Token"
                      autoComplete="off"
                    />
                  </label>
                  {!webSearchReady && (
                    <p className="muted">
                      Web Search stays disabled until a valid key is provided.
                    </p>
                  )}
                </div>
              )}
              {toolCatalog.some((tool) => !tool.uiVisible) && (
                <div className="modal-section">
                  <p className="section-title">Hidden tools</p>
                  <p className="section-hint">
                    Toggle global availability for tools that are not shown in
                    the chat UI.
                  </p>
                  <div className="hidden-tools" aria-label="Hidden tools">
                    <div className="hidden-tool-grid">
                      {toolCatalog
                        .filter((tool) => !tool.uiVisible)
                        .map((tool) => {
                          const enabled = !hiddenDisabled.has(tool.id);
                          return (
                            <label key={tool.id} className="inline-toggle">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => handleToggleHiddenTool(tool.id)}
                              />
                              <span>
                                {tool.name} (hidden tool)
                                <span className="muted">
                                  {" "}
                                  — {tool.description}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}
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

      {pendingDeletionSession && (
        <div className="modal-backdrop">
          <dialog
            className="modal delete-modal"
            open
            aria-modal="true"
            role="dialog"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onKeyDown={handleDeleteDialogKeyDown}
          >
            <div className="modal-header">
              <h3 id="delete-dialog-title">Delete chat</h3>
              <button className="ghost" onClick={handleCancelDelete}>
                Cancel
              </button>
            </div>
            <div className="modal-body">
              <p id="delete-dialog-description" className="warning-text">
                Deleting{" "}
                <strong>{pendingDeletionSession.title || "this chat"}</strong>{" "}
                is permanent and cannot be undone.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={handleCancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary destructive"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
}

export default App;
