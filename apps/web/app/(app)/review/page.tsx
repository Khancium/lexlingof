"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuthStore } from "@/lib/store";
import { api, type ModuleType, type ReviewDecision, type ReviewQueueItem } from "@/lib/api";
import { canReview, LEVEL_THRESHOLDS } from "@/lib/level";

const TABS: { label: string; value: ModuleType | undefined }[] = [
  { label: "ALL", value: undefined },
  { label: "WORD", value: "WORD" },
  { label: "AUDIO", value: "TRANSCRIPTION" },
  { label: "TRANSLATION", value: "TRANSLATION" },
  { label: "SCENE", value: "SCENE" },
];

export default function ReviewPage() {
  const user = useAuthStore((state) => state.user);
  const [filter, setFilter] = useState<ModuleType | undefined>(undefined);
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

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
  }

  if (!canReview(user?.level)) {
    const verified = user?.verifiedContributions ?? 0;
    const threshold = LEVEL_THRESHOLDS.SILVER;
    const progressPct = Math.min(100, Math.round((verified / threshold) * 100));
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <div className="text-6xl">🏆</div>
        <h1 className="text-2xl font-bold text-ink">Unlock Review Access</h1>
        <p className="text-ink-muted">Review access requires SILVER level (100 verified contributions)</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-card">
          <div className="h-full bg-yellow-500" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-sm font-semibold text-ink">
          {verified} / {threshold}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Review Queue</h1>

      <div className="flex gap-2">
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
            <ReviewCard key={item.contributionId} item={item} onReviewed={handleReviewed} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ item, onReviewed }: { item: ReviewQueueItem; onReviewed: (contributionId: string) => void }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [notes, setNotes] = useState("");
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function togglePlay() {
    if (!item.detail.audioFileId) return;
    setError(null);
    if (!audioUrl) {
      setIsLoadingAudio(true);
      try {
        const { url } = await api.audio.getPlayUrl(item.detail.audioFileId);
        setAudioUrl(url);
        setTimeout(() => audioRef.current?.play(), 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audio");
      } finally {
        setIsLoadingAudio(false);
      }
      return;
    }
    if (isPlaying) {
      audioRef.current?.pause();
    } else {
      audioRef.current?.play();
    }
  }

  async function submitDecision(decision: ReviewDecision) {
    setPendingDecision(decision);
    setError(null);
    try {
      await api.reviews.submitReview({ contributionId: item.contributionId, decision, notes: notes.trim() || undefined });
      onReviewed(item.contributionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
      setPendingDecision(null);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-surface p-5 shadow-sm">
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

      <div className="flex items-center gap-3 rounded-xl bg-surface-card p-3">
        <button
          onClick={togglePlay}
          disabled={!item.detail.audioFileId || isLoadingAudio}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isLoadingAudio ? "Loading..." : isPlaying ? "Pause" : "Play"}
        </button>
        {!item.detail.audioFileId ? <span className="text-xs text-ink-muted">No audio for this submission</span> : null}
        {audioUrl ? (
          <audio
            ref={audioRef}
            src={audioUrl}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
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
          className="flex-1 rounded-full bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          ✓ Valid
        </button>
        <button
          onClick={() => submitDecision("needs_correction")}
          disabled={pendingDecision !== null}
          className="flex-1 rounded-full bg-yellow-500 py-2.5 font-semibold text-ink hover:bg-yellow-400 disabled:opacity-50"
        >
          ⚠ Needs Correction
        </button>
        <button
          onClick={() => submitDecision("invalid")}
          disabled={pendingDecision !== null}
          className="flex-1 rounded-full bg-red-600 py-2.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          ✕ Invalid
        </button>
      </div>
    </div>
  );
}
