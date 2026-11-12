"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, getErrorMessage, type SentenceCategoryTile, type SentenceItem, type SentenceLanguage } from "@/lib/api";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import { useAuthStore } from "@/lib/store";
import { Pagination } from "@/components/admin-pagination";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };
type Draft = { transcription: string; romanization: string; ipa: string; recording: Recording | null };
type Step = "categories" | "category" | "record";
type TranslatedFilter = "" | "translated" | "untranslated";
type ActiveCategory = { id: string; name: string };

// The backend enforces no duration cap for Module 3, but the spec calls for
// a soft ceiling here ("no 3-second limit, can go up to 60 seconds").
const MAX_DURATION_MS = 60000;
const LIST_PAGE_SIZE = 50;
const PROMPT_LANGUAGE_KEY = "lexlingo.translate.promptLanguage";

const emptyDraft: Draft = { transcription: "", romanization: "", ipa: "", recording: null };

// A sentence is one meaning in three languages. The contributor picks which one to READ; the other two are
// shown underneath so the meaning is never in doubt. A recording of the sentence applies to all of them.
const LANGUAGES: { value: SentenceLanguage; label: string }[] = [
  { value: "english", label: "English" },
  { value: "urdu", label: "اردو" },
  { value: "persian", label: "فارسی" },
];
const LANGUAGE_NAME: Record<SentenceLanguage, string> = { english: "English", urdu: "Urdu", persian: "Persian" };

// Urdu and Persian are right-to-left scripts -- rendered ltr (the default), word order and punctuation come out backwards.
function textDirection(lang: SentenceLanguage): "rtl" | "ltr" {
  return lang === "urdu" || lang === "persian" ? "rtl" : "ltr";
}

function textIn(sentence: SentenceItem, lang: SentenceLanguage): string {
  return lang === "urdu" ? sentence.urduText : lang === "persian" ? sentence.persianText : sentence.englishText;
}

export default function TranslatePage() {
  return (
    <Suspense fallback={<p className="text-ink-muted">Loading...</p>}>
      <TranslatePageInner />
    </Suspense>
  );
}

function TranslatePageInner() {
  // Arriving from a failed-submission "Submit Again" link (?sentenceId=X) --
  // jumps straight into recording that exact sentence.
  const searchParams = useSearchParams();
  const deepLinkSentenceId = searchParams.get("sentenceId");

  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const autoLoadNext = useAuthStore((state) => state.user?.autoLoadNext ?? true);

  const [step, setStep] = useState<Step>("categories");

  // Which of the three languages to read the sentences in. Remembered between visits.
  const [promptLanguage, setPromptLanguage] = useState<SentenceLanguage>("english");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PROMPT_LANGUAGE_KEY);
      if (saved === "english" || saved === "urdu" || saved === "persian") setPromptLanguage(saved);
    } catch {
      /* storage unavailable -- keep the default */
    }
  }, []);
  function choosePromptLanguage(lang: SentenceLanguage) {
    setPromptLanguage(lang);
    try {
      window.localStorage.setItem(PROMPT_LANGUAGE_KEY, lang);
    } catch {
      /* not worth failing over */
    }
  }

  // The category tiles: how many sentences each has and how many of them this user already translated.
  const [categories, setCategories] = useState<SentenceCategoryTile[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  // The open category's sentences, in the admin's order. Searched / filtered / paged by the server.
  const [activeCategory, setActiveCategory] = useState<ActiveCategory | null>(null);
  const [items, setItems] = useState<SentenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<TranslatedFilter>("");
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // History of sentences visited this session, so Previous/Next can move
  // back and forth without re-fetching or losing in-progress drafts.
  const [history, setHistory] = useState<SentenceItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [loadingSentence, setLoadingSentence] = useState(false);
  const [sentenceError, setSentenceError] = useState<string | null>(null);
  // Shown on the record screen when "Next" finds nothing further in the category.
  const [navMessage, setNavMessage] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  // Tracks which recording (by object identity) was last successfully
  // submitted, so Submit re-locks after a click instead of staying
  // clickable during the brief window before the next sentence loads.
  const [lastSubmittedRecording, setLastSubmittedRecording] = useState<Recording | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const sentence = historyIndex >= 0 ? history[historyIndex] : null;
  const draft = sentence ? (drafts[sentence.id] ?? emptyDraft) : emptyDraft;

  function updateDraft(patch: Partial<Draft>) {
    if (!sentence) return;
    setDrafts((prev) => ({ ...prev, [sentence.id]: { ...(prev[sentence.id] ?? emptyDraft), ...patch } }));
  }

  const loadCategories = useCallback(() => {
    setLoadingCategories(true);
    setCategoriesError(null);
    api.contributions
      .getSentenceCategories()
      .then((res) => setCategories(res.items))
      .catch((err) => setCategoriesError(getErrorMessage(err, "Failed to load sentence categories")))
      .finally(() => setLoadingCategories(false));
  }, []);

  useEffect(() => {
    if (step !== "categories") return;
    loadCategories();
  }, [step, loadCategories]);

  // Search runs on the server (it matches all three languages), so wait for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (step !== "category" || !activeCategory) return;
    let cancelled = false;
    setLoadingList(true);
    setListError(null);
    api.contributions
      .getCategorySentences(activeCategory.id, {
        limit,
        offset,
        search: debouncedSearch || undefined,
        filter: filter || undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (!cancelled) setListError(getErrorMessage(err, "Failed to load this category"));
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, activeCategory, limit, offset, debouncedSearch, filter]);

  function openCategory(tile: { id: string; name: string }) {
    setActiveCategory({ id: tile.id, name: tile.name });
    setSearch("");
    setDebouncedSearch("");
    setFilter("");
    setOffset(0);
    setItems([]);
    setTotal(0);
    setSentenceError(null);
    setStep("category");
  }

  function openSentence(result: SentenceItem) {
    setSubmitError(null);
    setNavMessage(null);
    setDetailsOpen(false);
    setHistory((prev) => {
      const updated = [...prev, result];
      setHistoryIndex(updated.length - 1);
      return updated;
    });
    setStep("record");
  }

  // "Continue": the next sentence in this category I haven't translated yet, in the category's order.
  async function continueInCategory() {
    if (!activeCategory) return;
    setLoadingSentence(true);
    setSentenceError(null);
    try {
      openSentence(await api.contributions.getNextSentence(activeCategory.id));
    } catch (err) {
      setSentenceError(getErrorMessage(err, "No sentences available"));
    } finally {
      setLoadingSentence(false);
    }
  }

  useEffect(() => {
    if (!deepLinkSentenceId) return;
    setLoadingSentence(true);
    api.contributions
      .getSentenceById(deepLinkSentenceId)
      .then((s) => {
        // So "Back" and "Next" stay inside the sentence's own category.
        if (s.category) setActiveCategory({ id: s.category.id, name: s.category.name });
        openSentence(s);
      })
      .catch((err) => setSentenceError(getErrorMessage(err, "Failed to load sentence")))
      .finally(() => setLoadingSentence(false));
    // Only ever run once, for the initial deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkSentenceId]);

  function backFromRecord() {
    setStep(activeCategory ? "category" : "categories");
  }

  function goPrevious() {
    if (historyIndex <= 0) return;
    setSubmitError(null);
    setNavMessage(null);
    setDetailsOpen(false);
    setHistoryIndex((i) => i - 1);
  }

  async function goNext() {
    setSubmitError(null);
    setNavMessage(null);
    if (historyIndex < history.length - 1) {
      setDetailsOpen(false);
      setHistoryIndex((i) => i + 1);
      return;
    }
    if (!activeCategory || !sentence) return;
    setLoadingSentence(true);
    try {
      // The next untranslated sentence AFTER this one, in the category's order.
      openSentence(await api.contributions.getNextSentence(activeCategory.id, sentence.id));
    } catch (err) {
      setNavMessage(getErrorMessage(err, "No more sentences in this category"));
    } finally {
      setLoadingSentence(false);
    }
  }

  async function handleSubmit() {
    if (!sentence || !languageId || !draft.recording) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // A single request hands the audio + fields to the backend's buffer,
      // which acks immediately and finishes the R2 upload + DB write in the
      // background -- no waiting on either network hop here.
      await api.buffer.submitTranslation(
        {
          sentenceId: sentence.id,
          nativeText: draft.transcription.trim() || undefined,
          romanization: draft.romanization.trim() || undefined,
          ipa: draft.ipa.trim() || undefined,
          languageId,
          dialectId: dialectId ?? undefined,
          durationMs: Math.round(draft.recording.durationMs),
        },
        draft.recording.file,
      );

      setLastSubmittedRecording(draft.recording);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[sentence.id];
        return next;
      });
      // Reflect the submission locally so the category's progress and this
      // sentence's "Translated" badge update immediately without a re-fetch.
      const wasTranslated = sentence.hasTranslated;
      const markDone = (i: SentenceItem) => (i.id === sentence.id ? { ...i, hasTranslated: true } : i);
      setItems((prev) => prev.map(markDone));
      setHistory((prev) => prev.map(markDone));
      if (!wasTranslated && activeCategory) {
        setCategories((prev) =>
          prev.map((c) => (c.id === activeCategory.id ? { ...c, translatedCount: Math.min(c.sentenceCount, c.translatedCount + 1) } : c)),
        );
      }

      // Keep the submitted sentence in history (rather than dropping it) so
      // Previous can navigate back to it -- the backend overrides an existing
      // translation for the same sentence instead of creating a duplicate, so
      // recording again there replaces this submission.
      // Auto-advance is a per-user preference (Settings) -- off means the
      // just-submitted sentence stays on screen until Next is clicked.
      if (autoLoadNext) await goNext();
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Failed to submit translation"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!sentence && !!languageId && !!draft.recording && draft.recording !== lastSubmittedRecording && !isSubmitting;

  const languagePicker = (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <span>Read sentences in</span>
      <div className="flex overflow-hidden rounded-lg ring-1 ring-border">
        {LANGUAGES.map((l) => (
          <button
            key={l.value}
            type="button"
            onClick={() => choosePromptLanguage(l.value)}
            className={`px-3 py-1.5 text-sm font-medium transition ${
              promptLanguage === l.value ? "bg-brand text-ink-inverted" : "bg-surface-card text-ink hover:bg-border"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );

  const noLanguageNotice =
    !languageId && !languageLoading ? (
      <p className="text-center text-red-600">
        Your language isn&apos;t set yet.{" "}
        <Link href="/onboarding" className="font-semibold underline">
          Complete your profile
        </Link>{" "}
        before contributing.
      </p>
    ) : null;

  /* ------------------------------- categories ------------------------------- */
  if (step === "categories") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Link
            href="/contribute"
            className="btn-duo btn-duo-secondary shrink-0 bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
          >
            <span className="sm:hidden">← Back</span>
            <span className="hidden sm:inline">← Back to Contribute</span>
          </Link>
          <h1 className="sm:min-w-0 sm:flex-1 sm:truncate text-2xl font-bold text-ink">Translate a Sentence</h1>
        </div>

        <p className="text-sm text-ink-muted">
          Pick a topic. Each one has its sentences in a fixed order -- read each sentence and say it aloud in your language.
        </p>

        {languagePicker}
        {noLanguageNotice}
        {sentenceError ? <p className="text-center text-red-600">{sentenceError}</p> : null}

        {loadingCategories ? (
          <p className="text-ink-muted">Loading...</p>
        ) : categoriesError ? (
          <p className="text-red-600">{categoriesError}</p>
        ) : categories.length === 0 ? (
          <p className="text-ink-muted">No sentences are available yet -- please check back soon.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {categories.map((c) => {
              const pct = c.sentenceCount > 0 ? Math.min(100, Math.round((c.translatedCount / c.sentenceCount) * 100)) : 0;
              const done = c.sentenceCount > 0 && c.translatedCount >= c.sentenceCount;
              return (
                <button
                  key={c.id}
                  onClick={() => openCategory(c)}
                  className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface p-5 text-center shadow-sm transition hover:shadow-md"
                >
                  <span className="text-3xl">{done ? "✅" : "💬"}</span>
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-xs text-ink-muted">
                    {c.translatedCount} / {c.sentenceCount} translated
                  </span>
                  <div className="progress-duo-track h-1.5 w-full">
                    <div className="progress-duo-fill bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ------------------------------- one category ------------------------------- */
  if (step === "category") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button
            onClick={() => setStep("categories")}
            className="btn-duo btn-duo-secondary shrink-0 bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
          >
            ← All topics
          </button>
          <h1 className="sm:min-w-0 sm:flex-1 sm:truncate text-2xl font-bold text-ink">{activeCategory?.name}</h1>
        </div>

        {languagePicker}

        <button
          onClick={continueInCategory}
          disabled={loadingSentence || !languageId}
          className="btn-duo w-full bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {loadingSentence ? "Loading..." : "▶ Continue with the next sentence"}
        </button>
        {noLanguageNotice}
        {sentenceError ? <p className="text-center text-red-600">{sentenceError}</p> : null}

        <div className="flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this topic (any language)..."
            className="min-w-0 flex-1 rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as TranslatedFilter);
              setOffset(0);
            }}
            className="rounded-lg bg-surface-card px-4 py-3 text-sm text-ink ring-1 ring-border"
          >
            <option value="">All sentences</option>
            <option value="untranslated">Untranslated only</option>
            <option value="translated">Translated only</option>
          </select>
        </div>

        {loadingList ? (
          <p className="text-ink-muted">Loading...</p>
        ) : listError ? (
          <p className="text-red-600">{listError}</p>
        ) : items.length === 0 ? (
          <p className="text-ink-muted">No sentences match.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              // The row itself follows the reading direction: for Urdu/Persian the number sits on the right, the text
              // starts at the right edge and the "Translated" badge ends up on the left. (`text-start`, not `text-left`,
              // so right-to-left text isn't forced to the left edge.)
              <button
                key={item.id}
                onClick={() => openSentence(item)}
                dir={textDirection(promptLanguage)}
                className={`card-duo flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-start shadow-sm transition hover:shadow-md ${
                  item.hasTranslated ? "bg-brand-light/40" : "bg-surface"
                }`}
              >
                <span className="w-7 flex-shrink-0 text-xs font-semibold text-ink-muted">{offset + index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{textIn(item, promptLanguage)}</p>
                </div>
                {item.hasTranslated ? <span className="flex-shrink-0 text-xs font-semibold text-brand-dark">✓ Translated</span> : null}
              </button>
            ))}
          </div>
        )}

        <Pagination
          offset={offset}
          limit={limit}
          total={total}
          onChange={setOffset}
          onLimitChange={(n) => {
            setLimit(n);
            setOffset(0);
          }}
          showPageNumbers
        />
      </div>
    );
  }

  /* ---------------------------------- record ---------------------------------- */
  const otherLanguages = LANGUAGES.filter((l) => l.value !== promptLanguage);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button
        onClick={backFromRecord}
        className="btn-duo btn-duo-secondary shrink-0 bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
      >
        ← Back to {activeCategory ? activeCategory.name : "topics"}
      </button>

      {loadingSentence && !sentence ? (
        <p className="text-ink-muted">Loading...</p>
      ) : sentenceError || !sentence ? (
        <p className="text-red-600">{sentenceError ?? "No sentences available"}</p>
      ) : (
        <>
          {languagePicker}

          <div className="card-duo rounded-2xl bg-surface p-5 shadow-sm">
            {sentence.category ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{sentence.category.name}</p> : null}
            <p className="text-xl font-bold text-ink" dir={textDirection(promptLanguage)}>
              {textIn(sentence, promptLanguage)}
            </p>
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              {otherLanguages.map((l) => (
                // A fixed label column, then the text in its own reading direction -- so the labels line up on the
                // left whichever scripts are shown, and the text itself isn't tangled up with the label.
                <div key={l.value} className="flex items-baseline gap-3 text-sm text-ink-muted">
                  <span className="w-16 flex-shrink-0 text-[10px] font-semibold uppercase">{LANGUAGE_NAME[l.value]}</span>
                  <span className="min-w-0 flex-1 text-start" dir={textDirection(l.value)}>
                    {textIn(sentence, l.value)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              {sentence.hasTranslated ? <span className="text-xs font-semibold text-brand-dark">✓ You&apos;ve translated this -- recording again replaces it</span> : <span />}
              <Link href={`/forum?sentenceId=${sentence.id}`} className="text-xs font-semibold text-brand hover:underline">
                💬 Share to Forum
              </Link>
            </div>
          </div>

          <div className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface py-5 shadow-sm">
            <AudioRecorder
              key={sentence.id}
              maxDurationMs={MAX_DURATION_MS}
              onRecordingComplete={(file, durationMs, checksum) => updateDraft({ recording: { file, durationMs, checksum } })}
              onError={(message) => setSubmitError(message)}
            />
          </div>

          <div className="overflow-hidden rounded-2xl bg-surface shadow-sm">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <span className="font-medium text-ink">Add transcription (optional)</span>
              <span className={`text-ink-muted transition-transform ${detailsOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {detailsOpen && (
              <div className="space-y-3 px-5 pb-5">
                <textarea
                  value={draft.transcription}
                  onChange={(e) => updateDraft({ transcription: e.target.value })}
                  placeholder="Transcription (Pashto native script)"
                  rows={3}
                  className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                />
                <input
                  value={draft.romanization}
                  onChange={(e) => updateDraft({ romanization: e.target.value })}
                  placeholder="Romanization"
                  className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                />
                <input
                  value={draft.ipa}
                  onChange={(e) => updateDraft({ ipa: e.target.value })}
                  placeholder="IPA"
                  className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                />
              </div>
            )}
          </div>

          {noLanguageNotice}
          {submitError ? <p className="text-center text-red-600">{submitError}</p> : null}
          {navMessage ? <p className="text-center text-ink-muted">{navMessage}</p> : null}

          <div className="flex gap-3">
            <button
              onClick={goPrevious}
              disabled={historyIndex <= 0}
              className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-3 font-semibold text-ink transition hover:bg-border disabled:opacity-50"
            >
              ← Previous
            </button>
            <button
              onClick={goNext}
              disabled={loadingSentence}
              className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-3 font-semibold text-ink transition hover:bg-border disabled:opacity-50"
            >
              Next →
            </button>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-duo w-full bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </>
      )}
    </div>
  );
}
