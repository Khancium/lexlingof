"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AdminContributionListItem,
  type AdminUser,
  type ContributionKeyword,
  type ContributionStatusValue,
  type EducationLevel,
  type GenderOption,
  type Language,
  type ModuleType,
  type NamedOption,
} from "@/lib/api";
import { EDUCATION_LEVEL_OPTIONS, GENDER_OPTIONS } from "@/lib/demographics-constants";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";

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

const DEFAULT_PAGE_SIZE = 50;

const selectClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border";
const inputClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border";

type Filters = {
  status: ContributionStatusValue[];
  moduleType: ModuleType[];
  search: string;
  userId: string;
  languageId: string[];
  dialectId: string[];
  tribeId: string[];
  subTribeId: string[];
  country: string;
  city: string;
  villageId: string[];
  quarterId: string[];
  gender: GenderOption[];
  educationLevel: EducationLevel[];
  profession: string;
};

const EMPTY_FILTERS: Filters = {
  status: [],
  moduleType: [],
  search: "",
  userId: "",
  languageId: [],
  dialectId: [],
  tribeId: [],
  subTribeId: [],
  country: "",
  city: "",
  villageId: [],
  quarterId: [],
  gender: [],
  educationLevel: [],
  profession: "",
};

/** A dropdown that lets more than one option be picked from the same filter at once (e.g. status: pending + verified). */
function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggle(value: T) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const buttonLabel =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} ${label} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`${selectClass} flex items-center gap-2 text-left disabled:opacity-50`}
      >
        {buttonLabel}
        <span className="text-ink-muted">▾</span>
      </button>
      {open ? (
        // Anchored to the button's right edge and grown leftward (rather than
        // the default left:0 growing rightward) so filters near the right
        // edge of a narrow/mobile viewport don't open off-screen with no way
        // to reach their far options.
        <div className="absolute right-0 z-10 mt-1 max-h-64 w-max min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg bg-surface p-2 shadow-lg ring-1 ring-border">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-xs text-ink-muted">No options</p>
          ) : (
            options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-surface-card">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))
          )}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs font-semibold text-brand hover:bg-surface-card"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminContributionsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<AdminContributionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBulkActing, setIsBulkActing] = useState(false);

  // Filter dropdown data sources.
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [tribes, setTribes] = useState<NamedOption[]>([]);
  const [subTribes, setSubTribes] = useState<NamedOption[]>([]);
  const [villages, setVillages] = useState<NamedOption[]>([]);
  const [quarters, setQuarters] = useState<NamedOption[]>([]);

  // Playback -- one shared hidden <audio> element, same pattern as the
  // contributor-facing My Contributions page: instant play/pause via direct
  // .play()/.pause() calls instead of mounting a fresh element per row.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playUrlCache, setPlayUrlCache] = useState<Record<string, string>>({});

  // Expandable per-row details: remarks + keywords.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [remarksDraft, setRemarksDraft] = useState("");
  const [isSavingRemarks, setIsSavingRemarks] = useState(false);
  const [keywords, setKeywords] = useState<ContributionKeyword[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [isAddingKeyword, setIsAddingKeyword] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await api.admin.getContributions({
        status: filters.status.length ? filters.status : undefined,
        module_type: filters.moduleType.length ? filters.moduleType : undefined,
        search: filters.search.trim() || undefined,
        user_id: filters.userId || undefined,
        language_id: filters.languageId.length ? filters.languageId : undefined,
        dialect_id: filters.dialectId.length ? filters.dialectId : undefined,
        tribe_id: filters.tribeId.length ? filters.tribeId : undefined,
        sub_tribe_id: filters.subTribeId.length ? filters.subTribeId : undefined,
        country: filters.country.trim() || undefined,
        city: filters.city.trim() || undefined,
        village_id: filters.villageId.length ? filters.villageId : undefined,
        quarter_id: filters.quarterId.length ? filters.quarterId : undefined,
        gender: filters.gender.length ? filters.gender : undefined,
        education_level: filters.educationLevel.length ? filters.educationLevel : undefined,
        profession: filters.profession.trim() || undefined,
        limit,
        offset,
      });
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [filters, offset, limit]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  // Debounced so typing in the search/profession/country/city text filters
  // doesn't fire a full contribution query (with its demographics joins) on
  // every keystroke -- a rapid run of filter/offset changes collapses into
  // one request 300ms after things settle instead of one per change.
  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    api.admin.getUsers({ limit: 500 }).then((res) => setUsers(res.items)).catch(() => setUsers([]));
    api.languages.getAll().then(setLanguages).catch(() => setLanguages([]));
    api.demographics.getTribes().then(setTribes).catch(() => setTribes([]));
  }, []);

  // With multi-select, a filter can now have several parents (e.g. two
  // tribes picked at once) -- fetch each parent's children in parallel and
  // union the results by id instead of only supporting a single parent.
  function dedupeById<T extends { id: string }>(lists: T[][]): T[] {
    const map = new Map<string, T>();
    for (const list of lists) for (const item of list) map.set(item.id, item);
    return Array.from(map.values());
  }

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

  // Dialects are shown as the union of every selected language's dialects.
  const availableDialects = dedupeById(
    languages.filter((l) => filters.languageId.includes(l.id)).map((l) => l.dialects),
  );

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setOffset(0);
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      // Downstream selections become meaningless once their parent changes.
      if (key === "languageId") next.dialectId = [];
      if (key === "tribeId") next.subTribeId = [];
      if (key === "country" || key === "city") {
        next.villageId = [];
        next.quarterId = [];
      }
      if (key === "villageId") next.quarterId = [];
      return next;
    });
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setOffset(0);
  }

  async function handleAction(id: string, newStatus: "verified" | "rejected") {
    setActioningId(id);
    try {
      await api.admin.updateContributionStatus(id, { status: newStatus });
      setItems((prev) => prev.map((item) => (item.contributionId === id ? { ...item, status: newStatus } : item)));
    } finally {
      setActioningId(null);
    }
  }

  async function handleDelete(item: AdminContributionListItem) {
    if (!confirm(`Delete this ${MODULE_LABEL[item.moduleType]} contribution from ${item.contributor.displayName}? This cannot be undone.`)) return;
    setActioningId(item.contributionId);
    try {
      await api.admin.deleteContribution(item.contributionId);
      setItems((prev) => prev.filter((i) => i.contributionId !== item.contributionId));
      setTotal((prev) => prev - 1);
    } finally {
      setActioningId(null);
    }
  }

  async function handleDownload(item: AdminContributionListItem) {
    const audioFileId = item.detail.audioFileId as string | undefined;
    if (!audioFileId) return;
    setActioningId(item.contributionId);
    try {
      const { url } = await api.admin.getAudioDownloadUrl(audioFileId);
      // A real <a download> click (not window.open) so the browser saves the
      // file directly instead of navigating/opening a tab -- the presigned
      // URL's Content-Disposition: attachment header does the rest.
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to get download link");
    } finally {
      setActioningId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.contributionId))));
  }

  async function handleBulkStatus(newStatus: "verified" | "rejected") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setIsBulkActing(true);
    try {
      await api.admin.bulkUpdateContributionStatus(ids, newStatus);
      setItems((prev) => prev.map((item) => (selected.has(item.contributionId) ? { ...item, status: newStatus } : item)));
      setSelected(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setIsBulkActing(false);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected contribution(s)? This cannot be undone.`)) return;
    setIsBulkActing(true);
    try {
      await api.admin.bulkDeleteContributions(ids);
      setItems((prev) => prev.filter((i) => !selected.has(i.contributionId)));
      setTotal((prev) => prev - ids.length);
      setSelected(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setIsBulkActing(false);
    }
  }

  async function handleBulkDownload() {
    const selectedItems = items.filter((i) => selected.has(i.contributionId) && i.detail.audioFileId);
    if (selectedItems.length === 0) return;

    // A single file downloads directly; two or more get bundled into one
    // zip server-side instead of firing off several separate browser
    // downloads (which most browsers throttle or block past the first few).
    if (selectedItems.length === 1) {
      await handleDownload(selectedItems[0]);
      return;
    }

    setIsBulkActing(true);
    try {
      const blob = await api.admin.bulkDownloadZip(selectedItems.map((i) => i.contributionId));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contributions-${Date.now()}.zip`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download zip");
    } finally {
      setIsBulkActing(false);
    }
  }

  async function togglePlay(item: AdminContributionListItem) {
    const audioEl = audioRef.current;
    const audioFileId = item.detail.audioFileId as string | undefined;
    if (!audioEl || !audioFileId) return;

    if (playingId === item.contributionId) {
      audioEl.pause();
      setPlayingId(null);
      return;
    }

    const cachedUrl = playUrlCache[item.contributionId];
    if (cachedUrl) {
      audioEl.src = cachedUrl;
      setPlayingId(item.contributionId);
      audioEl.play().catch((err) => {
        setPlayingId(null);
        alert(err instanceof Error ? err.message : "Failed to play audio");
      });
      return;
    }

    setLoadingAudioId(item.contributionId);
    try {
      const { url } = await api.audio.getPlayUrl(audioFileId);
      setPlayUrlCache((prev) => ({ ...prev, [item.contributionId]: url }));
      audioEl.src = url;
      setPlayingId(item.contributionId);
      await audioEl.play();
    } catch (err) {
      setPlayingId(null);
      alert(err instanceof Error ? err.message : "Failed to play audio");
    } finally {
      setLoadingAudioId(null);
    }
  }

  async function toggleDetails(item: AdminContributionListItem) {
    if (expandedId === item.contributionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.contributionId);
    setRemarksDraft(item.remarks ?? "");
    setNewKeyword("");
    setDetailError(null);
    setLoadingKeywords(true);
    try {
      setKeywords(await api.admin.getContributionKeywords(item.contributionId));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load keywords");
    } finally {
      setLoadingKeywords(false);
    }
  }

  async function saveRemarks(id: string) {
    setIsSavingRemarks(true);
    try {
      const res = await api.admin.updateContributionRemarks(id, remarksDraft.trim());
      setItems((prev) => prev.map((i) => (i.contributionId === id ? { ...i, remarks: res.remarks } : i)));
    } finally {
      setIsSavingRemarks(false);
    }
  }

  async function addKeyword(id: string) {
    if (newKeyword.trim().length === 0) return;
    setIsAddingKeyword(true);
    setDetailError(null);
    try {
      const created = await api.admin.addContributionKeyword(id, newKeyword.trim());
      setKeywords((prev) => [...prev, created]);
      setNewKeyword("");
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to add keyword");
    } finally {
      setIsAddingKeyword(false);
    }
  }

  async function removeKeyword(id: string, keywordId: string) {
    const previous = keywords;
    setKeywords((prev) => prev.filter((k) => k.id !== keywordId));
    try {
      await api.admin.deleteContributionKeyword(id, keywordId);
    } catch (err) {
      setKeywords(previous);
      setDetailError(err instanceof Error ? err.message : "Failed to remove keyword");
    }
  }

  return (
    <div className="space-y-6">
      {/* Hidden -- playback driven entirely by the Play buttons below. */}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />

      <h1 className="text-2xl font-bold text-ink">Contributions</h1>

      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <input
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Search contributor name or email..."
            className={`${inputClass} min-w-64 flex-1`}
          />
          <select value={filters.userId} onChange={(e) => setFilter("userId", e.target.value)} className={selectClass}>
            <option value="">All contributors</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.email})
              </option>
            ))}
          </select>
          <MultiSelect
            label="statuses"
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace("_", " ") }))}
            selected={filters.status}
            onChange={(v) => setFilter("status", v)}
          />
          <MultiSelect
            label="modules"
            options={MODULE_OPTIONS.map((m) => ({ value: m, label: MODULE_LABEL[m] }))}
            selected={filters.moduleType}
            onChange={(v) => setFilter("moduleType", v)}
          />
        </div>

        <div className="flex flex-wrap gap-3 border-t border-border pt-3">
          <MultiSelect
            label="languages"
            options={languages.map((l) => ({ value: l.id, label: l.nameEnglish }))}
            selected={filters.languageId}
            onChange={(v) => setFilter("languageId", v)}
          />
          <MultiSelect
            label="dialects"
            options={availableDialects.map((d) => ({ value: d.id, label: d.nameEnglish }))}
            selected={filters.dialectId}
            onChange={(v) => setFilter("dialectId", v)}
            disabled={filters.languageId.length === 0}
          />
          <MultiSelect
            label="genders"
            options={GENDER_OPTIONS.map((g) => ({ value: g.value, label: g.label }))}
            selected={filters.gender}
            onChange={(v) => setFilter("gender", v)}
          />
          <MultiSelect
            label="education levels"
            options={EDUCATION_LEVEL_OPTIONS.map((e) => ({ value: e.value, label: e.label }))}
            selected={filters.educationLevel}
            onChange={(v) => setFilter("educationLevel", v)}
          />
          <input
            value={filters.profession}
            onChange={(e) => setFilter("profession", e.target.value)}
            placeholder="Profession contains..."
            className={inputClass}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <MultiSelect
            label="tribes"
            options={tribes.map((t) => ({ value: t.id, label: t.name }))}
            selected={filters.tribeId}
            onChange={(v) => setFilter("tribeId", v)}
          />
          <MultiSelect
            label="sub-tribes"
            options={subTribes.map((s) => ({ value: s.id, label: s.name }))}
            selected={filters.subTribeId}
            onChange={(v) => setFilter("subTribeId", v)}
            disabled={filters.tribeId.length === 0}
          />
          <input value={filters.country} onChange={(e) => setFilter("country", e.target.value)} placeholder="Country" className={inputClass} />
          <input value={filters.city} onChange={(e) => setFilter("city", e.target.value)} placeholder="City" className={inputClass} />
          <MultiSelect
            label="villages"
            options={villages.map((v) => ({ value: v.id, label: v.name }))}
            selected={filters.villageId}
            onChange={(v) => setFilter("villageId", v)}
            disabled={villages.length === 0}
          />
          <MultiSelect
            label="quarters"
            options={quarters.map((q) => ({ value: q.id, label: q.name }))}
            selected={filters.quarterId}
            onChange={(v) => setFilter("quarterId", v)}
            disabled={filters.villageId.length === 0}
          />
          <button onClick={clearFilters} className="text-sm font-semibold text-brand hover:underline">
            Clear filters
          </button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="card-duo flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-brand/40">
          <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
          <button
            onClick={() => handleBulkStatus("verified")}
            disabled={isBulkActing}
            className="btn-duo bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Verify
          </button>
          <button
            onClick={() => handleBulkStatus("rejected")}
            disabled={isBulkActing}
            className="btn-duo bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={handleBulkDownload}
            disabled={isBulkActing}
            className="btn-duo bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            Download
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={isBulkActing}
            className="px-2 py-1.5 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
          >
            Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs font-semibold text-ink-muted hover:text-ink">
            Clear selection
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <div className="card-duo overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3">Contributor</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Fragment key={item.contributionId}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.contributionId)}
                        onChange={() => toggleSelected(item.contributionId)}
                        aria-label={`Select contribution from ${item.contributor.displayName}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {item.contributor.displayName}
                      <div className="text-xs text-ink-muted">{item.contributor.email}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{MODULE_LABEL[item.moduleType]}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize text-white ${STATUS_COLOR[item.status] ?? "bg-slate-500"}`}
                      >
                        {item.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{new Date(item.submittedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.detail.audioFileId ? (
                          <button
                            onClick={() => togglePlay(item)}
                            disabled={loadingAudioId === item.contributionId}
                            className="btn-duo bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                          >
                            {loadingAudioId === item.contributionId
                              ? "Loading..."
                              : playingId === item.contributionId
                                ? "■ Stop"
                                : "▶ Play"}
                          </button>
                        ) : null}
                        {item.detail.audioFileId ? (
                          <button
                            onClick={() => handleDownload(item)}
                            disabled={actioningId === item.contributionId}
                            className="btn-duo btn-duo-secondary bg-surface-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-border disabled:opacity-50"
                          >
                            ⬇ Download
                          </button>
                        ) : null}
                        <button
                          onClick={() => handleAction(item.contributionId, "verified")}
                          disabled={actioningId === item.contributionId || item.status === "verified"}
                          className="btn-duo bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => handleAction(item.contributionId, "rejected")}
                          disabled={actioningId === item.contributionId || item.status === "rejected"}
                          className="btn-duo btn-duo-danger bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => toggleDetails(item)}
                          className="btn-duo btn-duo-secondary bg-surface-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-border"
                        >
                          {expandedId === item.contributionId ? "Close" : "Details"}
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={actioningId === item.contributionId}
                          className="px-2 py-1.5 text-xs font-semibold text-red-600 hover:underline disabled:opacity-40"
                        >
                          Delete
                        </button>
                        <AdminUndoButton resourceType="contribution" identifier={item.contributionId} onUndone={load} />
                      </div>
                    </td>
                  </tr>
                  {expandedId === item.contributionId ? (
                    <tr className="border-b border-border bg-surface-card/50 last:border-0">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Content</p>
                            <pre className="whitespace-pre-wrap rounded-lg bg-surface p-3 text-xs text-ink ring-1 ring-border">
                              {JSON.stringify(item.detail, null, 2)}
                            </pre>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                                Remarks (admin-only)
                              </p>
                              <textarea
                                value={remarksDraft}
                                onChange={(e) => setRemarksDraft(e.target.value)}
                                rows={2}
                                placeholder="Notes about this contribution..."
                                className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
                              />
                              <button
                                onClick={() => saveRemarks(item.contributionId)}
                                disabled={isSavingRemarks}
                                className="btn-duo mt-1 bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                              >
                                {isSavingRemarks ? "Saving..." : "Save Remarks"}
                              </button>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                                Keywords (training-data labels)
                              </p>
                              {loadingKeywords ? (
                                <p className="text-xs text-ink-muted">Loading...</p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {keywords.map((k) => (
                                    <span
                                      key={k.id}
                                      className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs text-ink ring-1 ring-border"
                                    >
                                      {k.keyword}
                                      <button
                                        onClick={() => removeKeyword(item.contributionId, k.id)}
                                        className="text-ink-muted hover:text-red-600"
                                        aria-label={`Remove keyword ${k.keyword}`}
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="mt-2 flex gap-2">
                                <input
                                  value={newKeyword}
                                  onChange={(e) => setNewKeyword(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addKeyword(item.contributionId);
                                    }
                                  }}
                                  placeholder="Add a keyword"
                                  className="flex-1 rounded-lg bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
                                />
                                <button
                                  onClick={() => addKeyword(item.contributionId)}
                                  disabled={isAddingKeyword || newKeyword.trim().length === 0}
                                  className="btn-duo bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                                >
                                  Add
                                </button>
                              </div>
                              {detailError ? <p className="mt-1 text-xs text-red-600">{detailError}</p> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
