"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage, type AdminSuggestion } from "@/lib/api";
import { Pagination } from "@/components/admin-pagination";

const DEFAULT_PAGE_SIZE = 50;

type Filter = "" | "true" | "false";

export default function AdminSuggestionsPage() {
  const [items, setItems] = useState<AdminSuggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [filter, setFilter] = useState<Filter>("false");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .getSuggestions({ isReviewed: filter === "" ? undefined : filter === "true", limit, offset })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load suggestions")))
      .finally(() => setLoading(false));
  }, [filter, offset, limit]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  useEffect(() => {
    load();
  }, [load]);

  async function toggleReviewed(item: AdminSuggestion) {
    setBusyId(item.id);
    try {
      await api.admin.markSuggestionReviewed(item.id, !item.isReviewed);
      load();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to update suggestion"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Suggestions</h1>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: "false", label: "Unreviewed" },
            { value: "true", label: "Reviewed" },
            { value: "", label: "All" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setFilter(opt.value);
              setOffset(0);
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              filter === opt.value ? "bg-brand text-ink-inverted" : "bg-surface-card text-ink-muted hover:bg-border"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">No suggestions found.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card-duo flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-ink">{item.message}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {item.userDisplayName} ({item.userEmail}) &middot; {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => toggleReviewed(item)}
                disabled={busyId === item.id}
                className={`btn-duo flex-shrink-0 px-4 py-2 text-xs font-semibold disabled:opacity-50 ${
                  item.isReviewed
                    ? "btn-duo-secondary bg-surface-card text-ink hover:bg-border"
                    : "bg-emerald-600 text-white hover:bg-emerald-500"
                }`}
              >
                {item.isReviewed ? "Mark Unreviewed" : "Mark Reviewed"}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
