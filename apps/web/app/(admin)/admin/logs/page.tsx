"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AuditLog } from "@/lib/api";
import { Pagination } from "@/components/admin-pagination";

const DEFAULT_PAGE_SIZE = 50;

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.superadmin
      .getAuditLogs({
        limit,
        offset,
        search: search.trim() || undefined,
        action: action.trim() || undefined,
        resource_type: resourceType.trim() || undefined,
      })
      .then((res) => {
        setLogs(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load logs"))
      .finally(() => setLoading(false));
  }, [offset, limit, search, action, resourceType]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Logs</h1>
        <p className="text-sm text-ink-muted">
          A crude, chronological record of what happens in the app -- registrations, logins, contribution
          submissions, buffer failures, and every admin/moderation action.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Search by actor name or email..."
          className="w-64 rounded-lg bg-surface-card px-4 py-2.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />
        <input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
          placeholder="Filter by action (e.g. user_login)"
          className="w-56 rounded-lg bg-surface-card px-4 py-2.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />
        <input
          value={resourceType}
          onChange={(e) => {
            setResourceType(e.target.value);
            setOffset(0);
          }}
          placeholder="Filter by resource type (e.g. contribution)"
          className="w-64 rounded-lg bg-surface-card px-4 py-2.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />
      </div>

      {error ? <p className="text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : logs.length === 0 ? (
        <p className="text-ink-muted">No log entries found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase text-ink-muted">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border last:border-0 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {log.actorDisplayName ? (
                      <>
                        <div className="font-medium text-ink">{log.actorDisplayName}</div>
                        <div className="text-xs text-ink-muted">{log.actorEmail}</div>
                      </>
                    ) : (
                      <span className="text-ink-muted">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-card px-2 py-0.5 text-xs font-semibold text-ink">{log.action}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {log.resourceType}
                    {log.resourceId ? <span className="block text-xs">{log.resourceId.slice(0, 8)}...</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {log.beforeState || log.afterState ? (
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        {expandedId === log.id ? "Hide" : "View"}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">--</span>
                    )}
                    {expandedId === log.id ? (
                      <pre className="mt-2 max-w-md overflow-x-auto rounded-lg bg-surface-card p-2 text-xs text-ink">
                        {JSON.stringify({ before: log.beforeState, after: log.afterState }, null, 2)}
                      </pre>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
