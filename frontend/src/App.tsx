import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EventsOn } from "../wailsjs/runtime/runtime";
import {
  Chat,
  CancelChat,
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
import { ChatFeed } from "./components/ChatFeed";
import { ChatHeader } from "./components/ChatHeader";
import { Composer } from "./components/Composer";
import { DeleteChatDialog } from "./components/DeleteChatDialog";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import type {
  ChatMessage,
  ChatResponsePayload,
  ChatSession,
  DialogueTrace,
  FeedItem,
  Role,
  ThinkingState,
  ToolCall,
  ToolMetadata,
} from "./types/chat";
import "./App.css";
import "./tool-calls.css";

const THINKING_START_EVENT = "thinking:start";
const THINKING_UPDATE_EVENT = "thinking:update";
const THINKING_END_EVENT = "thinking:end";
const ANSWER_UPDATE_EVENT = "answer:update";

interface ThinkingEventPayload {
  sessionId: string;
  chunk?: string;
}

interface AnswerEventPayload {
  sessionId: string;
  chunk: string;
}

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
  const [inFlightSessionId, setInFlightSessionId] = useState<string | null>(
    null
  );
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
  const [thinking, setThinking] = useState<ThinkingState | null>(null);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const placeholderMap = useRef<
    Record<string, { id: string; content: string; token: string }>
  >({});
  const requestTokensRef = useRef<Record<string, string>>({});
  const canceledRequestsRef = useRef<Set<string>>(new Set());
  const thinkingStreamsRef = useRef<Record<string, string>>({});
  const activeSessionIdRef = useRef(activeSessionId);
  const [thinkingStreamText, setThinkingStreamText] = useState("");

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    const messages = activeSession?.messages ?? [];
    let buffer: ChatMessage[] = [];

    const flush = () => {
      if (!buffer.length) return;
      const groupId = buffer.map((entry) => entry.id).join("-") || createId();
      items.push({ kind: "trace-group", id: groupId, traces: buffer });
      buffer = [];
    };

    messages.forEach((message) => {
      if (message.isTrace) {
        if (message.traceKind === "final") return;
        buffer.push(message);
        return;
      }

      flush();
      items.push({ kind: "message", message });
    });

    flush();
    return items;
  }, [activeSession?.messages]);

  const isSending = inFlightSessionId !== null;
  const isActiveSending = isSending && inFlightSessionId === activeSession?.id;

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
        const activeToken = requestTokensRef.current[payload.sessionId];
        if (
          !placeholder ||
          placeholder.token !== activeToken ||
          (activeToken && canceledRequestsRef.current.has(activeToken))
        )
          return;
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

  useEffect(() => {
    if (!thinking || thinking.sessionId !== activeSession?.id) return;
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [thinkingStreamText, thinkingElapsed, activeSession?.id]);

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
    if (!text || !activeSession || inFlightSessionId) return;
    if (!activeConfig) {
      alert("Add a model configuration before sending a message.");
      return;
    }
    const sessionId = activeSession.id;
    const requestToken = createId();

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
      token: requestToken,
    };
    requestTokensRef.current[sessionId] = requestToken;
    canceledRequestsRef.current.delete(requestToken);
    setDraft("");
    setInFlightSessionId(sessionId);
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
        const activeToken = requestTokensRef.current[sessionId];
        if (activeToken !== requestToken) return;
        if (canceledRequestsRef.current.has(requestToken)) return;
        const traceMessages = (response.trace ?? []).map((step) => {
          const createdAt = step.createdAt ?? new Date().toISOString();
          const role: Role = step.role === "tool" ? "tool" : "assistant";
          const statusPrefix = step.status ? `[${step.status}] ` : "";
          const titlePrefix = step.title ? `${step.title}: ` : "";
          const kindPrefix = step.kind ? `${step.kind} - ` : "";
          return {
            id: createId(),
            role,
            content:
              `${kindPrefix}${statusPrefix}${titlePrefix}${step.content}`.trim(),
            createdAt,
            isTrace: true,
            traceKind: step.kind,
            traceTitle: step.title,
            traceStatus: step.status,
          } satisfies ChatMessage;
        });

        updateSession(sessionId, (session) => {
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
        const activeToken = requestTokensRef.current[sessionId];
        if (activeToken !== requestToken) return;
        if (canceledRequestsRef.current.has(requestToken)) return;
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
        const activeToken = requestTokensRef.current[sessionId];
        if (activeToken !== requestToken) return;
        canceledRequestsRef.current.delete(requestToken);
        setInFlightSessionId((current) =>
          current === sessionId ? null : current
        );
        setThinking((currentThinking) =>
          currentThinking?.sessionId === sessionId ? null : currentThinking
        );
        delete placeholderMap.current[sessionId];
        delete requestTokensRef.current[sessionId];
        if (activeSessionIdRef.current === sessionId) {
          setThinkingStreamText("");
        }
      });
  };

  const handleCancelSend = () => {
    const sessionId = inFlightSessionId;
    if (!sessionId) return;
    const activeToken = requestTokensRef.current[sessionId];
    if (activeToken) {
      canceledRequestsRef.current.add(activeToken);
    }
    const placeholder = placeholderMap.current[sessionId];
    if (placeholder && placeholder.token === activeToken) {
      applyAssistantContent(
        sessionId,
        placeholder.id,
        "Request canceled",
        updateSession
      );
    }
    setLastLatencyMs(null);
    setInFlightSessionId((current) => (current === sessionId ? null : current));
    setThinking((currentThinking) =>
      currentThinking?.sessionId === sessionId ? null : currentThinking
    );
    if (activeSessionIdRef.current === sessionId) {
      setThinkingStreamText("");
    }
    CancelChat(sessionId).catch((err) => {
      console.error("[Chat] Failed to cancel session", err);
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
    <div className="window-shell">
      <TitleBar />

      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSession?.id}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onOpenSettings={() => setShowSettings(true)}
          onRequestDeleteSession={handleRequestDeleteSession}
        />

        <main className="chat-pane">
          <ChatHeader
            title={activeSession?.title || "New Chat"}
            configName={activeConfig?.name}
            provider={activeConfig?.provider}
            isSending={isSending}
            lastLatencyMs={lastLatencyMs}
          />

          <ChatFeed
            items={feedItems}
            thinking={thinking}
            thinkingElapsed={thinkingElapsed}
            thinkingStreamText={thinkingStreamText}
            chatScrollRef={chatScrollRef}
            activeSessionId={activeSession?.id}
            onRunTool={handleRunTool}
          />

          <Composer
            draft={draft}
            onDraftChange={setDraft}
            onEnterKey={handleEnterKey}
            onSend={handleSend}
            onCancel={handleCancelSend}
            isActiveSending={isActiveSending}
            enabledVisibleTools={enabledVisibleTools}
            disabledVisibleTools={disabledVisibleTools}
            toolError={toolError}
            chatOnly={settings.chatOnly}
            webSearchReady={webSearchReady}
            onToggleTool={handleToggleTool}
          />
        </main>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          visibleTools={visibleTools}
          toolCatalog={toolCatalog}
          hiddenDisabled={hiddenDisabled}
          webSearchReady={webSearchReady}
          modelErrors={modelErrors}
          modelsByConfig={modelsByConfig}
          isLoadingModels={isLoadingModels}
          onClose={() => setShowSettings(false)}
          onSubmit={handleSettingsSubmit}
          onAddConfig={handleAddConfig}
          onSelectConfig={handleSelectConfig}
          onDeleteConfig={handleDeleteConfig}
          onConfigChange={handleConfigChange}
          onLoadModels={handleLoadModels}
          onToggleChatOnly={handleToggleChatOnly}
          onToggleHiddenTool={handleToggleHiddenTool}
          onChangeWebSearchKey={(value) =>
            setSettings((prev) => ({ ...prev, webSearchApiKey: value }))
          }
        />
      )}

      {pendingDeletionSession && (
        <DeleteChatDialog
          sessionTitle={pendingDeletionSession.title || "this chat"}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
          onKeyDown={handleDeleteDialogKeyDown}
        />
      )}
    </div>
  );
}

export default App;
