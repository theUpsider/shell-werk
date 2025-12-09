import type React from "react";
import { useEffect, useState } from "react";
import type { ToolMetadata } from "../types/chat";

interface ComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onEnterKey: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onCancel: () => void;
  isActiveSending: boolean;
  enabledVisibleTools: ToolMetadata[];
  disabledVisibleTools: ToolMetadata[];
  toolError: string | null;
  missingWebSearchKey: boolean;
  chatOnly: boolean;
  webSearchReady: boolean;
  onToggleTool: (toolId: string) => void;
}

export const Composer: React.FC<ComposerProps> = ({
  draft,
  onDraftChange,
  onEnterKey,
  onSend,
  onCancel,
  isActiveSending,
  enabledVisibleTools,
  disabledVisibleTools,
  toolError,
  missingWebSearchKey,
  chatOnly,
  webSearchReady,
  onToggleTool,
}) => {
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);

  useEffect(() => {
    if (chatOnly) {
      setIsToolMenuOpen(false);
    }
  }, [chatOnly]);

  return (
    <div className="composer" aria-label="Chat input">
      <div className="composer-box">
        <div className="tool-pill-row" aria-label="Tool toggles">
          {enabledVisibleTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="tool-pill"
              onClick={() => onToggleTool(tool.id)}
              title={tool.description}
              aria-label={`Disable ${tool.name}`}
              disabled={chatOnly || (tool.id === "web_search" && !webSearchReady)}
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
              disabled={chatOnly}
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
                      onClick={() => onToggleTool(tool.id)}
                      disabled={chatOnly || (tool.id === "web_search" && !webSearchReady)}
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
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onEnterKey}
            placeholder="Ask shell werk what to do..."
            rows={3}
          />
          <button
            className={`send-button ${isActiveSending ? "cancel" : ""}`}
            onClick={isActiveSending ? onCancel : onSend}
            disabled={!isActiveSending && !draft.trim()}
            aria-label={isActiveSending ? "Cancel generation" : "Send"}
          >
            {isActiveSending ? (
              <span className="send-button-inner">
                <span className="cancel-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="send-button-label">Cancel</span>
              </span>
            ) : (
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
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
