import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FormEvent, useEffect, useRef, useState } from "react";
import "./App.css";

const STREAM_EVENT = "llm-stream";

type ChatRole = "user" | "assistant" | "tool" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  toolCallId?: string | null;
};

type Provider = "vllm" | "ollama";

type ProviderConfig = {
  baseUrl: string;
  apiKey?: string | null;
};

type ProviderCollection = Record<Provider, ProviderConfig>;

type LlmConfiguration = {
  activeProvider: Provider;
  selectedModel?: string | null;
  providers: ProviderCollection;
};

type LlmModel = {
  id: string;
  label: string;
  provider: Provider;
};

type StreamEvent =
  | { type: "answer"; requestId: string; delta: string }
  | { type: "done"; requestId: string }
  | { type: "error"; requestId: string; message?: string };

const providerLabels: Record<Provider, string> = {
  vllm: "vLLM",
  ollama: "Ollama",
};

const providers: Provider[] = ["vllm", "ollama"];

const providerHints: Record<Provider, string> = {
  vllm: "Point to the OpenAI-compatible endpoint exposed by your vLLM runtime.",
  ollama: "Use the Ollama daemon URL. Defaults to http://127.0.0.1:11434.",
};

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      role: "system",
      content:
        "Welcome! Connect to a provider and select a model to begin chatting.",
    },
    {
      id: "welcome-2",
      role: "assistant",
      content: "Configuration ready.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [config, setConfig] = useState<LlmConfiguration | null>(null);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeStreamRef = useRef<{
    requestId: string;
    assistantId: string;
  } | null>(null);

  const appendStreamDelta = (assistantId: string, delta: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, content: message.content + delta }
          : message
      )
    );
  };

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    const fetchConfig = async () => {
      setIsLoadingConfig(true);
      try {
        const result = await invoke<LlmConfiguration>("get_llm_configuration");
        if (!cancelled) {
          setConfig(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeError(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingConfig(false);
        }
      }
    };

    fetchConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const handler = (payload: StreamEvent) => {
      const active = activeStreamRef.current;
      if (!active || active.requestId !== payload.requestId) {
        return;
      }

      if (payload.type === "answer") {
        appendStreamDelta(active.assistantId, payload.delta ?? "");
      } else if (payload.type === "done") {
        activeStreamRef.current = null;
        setIsSending(false);
      } else if (payload.type === "error") {
        setError(payload.message ?? "Stream error");
        activeStreamRef.current = null;
        setIsSending(false);
      }
    };

    const attach = async () => {
      try {
        const dispose = await listen<StreamEvent>(STREAM_EVENT, ({ payload }) =>
          handler(payload)
        );
        if (cancelled) {
          dispose();
        } else {
          cleanup = dispose;
        }
      } catch (err) {
        console.warn("Falling back to DOM listener for stream events", err);
        const domHandler = (event: Event) => {
          const custom = event as CustomEvent<StreamEvent>;
          if (!custom.detail) return;
          handler(custom.detail);
        };
        globalThis.addEventListener(STREAM_EVENT, domHandler as EventListener);
        cleanup = () =>
          globalThis.removeEventListener(
            STREAM_EVENT,
            domHandler as EventListener
          );
      }
    };

    void attach();

    return () => {
      cancelled = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  const normalizeStatus = (message: string) => {
    setStatus(message);
    globalThis.setTimeout(() => setStatus(null), 4000);
  };

  const persistConfiguration = async (nextConfig: LlmConfiguration) => {
    setSaving(true);
    try {
      const updated = await invoke<LlmConfiguration>("save_llm_configuration", {
        payload: nextConfig,
      });
      setConfig(updated);
      normalizeStatus("Settings saved");
      setError(null);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (provider: Provider) => {
    setConfig((prev) => {
      if (!prev || prev.activeProvider === provider) {
        return prev;
      }

      const nextConfig = { ...prev, activeProvider: provider };
      void persistConfiguration(nextConfig);
      setModels([]);
      return nextConfig;
    });
  };

  const updateProviderField = (
    provider: Provider,
    field: keyof ProviderConfig,
    value: string
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        providers: {
          ...prev.providers,
          [provider]: {
            ...prev.providers[provider],
            [field]: value,
          },
        },
      };
    });
  };

  const handleSaveClick = () => {
    if (config) {
      void persistConfiguration(config);
    }
  };

  const refreshModels = async () => {
    if (!config) return;
    setLoadingModels(true);
    try {
      const result = await invoke<LlmModel[]>("list_llm_models", {
        provider: config.activeProvider,
      });
      setModels(result);
      normalizeStatus(
        `Loaded ${result.length} model${result.length === 1 ? "" : "s"}`
      );
      setError(null);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoadingModels(false);
    }
  };

  const handleModelSelect = async (modelId: string) => {
    if (!config) return;
    try {
      const updated = await invoke<LlmConfiguration>("select_llm_model", {
        modelId: modelId || null,
      });
      setConfig(updated);
      normalizeStatus(modelId ? `Selected ${modelId}` : "Model cleared");
      setError(null);
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  const startStream = async (
    input: string,
    history: ChatMessage[],
    requestId: string
  ) => {
    setIsSending(true);
    try {
      await invoke("chat_dialogue_stream", {
        payload: { input, history, requestId },
      });
      setError(null);
    } catch (err) {
      activeStreamRef.current = null;
      setIsSending(false);
      setError(normalizeError(err));
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    if (!config?.selectedModel) {
      setError("Select a model before chatting");
      return;
    }

    const requestId = crypto.randomUUID();

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: next,
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };

    setDraft("");
    setMessages((prev) => {
      const history = [...prev, userMessage];
      activeStreamRef.current = {
        requestId,
        assistantId: assistantMessage.id,
      };
      (globalThis as any).__STREAM_DEBUG__ = {
        requestId,
        assistantId: assistantMessage.id,
      };
      void startStream(next, history, requestId);
      return [...prev, userMessage, assistantMessage];
    });
  };

  return (
    <main className="workspace-shell">
      <header className="chat-header">
        <div>
          <div className="chat-title">Shell Werk</div>
          <div className="chat-subtitle">
            Configure providers, sync models, and keep the conversation flowing.
          </div>
        </div>
        <div className="llm-overview">
          <span className="llm-pill">
            {config ? providerLabels[config.activeProvider] : "Detecting..."}
          </span>
          {config?.selectedModel && (
            <span className="llm-pill muted">{config.selectedModel}</span>
          )}
        </div>
      </header>

      <section className="llm-panel" aria-live="polite">
        <div className="panel-heading">
          <div>
            <h2>LLM Provider Configuration</h2>
            <p>Store endpoint details once and reuse them across sessions.</p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={handleSaveClick}
            disabled={!config || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {error && <div className="llm-banner error">{error}</div>}
        {status && <div className="llm-banner success">{status}</div>}

        {isLoadingConfig && (
          <div className="llm-placeholder">Loading configuration…</div>
        )}

        {config && (
          <>
            <div className="provider-toggle">
              {providers.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className={`provider-chip ${
                    config.activeProvider === provider ? "active" : ""
                  }`}
                  onClick={() => handleProviderChange(provider)}
                >
                  {providerLabels[provider]}
                </button>
              ))}
            </div>

            {providers.map((provider) => (
              <fieldset className="provider-card" key={provider}>
                <legend>{providerLabels[provider]} endpoint</legend>
                <p className="provider-hint">{providerHints[provider]}</p>
                <label className="field-label" htmlFor={`${provider}-base`}>
                  Base URL
                </label>
                <input
                  id={`${provider}-base`}
                  className="field-input"
                  placeholder="https://"
                  value={config.providers[provider]?.baseUrl ?? ""}
                  onChange={(event) =>
                    updateProviderField(
                      provider,
                      "baseUrl",
                      event.currentTarget.value
                    )
                  }
                />
                {provider === "vllm" && (
                  <>
                    <label className="field-label" htmlFor="vllm-key">
                      API key (optional)
                    </label>
                    <input
                      id="vllm-key"
                      className="field-input"
                      type="password"
                      placeholder="sk-..."
                      value={config.providers.vllm.apiKey ?? ""}
                      onChange={(event) =>
                        updateProviderField(
                          "vllm",
                          "apiKey",
                          event.currentTarget.value
                        )
                      }
                    />
                  </>
                )}
              </fieldset>
            ))}

            <div className="models-card" aria-live="polite">
              <div className="models-header">
                <div>
                  <h3>Available models</h3>
                  <p>
                    Pulling from {providerLabels[config.activeProvider]} using
                    the saved settings.
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={refreshModels}
                  disabled={loadingModels}
                >
                  {loadingModels ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              <select
                className="models-select"
                value={config.selectedModel ?? ""}
                onChange={(event) =>
                  handleModelSelect(event.currentTarget.value)
                }
              >
                <option value="">Select a model</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              {!models.length && (
                <p className="muted">
                  Refresh to load models from the active provider.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section className="chat-panel" aria-label="Chat history">
        <div className="chat-window" ref={scrollRef}>
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message ${
                message.role === "user" ? "message-out" : "message-in"
              }`}
            >
              <div className="message-meta">
                {message.role === "user"
                  ? "You"
                  : message.role === "assistant"
                  ? "Assistant"
                  : message.role === "tool"
                  ? "Tool"
                  : "System"}
              </div>
              <div className="message-bubble">{message.content}</div>
            </article>
          ))}
        </div>
      </section>

      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <input
          className="chat-input"
          placeholder="Type your message..."
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          aria-label="Message input"
          disabled={isSending}
        />
        <button className="chat-send" type="submit" disabled={isSending}>
          {isSending ? "Sending..." : "Send"}
        </button>
      </form>
    </main>
  );
}

function normalizeError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong";
}

export default App;
