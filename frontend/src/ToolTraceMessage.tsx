import React, { useState } from "react";
import "./tool-calls.css";

interface ToolTraceMessageProps {
  content: string;
  kind?: string;
}

export const ToolTraceMessage: React.FC<ToolTraceMessageProps> = ({
  content,
  kind,
}) => {
  const [collapsed, setCollapsed] = useState(kind === "tool_result");

  // Parse content to separate prefix from actual details if possible
  // Format: "kind · [status] title: content"
  // We can just display it as is, but maybe style the prefix.

  return (
    <div className="tool-trace-message">
      <button
        type="button"
        className="tool-trace-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`trace-kind ${kind}`}>{kind || "trace"}</span>
        <span className="trace-preview">
          {collapsed
            ? content.slice(0, 80) + (content.length > 80 ? "..." : "")
            : "Details"}
        </span>
        <span className="trace-toggle">{collapsed ? "▼" : "▲"}</span>
      </button>
      {!collapsed && <div className="tool-trace-content">{content}</div>}
    </div>
  );
};
