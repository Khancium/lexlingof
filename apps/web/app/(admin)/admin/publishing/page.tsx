"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  CONCEPT_GRAMMATICAL_GENDER_OPTIONS,
  CONCEPT_GRAMMATICAL_NUMBER_OPTIONS,
  CONCEPT_PART_OF_SPEECH_OPTIONS,
  type AdminUserOption,
  type RecordingGrammar,
  type ContributionStatusValue,
  type EducationLevel,
  type GenderOption,
  type Language,
  type NamedOption,
  type PublishableRecording,
  type PublishedText,
  type PublishingConceptItem,
  type PublishingQueryParams,
  type PublishingSentenceItem,
} from "@/lib/api";
import { EDUCATION_LEVEL_OPTIONS, GENDER_OPTIONS } from "@/lib/demographics-constants";
import { Pagination } from "@/components/admin-pagination";
import { AdminMultiSelect as MultiSelect } from "@/components/admin-multi-select";
import { readUrlParam, useUrlStateSync } from "@/lib/url-state";

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

/**
 * Mass-assignment toolbar for the three hand-entered grammar fields
 * (gender/part of speech/number) -- shown above a word's recording list,
 * applies to however many recordings are checked. Each dropdown fires
 * immediately on change (no separate "Apply" step) since "select some
 * recordings, then pick a value" is the whole interaction.
 */
function GrammarBulkAssign({
  selectedCount,
  saving,
  onAssign,
  onSelectAll,
  onClearSelection,
}: {
  selectedCount: number;
  saving: boolean;
  onAssign: (field: keyof RecordingGrammar, value: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-card p-2.5 ring-1 ring-border">
      <span className="text-xs font-semibold text-ink-muted">
        {selectedCount > 0 ? `${selectedCount} selected` : "Select recordings to tag"}
      </span>
      <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-brand hover:underline">
        Select all
      </button>
      {selectedCount > 0 ? (
        <button type="button" onClick={onClearSelection} className="text-xs font-semibold text-ink-muted hover:underline">
          Clear
        </button>
      ) : null}
      <div className="ml-auto flex flex-wrap gap-2">
        <select
          value=""
          disabled={saving || selectedCount === 0}
          onChange={(e) => onAssign("grammaticalGender", e.target.value)}
          className={`${grammarSelectClass} disabled:opacity-50`}
        >
          <option value="">Set gender...</option>
          {CONCEPT_GRAMMATICAL_GENDER_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {prettify(v)}
            </option>
          ))}
        </select>
        <select
          value=""
          disabled={saving || selectedCount === 0}
          onChange={(e) => onAssign("partOfSpeech", e.target.value)}
          className={`${grammarSelectClass} disabled:opacity-50`}
        >
          <option value="">Set grammar...</option>
          {CONCEPT_PART_OF_SPEECH_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {prettify(v)}
            </option>
          ))}
        </select>
        <select
          value=""
          disabled={saving || selectedCount === 0}
          onChange={(e) => onAssign("grammaticalNumber", e.target.value)}
          className={`${grammarSelectClass} disabled:opacity-50`}
        >
          <option value="">Set number...</option>
          {CONCEPT_GRAMMATICAL_NUMBER_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {prettify(v)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** What the three text boxes hold while being edited -- strings, so an empty box is "". Converted to/from the API's null-for-none at the edges. */
type TextDraft = { nativeText: string; romanization: string; ipa: string };

function toDraft(text: PublishedText): TextDraft {
  return { nativeText: text.nativeText ?? "", romanization: text.romanization ?? "", ipa: text.ipa ?? "" };
}

function fromDraft(draft: TextDraft): PublishedText {
  return {
    nativeText: draft.nativeText.trim() || null,
    romanization: draft.romanization.trim() || null,
    ipa: draft.ipa.trim() || null,
  };
}

function sameText(a: PublishedText, b: PublishedText): boolean {
  return a.nativeText === b.nativeText && a.romanization === b.romanization && a.ipa === b.ipa;
}

const textFieldClass =
  "w-full rounded-lg bg-surface-card px-2.5 py-1.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand disabled:opacity-60";

const TEXT_FIELDS: { key: keyof TextDraft; label: string; dir: "auto" | "ltr"; placeholder: string }[] = [
  { key: "nativeText", label: "Native", dir: "auto", placeholder: "In its own script" },
  { key: "romanization", label: "Roman", dir: "ltr", placeholder: "Latin-script spelling" },
  { key: "ipa", label: "IPA", dir: "ltr", placeholder: "IPA transcription" },
];

/** Read-only: exactly what the contributor typed with their recording -- only the inputs they actually filled in. */
function ProvidedTextPanel({ provided }: { provided: PublishableRecording["provided"] }) {
  const entries: { label: string; value: string | null; dir: "auto" | "ltr" }[] = [
    { label: "Native", value: provided.nativeText, dir: "auto" },
    { label: "Roman", value: provided.romanization, dir: "ltr" },
    { label: "IPA", value: provided.ipa, dir: "ltr" },
    { label: "Notes", value: provided.notes, dir: "auto" },
  ];
  const filled = entries.filter((e) => e.value && e.value.trim().length > 0);
  return (
    <div className="space-y-1.5 rounded-lg bg-surface p-3 ring-1 ring-border">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Typed by the contributor</p>
      {filled.length === 0 ? (
        <p className="text-sm italic text-ink-muted">Nothing typed -- audio only.</p>
      ) : (
        <dl className="space-y-1">
          {filled.map((e) => (
            <div key={e.label} className="flex items-baseline gap-2">
              <dt className="w-11 shrink-0 text-xs font-semibold text-ink-muted">{e.label}</dt>
              {/* <bdi> isolates the text's own direction without right-aligning the whole row, which would strand an RTL Native value at the far edge away from its label. */}
              <dd className="min-w-0 flex-1 break-words text-sm text-ink">
                <bdi dir={e.dir}>{e.value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The Native / Roman / IPA text the public API exports for this recording -- starts as the contributor's own
 * and is whatever the admin types here. A blank box exports as nothing for that field (so a wrong IPA can be
 * dropped); "Use contributor's text" goes back to exporting what they typed. For a recording that isn't
 * published yet the boxes are edited first and saved by the Publish button, so nothing goes live uncorrected.
 */
function ExportTextPanel({
  recording,
  draft,
  onChange,
  dirty,
  busy,
  onSave,
  onReset,
  onCopyProvided,
  canCopyProvided,
}: {
  recording: PublishableRecording;
  draft: TextDraft;
  onChange: (key: keyof TextDraft, value: string) => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
  onCopyProvided: () => void;
  canCopyProvided: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-surface p-3 ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Exported to dictionary &amp; learning apps</p>
        {recording.isPublished ? (
          <span className="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
            {recording.exported.isCurated ? "Edited text" : "Contributor's text"}
          </span>
        ) : (
          <span className="text-[11px] italic text-ink-muted">Applied when you publish</span>
        )}
        {canCopyProvided ? (
          <button type="button" onClick={onCopyProvided} disabled={busy} className="ml-auto text-xs font-semibold text-brand hover:underline disabled:opacity-50">
            Copy from contributor
          </button>
        ) : null}
      </div>
      {TEXT_FIELDS.map((f) => (
        <label key={f.key} className="flex items-center gap-2">
          <span className="w-11 shrink-0 text-xs font-semibold text-ink-muted">{f.label}</span>
          <input
            value={draft[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
            dir={f.dir}
            maxLength={2000}
            disabled={busy}
            placeholder={f.placeholder}
            className={textFieldClass}
          />
        </label>
      ))}
      {recording.isPublished ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !dirty}
            className="btn-duo bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? "..." : "Save text"}
          </button>
          {recording.exported.isCurated ? (
            <button type="button" onClick={onReset} disabled={busy} className="text-xs font-semibold text-ink-muted hover:underline disabled:opacity-50">
              Use contributor&apos;s text
            </button>
          ) : null}
          {dirty ? <span className="text-[11px] italic text-ink-muted">Unsaved changes</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One contributor's recording -- audio player, metadata badges, what they typed, the editable export text, and the publish/unpublish toggle. Shared by the words and sentences tabs. `selectable` (words only) adds a checkbox for mass grammar assignment. */
function RecordingRow({
  recording,
  busy,
  onPublish,
  onUnpublish,
  onSaveText,
  onResetText,
  selectable,
  selected,
  onToggleSelect,
}: {
  recording: PublishableRecording;
  busy: boolean;
  /** `text` is passed only when the admin changed the export text before publishing. */
  onPublish: (text?: PublishedText) => void;
  onUnpublish: () => void;
  onSaveText: (text: PublishedText) => void;
  onResetText: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const hasGrammar = recording.grammaticalGender || recording.partOfSpeech || recording.grammaticalNumber;

  const { nativeText, romanization, ipa } = recording.exported;
  const [draft, setDraft] = useState<TextDraft>(() => toDraft(recording.exported));
  // Follow the server's value after a save / reset / unpublish -- but not on every render, which would wipe what is being typed.
  useEffect(() => {
    setDraft(toDraft({ nativeText, romanization, ipa }));
  }, [nativeText, romanization, ipa, recording.exported.isCurated]);

  const dirty = !sameText(fromDraft(draft), { nativeText, romanization, ipa });
  const provided = recording.provided;
  const canCopyProvided = !sameText(fromDraft(draft), { nativeText: provided.nativeText, romanization: provided.romanization, ipa: provided.ipa });

  return (
    <div className="space-y-3 rounded-xl bg-surface-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        {selectable ? (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={onToggleSelect}
            className="h-4 w-4 shrink-0 rounded border-border"
            aria-label="Select this recording for mass grammar assignment"
          />
        ) : null}
        <audio controls preload="none" src={recording.audioUrl} className="h-9 w-56" />
        <p className="min-w-[7rem] flex-1 truncate text-sm font-semibold text-ink">{recording.contributorName}</p>
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
            <span className="text-[11px] italic text-ink-muted">Location not shared</span>
          )}
          {hasGrammar ? (
            <>
              {recording.partOfSpeech ? <MetaBadge label={prettify(recording.partOfSpeech)} /> : null}
              {recording.grammaticalGender ? <MetaBadge label={prettify(recording.grammaticalGender)} /> : null}
              {recording.grammaticalNumber ? <MetaBadge label={prettify(recording.grammaticalNumber)} /> : null}
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={recording.isPublished ? onUnpublish : () => onPublish(dirty ? fromDraft(draft) : undefined)}
          disabled={busy}
          className={`btn-duo px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
            recording.isPublished
              ? "btn-duo-secondary bg-surface text-ink hover:bg-border"
              : "bg-brand text-ink-inverted hover:bg-brand-dark"
          }`}
        >
          {busy ? "..." : recording.isPublished ? "Unpublish" : "Publish"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ProvidedTextPanel provided={provided} />
        <ExportTextPanel
          recording={recording}
          draft={draft}
          onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
          dirty={dirty}
          busy={busy}
          onSave={() => onSaveText(fromDraft(draft))}
          onReset={onResetText}
          onCopyProvided={() =>
            setDraft(toDraft({ nativeText: provided.nativeText, romanization: provided.romanization, ipa: provided.ipa }))
          }
          canCopyProvided={canCopyProvided}
        />
      </div>
    </div>
  );
}

function readUrlArray(key: string): string[] {
  const raw = readUrlParam(key, "");
  return raw ? raw.split(",").filter(Boolean) : [];
}

function readInitialFilters(): Filters {
  return {
    search: readUrlParam("search", ""),
    status: readUrlArray("status") as ContributionStatusValue[],
    userId: readUrlParam("userId", ""),
    languageId: readUrlArray("languageId"),
    dialectId: readUrlArray("dialectId"),
    tribeId: readUrlArray("tribeId"),
    subTribeId: readUrlArray("subTribeId"),
    country: readUrlParam("country", ""),
    city: readUrlParam("city", ""),
    villageId: readUrlArray("villageId"),
    quarterId: readUrlArray("quarterId"),
    gender: readUrlArray("gender") as GenderOption[],
    educationLevel: readUrlArray("educationLevel") as EducationLevel[],
    profession: readUrlParam("profession", ""),
  };
}

export default function AdminPublishingPage() {
  const [tab, setTab] = useState<Tab>(() => readUrlParam("tab", "words") as Tab);
  const [filters, setFilters] = useState<Filters>(readInitialFilters);
  const [offset, setOffset] = useState(() => readUrlParam("offset", 0));

  const [conceptItems, setConceptItems] = useState<PublishingConceptItem[]>([]);
  const [sentenceItems, setSentenceItems] = useState<PublishingSentenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<PublishableRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<Set<string>>(new Set());
  const [grammarSaving, setGrammarSaving] = useState(false);

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

  useUrlStateSync({
    tab,
    offset,
    search: filters.search,
    status: filters.status.join(","),
    userId: filters.userId,
    languageId: filters.languageId.join(","),
    dialectId: filters.dialectId.join(","),
    tribeId: filters.tribeId.join(","),
    subTribeId: filters.subTribeId.join(","),
    country: filters.country,
    city: filters.city,
    villageId: filters.villageId.join(","),
    quarterId: filters.quarterId.join(","),
    gender: filters.gender.join(","),
    educationLevel: filters.educationLevel.join(","),
    profession: filters.profession,
  });

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
    setSelectedRecordingIds(new Set());
  }

  function toggleExpand(id: string) {
    setSelectedRecordingIds(new Set());
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

  function toggleSelectRecording(recordingId: string) {
    setSelectedRecordingIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordingId)) next.delete(recordingId);
      else next.add(recordingId);
      return next;
    });
  }

  function patchRecording(recordingId: string, patch: Partial<PublishableRecording>) {
    setRecordings((prev) => prev.map((r) => (r.id === recordingId ? { ...r, ...patch } : r)));
  }

  /** What a recording exports once nothing has been curated -- the contributor's own text. */
  function contributorsText(r: PublishableRecording): PublishableRecording["exported"] {
    return { nativeText: r.provided.nativeText, romanization: r.provided.romanization, ipa: r.provided.ipa, isCurated: false };
  }

  /** Runs one action on one recording row, keeping its buttons disabled meanwhile. */
  async function withBusy(recordingId: string, action: () => Promise<void>) {
    setTogglingId(recordingId);
    try {
      await action();
    } finally {
      setTogglingId(null);
    }
  }

  // `text` is set only when the admin edited the export text before publishing; otherwise the contributor's own text is exported.
  function handlePublish(parentId: string, recording: PublishableRecording, text?: PublishedText) {
    return withBusy(recording.id, async () => {
      if (tab === "words") await api.publishing.publishRecording(parentId, recording.id, text);
      else await api.publishing.publishTranslation(parentId, recording.id, text);
      patchRecording(recording.id, { isPublished: true, exported: text ? { ...text, isCurated: true } : recording.exported });
      load();
    });
  }

  function handleUnpublish(parentId: string, recording: PublishableRecording) {
    // Unpublishing deletes the publication, and the edited export text lives on it -- so ask before throwing that away.
    if (recording.exported.isCurated && !window.confirm("Unpublishing discards the Native / Roman / IPA text you edited for this recording. Continue?")) return;
    return withBusy(recording.id, async () => {
      if (tab === "words") await api.publishing.unpublishRecording(parentId, recording.id);
      else await api.publishing.unpublishTranslation(parentId, recording.id);
      patchRecording(recording.id, { isPublished: false, exported: contributorsText(recording) });
      load();
    });
  }

  function handleSaveText(parentId: string, recording: PublishableRecording, text: PublishedText) {
    return withBusy(recording.id, async () => {
      if (tab === "words") await api.publishing.setRecordingText(parentId, recording.id, text);
      else await api.publishing.setTranslationText(parentId, recording.id, text);
      patchRecording(recording.id, { exported: { ...text, isCurated: true } });
    });
  }

  function handleResetText(parentId: string, recording: PublishableRecording) {
    return withBusy(recording.id, async () => {
      if (tab === "words") await api.publishing.resetRecordingText(parentId, recording.id);
      else await api.publishing.resetTranslationText(parentId, recording.id);
      patchRecording(recording.id, { exported: contributorsText(recording) });
    });
  }

  async function handleUnpublishAll(id: string) {
    const noun = tab === "words" ? "word" : "sentence";
    const hasEdits = expandedId === id && recordings.some((r) => r.isPublished && r.exported.isCurated);
    const warning = hasEdits ? " The Native / Roman / IPA text you edited for them is discarded too." : "";
    if (!window.confirm(`Withdraw every published recording for this ${noun} from the public site?${warning}`)) return;
    setUnpublishingId(id);
    try {
      if (tab === "words") await api.publishing.unpublishAllRecordings(id);
      else await api.publishing.unpublishAllTranslations(id);
      if (expandedId === id) {
        setRecordings((prev) => prev.map((r) => ({ ...r, isPublished: false, publicationId: null, exported: contributorsText(r) })));
      }
      load();
    } finally {
      setUnpublishingId(null);
    }
  }

  async function handleGrammarBulkAssign(conceptId: string, field: keyof RecordingGrammar, value: string) {
    if (selectedRecordingIds.size === 0 || value === "") return;
    const ids = Array.from(selectedRecordingIds);
    const nextValue = value as RecordingGrammar[typeof field];
    setGrammarSaving(true);
    try {
      await api.publishing.setRecordingsGrammar(conceptId, ids, { [field]: nextValue });
      setRecordings((prev) => prev.map((r) => (selectedRecordingIds.has(r.id) ? { ...r, [field]: nextValue } : r)));
    } finally {
      setGrammarSaving(false);
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
          actually been contributed for appear below. Each recording shows what its contributor typed (Native, Roman, IPA) beside the same
          three fields as exported to dictionary and language-learning apps -- what you type there replaces the contributor&apos;s text in the feed.
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
                {/* Two sibling toggle buttons (title / badges) with the Unpublish
                   button between them -- a <button> can't be nested inside
                   another <button>, and the whole row must still expand on click. */}
                <div className="flex w-full items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(id)}
                    aria-expanded={isExpanded}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate font-semibold text-ink">{label}</p>
                    <p className="text-xs text-ink-muted">{category ?? "Uncategorized"}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.publishedCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleUnpublishAll(id)}
                        disabled={unpublishingId === id}
                        className="rounded-full bg-red-600/10 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-600/20 disabled:opacity-50"
                      >
                        {unpublishingId === id ? "..." : "Unpublish all"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleExpand(id)}
                      tabIndex={-1}
                      className="flex items-center gap-2"
                    >
                      <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-dark">
                        {item.publishedCount} published
                      </span>
                      <span className="rounded-full bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-muted ring-1 ring-border">
                        {item.eligibleCount} verified
                      </span>
                      <span className={`text-ink-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-4 space-y-2 border-t border-border pt-4">
                    {recordingsLoading ? (
                      <p className="text-sm text-ink-muted">Loading recordings...</p>
                    ) : recordings.length === 0 ? (
                      <p className="text-sm text-ink-muted">No verified recordings yet for this {tab === "words" ? "word" : "sentence"}.</p>
                    ) : (
                      <>
                        {tab === "words" ? (
                          <GrammarBulkAssign
                            selectedCount={selectedRecordingIds.size}
                            saving={grammarSaving}
                            onAssign={(field, value) => handleGrammarBulkAssign(id, field, value)}
                            onSelectAll={() => setSelectedRecordingIds(new Set(recordings.map((r) => r.id)))}
                            onClearSelection={() => setSelectedRecordingIds(new Set())}
                          />
                        ) : null}
                        {recordings.map((r) => (
                          <RecordingRow
                            key={r.id}
                            recording={r}
                            busy={togglingId === r.id}
                            onPublish={(text) => handlePublish(id, r, text)}
                            onUnpublish={() => handleUnpublish(id, r)}
                            onSaveText={(text) => handleSaveText(id, r, text)}
                            onResetText={() => handleResetText(id, r)}
                            selectable={tab === "words"}
                            selected={selectedRecordingIds.has(r.id)}
                            onToggleSelect={() => toggleSelectRecording(r.id)}
                          />
                        ))}
                      </>
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
