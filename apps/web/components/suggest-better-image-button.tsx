"use client";

import { useState } from "react";
import { api, getErrorMessage } from "@/lib/api";

/** A small, unobtrusive link tucked next to a concept/scene's image -- opens a tiny form to attach a better photo, filed as a suggestion tagged with this item's id so an admin can review it against the live image. */
export function SuggestBetterImageButton({
  itemLabel,
  conceptId,
  sceneId,
}: {
  itemLabel: string;
  conceptId?: string;
  sceneId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function reset() {
    setOpen(false);
    setImage(null);
    setNote("");
    setError(null);
  }

  async function handleSubmit() {
    if (!image) {
      setError("Choose an image first.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await api.users.submitSuggestion({
        message: note.trim() || `Suggested a better image for "${itemLabel}".`,
        image,
        conceptId,
        sceneId,
      });
      setSent(true);
      setImage(null);
      setNote("");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to send suggestion"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSent(false);
        }}
        className="text-xs text-ink-muted/70 hover:text-ink-muted hover:underline"
      >
        Suggest a better image
      </button>
    );
  }

  return (
    <div className="card-duo w-full max-w-xs space-y-2 rounded-xl bg-surface-card p-3 text-left shadow-sm ring-1 ring-border">
      {sent ? (
        <>
          <p className="text-xs text-emerald-600">Thanks! Sent to the team for review.</p>
          <button type="button" onClick={reset} className="text-xs font-semibold text-brand hover:underline">
            Close
          </button>
        </>
      ) : (
        <>
          <label className="block cursor-pointer text-xs font-semibold text-brand hover:underline">
            {image ? image.name : "Choose image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="w-full rounded-lg bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !image}
              className="btn-duo bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
            >
              {isSubmitting ? "Sending..." : "Send"}
            </button>
            <button type="button" onClick={reset} className="text-xs font-semibold text-ink-muted hover:underline">
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
