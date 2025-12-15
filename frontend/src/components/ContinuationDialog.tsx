import type React from "react";
import type { ContinuationPrompt } from "../types/chat";

interface ContinuationDialogProps {
  prompt: ContinuationPrompt;
  busy?: boolean;
  onContinue: () => void;
  onCancel: () => void;
  sessionTitle?: string;
}

export const ContinuationDialog: React.FC<ContinuationDialogProps> = ({
  prompt,
  busy = false,
  onContinue,
  onCancel,
  sessionTitle,
}) => {
  const isFailure = prompt.reason === "tool_failures";
  const failureCount = prompt.failureCount ?? 0;
  const stepCount = prompt.iteration ?? prompt.limit ?? 0;
  const headline = isFailure ? "Tool needs guidance" : "Continue generation?";

  const reasonCopy = isFailure
    ? `The ${prompt.toolName || "tool"} call failed ${failureCount} time${
        failureCount === 1 ? "" : "s"
      }.`
    : `This request has used ${stepCount} tool step${
        stepCount === 1 ? "" : "s"
      }.`;

  const detailCopy = isFailure
    ? "You can continue to let the assistant retry or stop now to adjust the plan."
    : "Continue if you expect more tool calls, or stop to change the request.";

  return (
    <div className="modal-backdrop">
      <dialog
        className="modal continuation-modal"
        open
        aria-modal="true"
        role="dialog"
        aria-labelledby="continuation-dialog-title"
        aria-describedby="continuation-dialog-description"
      >
        <div className="modal-header">
          <h3 id="continuation-dialog-title">{headline}</h3>
        </div>
        <div className="modal-body" id="continuation-dialog-description">
          {sessionTitle && (
            <p className="modal-subtle">Session: {sessionTitle}</p>
          )}
          <p className="modal-lede">{reasonCopy}</p>
          <p className="modal-subtle">{detailCopy}</p>
          {prompt.detail && (
            <div className="modal-panel" aria-label="Last error detail">
              <p className="modal-subtle">Last failure</p>
              <pre className="modal-pre">{prompt.detail}</pre>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Stop
          </button>
          <button
            type="button"
            className="primary"
            onClick={onContinue}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Working..." : "Continue"}
          </button>
        </div>
      </dialog>
    </div>
  );
};
