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
          className="titlebar-btn minimize"
          onClick={handleMinimise}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label="Minimize window"
        />
        <button
          type="button"
          className="titlebar-btn maximize"
          onClick={handleToggleMaximise}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
        />
        <button
          type="button"
          className="titlebar-btn close"
          onClick={handleQuit}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label="Exit shell-werk"
        />
      </div>
    </div>
  );
}
