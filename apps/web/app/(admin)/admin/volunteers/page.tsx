"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  api,
  getErrorMessage,
  type PendingChange,
  type PendingTargetType,
  type VolunteerActivity,
  type VolunteerListItem,
} from "@/lib/api";
import { AdminToggle } from "@/components/admin-toggle";

/** The four review groups the admin explicitly wants pending changes split into. */
const GROUPS: { key: string; label: string; targetTypes: PendingTargetType[] }[] = [
  { key: "images", label: "Images", targetTypes: ["concept_media", "scene_media"] },
  { key: "modules", label: "Concepts & Scenes", targetTypes: ["concept", "scene"] },
  { key: "categories", label: "Categories", targetTypes: ["category"] },
  { key: "sentences", label: "Sentences", targetTypes: ["sentence"] },
];

function groupPending(items: PendingChange[]) {
  return GROUPS.map((g) => ({ ...g, items: items.filter((i) => g.targetTypes.includes(i.targetType)) })).filter(
    (g) => g.items.length > 0,
  );
}

export default function AdminVolunteersPage() {
  const [volunteers, setVolunteers] = useState<VolunteerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<VolunteerActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .listVolunteers()
      .then(setVolunteers)
      .catch((err) => setError(getErrorMessage(err, "Failed to load volunteers")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadActivity = useCallback((id: string) => {
    setActivityLoading(true);
    setActivityError(null);
    api.admin
      .getVolunteerActivity(id)
      .then(setActivity)
      .catch((err) => setActivityError(getErrorMessage(err, "Failed to load activity")))
      .finally(() => setActivityLoading(false));
  }, []);

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setActivity(null);
      return;
    }
    setExpandedId(id);
    setActivity(null);
    loadActivity(id);
  }

  async function handleAutoApproveToggle(v: VolunteerListItem) {
    setTogglingId(v.id);
    try {
      const updated = await api.admin.setVolunteerAutoApprove(v.id, !v.autoApproveVolunteer);
      setVolunteers((prev) => prev.map((x) => (x.id === v.id ? { ...x, autoApproveVolunteer: updated.autoApproveVolunteer } : x)));
    } catch (err) {
      alert(getErrorMessage(err, "Failed to update auto-approve"));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRevoke(v: VolunteerListItem) {
    if (!confirm(`Revoke volunteer status from ${v.displayName} (${v.email})? They become a regular contributor again.`)) return;
    setBusyAction(`revoke-${v.id}`);
    try {
      await api.admin.setVolunteer(v.id, false);
      if (expandedId === v.id) {
        setExpandedId(null);
        setActivity(null);
      }
      load();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to revoke volunteer status"));
    } finally {
      setBusyAction(null);
    }
  }

  function refreshExpanded() {
    if (expandedId) loadActivity(expandedId);
    load();
  }

  async function handleApprove(id: string) {
    setBusyAction(`approve-${id}`);
    try {
      await api.admin.approvePendingChange(id);
      refreshExpanded();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to approve"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReject(id: string) {
    const reason = window.prompt("Reason for rejecting (optional):") ?? undefined;
    setBusyAction(`reject-${id}`);
    try {
      await api.admin.rejectPendingChange(id, reason || undefined);
      refreshExpanded();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to reject"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGroupApproveAll(groupKey: string, ids: string[]) {
    if (ids.length === 0) return;
    if (!confirm(`Approve all ${ids.length} pending item(s) in this group?`)) return;
    setBusyAction(`group-approve-${groupKey}`);
    try {
      const result = await api.admin.bulkApprovePendingChanges(ids);
      if (result.errors.length > 0) {
        alert(`Approved ${result.approved}. ${result.errors.length} failed:\n${result.errors.map((e) => e.message ?? e.id).join("\n")}`);
      }
      refreshExpanded();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to bulk-approve"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGroupRejectAll(groupKey: string, ids: string[]) {
    if (ids.length === 0) return;
    const reason = window.prompt(`Reason for rejecting all ${ids.length} item(s) in this group (optional):`) ?? undefined;
    if (!confirm(`Reject all ${ids.length} pending item(s) in this group?`)) return;
    setBusyAction(`group-reject-${groupKey}`);
    try {
      const result = await api.admin.bulkRejectPendingChanges(ids, reason || undefined);
      if (result.errors.length > 0) {
        alert(`Rejected ${result.rejected}. ${result.errors.length} failed:\n${result.errors.map((e) => e.message ?? e.id).join("\n")}`);
      }
      refreshExpanded();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to bulk-reject"));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Volunteers</h1>
      <p className="text-sm text-ink-muted">
        Volunteers get full access to the Concepts, Scenes, and Sentences admin pages. Unless auto-approve is on, every single-item
        create or delete they submit is queued here for review before it applies.
      </p>

      {error ? <p className="text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : volunteers.length === 0 ? (
        <p className="text-ink-muted">No one currently holds the volunteer role. Promote a contributor from the Users page.</p>
      ) : (
        <div className="card-duo overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">Volunteer</th>
                <th className="px-4 py-3">Points</th>
                <th className="px-4 py-3">Pending</th>
                <th className="px-4 py-3">Auto-approve</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {volunteers.map((v) => (
                <Fragment key={v.id}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleExpand(v.id)}
                        className="font-medium text-ink hover:text-brand hover:underline"
                      >
                        {v.displayName}
                      </button>
                      <div className="text-xs text-ink-muted">{v.email}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{v.totalPoints ?? 0}</td>
                    <td className="px-4 py-3">
                      {v.pendingCount > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{v.pendingCount}</span>
                      ) : (
                        <span className="text-xs text-ink-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AdminToggle
                        checked={v.autoApproveVolunteer}
                        onChange={() => handleAutoApproveToggle(v)}
                        disabled={togglingId === v.id}
                        label={`Toggle auto-approve for ${v.displayName}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{new Date(v.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleRevoke(v)}
                        disabled={busyAction === `revoke-${v.id}`}
                        className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                      >
                        {busyAction === `revoke-${v.id}` ? "Revoking..." : "Revoke volunteer"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === v.id ? (
                    <tr className="border-b border-border bg-surface-card/50 last:border-0">
                      <td colSpan={6} className="px-4 py-4">
                        {activityLoading ? (
                          <p className="text-sm text-ink-muted">Loading activity...</p>
                        ) : activityError ? (
                          <p className="text-sm text-red-600">{activityError}</p>
                        ) : activity ? (
                          <VolunteerActivityPanel
                            activity={activity}
                            busyAction={busyAction}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            onGroupApproveAll={handleGroupApproveAll}
                            onGroupRejectAll={handleGroupRejectAll}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VolunteerActivityPanel({
  activity,
  busyAction,
  onApprove,
  onReject,
  onGroupApproveAll,
  onGroupRejectAll,
}: {
  activity: VolunteerActivity;
  busyAction: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onGroupApproveAll: (groupKey: string, ids: string[]) => void;
  onGroupRejectAll: (groupKey: string, ids: string[]) => void;
}) {
  const pending = activity.pendingChanges.filter((p) => p.status === "pending");
  const history = activity.pendingChanges.filter((p) => p.status !== "pending");
  const groups = groupPending(pending);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Pending review</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing pending review.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const ids = g.items.map((i) => i.id);
              return (
                <div key={g.key} className="rounded-xl bg-surface p-3 ring-1 ring-border">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {g.label} <span className="text-xs font-normal text-ink-muted">({g.items.length})</span>
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => onGroupApproveAll(g.key, ids)}
                        disabled={busyAction === `group-approve-${g.key}`}
                        className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
                      >
                        Approve all
                      </button>
                      <button
                        onClick={() => onGroupRejectAll(g.key, ids)}
                        disabled={busyAction === `group-reject-${g.key}`}
                        className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                      >
                        Reject all
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {g.items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-card px-3 py-2">
                        <span className="text-sm text-ink">
                          <span className="mr-2 rounded-full bg-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-muted">
                            {item.action}
                          </span>
                          {item.label}
                          <span className="ml-2 text-xs text-ink-muted">{new Date(item.createdAt).toLocaleString()}</span>
                        </span>
                        <span className="flex gap-3">
                          <button
                            onClick={() => onApprove(item.id)}
                            disabled={busyAction === `approve-${item.id}`}
                            className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => onReject(item.id)}
                            disabled={busyAction === `reject-${item.id}`}
                            className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Reviewed history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-ink-muted">No reviewed submissions yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-card px-3 py-2 text-sm">
                <span className="text-ink">
                  <span
                    className={`mr-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      item.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {item.status}
                  </span>
                  {item.label}
                  {item.rejectionReason ? <span className="ml-2 text-xs text-ink-muted">-- {item.rejectionReason}</span> : null}
                </span>
                <span className="text-xs text-ink-muted">{item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : "--"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Audit log (auto-approved / already-applied actions)</h3>
        {activity.auditLog.length === 0 ? (
          <p className="text-sm text-ink-muted">No audit log entries yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {activity.auditLog.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-card px-3 py-2 text-sm">
                <span className="text-ink">
                  {entry.action} <span className="text-xs text-ink-muted">({entry.resourceType})</span>
                </span>
                <span className="text-xs text-ink-muted">{new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
