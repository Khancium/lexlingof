"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { api, type ContributionListItem, type ModuleType, type PendingSubmissionItem } from "@/lib/api";
import { Pagination } from "@/components/admin-pagination";

const MODULE_LABEL: Record<ModuleType, string> = {
  WORD: "Word",
  TRANSCRIPTION: "Audio Upload",
  TRANSLATION: "Translation",
  SCENE: "Scene",
};

const FILTERS: { label: string; value: ModuleType | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Word", value: "WORD" },
  { label: "Audio", value: "TRANSCRIPTION" },
  { label: "Translation", value: "TRANSLATION" },
  { label: "Scene", value: "SCENE" },
];

const PAGE_SIZE = 20;

function contributionTitle(item: ContributionListItem): string {
  const d = item.detail;
  if (!d) return MODULE_LABEL[item.moduleType];
  switch (item.moduleType) {
    case "WORD":
      return d.nativeWord || "(no word text)";
    case "TRANSCRIPTION":
      return d.title || "(untitled)";
    case "TRANSLATION":
      return d.nativeText || "(no translation text)";
    case "SCENE":
      return d.sceneTitle || "(untitled scene)";
    default:
      return MODULE_LABEL[item.moduleType];
  }
}

export default function ContributionsPage() {
  const [filter, setFilter] = useState<ModuleType | undefined>(undefined);
  const [items, setItems] = useState<ContributionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  // A single shared, hidden <audio> element -- only one item can play at a
  // time anyway, and reusing one element (instead of mounting/unmounting a
  // fresh <audio> per click) is what makes play/pause instant: play() and
  // pause() are called directly on it, with play URLs cached per
  // contribution so replaying something already fetched doesn't re-hit the
  // network either.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playUrlCache, setPlayUrlCache] = useState<Record<string, string>>({});
  const [playError, setPlayError] = useState<{ id: string; message: string } | null>(null);

  const [pending, setPending] = useState<PendingSubmissionItem[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    api.users
      .getContributions({ limit: PAGE_SIZE, offset, moduleType: filter })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [filter, offset]);

  const loadPending = useCallback(() => {
    api.buffer.getMine().then(setPending).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // While a buffered submission is still pending/processing, poll for it to
  // resolve into a real contribution -- then refresh both lists so it moves
  // from "Processing" here into the normal list below with its points.
  useEffect(() => {
    if (!pending.some((p) => p.status === "pending" || p.status === "processing")) return;
    const interval = setInterval(() => {
      loadPending();
      load();
    }, 4000);
    return () => clearInterval(interval);
  }, [pending, loadPending, load]);

  function changeFilter(value: ModuleType | undefined) {
    setFilter(value);
    setOffset(0);
    audioRef.current?.pause();
    setPlayingId(null);
  }

  async function togglePlay(item: ContributionListItem) {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (playingId === item.id) {
      audioEl.pause();
      setPlayingId(null);
      return;
    }

    const audioFileId = item.detail?.audioFileId;
    if (!audioFileId) return;
    setPlayError(null);

    const cachedUrl = playUrlCache[item.id];
    if (cachedUrl) {
      audioEl.src = cachedUrl;
      setPlayingId(item.id);
      audioEl.play().catch(() => {});
      return;
    }

    setLoadingId(item.id);
    try {
      const { url } = await api.audio.getPlayUrl(audioFileId);
      setPlayUrlCache((prev) => ({ ...prev, [item.id]: url }));
      audioEl.src = url;
      setPlayingId(item.id);
      await audioEl.play();
    } catch (err) {
      setPlayError({ id: item.id, message: err instanceof Error ? err.message : "Failed to load audio" });
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Hidden -- playback is driven entirely by the Play/Stop buttons below,
         never the browser's native controls. onPause is deliberately not
         wired to clear playingId: swapping .src on this same element to
         switch tracks fires a pause event first, which would otherwise
         race the very setPlayingId(item.id) that follows it. */}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />

      <h1 className="text-2xl font-bold text-ink">My Contributions</h1>

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((p) => (
            <div key={p.id} className="card-duo flex items-center gap-3 rounded-2xl bg-surface-card p-3 text-sm">
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full ${
                  p.status === "failed" ? "bg-danger" : "animate-pulse bg-secondary"
                }`}
              />
              <span className="font-semibold text-ink">{MODULE_LABEL[p.moduleType]}</span>
              <span className={p.status === "failed" ? "text-danger" : "text-ink-muted"}>
                {p.status === "failed" ? `Failed -- ${p.errorMessage ?? "unknown error"}` : "Submitted, processing..."}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => changeFilter(f.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              filter === f.value ? "bg-brand text-ink-inverted" : "bg-surface-card text-ink-muted hover:bg-border"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">No contributions yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card-duo flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-sm">
              {item.detail?.imageUrl ? (
                <Image
                  src={item.detail.imageUrl}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-surface-card text-xl">
                  {item.moduleType === "SCENE" ? "🖼️" : item.moduleType === "TRANSLATION" ? "🌐" : "🎙️"}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{MODULE_LABEL[item.moduleType]}</p>
                <p className="truncate font-medium text-ink">{contributionTitle(item)}</p>
                <p className="text-xs text-ink-muted">{new Date(item.submittedAt).toLocaleDateString()}</p>
                {playError?.id === item.id ? <p className="mt-1 text-xs text-red-600">{playError.message}</p> : null}
              </div>

              <div className="flex flex-shrink-0 items-center gap-4">
                {item.detail?.audioFileId ? (
                  <button
                    onClick={() => togglePlay(item)}
                    disabled={loadingId === item.id}
                    className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                  >
                    {loadingId === item.id ? "Loading..." : playingId === item.id ? "■ Stop" : "▶ Play"}
                  </button>
                ) : null}
                <span className="text-sm font-semibold text-emerald-600">
                  {item.totalPoints != null ? `+${item.totalPoints}` : "--"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />}
    </div>
  );
}
