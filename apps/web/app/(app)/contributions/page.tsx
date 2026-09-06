"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { api, type ContributionListItem, type ModuleType } from "@/lib/api";
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

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

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

  useEffect(() => {
    load();
  }, [load]);

  function changeFilter(value: ModuleType | undefined) {
    setFilter(value);
    setOffset(0);
    setPlayingId(null);
  }

  async function togglePlay(item: ContributionListItem) {
    if (playingId === item.id) {
      setPlayingId(null);
      setPlayUrl(null);
      return;
    }
    const audioFileId = item.detail?.audioFileId;
    if (!audioFileId) return;
    setPlayingId(item.id);
    setPlayUrl(null);
    setPlayError(null);
    try {
      const { url } = await api.audio.getPlayUrl(audioFileId);
      setPlayUrl(url);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Failed to load audio");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">My Contributions</h1>

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
                {playingId === item.id && (
                  <div className="mt-2">
                    {playUrl ? (
                      <audio src={playUrl} controls autoPlay className="h-9 max-w-full" />
                    ) : playError ? (
                      <p className="text-xs text-red-600">{playError}</p>
                    ) : (
                      <p className="text-xs text-ink-muted">Loading audio...</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-shrink-0 items-center gap-4">
                {item.detail?.audioFileId ? (
                  <button
                    onClick={() => togglePlay(item)}
                    className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark"
                  >
                    {playingId === item.id ? "Stop" : "▶ Play"}
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
