"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  CONCEPT_GRAMMATICAL_GENDER_OPTIONS,
  CONCEPT_GRAMMATICAL_NUMBER_OPTIONS,
  CONCEPT_PART_OF_SPEECH_OPTIONS,
  type AdminUserOption,
  type ConceptGrammar,
  type ContributionStatusValue,
  type EducationLevel,
  type GenderOption,
  type Language,
  type NamedOption,
  type PublishableRecording,
  type PublishingConceptItem,
  type PublishingQueryParams,
  type PublishingSentenceItem,
} from "@/lib/api";
import { EDUCATION_LEVEL_OPTIONS, GENDER_OPTIONS } from "@/lib/demographics-constants";
import { Pagination } from "@/components/admin-pagination";
import { AdminMultiSelect as MultiSelect } from "@/components/admin-multi-select";

const PAGE_SIZE = 20;

type Tab = "words" | "sentences";

const STATUS_OPTIONS: ContributionStatusValue[] = ["draft", "pending", "under_review", "verified", "needs_correction", "rejected"];

const selectClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border";
const inputClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border";

type Filters = {
  search: string;
  status: ContributionStatusValue[];
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
  search: "",
  status: [],
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

function dedupeById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) for (const item of list) map.set(item.id, item);
  return Array.from(map.values());
}

function MetaBadge({ label }: { label: string }) {
  return <span className="rounded-full bg-surface-card px-2 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-border">{label}</span>;
}

const STATUS_COLOR: Record<ContributionStatusValue, string> = {
  draft: "bg-slate-600",
  pending: "bg-yellow-600",
  under_review: "bg-yellow-600",
  verified: "bg-emerald-600",
  needs_correction: "bg-orange-600",
  rejected: "bg-red-600",
};

function StatusBadge({ status }: { status: ContributionStatusValue }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${STATUS_COLOR[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function prettify(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

const grammarSelectClass = "rounded-lg bg-surface-card px-2 py-1 text-xs text-ink ring-1 ring-border";

/** The three hand-entered grammar dropdowns (gender/part of speech/number) shown on each word's card -- words only, set directly from the list without expanding the card. */
function ConceptGrammarFields({
  concept,
  saving,
  onChange,
}: {
  concept: ConceptGrammar;
  saving: boolean;
  onChange: (field: keyof ConceptGrammar, value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
      <select
        value={concept.grammaticalGender ?? ""}
        disabled={saving}
        onChange={(e) => onChange("grammaticalGender", e.target.value)}
        className={grammarSelectClass}
      >
        <option value="">Gender</option>
        {CONCEPT_GRAMMATICAL_GENDER_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {prettify(v)}
          </option>
        ))}
      </select>
      <select
        value={concept.partOfSpeech ?? ""}
        disabled={saving}
        onChange={(e) => onChange("partOfSpeech", e.target.value)}
        className={grammarSelectClass}
      >
        <option value="">Grammar</option>
        {CONCEPT_PART_OF_SPEECH_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {prettify(v)}
          </option>
        ))}
      </select>
      <select
        value={concept.grammaticalNumber ?? ""}
        disabled={saving}
        onChange={(e) => onChange("grammaticalNumber", e.target.value)}
        className={grammarSelectClass}
      >
        <option value="">Number</option>
        {CONCEPT_GRAMMATICAL_NUMBER_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {prettify(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One contributor's recording -- audio player, metadata badges, and the publish/unpublish toggle. Shared by the words and sentences tabs. */
function RecordingRow({
  recording,
  onToggle,
  isToggling,
}: {
  recording: PublishableRecording;
  onToggle: () => void;
  isToggling: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-card p-3">
      <audio controls preload="none" src={recording.audioUrl} className="h-9 w-56" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {recording.nativeText || <span className="italic text-ink-muted">(no text)</span>}
        </p>
        <p className="truncate text-xs text-ink-muted">{recording.contributorName}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={recording.status} />
        {recording.language ? <MetaBadge label={recording.language} /> : null}
        {recording.dialect ? <MetaBadge label={recording.dialect} /> : null}
        {recording.locationShared ? (
          <>
            {recording.city ? <MetaBadge label={recording.city} /> : null}
            {recording.tribe ? <MetaBadge label={recording.tribe} /> : null}
            {recording.village ? <MetaBadge label={recording.village} /> : null}
          </>
        ) : (
          <span className="text-[11px] italic text-ink-faint">Location not shared</span>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={isToggling}
        className={`btn-duo px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
          recording.isPublished
            ? "btn-duo-secondary bg-surface text-ink hover:bg-border"
            : "bg-brand text-ink-inverted hover:bg-brand-dark"
        }`}
      >
        {isToggling ? "..." : recording.isPublished ? "Unpublish" : "Publish"}
      </button>
    </div>
  );
}

export default function AdminPublishingPage() {
  const [tab, setTab] = useState<Tab>("words");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const [conceptItems, setConceptItems] = useState<PublishingConceptItem[]>([]);
  const [sentenceItems, setSentenceItems] = useState<PublishingSentenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<PublishableRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [grammarSavingId, setGrammarSavingId] = useState<string | null>(null);

  // Filter dropdown data sources -- same shape as the Contributions page.
  const [users, setUsers] = useState<AdminUserOption[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [tribes, setTribes] = useState<NamedOption[]>([]);
  const [subTribes, setSubTribes] = useState<NamedOption[]>([]);
  const [villages, setVillages] = useState<NamedOption[]>([]);
  const [quarters, setQuarters] = useState<NamedOption[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    const params: PublishingQueryParams = {
      search: filters.search.trim() || undefined,
      status: filters.status.length ? filters.status : undefined,
      userId: filters.userId || undefined,
      languageId: filters.languageId.length ? filters.languageId : undefined,
      dialectId: filters.dialectId.length ? filters.dialectId : undefined,
      tribeId: filters.tribeId.length ? filters.tribeId : undefined,
      subTribeId: filters.subTribeId.length ? filters.subTribeId : undefined,
      country: filters.country.trim() || undefined,
      city: filters.city.trim() || undefined,
      villageId: filters.villageId.length ? filters.villageId : undefined,
      quarterId: filters.quarterId.length ? filters.quarterId : undefined,
      gender: filters.gender.length ? filters.gender : undefined,
      educationLevel: filters.educationLevel.length ? filters.educationLevel : undefined,
      profession: filters.profession.trim() || undefined,
      limit: PAGE_SIZE,
      offset,
    };
    const request = tab === "words" ? api.publishing.getConcepts(params) : api.publishing.getSentences(params);
    request
      .then((res) => {
        if (tab === "words") setConceptItems(res.items as PublishingConceptItem[]);
        else setSentenceItems(res.items as PublishingSentenceItem[]);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [tab, filters, offset]);

  // Debounced the same way the Contributions page debounces its own text/demographic filters.
  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    api.admin.getUserOptions().then(setUsers).catch(() => setUsers([]));
    api.languages.getAll().then(setLanguages).catch(() => setLanguages([]));
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

  const availableDialects = dedupeById(languages.filter((l) => filters.languageId.includes(l.id)).map((l) => l.dialects));

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setOffset(0);
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
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

  function switchTab(next: Tab) {
    setTab(next);
    setOffset(0);
    setExpandedId(null);
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setRecordings([]);
      return;
    }
    setExpandedId(id);
    setRecordingsLoading(true);
    const request = tab === "words" ? api.publishing.getConceptRecordings(id) : api.publishing.getSentenceTranslations(id);
    request.then(setRecordings).finally(() => setRecordingsLoading(false));
  }

  async function handleToggle(parentId: string, recording: PublishableRecording) {
    setTogglingId(recording.id);
    try {
      if (tab === "words") {
        if (recording.isPublished) await api.publishing.unpublishRecording(parentId, recording.id);
        else await api.publishing.publishRecording(parentId, recording.id);
      } else {
        if (recording.isPublished) await api.publishing.unpublishTranslation(parentId, recording.id);
        else await api.publishing.publishTranslation(parentId, recording.id);
      }
      setRecordings((prev) => prev.map((r) => (r.id === recording.id ? { ...r, isPublished: !r.isPublished } : r)));
      load();
    } finally {
      setTogglingId(null);
    }
  }

  async function handleUnpublishAll(id: string) {
    const noun = tab === "words" ? "word" : "sentence";
    if (!window.confirm(`Withdraw every published recording for this ${noun} from the public site?`)) return;
    setUnpublishingId(id);
    try {
      if (tab === "words") await api.publishing.unpublishAllRecordings(id);
      else await api.publishing.unpublishAllTranslations(id);
      if (expandedId === id) setRecordings((prev) => prev.map((r) => ({ ...r, isPublished: false, publicationId: null })));
      load();
    } finally {
      setUnpublishingId(null);
    }
  }

  async function handleGrammarChange(conceptId: string, field: keyof ConceptGrammar, value: string) {
    const nextValue = value === "" ? null : (value as ConceptGrammar[typeof field]);
    setConceptItems((prev) => prev.map((c) => (c.id === conceptId ? { ...c, [field]: nextValue } : c)));
    setGrammarSavingId(conceptId);
    try {
      await api.publishing.setConceptGrammar(conceptId, { [field]: nextValue });
    } finally {
      setGrammarSavingId(null);
    }
  }

  const items = tab === "words" ? conceptItems : sentenceItems;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Publishing</h1>
        <p className="text-sm text-ink-muted">
          Choose which verified recordings appear on the public dictionary and language-learning site. A word or sentence can have several
          published recordings at once -- publish more than one to show different dialects side by side. Only words and sentences that have
          actually been contributed for appear below.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchTab("words")}
          className={`btn-duo px-4 py-2 text-sm font-semibold ${tab === "words" ? "bg-brand text-ink-inverted" : "btn-duo-secondary bg-surface-card text-ink"}`}
        >
          Words (Dictionary)
        </button>
        <button
          type="button"
          onClick={() => switchTab("sentences")}
          className={`btn-duo px-4 py-2 text-sm font-semibold ${tab === "sentences" ? "bg-brand text-ink-inverted" : "btn-duo-secondary bg-surface-card text-ink"}`}
        >
          Sentences (Language Learning)
        </button>
      </div>

      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <input
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder={tab === "words" ? "Search words..." : "Search sentences..."}
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

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">No {tab === "words" ? "words" : "sentences"} match these filters.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const id = item.id;
            const label = "labelEnglish" in item ? item.labelEnglish : item.englishText;
            const category = item.categoryName;
            const isExpanded = expandedId === id;
            return (
              <div key={id} className="card-duo rounded-2xl bg-surface p-4 shadow-sm">
                <button type="button" onClick={() => toggleExpand(id)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{label}</p>
                    <p className="text-xs text-ink-muted">{category ?? "Uncategorized"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.publishedCount > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnpublishAll(id);
                        }}
                        disabled={unpublishingId === id}
                        className="rounded-full bg-red-600/10 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-600/20 disabled:opacity-50"
                      >
                        {unpublishingId === id ? "..." : "Unpublish all"}
                      </button>
                    ) : null}
                    <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-dark">
                      {item.publishedCount} published
                    </span>
                    <span className="rounded-full bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-muted ring-1 ring-border">
                      {item.eligibleCount} verified
                    </span>
                    <span className={`text-ink-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                  </div>
                </button>

                {tab === "words" ? (
                  <div className="mt-3">
                    <ConceptGrammarFields
                      concept={item as PublishingConceptItem}
                      saving={grammarSavingId === id}
                      onChange={(field, value) => handleGrammarChange(id, field, value)}
                    />
                  </div>
                ) : null}

                {isExpanded ? (
                  <div className="mt-4 space-y-2 border-t border-border pt-4">
                    {recordingsLoading ? (
                      <p className="text-sm text-ink-muted">Loading recordings...</p>
                    ) : recordings.length === 0 ? (
                      <p className="text-sm text-ink-muted">No verified recordings yet for this {tab === "words" ? "word" : "sentence"}.</p>
                    ) : (
                      recordings.map((r) => (
                        <RecordingRow key={r.id} recording={r} isToggling={togglingId === r.id} onToggle={() => handleToggle(id, r)} />
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />}
    </div>
  );
}
