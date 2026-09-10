"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AdminUser } from "@/lib/api";
import { LEVEL_COLOR } from "@/lib/level";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";

const PAGE_SIZE = 20;

type StatusFilter = "" | "active" | "restricted" | "suspended";

function statusBadge(u: AdminUser): { label: string; className: string } {
  if (u.isSuspended) {
    const until = u.suspendedUntil ? new Date(u.suspendedUntil) : null;
    return {
      label: until ? `Cool-off until ${until.toLocaleDateString()}` : "Suspended",
      className: "bg-red-100 text-red-700",
    };
  }
  if (u.isRestricted) {
    return { label: "Restricted", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Active", className: "bg-emerald-100 text-emerald-700" };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .getUsers({ limit: PAGE_SIZE, offset, search: search.trim() || undefined, status: status || undefined })
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }, [offset, search, status]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  async function handleRestrict(u: AdminUser) {
    const reason = window.prompt(`Reason for restricting ${u.displayName}? (blocks new contribution submissions, they can still log in)`);
    if (!reason) return;
    setBusyId(u.id);
    try {
      await api.admin.restrictUser(u.id, reason);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restrict user");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnrestrict(u: AdminUser) {
    setBusyId(u.id);
    try {
      await api.admin.unrestrictUser(u.id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unrestrict user");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCooloff(u: AdminUser) {
    const daysStr = window.prompt(`Cool-off ${u.displayName} for how many days? (blocks login entirely for this long)`, "7");
    if (!daysStr) return;
    const days = Number(daysStr);
    if (!Number.isFinite(days) || days < 1) {
      alert("Enter a whole number of days (1 or more).");
      return;
    }
    const reason = window.prompt("Reason for the cool-off?");
    if (!reason) return;
    setBusyId(u.id);
    try {
      await api.admin.cooloffUser(u.id, reason, Math.round(days));
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to apply cool-off");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnsuspend(u: AdminUser) {
    setBusyId(u.id);
    try {
      await api.admin.unsuspendUser(u.id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to lift suspension");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBan(u: AdminUser) {
    if (
      !window.confirm(
        `Ban ${u.displayName} (${u.email}) by deleting their account? This scrubs their profile and permanently blocks this email from registering again. Their past contributions stay in the corpus. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(u.id);
    try {
      await api.admin.banUser(u.id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to ban user");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Users</h1>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Search by name or email..."
          className="w-64 rounded-lg bg-surface-card px-4 py-2.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setOffset(0);
          }}
          className="rounded-lg bg-surface-card px-4 py-2.5 text-sm text-ink ring-1 ring-border"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="restricted">Restricted</option>
          <option value="suspended">Suspended / Cool-off</option>
        </select>
      </div>

      {error ? <p className="text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : users.length === 0 ? (
        <p className="text-ink-muted">No users found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase text-ink-muted">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Contributions</th>
                <th className="px-4 py-3">Points</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const badge = statusBadge(u);
                const isBusy = busyId === u.id;
                return (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{u.displayName}</div>
                      <div className="text-xs text-ink-muted">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{u.role}</td>
                    <td className="px-4 py-3">
                      {u.level ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${LEVEL_COLOR[u.level]}`}>{u.level}</span>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {u.totalContributions ?? 0} ({u.verifiedContributions ?? 0} verified)
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{u.totalPoints ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                      {u.isSuspended && u.suspendedReason ? (
                        <p className="mt-1 max-w-[180px] text-[11px] text-ink-muted">{u.suspendedReason}</p>
                      ) : u.isRestricted && u.restrictedReason ? (
                        <p className="mt-1 max-w-[180px] text-[11px] text-ink-muted">{u.restrictedReason}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {u.isSuspended ? (
                          <button
                            onClick={() => handleUnsuspend(u)}
                            disabled={isBusy}
                            className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border disabled:opacity-50"
                          >
                            Lift ban
                          </button>
                        ) : (
                          <button
                            onClick={() => handleCooloff(u)}
                            disabled={isBusy}
                            className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
                          >
                            Cool-off
                          </button>
                        )}
                        {u.isRestricted ? (
                          <button
                            onClick={() => handleUnrestrict(u)}
                            disabled={isBusy}
                            className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border disabled:opacity-50"
                          >
                            Unrestrict
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRestrict(u)}
                            disabled={isBusy || u.isSuspended}
                            className="rounded-full bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                          >
                            Restrict
                          </button>
                        )}
                        {u.role !== "super_admin" ? (
                          <button
                            onClick={() => handleBan(u)}
                            disabled={isBusy}
                            className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                          >
                            Ban (delete)
                          </button>
                        ) : null}
                        <AdminUndoButton
                          resourceType="user"
                          identifier={u.id}
                          onUndone={load}
                          className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />}
    </div>
  );
}
