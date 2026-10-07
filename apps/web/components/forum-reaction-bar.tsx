"use client";

import { useState } from "react";
import type { ForumReactionCounts, ForumReactionType } from "@/lib/api";

const REACTIONS: { type: ForumReactionType; emoji: string; label: string }[] = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "dislike", emoji: "👎", label: "Dislike" },
  { type: "love", emoji: "❤️", label: "Love" },
  { type: "laugh", emoji: "😂", label: "Laugh" },
  { type: "wow", emoji: "😮", label: "Wow" },
  { type: "sad", emoji: "😢", label: "Sad" },
  { type: "angry", emoji: "😡", label: "Angry" },
];

const REACTION_BY_TYPE = new Map(REACTIONS.map((r) => [r.type, r]));

/** The toggle button + popover for picking a reaction, plus the aggregated count chips -- shared by both post and comment rows. */
export function ForumReactionBar({
  reactionCounts,
  myReaction,
  onReact,
  onUnreact,
  size = "md",
}: {
  reactionCounts: ForumReactionCounts;
  myReaction: ForumReactionType | null;
  onReact: (type: ForumReactionType) => void;
  onUnreact: () => void;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const active = myReaction ? REACTION_BY_TYPE.get(myReaction) : null;
  const nonZeroCounts = REACTIONS.map((r) => ({ ...r, count: reactionCounts[r.type] ?? 0 })).filter((r) => r.count > 0);
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  function handlePick(type: ForumReactionType) {
    setOpen(false);
    if (myReaction === type) onUnreact();
    else onReact(type);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition ${textSize} ${
            active ? "bg-brand-light text-brand-dark" : "bg-surface-card text-ink-muted hover:bg-border"
          }`}
        >
          <span>{active?.emoji ?? "👍"}</span>
          <span>{active?.label ?? "React"}</span>
        </button>
        {open ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-full bg-surface p-1.5 shadow-lg ring-1 ring-border">
              {REACTIONS.map((r) => (
                <button
                  key={r.type}
                  type="button"
                  onClick={() => handlePick(r.type)}
                  title={r.label}
                  className={`rounded-full p-1.5 text-lg transition hover:scale-125 ${myReaction === r.type ? "bg-brand-light" : ""}`}
                >
                  {r.emoji}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {nonZeroCounts.length > 0 ? (
        <div className={`flex flex-wrap items-center gap-1.5 text-ink-muted ${textSize}`}>
          {nonZeroCounts.map((r) => (
            <span key={r.type} className="flex items-center gap-0.5">
              {r.emoji} {r.count}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
