import React, { useMemo, useState } from "react";
import "./tool-calls.css";

interface ToolTraceMessageProps {
  content: string;
  kind?: string;
  title?: string;
  status?: string;
  initiallyCollapsed?: boolean;
}

export const ToolTraceMessage: React.FC<ToolTraceMessageProps> = ({
  content,
  kind,
  title,
  status,
  initiallyCollapsed = true,
}) => {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  const { detectedStatus, preview, body } = useMemo(() => {
    const statusRegex = /^\s*\[([^\]]+)\]\s*/;
    const statusMatch = statusRegex.exec(content);
    const detectedStatus = statusMatch?.[1];
    const withoutStatus = content.replace(statusRegex, "");
    const cleanPreview = withoutStatus.slice(0, 96).trim();

    return {
      detectedStatus,
      preview: cleanPreview || withoutStatus,
      body: withoutStatus,
    };
  }, [content]);

  const previewText = preview || "View details";
  const showEllipsis = body.length > previewText.length;
  const headerStatus = status || detectedStatus;

  return (
    <div
      className="tool-trace-message"
      data-kind={kind}
      data-collapsed={collapsed}
    >
      <button
        type="button"
        className="tool-trace-header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${
          kind || "trace"
        } details`}
      >
        <span className={`trace-kind ${kind || "trace"}`}>
          {kind || "trace"}
        </span>
        {title && <span className="trace-sep"> · </span>}
        {title && <span className="trace-title">{title}</span>}
        {headerStatus && <span className="trace-status">{headerStatus}</span>}
        <span className="trace-preview" title={body}>
          {previewText}
          {showEllipsis ? " …" : ""}
        </span>
        <span className="trace-toggle" aria-hidden="true">
          <span
            className={`chevron ${
              collapsed ? "chevron-collapsed" : "chevron-open"
            }`}
          >
            ▸
          </span>
        </span>
      </button>
      {!collapsed && (
        <section
          className="tool-trace-content"
          aria-label={`${kind || "trace"} details`}
        >
          {body}
        </section>
      )}
    </div>
  );
};
