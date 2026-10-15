"use client";

import { useEffect, useState } from "react";
import { api, type PublishableRecording, type PublishingConceptItem, type PublishingSentenceItem } from "@/lib/api";
import { Pagination } from "@/components/admin-pagination";

const PAGE_SIZE = 20;

type Tab = "words" | "sentences";

function MetaBadge({ label }: { label: string }) {
  return <span className="rounded-full bg-surface-card px-2 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-border">{label}</span>;
}

/** One contributor's recording -- audio player, metadata badges, and the publish/unpublish toggle. Shared by the words and sentences tabs. */
function RecordingRow({
  recording,
  onToggle,
  isToggling,
}: {
  recording: PublishableRecording;
  onToggle: () => void;
  isToggling: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-card p-3">
      <audio controls preload="none" src={recording.audioUrl} className="h-9 w-56" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {recording.nativeText || <span className="italic text-ink-muted">(no text)</span>}
        </p>
        <p className="truncate text-xs text-ink-muted">{recording.contributorName}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {recording.language ? <MetaBadge label={recording.language} /> : null}
        {recording.dialect ? <MetaBadge label={recording.dialect} /> : null}
        {recording.locationShared ? (
          <>
            {recording.city ? <MetaBadge label={recording.city} /> : null}
            {recording.tribe ? <MetaBadge label={recording.tribe} /> : null}
            {recording.village ? <MetaBadge label={recording.village} /> : null}
          </>
        ) : (
          <span className="text-[11px] italic text-ink-faint">Location not shared</span>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={isToggling}
        className={`btn-duo px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
          recording.isPublished
            ? "btn-duo-secondary bg-surface text-ink hover:bg-border"
            : "bg-brand text-ink-inverted hover:bg-brand-dark"
        }`}
      >
        {isToggling ? "..." : recording.isPublished ? "Unpublish" : "Publish"}
      </button>
    </div>
  );
}

export default function AdminPublishingPage() {
  const [tab, setTab] = useState<Tab>("words");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const [conceptItems, setConceptItems] = useState<PublishingConceptItem[]>([]);
  const [sentenceItems, setSentenceItems] = useState<PublishingSentenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<PublishableRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    const params = { search: search.trim() || undefined, limit: PAGE_SIZE, offset };
    const request = tab === "words" ? api.publishing.getConcepts(params) : api.publishing.getSentences(params);
    request
      .then((res) => {
        if (tab === "words") setConceptItems(res.items as PublishingConceptItem[]);
        else setSentenceItems(res.items as PublishingSentenceItem[]);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, offset]);

  function handleSearchSubmit() {
    setOffset(0);
    load();
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setRecordings([]);
      return;
    }
    setExpandedId(id);
    setRecordingsLoading(true);
    const request = tab === "words" ? api.publishing.getConceptRecordings(id) : api.publishing.getSentenceTranslations(id);
    request.then(setRecordings).finally(() => setRecordingsLoading(false));
  }

  async function handleToggle(parentId: string, recording: PublishableRecording) {
    setTogglingId(recording.id);
    try {
      if (tab === "words") {
        if (recording.isPublished) await api.publishing.unpublishRecording(parentId, recording.id);
        else await api.publishing.publishRecording(parentId, recording.id);
      } else {
        if (recording.isPublished) await api.publishing.unpublishTranslation(parentId, recording.id);
        else await api.publishing.publishTranslation(parentId, recording.id);
      }
      setRecordings((prev) => prev.map((r) => (r.id === recording.id ? { ...r, isPublished: !r.isPublished } : r)));
      load();
    } finally {
      setTogglingId(null);
    }
  }

  const items = tab === "words" ? conceptItems : sentenceItems;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Publishing</h1>
        <p className="text-sm text-ink-muted">
          Choose which verified recordings appear on the public dictionary and language-learning site. A word or sentence can have several
          published recordings at once -- publish more than one to show different dialects side by side.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setTab("words");
            setOffset(0);
            setExpandedId(null);
          }}
          className={`btn-duo px-4 py-2 text-sm font-semibold ${tab === "words" ? "bg-brand text-ink-inverted" : "btn-duo-secondary bg-surface-card text-ink"}`}
        >
          Words (Dictionary)
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("sentences");
            setOffset(0);
            setExpandedId(null);
          }}
          className={`btn-duo px-4 py-2 text-sm font-semibold ${tab === "sentences" ? "bg-brand text-ink-inverted" : "btn-duo-secondary bg-surface-card text-ink"}`}
        >
          Sentences (Language Learning)
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearchSubmit();
          }}
          placeholder={tab === "words" ? "Search words..." : "Search sentences..."}
          className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
        />
        <button onClick={handleSearchSubmit} className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink">
          Search
        </button>
      </div>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">No results.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const id = item.id;
            const label = "labelEnglish" in item ? item.labelEnglish : item.englishText;
            const category = item.categoryName;
            const isExpanded = expandedId === id;
            return (
              <div key={id} className="card-duo rounded-2xl bg-surface p-4 shadow-sm">
                <button type="button" onClick={() => toggleExpand(id)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{label}</p>
                    <p className="text-xs text-ink-muted">{category ?? "Uncategorized"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-dark">
                      {item.publishedCount} published
                    </span>
                    <span className="rounded-full bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-muted ring-1 ring-border">
                      {item.eligibleCount} verified
                    </span>
                    <span className={`text-ink-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                  </div>
                </button>

                {isExpanded ? (
                  <div className="mt-4 space-y-2 border-t border-border pt-4">
                    {recordingsLoading ? (
                      <p className="text-sm text-ink-muted">Loading recordings...</p>
                    ) : recordings.length === 0 ? (
                      <p className="text-sm text-ink-muted">No verified recordings yet for this {tab === "words" ? "word" : "sentence"}.</p>
                    ) : (
                      recordings.map((r) => (
                        <RecordingRow key={r.id} recording={r} isToggling={togglingId === r.id} onToggle={() => handleToggle(id, r)} />
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />}
    </div>
  );
}
