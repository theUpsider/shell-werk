import type React from "react";
import type { ChatSession } from "../types/chat";

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onRequestDeleteSession: (
    sessionId: string,
    event?: React.MouseEvent<HTMLButtonElement>
  ) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onOpenSettings,
  onRequestDeleteSession,
}) => {
  return (
    <aside className="sidebar">
      <button className="primary" onClick={onNewChat}>
        New Chat
      </button>
      <nav className="session-list" aria-label="Past chats">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <div
              key={session.id}
              className={`session-row ${isActive ? "active" : ""}`}
            >
              <button
                type="button"
                className="session-item"
                onClick={() => onSelectSession(session.id)}
              >
                <span className="session-title">
                  {session.title || "New Chat"}
                </span>
                <span className="session-meta">
                  {new Date(session.updatedAt).toLocaleString()}
                </span>
              </button>
              <button
                type="button"
                className="session-delete"
                onClick={(event) => onRequestDeleteSession(session.id, event)}
                aria-label={`Delete chat ${session.title || "chat"}`}
              >
                <span aria-hidden="true">x</span>
              </button>
            </div>
          );
        })}
      </nav>
      <button className="ghost" onClick={onOpenSettings}>
        Settings
      </button>
    </aside>
  );
};
