"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import axios from "axios";
import { useAuthStore } from "@/lib/store";
import { api, getErrorMessage, type ModuleType, type ReviewDecision, type ReviewQueueItem } from "@/lib/api";
import { canReview, useLevelThresholds } from "@/lib/level";

const TABS: { label: string; value: ModuleType | undefined }[] = [
  { label: "ALL", value: undefined },
  { label: "WORD", value: "WORD" },
  { label: "AUDIO", value: "TRANSCRIPTION" },
  { label: "TRANSLATION", value: "TRANSLATION" },
  { label: "SCENE", value: "SCENE" },
];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function ReviewPage() {
  const user = useAuthStore((state) => state.user);
  const levelThresholds = useLevelThresholds();
  const [filter, setFilter] = useState<ModuleType | undefined>(undefined);
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  // A single shared, hidden <audio> element for the whole queue -- same
  // pattern as My Contributions -- so play/pause/stop are instant direct
  // calls on one persistent element instead of the previous per-card
  // <audio> that only mounted (and only got a real ref) after the first
  // Play click, which is exactly why that click loaded the audio but never
  // actually started it: .play() ran before the just-mounted element had
  // finished attaching its ref, so only the *second* click (by then already
  // mounted) worked.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playUrlCache, setPlayUrlCache] = useState<Record<string, string>>({});
  const [playError, setPlayError] = useState<{ id: string; message: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const load = useCallback(async (moduleType: ModuleType | undefined) => {
    setLoading(true);
    try {
      setItems(await api.reviews.getQueue(moduleType));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canReview(user?.level)) load(filter);
  }, [filter, user, load]);

  function handleReviewed(contributionId: string) {
    setItems((prev) => prev.filter((i) => i.contributionId !== contributionId));
    if (loadedId === contributionId) {
      audioRef.current?.pause();
      setLoadedId(null);
      setPlayingId(null);
      setCurrentTime(0);
    }
  }

  async function togglePlay(item: ReviewQueueItem) {
    const audioEl = audioRef.current;
    const audioFileId = item.detail.audioFileId as string | undefined;
    if (!audioEl || !audioFileId) return;

    if (playingId === item.contributionId) {
      audioEl.pause();
      setPlayingId(null);
      return;
    }

    // Already loaded (just paused) -- resume in place rather than
    // reassigning .src, which would reload the media and jump back to 0.
    if (loadedId === item.contributionId) {
      setPlayingId(item.contributionId);
      audioEl.play().catch(() => {});
      return;
    }

    setPlayError(null);
    setCurrentTime(0);
    setDuration(0);

    const cachedUrl = playUrlCache[item.contributionId];
    if (cachedUrl) {
      audioEl.src = cachedUrl;
      setLoadedId(item.contributionId);
      setPlayingId(item.contributionId);
      audioEl.play().catch(() => {});
      return;
    }

    setLoadingAudioId(item.contributionId);
    try {
      const { url } = await api.audio.getPlayUrl(audioFileId);
      setPlayUrlCache((prev) => ({ ...prev, [item.contributionId]: url }));
      audioEl.src = url;
      setLoadedId(item.contributionId);
      setPlayingId(item.contributionId);
      await audioEl.play();
    } catch (err) {
      setPlayError({ id: item.contributionId, message: getErrorMessage(err, "Failed to load audio") });
    } finally {
      setLoadingAudioId(null);
    }
  }

  function stopPlayback(item: ReviewQueueItem) {
    const audioEl = audioRef.current;
    if (!audioEl || loadedId !== item.contributionId) return;
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

  if (!canReview(user?.level)) {
    const totalContributions = user?.totalContributions ?? 0;
    const threshold = levelThresholds.SILVER;
    const progressPct = Math.min(100, Math.round((totalContributions / threshold) * 100));
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <div className="text-6xl">🏆</div>
        <h1 className="text-2xl font-bold text-ink">Unlock Review Access</h1>
        <p className="text-ink-muted">Review access requires SILVER level ({threshold} contributions)</p>
        <div className="progress-duo-track">
          <div className="progress-duo-fill bg-yellow-500" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-sm font-semibold text-ink">
          {totalContributions} / {threshold}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hidden -- playback driven entirely by the Play/Pause/Stop buttons
         below, never the browser's native controls. onPause is deliberately
         not wired to clear playingId: swapping .src on this same element to
         switch tracks fires a pause event first, which would otherwise race
         the very setPlayingId(item.contributionId) that follows it. */}
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

      <h1 className="text-2xl font-bold text-ink">Review Queue</h1>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setFilter(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${
              filter === tab.value ? "bg-brand text-ink-inverted" : "bg-surface-card text-ink-muted hover:bg-border"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">No pending reviews. All caught up!</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ReviewCard
              key={item.contributionId}
              item={item}
              onReviewed={handleReviewed}
              isLoadingAudio={loadingAudioId === item.contributionId}
              isLoaded={loadedId === item.contributionId}
              isPlaying={playingId === item.contributionId}
              currentTime={loadedId === item.contributionId ? currentTime : 0}
              duration={loadedId === item.contributionId ? duration : 0}
              playError={playError?.id === item.contributionId ? playError.message : null}
              onTogglePlay={() => togglePlay(item)}
              onStop={() => stopPlayback(item)}
              onSeek={seek}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  item,
  onReviewed,
  isLoadingAudio,
  isLoaded,
  isPlaying,
  currentTime,
  duration,
  playError,
  onTogglePlay,
  onStop,
  onSeek,
}: {
  item: ReviewQueueItem;
  onReviewed: (contributionId: string) => void;
  isLoadingAudio: boolean;
  isLoaded: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playError: string | null;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const [notes, setNotes] = useState("");
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitDecision(decision: ReviewDecision) {
    setPendingDecision(decision);
    setError(null);
    try {
      await api.reviews.submitReview({ contributionId: item.contributionId, decision, notes: notes.trim() || undefined });
      onReviewed(item.contributionId);
    } catch (err) {
      // Another reviewer already resolved this one between page load and
      // this submit -- it's stale, not a real failure, so drop it from the
      // list instead of leaving a card whose buttons will just 409 again.
      if (axios.isAxiosError(err) && (err.response?.data as { code?: string } | undefined)?.code === "CONTRIBUTION_NOT_PENDING") {
        onReviewed(item.contributionId);
        return;
      }
      setError(getErrorMessage(err, "Failed to submit review"));
      setPendingDecision(null);
    }
  }

  return (
    <div className="card-duo space-y-4 rounded-2xl bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-ink">{item.contributor.displayName}</p>
          <p className="text-xs text-ink-muted">
            {item.language?.nameEnglish ?? "Unknown language"} · {new Date(item.submittedAt).toLocaleDateString()}
          </p>
        </div>
        <span className="rounded-full bg-surface-card px-2 py-1 text-xs font-bold text-ink">{item.moduleType}</span>
      </div>

      {item.detail.imageUrl ? (
        <div className="relative h-40 w-full overflow-hidden rounded-lg">
          <Image src={item.detail.imageUrl} alt="" fill sizes="100vw" className="object-cover" />
        </div>
      ) : null}

      {item.moduleType === "WORD" ? (
        <div>
          <p className="text-xl font-bold text-ink">{item.detail.nativeWord}</p>
          {item.detail.romanization ? <p className="text-sm text-ink-muted">Romanization: {item.detail.romanization}</p> : null}
          {item.detail.ipa ? <p className="text-sm text-ink-muted">IPA: {item.detail.ipa}</p> : null}
        </div>
      ) : null}

      {item.moduleType === "TRANSLATION" ? (
        <div>
          <p className="text-sm text-ink-muted">{item.detail.englishText}</p>
          <p className="mt-1 text-lg font-bold text-ink">{item.detail.nativeText}</p>
        </div>
      ) : null}

      {item.moduleType === "SCENE" ? (
        <div>
          <p className="text-lg font-bold text-ink">{item.detail.title}</p>
          <p className="text-sm capitalize text-ink-muted">Difficulty: {item.detail.difficulty}</p>
        </div>
      ) : null}

      {item.moduleType === "TRANSCRIPTION" ? (
        <div>
          <p className="text-lg font-bold text-ink">{item.detail.title}</p>
          <p className="text-sm capitalize text-ink-muted">Type: {item.detail.recordingType}</p>
          {item.detail.nativeText ? <p className="mt-1 text-sm text-ink-muted">{item.detail.nativeText}</p> : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-xl bg-surface-card p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onTogglePlay}
            disabled={!item.detail.audioFileId || isLoadingAudio}
            className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isLoadingAudio ? "Loading..." : isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          {isLoaded ? (
            <button
              onClick={onStop}
              className="btn-duo btn-duo-secondary bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-border"
            >
              ■ Stop
            </button>
          ) : null}
          {!item.detail.audioFileId ? <span className="text-xs text-ink-muted">No audio for this submission</span> : null}
        </div>
        {playError ? <p className="text-xs text-red-600">{playError}</p> : null}
        {isLoaded ? (
          <div className="flex items-center gap-2">
            <span className="w-9 flex-shrink-0 text-xs tabular-nums text-ink-muted">{formatTime(currentTime)}</span>
            <div onClick={onSeek} className="h-1.5 flex-1 cursor-pointer rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
              />
            </div>
            <span className="w-9 flex-shrink-0 text-xs tabular-nums text-ink-muted">{formatTime(duration)}</span>
          </div>
        ) : null}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional reason / notes"
        rows={2}
        className="w-full rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-3">
        <button
          onClick={() => submitDecision("valid")}
          disabled={pendingDecision !== null}
          className="btn-duo flex-1 bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          ✓ Correct
        </button>
        <button
          onClick={() => submitDecision("invalid")}
          disabled={pendingDecision !== null}
          className="btn-duo btn-duo-danger flex-1 bg-red-600 py-2.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          ✕ Incorrect
        </button>
        <button
          onClick={() => submitDecision("cannot_decide")}
          disabled={pendingDecision !== null}
          className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-2.5 font-semibold text-ink hover:bg-border disabled:opacity-50"
        >
          ? Cannot Decide
        </button>
      </div>
    </div>
  );
}
