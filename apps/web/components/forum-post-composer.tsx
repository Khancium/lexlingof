"use client";

import { useState } from "react";
import { api, getErrorMessage, type ConceptListItem, type RandomSentence } from "@/lib/api";
import { EmojiPicker } from "@/components/emoji-picker";
import { GifAttachInput } from "@/components/gif-attach-input";

type Attachment =
  | { type: "none" }
  | { type: "concept"; concept: ConceptListItem }
  | { type: "sentence"; sentence: RandomSentence };

/** The "share an object/sentence to the forum" picker -- search-as-you-type against the same public list/search endpoints the contribute pages use. */
function AttachmentPicker({ attachment, onChange }: { attachment: Attachment; onChange: (a: Attachment) => void }) {
  const [mode, setMode] = useState<"" | "concept" | "sentence">("");
  const [search, setSearch] = useState("");
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [sentences, setSentences] = useState<RandomSentence[]>([]);
  const [loading, setLoading] = useState(false);

  function runSearch(nextMode: "concept" | "sentence", query: string) {
    setLoading(true);
    if (nextMode === "concept") {
      api.concepts
        .getAll({ search: query.trim() || undefined, limit: 10 })
        .then((res) => setConcepts(res.items))
        .finally(() => setLoading(false));
    } else {
      api.contributions
        .searchSentences({ search: query.trim() || undefined, limit: 10 })
        .then((res) => setSentences(res.items))
        .finally(() => setLoading(false));
    }
  }

  function openPicker(nextMode: "concept" | "sentence") {
    setMode(nextMode);
    setSearch("");
    runSearch(nextMode, "");
  }

  if (attachment.type === "concept") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2 text-sm">
        {attachment.concept.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny transient thumbnail, not worth next/image's overhead here
          <img src={attachment.concept.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
        ) : null}
        <span className="flex-1 text-ink">Discussing: {attachment.concept.labelEnglish}</span>
        <button type="button" onClick={() => onChange({ type: "none" })} className="text-xs text-ink-muted hover:underline">
          Remove
        </button>
      </div>
    );
  }
  if (attachment.type === "sentence") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2 text-sm">
        <span className="flex-1 truncate text-ink">Discussing: &quot;{attachment.sentence.englishText}&quot;</span>
        <button type="button" onClick={() => onChange({ type: "none" })} className="text-xs text-ink-muted hover:underline">
          Remove
        </button>
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="flex gap-3">
        <button type="button" onClick={() => openPicker("concept")} className="text-xs font-semibold text-brand hover:underline">
          + Attach an object
        </button>
        <button type="button" onClick={() => openPicker("sentence")} className="text-xs font-semibold text-brand hover:underline">
          + Attach a sentence
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-surface-card p-2">
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            runSearch(mode, e.target.value);
          }}
          placeholder={mode === "concept" ? "Search objects..." : "Search sentences..."}
          autoFocus
          className="flex-1 rounded-lg bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
        />
        <button type="button" onClick={() => setMode("")} className="text-xs text-ink-muted hover:underline">
          Cancel
        </button>
      </div>
      {loading ? (
        <p className="px-2 text-xs text-ink-muted">Searching...</p>
      ) : mode === "concept" ? (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {concepts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({ type: "concept", concept: c });
                setMode("");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny transient thumbnail in a search list */}
              {c.imageUrl ? <img src={c.imageUrl} alt="" className="h-6 w-6 rounded object-cover" /> : null}
              {c.labelEnglish}
            </button>
          ))}
          {concepts.length === 0 ? <p className="px-2 text-xs text-ink-muted">No matches.</p> : null}
        </div>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {sentences.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onChange({ type: "sentence", sentence: s });
                setMode("");
              }}
              className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface"
            >
              {s.englishText}
            </button>
          ))}
          {sentences.length === 0 ? <p className="px-2 text-xs text-ink-muted">No matches.</p> : null}
        </div>
      )}
    </div>
  );
}

export function ForumPostComposer({ onPosted }: { onPosted: () => void }) {
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [gifUrl, setGifUrl] = useState("");
  const [attachment, setAttachment] = useState<Attachment>({ type: "none" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (body.trim().length === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.forum.createPost({
        body: body.trim(),
        image: image ?? undefined,
        gifUrl: gifUrl || undefined,
        conceptId: attachment.type === "concept" ? attachment.concept.id : undefined,
        sentenceId: attachment.type === "sentence" ? attachment.sentence.id : undefined,
      });
      setBody("");
      setImage(null);
      setGifUrl("");
      setAttachment({ type: "none" });
      onPosted();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to post"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-duo space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Ask a question, start a discussion, or share something..."
        rows={3}
        className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
      />

      <AttachmentPicker attachment={attachment} onChange={setAttachment} />

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

      <div className="flex flex-wrap items-center gap-2">
        <EmojiPicker onSelect={(emoji) => setBody((prev) => prev + emoji)} />
        <label className="cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-card">
          📷 Photo
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        </label>
        <GifAttachInput value={gifUrl} onChange={setGifUrl} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || body.trim().length === 0}
          className="btn-duo bg-brand px-5 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isSubmitting ? "Posting..." : "Post"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
