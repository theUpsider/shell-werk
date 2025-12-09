import type { ModelConfig, SettingsState } from "../settings";
import type { ToolMetadata } from "../types/chat";
import type React from "react";

interface SettingsModalProps {
  settings: SettingsState;
  visibleTools: ToolMetadata[];
  toolCatalog: ToolMetadata[];
  hiddenDisabled: Set<string>;
  webSearchReady: boolean;
  modelErrors: Record<string, string | null>;
  modelsByConfig: Record<string, string[]>;
  isLoadingModels: Record<string, boolean>;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onAddConfig: () => void;
  onSelectConfig: (configId: string) => void;
  onDeleteConfig: (configId: string) => void;
  onConfigChange: (
    configId: string,
    key: keyof ModelConfig,
    value: string
  ) => void;
  onLoadModels: (configId: string) => void;
  onToggleChatOnly: (enabled: boolean) => void;
  onToggleHiddenTool: (toolId: string) => void;
  onChangeWebSearchKey: (value: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  visibleTools,
  toolCatalog,
  hiddenDisabled,
  webSearchReady,
  modelErrors,
  modelsByConfig,
  isLoadingModels,
  onClose,
  onSubmit,
  onAddConfig,
  onSelectConfig,
  onDeleteConfig,
  onConfigChange,
  onLoadModels,
  onToggleChatOnly,
  onToggleHiddenTool,
  onChangeWebSearchKey,
}) => {
  return (
    <div className="modal-backdrop">
      <dialog
        className="modal"
        open
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-header">
          <h3 id="settings-title">Model settings</h3>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <form className="modal-body" onSubmit={onSubmit}>
          <div className="modal-section">
            <div className="config-header-row">
              <div>
                <p className="section-title">Model configurations</p>
                <p className="section-hint">
                  Create cards for each provider + endpoint + model combo and
                  pick one as the active chat target.
                </p>
              </div>
              <button type="button" className="ghost" onClick={onAddConfig}>
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
                            onConfigChange(config.id, "name", e.target.value)
                          }
                        />
                      </label>
                      <div className="config-card-actions">
                        <label className="inline-toggle">
                          <input
                            type="radio"
                            name="active-config"
                            checked={isActive}
                            onChange={() => onSelectConfig(config.id)}
                          />
                          <span>Active</span>
                        </label>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => onDeleteConfig(config.id)}
                          disabled={settings.configs.length <= 1}
                          aria-label={`Delete ${config.name || `config ${index + 1}`}`}
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
                            onConfigChange(config.id, "provider", e.target.value)
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
                            onConfigChange(config.id, "endpoint", e.target.value)
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
                            onConfigChange(config.id, "apiKey", e.target.value)
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
                              onConfigChange(config.id, "model", e.target.value)
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
                              onConfigChange(config.id, "model", e.target.value)
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
                        onClick={() => onLoadModels(config.id)}
                        disabled={loading}
                      >
                        {loading ? "Loading models..." : "Load models"}
                      </button>
                      {modelError && <span className="error-text">{modelError}</span>}
                      {!modelError && models.length > 0 && (
                        <span className="muted">{models.length} models available</span>
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
                onChange={(e) => onToggleChatOnly(e.target.checked)}
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
                  onChange={(e) => onChangeWebSearchKey(e.target.value)}
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
                Toggle global availability for tools that are not shown in the chat UI.
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
                            onChange={() => onToggleHiddenTool(tool.id)}
                          />
                          <span>
                            {tool.name} (hidden tool)
                            <span className="muted"> - {tool.description}</span>
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
};
