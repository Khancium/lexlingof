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
    return <p className="text-red-600">Super-admin access required.</p>;
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
      <h1 className="text-2xl font-bold text-ink">Gamification Config</h1>

      <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
        ⚠ Changing these values affects all future point awards.
      </div>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.configKey} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-ink">{row.configKey}</td>
                  <td className="px-4 py-3 text-ink-muted">{row.description}</td>
                  <td className="px-4 py-3">
                    {editingKey === row.configKey ? (
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 rounded bg-surface-card px-2 py-1 text-ink ring-1 ring-border"
                      />
                    ) : (
                      <span className="text-ink">{numericValue(row) ?? JSON.stringify(row.configValue)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingKey === row.configKey ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(row.configKey)}
                          disabled={isSaving}
                          className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-ink-inverted hover:bg-brand-dark"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingKey(null)}
                          className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(row)} className="text-xs font-semibold text-brand hover:underline">
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
