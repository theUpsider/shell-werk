import React, { useState } from "react";
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
  onRenameSession: (sessionId: string, title: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onOpenSettings,
  onRequestDeleteSession,
  onRenameSession,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const beginRename = (
    session: ChatSession,
    event?: React.MouseEvent<HTMLDivElement | HTMLButtonElement>
  ) => {
    event?.preventDefault();
    setRenamingId(session.id);
    setRenameValue(session.title || "New Chat");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const commitRename = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!renamingId) return;
    const nextTitle = renameValue.trim() || "New Chat";
    onRenameSession(renamingId, nextTitle);
    cancelRename();
  };

  return (
    <aside className="sidebar">
      <button className="primary" onClick={onNewChat}>
        New Chat
      </button>
      <nav className="session-list" aria-label="Past chats">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isRenaming = renamingId === session.id;
          return (
            <div
              key={session.id}
              className={`session-row ${isActive ? "active" : ""}`}
              onContextMenu={(event) => beginRename(session, event)}
            >
              {isRenaming ? (
                <form className="session-rename" onSubmit={commitRename}>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    aria-label="Rename chat"
                    className="session-rename-input"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                  />
                  <div className="session-rename-actions">
                    <button type="submit" className="primary">
                      Save name
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={cancelRename}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="session-item"
                  onClick={() => onSelectSession(session.id)}
                  title="Right-click to rename chat"
                >
                  <span className="session-title">
                    {session.title || "New Chat"}
                  </span>
                  <span className="session-meta">
                    {new Date(session.updatedAt).toLocaleString()}
                  </span>
                </button>
              )}
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
