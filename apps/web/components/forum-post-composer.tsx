"use client";

import { useState } from "react";
import { api, getErrorMessage, type ForumConceptPreview, type ForumSentencePreview } from "@/lib/api";
import { EmojiPicker } from "@/components/emoji-picker";

export type ForumAnchor =
  | { type: "concept"; concept: ForumConceptPreview }
  | { type: "sentence"; sentence: ForumSentencePreview };

/** The fixed "discussing this" reference set by a "Share to Forum" link elsewhere in the app -- read-only here, never searched or changed from within the composer. */
function AnchorPreview({ anchor }: { anchor: ForumAnchor }) {
  if (anchor.type === "concept") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2 text-sm">
        {anchor.concept.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny transient thumbnail, not worth next/image's overhead here
          <img src={anchor.concept.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
        ) : null}
        <span className="text-ink">
          Discussing: <span className="font-medium">{anchor.concept.labelEnglish}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-surface-card px-3 py-2 text-sm text-ink">
      Discussing: <span className="font-medium">&quot;{anchor.sentence.englishText}&quot;</span>
    </div>
  );
}

/** Dynamic 2-6 option poll builder -- revealed by the "+ Poll" toggle below the composer. */
function PollBuilder({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  return (
    <div className="space-y-2 rounded-lg bg-surface-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Poll options</p>
      {options.map((option, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={option}
            onChange={(e) => onChange(options.map((o, j) => (j === i ? e.target.value : o)))}
            placeholder={`Option ${i + 1}`}
            maxLength={120}
            className="flex-1 rounded-lg bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          {options.length > 2 ? (
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              aria-label="Remove option"
              className="text-ink-muted hover:text-ink"
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      {options.length < 6 ? (
        <button type="button" onClick={() => onChange([...options, ""])} className="text-xs font-semibold text-brand hover:underline">
          + Add option
        </button>
      ) : null}
    </div>
  );
}

export function ForumPostComposer({ onPosted, anchor }: { onPosted: () => void; anchor?: ForumAnchor }) {
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedPollOptions = pollOptions.map((o) => o.trim()).filter((o) => o.length > 0);
  const pollInvalid = showPoll && trimmedPollOptions.length < 2;

  async function handleSubmit() {
    if (body.trim().length === 0 || pollInvalid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.forum.createPost({
        body: body.trim(),
        image: image ?? undefined,
        pollOptions: showPoll ? trimmedPollOptions : undefined,
        conceptId: anchor?.type === "concept" ? anchor.concept.id : undefined,
        sentenceId: anchor?.type === "sentence" ? anchor.sentence.id : undefined,
      });
      setBody("");
      setImage(null);
      setShowPoll(false);
      setPollOptions(["", ""]);
      onPosted();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to post"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-duo space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
      {anchor ? <AnchorPreview anchor={anchor} /> : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Ask a question, start a discussion, or share something..."
        rows={3}
        className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
      />

      {image ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, which next/image cannot load */}
          <img src={URL.createObjectURL(image)} alt="" className="h-20 w-auto rounded-lg object-cover ring-1 ring-border" />
          <button
            type="button"
            onClick={() => setImage(null)}
            aria-label="Remove image"
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-xs text-ink-inverted"
          >
            ×
          </button>
        </div>
      ) : null}

      {showPoll ? <PollBuilder options={pollOptions} onChange={setPollOptions} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <EmojiPicker onSelect={(emoji) => setBody((prev) => prev + emoji)} />
        <label className="cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-card">
          📷 Photo
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        </label>
        <button
          type="button"
          onClick={() => setShowPoll((v) => !v)}
          className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-card"
        >
          {showPoll ? "✕ Remove poll" : "📊 Poll"}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || body.trim().length === 0 || pollInvalid}
          className="btn-duo bg-brand px-5 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isSubmitting ? "Posting..." : "Post"}
        </button>
      </div>

      {pollInvalid ? <p className="text-sm text-ink-muted">A poll needs at least 2 options.</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
