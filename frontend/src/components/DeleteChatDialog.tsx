import type React from "react";

interface DeleteChatDialogProps {
  sessionTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDialogElement>) => void;
}

export const DeleteChatDialog: React.FC<DeleteChatDialogProps> = ({
  sessionTitle,
  onCancel,
  onConfirm,
  onKeyDown,
}) => {
  return (
    <div className="modal-backdrop">
      <dialog
        className="modal delete-modal"
        open
        aria-modal="true"
        role="dialog"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <h3 id="delete-dialog-title">Delete chat</h3>
        </div>
        <div className="modal-body">
          <p id="delete-dialog-description" className="warning-text">
            Deleting <strong>{sessionTitle || "this chat"}</strong> is permanent
            and cannot be undone.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary destructive" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </dialog>
    </div>
  );
};
