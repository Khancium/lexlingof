"use client";

import { useState } from "react";

// A small curated set rather than a full Unicode emoji library -- covers
// the common cases (reactions in text, feelings, everyday objects) without
// pulling in an external emoji-data package just for a picker grid.
const EMOJIS = [
  "😀", "😂", "🥰", "😍", "😊", "🙂", "😉", "😎", "🤔", "😅",
  "😢", "😭", "😡", "😱", "🥳", "😴", "🤯", "🙄", "😬", "🤗",
  "👍", "👎", "👏", "🙏", "💪", "🤝", "✌️", "🤞", "👋", "🤷",
  "❤️", "💔", "🔥", "✨", "🎉", "⭐", "💯", "👀", "💡", "✅",
  "🐶", "🐱", "🦋", "🌸", "🌞", "🌙", "🍎", "☕", "🎵", "📸",
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add emoji"
        className="rounded-lg px-2 py-1.5 text-lg hover:bg-surface-card"
      >
        😊
      </button>
      {open ? (
        <>
          {/* Backdrop to close on outside click -- simpler than a ref-based listener for a small popover like this. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 grid w-64 grid-cols-8 gap-1 rounded-xl bg-surface p-2 shadow-lg ring-1 ring-border">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                }}
                className="rounded-lg p-1 text-lg hover:bg-surface-card"
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
