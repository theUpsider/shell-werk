import { useState } from "react";
import { ToolTraceMessage } from "../ToolTraceMessage";
import type { ChatMessage } from "../types/chat";

interface TraceGroupProps {
  traces: ChatMessage[];
}

export const TraceGroup: React.FC<TraceGroupProps> = ({ traces }) => {
  const [collapsed, setCollapsed] = useState(true);
  const first = traces[0];
  const title = `Tool calls (${traces.length})`;
  const createdTime = first?.createdAt
    ? new Date(first.createdAt).toLocaleTimeString()
    : "";

  return (
    <div className="trace-group-card" data-collapsed={collapsed}>
      <button
        type="button"
        className="trace-group-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <div className="trace-group-meta">
          <span className="trace-group-title">{title}</span>
          {createdTime && (
            <span className="trace-group-time" aria-label="Timestamp">
              {createdTime}
            </span>
          )}
        </div>
        <span className="trace-group-chevron" aria-hidden="true">
          {collapsed ? ">" : "v"}
        </span>
      </button>
      {!collapsed && (
        <div className="trace-group-body">
          {traces.map((trace) => (
            <ToolTraceMessage
              key={trace.id}
              content={trace.content}
              kind={trace.traceKind}
              initiallyCollapsed
            />
          ))}
        </div>
      )}
    </div>
  );
};
