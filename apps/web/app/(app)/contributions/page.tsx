"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, type ContributionListItem, type ModuleType, type PendingSubmissionItem } from "@/lib/api";
import { Pagination } from "@/components/admin-pagination";

/** Where "Submit Again" should send the user to re-record this exact item, or null if there's no specific object to jump back to. */
function submitAgainHref(item: PendingSubmissionItem): string | null {
  if (!item.target) return item.moduleType === "TRANSCRIPTION" ? "/contribute/audio" : null;
  switch (item.moduleType) {
    case "WORD":
      if (!item.target.id) return null;
      return `/contribute/concept?conceptId=${item.target.id}${item.target.synonymIndex ? `&synonymIndex=${item.target.synonymIndex}` : ""}`;
    case "TRANSLATION":
      return item.target.id ? `/contribute/translate?sentenceId=${item.target.id}` : null;
    case "SCENE":
      return item.target.id ? `/contribute/scene?sceneId=${item.target.id}` : null;
    case "TRANSCRIPTION":
      return "/contribute/audio";
    default:
      return null;
  }
}

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

const DEFAULT_PAGE_SIZE = 20;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

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
  return (
    <Suspense fallback={<p className="text-ink-muted">Loading...</p>}>
      <ContributionsPageInner />
    </Suspense>
  );
}

function ContributionsPageInner() {
  // Set when arriving from a notification's "View" button on a failed
  // submission (?failed=<pendingSubmissionId>) -- used to scroll to and
  // highlight that exact pending item below instead of just landing on a
  // generic list the user has to hunt through.
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("failed");
  const highlightRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToHighlight, setHasScrolledToHighlight] = useState(false);
  // Failed Submissions is a summary button on the normal view; clicking it
  // (or arriving from a notification's "View" link) switches to a
  // dedicated full-page listing of every failed item instead of cluttering
  // the main contributions list with them inline.
  const [showingFailed, setShowingFailed] = useState(!!highlightId);

  const [filter, setFilter] = useState<ModuleType | undefined>(undefined);
  const [items, setItems] = useState<ContributionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  // A single shared, hidden <audio> element -- only one item can play at a
  // time anyway, and reusing one element (instead of mounting/unmounting a
  // fresh <audio> per click) is what makes play/pause instant: play() and
  // pause() are called directly on it, with play URLs cached per
  // contribution so replaying something already fetched doesn't re-hit the
  // network either.
  const audioRef = useRef<HTMLAudioElement>(null);
  // Which contribution's audio is currently loaded into the shared element
  // -- kept distinct from playingId so re-clicking Play after a Pause just
  // resumes (loadedId unchanged), instead of reassigning .src and
  // restarting from 0 the way it would if "paused" were represented only
  // by playingId briefly going null.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playUrlCache, setPlayUrlCache] = useState<Record<string, string>>({});
  const [playError, setPlayError] = useState<{ id: string; message: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [pending, setPending] = useState<PendingSubmissionItem[]>([]);
  const processingItems = pending.filter((p) => p.status !== "failed");
  const failedItems = pending.filter((p) => p.status === "failed");

  const load = useCallback(() => {
    setLoading(true);
    api.users
      .getContributions({ limit, offset, moduleType: filter })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [filter, offset, limit]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  const loadPending = useCallback(() => {
    api.buffer.getMine().then(setPending).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (!highlightId || hasScrolledToHighlight) return;
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      setHasScrolledToHighlight(true);
    }
  }, [highlightId, hasScrolledToHighlight, pending]);

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
    setLoadedId(null);
    setCurrentTime(0);
  }

  async function togglePlay(item: ContributionListItem) {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (playingId === item.id) {
      audioEl.pause();
      setPlayingId(null);
      return;
    }

    // Already loaded (just paused) -- resume in place rather than
    // reassigning .src, which would reload the media and jump back to 0.
    if (loadedId === item.id) {
      setPlayingId(item.id);
      audioEl.play().catch(() => {});
      return;
    }

    const audioFileId = item.detail?.audioFileId;
    if (!audioFileId) return;
    setPlayError(null);
    setCurrentTime(0);
    setDuration(0);

    const cachedUrl = playUrlCache[item.id];
    if (cachedUrl) {
      audioEl.src = cachedUrl;
      setLoadedId(item.id);
      setPlayingId(item.id);
      audioEl.play().catch(() => {});
      return;
    }

    setLoadingId(item.id);
    try {
      const { url } = await api.audio.getPlayUrl(audioFileId);
      setPlayUrlCache((prev) => ({ ...prev, [item.id]: url }));
      audioEl.src = url;
      setLoadedId(item.id);
      setPlayingId(item.id);
      await audioEl.play();
    } catch (err) {
      setPlayError({ id: item.id, message: err instanceof Error ? err.message : "Failed to load audio" });
    } finally {
      setLoadingId(null);
    }
  }

  function stopPlayback(item: ContributionListItem) {
    const audioEl = audioRef.current;
    if (!audioEl || loadedId !== item.id) return;
    audioEl.pause();
    audioEl.currentTime = 0;
    setPlayingId(null);
    setLoadedId(null);
    setCurrentTime(0);
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audioEl = audioRef.current;
    if (!audioEl || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audioEl.currentTime = fraction * duration;
    setCurrentTime(fraction * duration);
  }

  return (
    <div className="space-y-6">
      {/* Hidden -- playback is driven entirely by the Play/Stop buttons below,
         never the browser's native controls. onPause is deliberately not
         wired to clear playingId: swapping .src on this same element to
         switch tracks fires a pause event first, which would otherwise
         race the very setPlayingId(item.id) that follows it. */}
      <audio
        ref={audioRef}
        onEnded={() => {
          setPlayingId(null);
          setCurrentTime(0);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        className="hidden"
      />

      <h1 className="text-2xl font-bold text-ink">My Contributions</h1>

      {showingFailed ? (
        <div className="space-y-4">
          <button
            onClick={() => setShowingFailed(false)}
            className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
          >
            ← Back to Contributions
          </button>

          <div className="card-duo rounded-2xl border border-red-200 bg-red-50 p-4">
            <h2 className="mb-3 text-lg font-bold text-red-700">⚠ Failed Submissions</h2>
            {failedItems.length === 0 ? (
              <p className="text-sm text-red-700">No failed submissions -- you're all caught up.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {failedItems.map((p) => {
                  const isHighlighted = p.id === highlightId;
                  const href = submitAgainHref(p);
                  return (
                    <div
                      key={p.id}
                      ref={isHighlighted ? highlightRef : undefined}
                      className={`flex flex-col items-center gap-2 rounded-2xl bg-surface p-4 text-center shadow-sm ${
                        isHighlighted ? "ring-2 ring-red-400" : ""
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-600">{MODULE_LABEL[p.moduleType]}</p>
                      <p className="truncate text-sm font-medium text-ink" title={p.target?.label ?? undefined}>
                        {p.target?.label ?? "(no additional detail)"}
                        {p.target?.synonymIndex ? ` (synonym ${p.target.synonymIndex})` : ""}
                      </p>
                      {href ? (
                        <Link
                          href={href}
                          className="btn-duo w-full bg-red-600 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-red-500"
                        >
                          Submit Again
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {processingItems.length > 0 && (
            <div className="space-y-2">
              {processingItems.map((p) => (
                <div key={p.id} className="card-duo flex items-center gap-3 rounded-2xl bg-surface-card p-3 text-sm">
                  <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-secondary" />
                  <span className="font-semibold text-ink">{MODULE_LABEL[p.moduleType]}</span>
                  <span className="text-ink-muted">Submitted, processing...</span>
                </div>
              ))}
            </div>
          )}

          {failedItems.length > 0 && (
            <button
              onClick={() => setShowingFailed(true)}
              className="card-duo flex w-full items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-4 text-left transition hover:shadow-md"
            >
              <span className="font-bold text-red-700">
                ⚠ {failedItems.length} Failed Submission{failedItems.length === 1 ? "" : "s"}
              </span>
              <span className="text-red-700">→</span>
            </button>
          )}

          <div className="flex flex-wrap gap-2">
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
            <div key={item.id} className="card-duo flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
              <div className="flex items-center gap-4">
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

                <div className="flex flex-shrink-0 items-center gap-2">
                  {item.detail?.audioFileId ? (
                    <>
                      <button
                        onClick={() => togglePlay(item)}
                        disabled={loadingId === item.id}
                        className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                      >
                        {loadingId === item.id ? "Loading..." : playingId === item.id ? "⏸ Pause" : "▶ Play"}
                      </button>
                      {loadedId === item.id ? (
                        <button
                          onClick={() => stopPlayback(item)}
                          className="btn-duo btn-duo-secondary bg-surface-card px-3 py-2 text-sm font-semibold text-ink hover:bg-border"
                        >
                          ■ Stop
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  <span className="ml-2 text-sm font-semibold text-emerald-600">
                    {item.totalPoints != null ? `+${item.totalPoints}` : "--"}
                  </span>
                </div>
              </div>

              {loadedId === item.id ? (
                <div className="flex items-center gap-2 pl-[72px]">
                  <span className="w-9 flex-shrink-0 text-xs tabular-nums text-ink-muted">{formatTime(currentTime)}</span>
                  <div onClick={seek} className="h-1.5 flex-1 cursor-pointer rounded-full bg-surface-card">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-9 flex-shrink-0 text-xs tabular-nums text-ink-muted">{formatTime(duration)}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

          {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
        </>
      )}
    </div>
  );
}
