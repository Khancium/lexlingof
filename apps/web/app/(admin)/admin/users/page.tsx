"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  downloadBlob,
  getErrorMessage,
  type AdminUser,
  type AdminUsersQuery,
  type ContributorLevel,
  type EducationLevel,
  type GenderOption,
  type NamedOption,
  type ReportFormat,
  type UserSortOption,
  type UserStatusFilter,
} from "@/lib/api";
import { EDUCATION_LEVEL_OPTIONS, GENDER_OPTIONS } from "@/lib/demographics-constants";
import { LEVEL_COLOR } from "@/lib/level";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";
import { AdminMultiSelect } from "@/components/admin-multi-select";
import { AdminUserActionModal } from "@/components/admin-user-action-modal";
import { AdminUserDetailsModal } from "@/components/admin-user-details-modal";

const DEFAULT_PAGE_SIZE = 20;

const ROLE_OPTIONS = ["contributor", "reviewer", "admin", "super_admin"] as const;
const STATUS_OPTIONS: UserStatusFilter[] = ["active", "restricted", "suspended"];
const LEVEL_OPTIONS: ContributorLevel[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];

const STATUS_LABEL: Record<UserStatusFilter, string> = {
  active: "Active",
  restricted: "Restricted",
  suspended: "Suspended / Cool-off",
};

const SORT_OPTIONS: { value: UserSortOption; label: string }[] = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "contributions_desc", label: "Most contributions" },
  { value: "points_desc", label: "Most points" },
  { value: "name_asc", label: "Name (A-Z)" },
];

const selectClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border";
const inputClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border";
const numberClass = `${inputClass} w-24`;

type Filters = {
  search: string;
  role: string[];
  status: UserStatusFilter[];
  gender: GenderOption[];
  educationLevel: EducationLevel[];
  tribeId: string[];
  subTribeId: string[];
  villageId: string[];
  quarterId: string[];
  country: string;
  city: string;
  motherTongue: string;
  profession: string;
  minAge: string;
  maxAge: string;
  level: ContributorLevel[];
  minContributions: string;
  maxContributions: string;
  minVerified: string;
  minPoints: string;
  maxPoints: string;
  minReviews: string;
  activity: "" | "contributed" | "never_contributed";
  joinedFrom: string;
  joinedTo: string;
  sort: UserSortOption;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  role: [],
  status: [],
  gender: [],
  educationLevel: [],
  tribeId: [],
  subTribeId: [],
  villageId: [],
  quarterId: [],
  country: "",
  city: "",
  motherTongue: "",
  profession: "",
  minAge: "",
  maxAge: "",
  level: [],
  minContributions: "",
  maxContributions: "",
  minVerified: "",
  minPoints: "",
  maxPoints: "",
  minReviews: "",
  activity: "",
  joinedFrom: "",
  joinedTo: "",
  sort: "created_desc",
};

/** "" and non-numeric text mean "no bound", not 0 -- an empty box must not filter everything out. */
function numOrUndefined(value: string) {
  const n = Number(value);
  return value.trim() === "" || Number.isNaN(n) ? undefined : n;
}

function trimOrUndefined(value: string) {
  return value.trim() || undefined;
}

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

function dedupeById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) for (const item of list) map.set(item.id, item);
  return Array.from(map.values());
}

export default function AdminUsersPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionUser, setActionUser] = useState<AdminUser | null>(null);
  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reportBusy, setReportBusy] = useState(false);

  // Cascading filter option sources.
  const [tribes, setTribes] = useState<NamedOption[]>([]);
  const [subTribes, setSubTribes] = useState<NamedOption[]>([]);
  const [villages, setVillages] = useState<NamedOption[]>([]);
  const [quarters, setQuarters] = useState<NamedOption[]>([]);

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  }

  const query = useMemo<AdminUsersQuery>(
    () => ({
      limit,
      offset,
      search: trimOrUndefined(filters.search),
      role: filters.role,
      status: filters.status,
      gender: filters.gender,
      education_level: filters.educationLevel,
      tribe_id: filters.tribeId,
      sub_tribe_id: filters.subTribeId,
      village_id: filters.villageId,
      quarter_id: filters.quarterId,
      country: trimOrUndefined(filters.country),
      city: trimOrUndefined(filters.city),
      mother_tongue: trimOrUndefined(filters.motherTongue),
      profession: trimOrUndefined(filters.profession),
      min_age: numOrUndefined(filters.minAge),
      max_age: numOrUndefined(filters.maxAge),
      level: filters.level,
      min_contributions: numOrUndefined(filters.minContributions),
      max_contributions: numOrUndefined(filters.maxContributions),
      min_verified: numOrUndefined(filters.minVerified),
      min_points: numOrUndefined(filters.minPoints),
      max_points: numOrUndefined(filters.maxPoints),
      min_reviews: numOrUndefined(filters.minReviews),
      activity: filters.activity || undefined,
      joined_from: filters.joinedFrom ? new Date(filters.joinedFrom).toISOString() : undefined,
      // An end date is inclusive of the whole day, otherwise picking today
      // returns nothing (everything today is after 00:00).
      joined_to: filters.joinedTo ? new Date(`${filters.joinedTo}T23:59:59.999Z`).toISOString() : undefined,
      sort: filters.sort,
    }),
    [filters, limit, offset],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .getUsers(query)
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load users")))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    api.demographics.getTribes().then(setTribes).catch(() => setTribes([]));
  }, []);

  useEffect(() => {
    if (filters.tribeId.length) {
      Promise.all(filters.tribeId.map((id) => api.demographics.getSubTribes(id)))
        .then((lists) => setSubTribes(dedupeById(lists)))
        .catch(() => setSubTribes([]));
    } else {
      setSubTribes([]);
    }
  }, [filters.tribeId]);

  useEffect(() => {
    if (filters.country.trim() && filters.city.trim()) {
      api.demographics.getVillages(filters.country.trim(), filters.city.trim()).then(setVillages).catch(() => setVillages([]));
    } else {
      setVillages([]);
    }
  }, [filters.country, filters.city]);

  useEffect(() => {
    if (filters.villageId.length) {
      Promise.all(filters.villageId.map((id) => api.demographics.getQuarters(id)))
        .then((lists) => setQuarters(dedupeById(lists)))
        .catch(() => setQuarters([]));
    } else {
      setQuarters([]);
    }
  }, [filters.villageId]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const [key, value] of Object.entries(filters)) {
      if (key === "sort" || key === "search") continue;
      if (Array.isArray(value) ? value.length > 0 : value !== "") count += 1;
    }
    return count;
  }, [filters]);

  // Selection is tracked across pages by id, so a bulk report can span more
  // than one page of results; only ids still known to the table are shown as
  // selected, but the set itself is not pruned on navigation.
  const pageIds = users.map((u) => u.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) for (const id of pageIds) next.delete(id);
      else for (const id of pageIds) next.add(id);
      return next;
    });
  }

  async function downloadIndividual(u: AdminUser, format: ReportFormat) {
    setBusyId(u.id);
    try {
      const { blob, filename } = await api.admin.getUserReport(u.id, format);
      downloadBlob(blob, filename);
    } catch (err) {
      alert(getErrorMessage(err, "Failed to generate report"));
    } finally {
      setBusyId(null);
    }
  }

  async function downloadConsolidated(format: ReportFormat) {
    if (selected.size === 0) return;
    setReportBusy(true);
    try {
      const { blob, filename } = await api.admin.getUsersReport(Array.from(selected), format);
      downloadBlob(blob, filename);
    } catch (err) {
      alert(getErrorMessage(err, "Failed to generate report"));
    } finally {
      setReportBusy(false);
    }
  }

  async function handleUnrestrict(u: AdminUser) {
    setBusyId(u.id);
    try {
      await api.admin.unrestrictUser(u.id);
      load();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to unrestrict user"));
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
      alert(getErrorMessage(err, "Failed to lift suspension"));
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
      alert(getErrorMessage(err, "Failed to ban user"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Users</h1>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={filters.search}
          onChange={(e) => update("search", e.target.value)}
          placeholder="Search by name or email..."
          className={`${inputClass} w-64`}
        />
        <select value={filters.sort} onChange={(e) => update("sort", e.target.value as UserSortOption)} className={selectClass}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`${selectClass} font-semibold ${activeFilterCount > 0 ? "text-brand" : "text-ink"}`}
        >
          {showFilters ? "Hide filters" : "Filters"}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        {activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setFilters((prev) => ({ ...EMPTY_FILTERS, search: prev.search, sort: prev.sort }));
              setOffset(0);
            }}
            className="text-sm font-semibold text-brand hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {showFilters ? (
        <div className="space-y-4 rounded-2xl bg-surface p-4 shadow-sm">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Signup details</p>
            <div className="flex flex-wrap gap-2">
              <AdminMultiSelect
                label="genders"
                options={GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                selected={filters.gender}
                onChange={(v) => update("gender", v)}
              />
              <AdminMultiSelect
                label="education"
                options={EDUCATION_LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                selected={filters.educationLevel}
                onChange={(v) => update("educationLevel", v)}
              />
              <AdminMultiSelect
                label="tribes"
                options={tribes.map((t) => ({ value: t.id, label: t.name }))}
                selected={filters.tribeId}
                onChange={(v) => {
                  update("tribeId", v);
                  update("subTribeId", []);
                }}
              />
              <AdminMultiSelect
                label="sub-tribes"
                options={subTribes.map((t) => ({ value: t.id, label: t.name }))}
                selected={filters.subTribeId}
                onChange={(v) => update("subTribeId", v)}
                disabled={filters.tribeId.length === 0}
              />
              <input
                value={filters.country}
                onChange={(e) => update("country", e.target.value)}
                placeholder="Country"
                className={`${inputClass} w-32`}
              />
              <input
                value={filters.city}
                onChange={(e) => update("city", e.target.value)}
                placeholder="City"
                className={`${inputClass} w-32`}
              />
              <AdminMultiSelect
                label="villages"
                options={villages.map((v) => ({ value: v.id, label: v.name }))}
                selected={filters.villageId}
                onChange={(v) => {
                  update("villageId", v);
                  update("quarterId", []);
                }}
                disabled={!filters.country.trim() || !filters.city.trim()}
              />
              <AdminMultiSelect
                label="quarters"
                options={quarters.map((q) => ({ value: q.id, label: q.name }))}
                selected={filters.quarterId}
                onChange={(v) => update("quarterId", v)}
                disabled={filters.villageId.length === 0}
              />
              <input
                value={filters.motherTongue}
                onChange={(e) => update("motherTongue", e.target.value)}
                placeholder="Mother tongue"
                className={`${inputClass} w-36`}
              />
              <input
                value={filters.profession}
                onChange={(e) => update("profession", e.target.value)}
                placeholder="Profession"
                className={`${inputClass} w-32`}
              />
              <input
                type="number"
                min={0}
                value={filters.minAge}
                onChange={(e) => update("minAge", e.target.value)}
                placeholder="Min age"
                className={numberClass}
              />
              <input
                type="number"
                min={0}
                value={filters.maxAge}
                onChange={(e) => update("maxAge", e.target.value)}
                placeholder="Max age"
                className={numberClass}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Account &amp; activity</p>
            <div className="flex flex-wrap gap-2">
              <AdminMultiSelect
                label="roles"
                options={ROLE_OPTIONS.map((r) => ({ value: r, label: r.replace("_", " ") }))}
                selected={filters.role}
                onChange={(v) => update("role", v)}
              />
              <AdminMultiSelect
                label="statuses"
                options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                selected={filters.status}
                onChange={(v) => update("status", v)}
              />
              <AdminMultiSelect
                label="levels"
                options={LEVEL_OPTIONS.map((l) => ({ value: l, label: l }))}
                selected={filters.level}
                onChange={(v) => update("level", v)}
              />
              <select
                value={filters.activity}
                onChange={(e) => update("activity", e.target.value as Filters["activity"])}
                className={selectClass}
              >
                <option value="">Any activity</option>
                <option value="contributed">Has contributed</option>
                <option value="never_contributed">Never contributed</option>
              </select>
              <input
                type="number"
                min={0}
                value={filters.minContributions}
                onChange={(e) => update("minContributions", e.target.value)}
                placeholder="Min contrib."
                className={numberClass}
              />
              <input
                type="number"
                min={0}
                value={filters.maxContributions}
                onChange={(e) => update("maxContributions", e.target.value)}
                placeholder="Max contrib."
                className={numberClass}
              />
              <input
                type="number"
                min={0}
                value={filters.minVerified}
                onChange={(e) => update("minVerified", e.target.value)}
                placeholder="Min verified"
                className={numberClass}
              />
              <input
                type="number"
                min={0}
                value={filters.minPoints}
                onChange={(e) => update("minPoints", e.target.value)}
                placeholder="Min points"
                className={numberClass}
              />
              <input
                type="number"
                min={0}
                value={filters.maxPoints}
                onChange={(e) => update("maxPoints", e.target.value)}
                placeholder="Max points"
                className={numberClass}
              />
              <input
                type="number"
                min={0}
                value={filters.minReviews}
                onChange={(e) => update("minReviews", e.target.value)}
                placeholder="Min reviews"
                className={numberClass}
              />
              <label className="flex items-center gap-1 text-xs text-ink-muted">
                Joined
                <input
                  type="date"
                  value={filters.joinedFrom}
                  onChange={(e) => update("joinedFrom", e.target.value)}
                  className={inputClass}
                />
                to
                <input
                  type="date"
                  value={filters.joinedTo}
                  onChange={(e) => update("joinedTo", e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-brand/10 p-3 ring-1 ring-brand/30">
          <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => downloadConsolidated("csv")}
            disabled={reportBusy}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {reportBusy ? "Generating..." : "Consolidated CSV"}
          </button>
          <button
            type="button"
            onClick={() => downloadConsolidated("pdf")}
            disabled={reportBusy}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {reportBusy ? "Generating..." : "Consolidated PDF"}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-semibold text-brand hover:underline">
            Clear selection
          </button>
        </div>
      ) : null}

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
                <th className="px-4 py-3">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} aria-label="Select all on page" />
                </th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Contributions</th>
                <th className="px-4 py-3">Points</th>
                <th className="px-4 py-3">Reviews</th>
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
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => toggleOne(u.id)}
                        aria-label={`Select ${u.displayName}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{u.displayName}</div>
                      <div className="text-xs text-ink-muted">{u.email}</div>
                      {u.tribeName || u.city ? (
                        <div className="text-[11px] text-ink-muted">{[u.tribeName, u.city, u.motherTongue].filter(Boolean).join(" · ")}</div>
                      ) : null}
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
                    <td className="px-4 py-3 text-ink-muted">{u.reviewsCompleted ?? 0}</td>
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
                        <button
                          onClick={() => setDetailsUserId(u.id)}
                          className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => downloadIndividual(u, "csv")}
                          disabled={isBusy}
                          className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border disabled:opacity-50"
                        >
                          CSV
                        </button>
                        <button
                          onClick={() => downloadIndividual(u, "pdf")}
                          disabled={isBusy}
                          className="rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border disabled:opacity-50"
                        >
                          PDF
                        </button>
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
                            onClick={() => setActionUser(u)}
                            disabled={isBusy}
                            className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
                          >
                            Restrict / Cool-off
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
                        ) : null}
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

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}

      {actionUser ? (
        <AdminUserActionModal user={actionUser} onClose={() => setActionUser(null)} onDone={load} />
      ) : null}
      {detailsUserId ? (
        <AdminUserDetailsModal userId={detailsUserId} onClose={() => setDetailsUserId(null)} />
      ) : null}
    </div>
  );
}
