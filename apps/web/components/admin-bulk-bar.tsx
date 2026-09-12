"use client";

import { useState } from "react";
import { getErrorMessage, type BulkPermanentDeleteResult } from "@/lib/api";

export function AdminBulkBar({
  count,
  onClear,
  onDelete,
  onPermanentDelete,
  children,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => Promise<void>;
  /** Omit to offer soft delete only. */
  onPermanentDelete?: () => Promise<BulkPermanentDeleteResult>;
  children?: React.ReactNode;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isErasing, setIsErasing] = useState(false);

  if (count === 0) return null;

  async function handleDelete() {
    if (!confirm(`Delete ${count} selected item(s)? This cannot be undone from here.`)) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  }

  async function handlePermanentDelete() {
    if (!onPermanentDelete) return;
    if (
      !confirm(
        `Permanently delete ${count} selected item(s)?\n\nThis erases them from the database and deletes their images from storage. It cannot be undone. Anything still referenced by contributor recordings will be skipped.`,
      )
    ) {
      return;
    }
    setIsErasing(true);
    try {
      const result = await onPermanentDelete();
      // Bulk is best-effort per item, so a partial result is the normal
      // outcome, not an error -- report exactly what was and wasn't erased.
      if (result.skipped.length > 0) {
        const detail = result.skipped
          .slice(0, 10)
          .map((s) => `- ${s.reason}`)
          .join("\n");
        const more = result.skipped.length > 10 ? `\n...and ${result.skipped.length - 10} more.` : "";
        alert(
          `Permanently deleted ${result.deleted} item(s).\n\nSkipped ${result.skipped.length}:\n${detail}${more}`,
        );
      }
    } catch (err) {
      alert(getErrorMessage(err, "Failed to permanently delete"));
    } finally {
      setIsErasing(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-5 py-3 shadow-sm">
      <span className="text-sm font-semibold text-ink-inverted">{count} selected</span>
      {children}
      <button
        onClick={handleDelete}
        disabled={isDeleting || isErasing}
        className="btn-duo btn-duo-danger bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
      >
        {isDeleting ? "Deleting..." : "Delete Selected"}
      </button>
      {onPermanentDelete ? (
        <button
          onClick={handlePermanentDelete}
          disabled={isDeleting || isErasing}
          title="Erase from the database and delete images from storage"
          className="btn-duo bg-red-900 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {isErasing ? "Erasing..." : "Delete Permanently"}
        </button>
      ) : null}
      <button onClick={onClear} className="btn-duo btn-duo-secondary ml-auto bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border">
        Clear
      </button>
    </div>
  );
}
