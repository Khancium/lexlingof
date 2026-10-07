"use client";

import { useState } from "react";

/**
 * No GIF-search API key is configured in this project, so this is a
 * paste-a-link control (a direct .gif/.webp URL, or a Giphy/Tenor share
 * link that resolves to one) rather than an integrated search picker.
 */
export function GifAttachInput({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  if (value) {
    return (
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party GIF URL, not covered by next/image's remotePatterns */}
        <img src={value} alt="Attached GIF" className="h-20 w-auto rounded-lg object-cover ring-1 ring-border" />
        <button
          type="button"
          onClick={() => {
            onChange("");
            setDraft("");
          }}
          aria-label="Remove GIF"
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-xs text-ink-inverted"
        >
          ×
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-card"
      >
        GIF
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste a GIF link..."
        autoFocus
        className="w-40 rounded-lg bg-surface-card px-2 py-1.5 text-xs text-ink placeholder:text-gray-400 ring-1 ring-border"
      />
      <button
        type="button"
        onClick={() => {
          if (draft.trim()) onChange(draft.trim());
          setOpen(false);
        }}
        className="text-xs font-semibold text-brand hover:underline"
      >
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}
