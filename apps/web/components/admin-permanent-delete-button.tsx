"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/api";

/**
 * The destructive counterpart to the normal Delete button: that one only
 * sets is_active/deleted_at (the row and any uploaded image stay in the
 * database and in Supabase Storage forever), this one removes both for
 * real. The backend refuses when contributor recordings reference the item,
 * and that refusal is surfaced verbatim -- it explains the count and points
 * back at the normal delete.
 */
export function AdminPermanentDeleteButton({
  itemLabel,
  onDelete,
  onDone,
  className,
}: {
  itemLabel: string;
  onDelete: () => Promise<unknown>;
  onDone: () => void;
  className?: string;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleClick() {
    if (
      !confirm(
        `Permanently delete "${itemLabel}"?\n\nThis erases it from the database and deletes its image from storage. It cannot be undone, and the Undo button will not bring it back.`,
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete();
      onDone();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to permanently delete"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isDeleting}
      title="Erase from the database and delete the image from storage"
      className={className ?? "text-xs font-semibold text-red-700 underline hover:text-red-800 disabled:opacity-50"}
    >
      {isDeleting ? "Erasing..." : "Delete Permanently"}
    </button>
  );
}
