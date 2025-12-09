import type React from "react";
import ReactMarkdown from "react-markdown";
import type { FeedItem, ThinkingState, ToolCall } from "../types/chat";
import { TraceGroup } from "./TraceGroup";

const markdownComponents = {
  a: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props} target="_blank" rel="noreferrer">
      {children ?? props.href}
    </a>
  ),
};

const formatElapsed = (elapsedMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

interface ChatFeedProps {
  items: FeedItem[];
  thinking: ThinkingState | null;
  thinkingElapsed: number;
  thinkingStreamText: string;
  chatScrollRef: React.RefObject<HTMLDivElement>;
  activeSessionId?: string;
  onRunTool: (toolCall: ToolCall) => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  items,
  thinking,
  thinkingElapsed,
  thinkingStreamText,
  chatScrollRef,
  activeSessionId,
  onRunTool,
}) => {
  return (
    <div className="chat-feed" ref={chatScrollRef}>
      {items.length ? (
        items.map((item) => {
          if (item.kind === "trace-group") {
            return <TraceGroup key={item.id} traces={item.traces} />;
          }

          const message = item.message;

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
            <div key={message.id} className={`message message-${message.role}`}>
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
                        <button onClick={() => onRunTool(tc)}>
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
          <p className="muted">Messages stay local and persist across restarts.</p>
        </div>
      )}

      {thinking?.sessionId === activeSessionId && (
        <div
          className="message thinking message-assistant"
          role="status"
          aria-label="Thinking indicator"
        >
          <div className="thinking-icon" aria-hidden="true" data-testid="idea-bulb">
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
  );
};
