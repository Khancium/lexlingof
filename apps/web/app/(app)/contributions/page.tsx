"use client";

import { useEffect, useState } from "react";
import { api, type ContributionListItem, type ModuleType } from "@/lib/api";

const MODULE_LABEL: Record<ModuleType, string> = {
  WORD: "Word",
  TRANSCRIPTION: "Audio Upload",
  TRANSLATION: "Translation",
  SCENE: "Scene",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-600",
  pending: "bg-yellow-600",
  under_review: "bg-yellow-600",
  verified: "bg-emerald-600",
  needs_correction: "bg-orange-600",
  rejected: "bg-red-600",
};

const FILTERS: { label: string; value: ModuleType | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Word", value: "WORD" },
  { label: "Audio", value: "TRANSCRIPTION" },
  { label: "Translation", value: "TRANSLATION" },
  { label: "Scene", value: "SCENE" },
];

export default function ContributionsPage() {
  const [filter, setFilter] = useState<ModuleType | undefined>(undefined);
  const [items, setItems] = useState<ContributionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.users
      .getContributions({ limit: 100, moduleType: filter })
      .then((res) => setItems(res.items))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">My Contributions</h1>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
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
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Points</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-ink">{MODULE_LABEL[item.moduleType]}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize text-white ${STATUS_COLOR[item.status] ?? "bg-slate-500"}`}
                    >
                      {item.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{new Date(item.submittedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-600">
                    {item.totalPoints != null ? `+${item.totalPoints}` : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
