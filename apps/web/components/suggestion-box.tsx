"use client";

import { useState } from "react";
import { api, getErrorMessage } from "@/lib/api";

/** The general feedback box -- moved here from Settings so it lives on the dashboard instead. Also used as the base for the smaller per-item "suggest a better image" button (see SuggestBetterImageButton). */
export function SuggestionBox() {
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (message.trim().length === 0) return;
    setIsSubmitting(true);
    setError(null);
    setSent(false);
    try {
      await api.users.submitSuggestion({ message: message.trim(), image: image ?? undefined });
      setMessage("");
      setImage(null);
      setSent(true);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to send suggestion"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
      <h2 className="text-lg font-bold text-ink">Suggestions &amp; Feedback</h2>
      <p className="text-sm text-ink-muted">
        Spotted a bug, or have an idea to make Lexlingo better? Send it straight to the team -- a screenshot helps too.
      </p>
      <textarea
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setSent(false);
        }}
        placeholder="Tell us what's on your mind..."
        rows={4}
        className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg bg-surface-card px-3 py-2 text-sm font-semibold text-ink ring-1 ring-border hover:bg-border">
          {image ? "Change Image" : "Attach Image (optional)"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
        </label>
        {image ? (
          <span className="text-xs text-ink-muted">
            {image.name}{" "}
            <button type="button" onClick={() => setImage(null)} className="font-semibold text-brand hover:underline">
              Remove
            </button>
          </span>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {sent ? <p className="text-sm text-emerald-600">Thanks! Your feedback has been sent.</p> : null}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || message.trim().length === 0}
        className="btn-duo bg-brand px-5 py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
      >
        {isSubmitting ? "Sending..." : "Send Feedback"}
      </button>
    </div>
  );
}
