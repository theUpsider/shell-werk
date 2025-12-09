import type React from "react";

interface ChatHeaderProps {
  title: string;
  configName?: string;
  provider?: string;
  isSending: boolean;
  lastLatencyMs: number | null;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  configName,
  provider,
  isSending,
  lastLatencyMs,
}) => {
  return (
    <div className="chat-header">
      <div>
        <p className="label">Active chat</p>
        <h2>{title || "New Chat"}</h2>
      </div>
      <div className="chip-row">
        <div className="chip">
          Config: {configName || "No config"} - {provider || "unset"}
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
  );
};
