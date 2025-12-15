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
        </div>
      )}

      {thinking?.sessionId === activeSessionId && (
        <output
          className="message thinking message-assistant"
          aria-label="Thinking indicator"
        >
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
        </output>
      )}
    </div>
  );
};
