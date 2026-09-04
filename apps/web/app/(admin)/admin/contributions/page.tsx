"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AdminContributionListItem, type ContributionStatusValue, type ModuleType } from "@/lib/api";

const MODULE_LABEL: Record<ModuleType, string> = {
  WORD: "Word",
  TRANSCRIPTION: "Audio Upload",
  TRANSLATION: "Translation",
  SCENE: "Scene",
};

const STATUS_OPTIONS: ContributionStatusValue[] = ["draft", "pending", "under_review", "verified", "needs_correction", "rejected"];
const MODULE_OPTIONS: ModuleType[] = ["WORD", "TRANSCRIPTION", "TRANSLATION", "SCENE"];

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-600",
  pending: "bg-yellow-600",
  under_review: "bg-yellow-600",
  verified: "bg-emerald-600",
  needs_correction: "bg-orange-600",
  rejected: "bg-red-600",
};

export default function AdminContributionsPage() {
  const [status, setStatus] = useState<ContributionStatusValue | "">("");
  const [moduleType, setModuleType] = useState<ModuleType | "">("");
  const [items, setItems] = useState<AdminContributionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(
        await api.admin.getContributions({
          status: status || undefined,
          module_type: moduleType || undefined,
          limit: 100,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [status, moduleType]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAction(id: string, newStatus: "verified" | "rejected") {
    setActioningId(id);
    try {
      await api.admin.updateContributionStatus(id, { status: newStatus });
      setItems((prev) => prev.map((item) => (item.contributionId === id ? { ...item, status: newStatus } : item)));
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Contributions</h1>

      <div className="flex gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ContributionStatusValue | "")}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          value={moduleType}
          onChange={(e) => setModuleType(e.target.value as ModuleType | "")}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700"
        >
          <option value="">All modules</option>
          {MODULE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {MODULE_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700 text-slate-400">
              <tr>
                <th className="px-4 py-3">Contributor</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.contributionId} className="border-b border-slate-700/50 last:border-0">
                  <td className="px-4 py-3 text-white">{item.contributor.displayName}</td>
                  <td className="px-4 py-3 text-slate-300">{MODULE_LABEL[item.moduleType]}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold capitalize text-white ${STATUS_COLOR[item.status] ?? "bg-slate-600"}`}
                    >
                      {item.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{new Date(item.submittedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(item.contributionId, "verified")}
                        disabled={actioningId === item.contributionId || item.status === "verified"}
                        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => handleAction(item.contributionId, "rejected")}
                        disabled={actioningId === item.contributionId || item.status === "rejected"}
                        className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </div>
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
