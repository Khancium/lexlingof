"use client";

import { useState } from "react";

export function AdminBulkBar({
  count,
  onClear,
  onDelete,
  children,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

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

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-5 py-3 shadow-sm">
      <span className="text-sm font-semibold text-ink-inverted">{count} selected</span>
      {children}
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="btn-duo btn-duo-danger bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
      >
        {isDeleting ? "Deleting..." : "Delete Selected"}
      </button>
      <button onClick={onClear} className="btn-duo btn-duo-secondary ml-auto bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border">
        Clear
      </button>
    </div>
  );
}
