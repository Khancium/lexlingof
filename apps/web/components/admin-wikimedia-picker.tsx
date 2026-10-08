"use client";

import { useEffect, useState } from "react";
import { api, getErrorMessage, type WikimediaImageResult } from "@/lib/api";

/**
 * Search-and-pick modal for Wikimedia Commons' media library, shared by the
 * concepts and scenes admin pages -- same shape as AdminOpenversePicker, just
 * against Commons directly instead of Openverse's aggregated catalog (a much
 * larger pool, useful when Openverse hasn't indexed an image yet). Only
 * returns the chosen result to the caller; attaching it is the caller's job.
 */
export function AdminWikimediaPicker({
  defaultQuery,
  onSelect,
  onClose,
}: {
  defaultQuery: string;
  onSelect: (image: WikimediaImageResult) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<WikimediaImageResult[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  function search(q: string, p: number) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    api.admin
      .searchWikimedia(trimmed, p)
      .then((res) => {
        setResults(res.results);
        setPageCount(res.pageCount);
        setPage(res.page);
      })
      .catch((err) => setError(getErrorMessage(err, "Search failed")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    search(defaultQuery, 1);
    // Only on mount -- subsequent searches are user-triggered (submit / page buttons).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelect(image: WikimediaImageResult) {
    setAttachingId(image.id);
    setError(null);
    try {
      await onSelect(image);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to attach image"));
    } finally {
      setAttachingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card-duo flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Find an image on Wikimedia Commons</h2>
          <button onClick={onClose} className="text-sm font-semibold text-ink-muted hover:text-ink">
            Close
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(query, 1);
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Wikimedia Commons..."
            autoFocus
            className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            Search
          </button>
        </form>

        {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">Searching...</p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">No results. Try a different search term.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {results.map((image) => (
                <button
                  key={image.id}
                  onClick={() => handleSelect(image)}
                  disabled={attachingId !== null}
                  className="group relative overflow-hidden rounded-lg text-left ring-1 ring-border transition hover:ring-2 hover:ring-brand disabled:opacity-50"
                >
                  {/* Third-party thumbnails served straight from Wikimedia -- not run
                     through next/image, same reasoning as the Openverse picker. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.thumbnail ?? image.url} alt={image.title ?? ""} className="h-28 w-full object-cover sm:h-32" />
                  <div className="bg-surface-card p-1.5">
                    <p className="truncate text-[11px] font-semibold text-ink">{image.title ?? "Untitled"}</p>
                    <p className="truncate text-[10px] text-ink-muted">{image.creator ?? "Unknown creator"}</p>
                    <span className="mt-0.5 inline-block rounded-full bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted ring-1 ring-border">
                      {image.license}
                    </span>
                  </div>
                  {attachingId === image.id ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white">
                      Attaching...
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => search(query, page - 1)}
              disabled={page <= 1 || loading}
              className="text-xs font-semibold text-brand hover:underline disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs text-ink-muted">
              Page {page} of {pageCount}
            </span>
            <button
              onClick={() => search(query, page + 1)}
              disabled={page >= pageCount || loading}
              className="text-xs font-semibold text-brand hover:underline disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        ) : null}

        <p className="mt-3 text-center text-[11px] text-ink-muted">
          Images from{" "}
          <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer" className="underline">
            Wikimedia Commons
          </a>{" "}
          -- attribution is stored automatically when you pick one.
        </p>
      </div>
    </div>
  );
}
