import { useEffect, useState } from "react";
import {
  Quit,
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
} from "../../wailsjs/runtime/runtime";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const runtimeAvailable =
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as { runtime?: unknown }).runtime);

  useEffect(() => {
    if (!runtimeAvailable) return;
    WindowIsMaximised()
      .then(setIsMaximized)
      .catch(() => setIsMaximized(false));
  }, [runtimeAvailable]);

  const syncMaxState = async () => {
    if (!runtimeAvailable) return;
    try {
      const next = await WindowIsMaximised();
      setIsMaximized(next);
    } catch {
      setIsMaximized(false);
    }
  };

  const handleToggleMaximise = async () => {
    if (!runtimeAvailable) return;
    try {
      await WindowToggleMaximise();
    } finally {
      syncMaxState();
    }
  };

  const handleDoubleClick = () => {
    handleToggleMaximise();
  };

  const handleMinimise = () => {
    if (!runtimeAvailable) return;
    WindowMinimise();
  };

  const handleQuit = () => {
    if (!runtimeAvailable) return;
    Quit();
  };

  return (
    <div className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="titlebar-brand">
        <span className="titlebar-dot" aria-hidden />
        <div className="titlebar-text">
          <span className="titlebar-title">shell-werk</span>
          <span className="titlebar-subtitle">local agent workspace</span>
        </div>
      </div>

      <div className="titlebar-actions" aria-label="Window controls">
        <button
          type="button"
          className="titlebar-btn"
          onClick={handleMinimise}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label="Minimize window"
        >
          <svg viewBox="0 0 12 12" aria-hidden focusable="false">
            <path d="M2.5 6.5h7v1h-7z" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-btn"
          onClick={handleToggleMaximise}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
        >
          {isMaximized ? (
            <svg viewBox="0 0 12 12" aria-hidden focusable="false">
              <path d="M3 4h5v5H3z" />
              <path d="M4 3h5v5h-1V4H4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden focusable="false">
              <path d="M3 3h6v6H3z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar-btn close"
          onClick={handleQuit}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label="Exit shell-werk"
        >
          <svg viewBox="0 0 12 12" aria-hidden focusable="false">
            <path d="M3 3l6 6M9 3 3 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
