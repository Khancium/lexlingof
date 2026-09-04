"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, type GamificationConfigRow } from "@/lib/api";

export default function GamificationConfigPage() {
  const user = useAuthStore((state) => state.user);
  const [rows, setRows] = useState<GamificationConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "super_admin") return;
    api.superadmin.getGamificationConfig().then((res) => {
      setRows(res);
      setLoading(false);
    });
  }, [user]);

  if (user?.role !== "super_admin") {
    return <p className="text-red-400">Super-admin access required.</p>;
  }

  function numericValue(row: GamificationConfigRow): number | null {
    const v = (row.configValue as { value?: unknown })?.value;
    return typeof v === "number" ? v : null;
  }

  function startEdit(row: GamificationConfigRow) {
    setEditingKey(row.configKey);
    setEditValue(String(numericValue(row) ?? 0));
    setError(null);
  }

  async function saveEdit(key: string) {
    const parsed = Number(editValue);
    if (Number.isNaN(parsed)) {
      setError("Value must be a number");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const updated = await api.superadmin.updateGamificationConfig(key, parsed);
      setRows((prev) => prev.map((r) => (r.configKey === key ? updated : r)));
      setEditingKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update config");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Gamification Config</h1>

      <div className="rounded-lg border border-yellow-700 bg-yellow-950 p-4 text-sm text-yellow-300">
        ⚠ Changing these values affects all future point awards.
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700 text-slate-400">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.configKey} className="border-b border-slate-700/50 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-white">{row.configKey}</td>
                  <td className="px-4 py-3 text-slate-400">{row.description}</td>
                  <td className="px-4 py-3">
                    {editingKey === row.configKey ? (
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 rounded bg-slate-900 px-2 py-1 text-white ring-1 ring-slate-700"
                      />
                    ) : (
                      <span className="text-white">{numericValue(row) ?? JSON.stringify(row.configValue)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingKey === row.configKey ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(row.configKey)}
                          disabled={isSaving}
                          className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingKey(null)}
                          className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(row)} className="text-xs font-semibold text-blue-400 hover:underline">
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
