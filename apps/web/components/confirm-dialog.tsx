"use client";

import { useEffect } from "react";

/**
 * The app's first custom modal -- every other confirmation (admin deletes)
 * still uses window.confirm(), which is fine for an internal admin tool but
 * reads as jarringly out-of-theme for a contributor-facing action like
 * signing out, hence a themed dialog just for this.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="card-duo w-full max-w-sm rounded-2xl bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">{message}</p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-2.5 text-sm font-semibold text-ink hover:bg-border"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`btn-duo flex-1 py-2.5 text-sm font-semibold text-white ${
              danger ? "bg-red-600 hover:bg-red-500" : "bg-brand text-ink-inverted hover:bg-brand-dark"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
