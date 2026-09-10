"use client";

import { useState } from "react";
import { api, getErrorMessage } from "@/lib/api";

/**
 * "Undo last change" for one item -- reverses whatever the most recent
 * audit-logged action on this resource was (status change, edit, delete).
 * A 404 from the backend means nothing has been logged for this item yet,
 * which is the common case, so it's shown as a quiet disabled state rather
 * than an error.
 */
export function AdminUndoButton({
  resourceType,
  identifier,
  onUndone,
  className,
}: {
  resourceType: string;
  identifier: string;
  onUndone?: () => void;
  className?: string;
}) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUndo() {
    if (!confirm("Undo the most recent change to this item?")) return;
    setIsUndoing(true);
    setError(null);
    try {
      await api.admin.undo(resourceType, identifier);
      onUndone?.();
    } catch (err) {
      setError(getErrorMessage(err, "Nothing to undo"));
    } finally {
      setIsUndoing(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleUndo}
        disabled={isUndoing}
        title="Undo the most recent change to this item"
        className={className ?? "btn-duo btn-duo-secondary bg-surface-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-border disabled:opacity-50"}
      >
        {isUndoing ? "Undoing..." : "↺ Undo"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
