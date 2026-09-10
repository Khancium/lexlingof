"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, getErrorMessage, type RandomSentence } from "@/lib/api";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import { useAuthStore } from "@/lib/store";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };
type Draft = { transcription: string; romanization: string; ipa: string; recording: Recording | null };
type Step = "browse" | "record";
type TranslatedFilter = "" | "translated" | "untranslated";

// The backend enforces no duration cap for Module 3, but the spec calls for
// a soft ceiling here ("no 3-second limit, can go up to 60 seconds").
const MAX_DURATION_MS = 60000;
const PAGE_SIZE = 50;

const emptyDraft: Draft = { transcription: "", romanization: "", ipa: "", recording: null };

export default function TranslatePage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const autoLoadNext = useAuthStore((state) => state.user?.autoLoadNext ?? true);

  const [step, setStep] = useState<Step>("browse");

  // Browse step: a real paginated list (mirroring the concept/scene modules'
  // browse-tiles-with-search pattern) instead of only a small
  // search-and-jump dropdown -- the backend already sorts untranslated
  // sentences first and marks each with hasTranslated.
  const [browseItems, setBrowseItems] = useState<RandomSentence[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseSearch, setBrowseSearch] = useState("");
  const [browseFilter, setBrowseFilter] = useState<TranslatedFilter>("");
  const [loadingBrowse, setLoadingBrowse] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // History of sentences visited this session, so Previous/Next can move
  // back and forth without re-fetching or losing in-progress drafts.
  const [history, setHistory] = useState<RandomSentence[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [loadingSentence, setLoadingSentence] = useState(false);
  const [sentenceError, setSentenceError] = useState<string | null>(null);

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

  const loadBrowseList = useCallback(() => {
    setLoadingBrowse(true);
    setBrowseError(null);
    api.contributions
      .searchSentences({ search: browseSearch.trim() || undefined, filter: browseFilter || undefined, limit: PAGE_SIZE })
      .then((res) => {
        setBrowseItems(res.items);
        setBrowseTotal(res.total);
      })
      .catch((err) => setBrowseError(getErrorMessage(err, "Failed to load sentences")))
      .finally(() => setLoadingBrowse(false));
  }, [browseSearch, browseFilter]);

  useEffect(() => {
    if (step !== "browse") return;
    const timeout = setTimeout(loadBrowseList, 250);
    return () => clearTimeout(timeout);
  }, [step, loadBrowseList]);

  const fetchNewSentence = useCallback(
    async (forLanguageId: string) => {
      setLoadingSentence(true);
      setSentenceError(null);
      setDetailsOpen(false);
      try {
        const next = await api.contributions.getRandomSentence(forLanguageId);
        setHistory((prev) => {
          const updated = [...prev, next];
          setHistoryIndex(updated.length - 1);
          return updated;
        });
        setStep("record");
      } catch (err) {
        setSentenceError(getErrorMessage(err, "No sentences available"));
      } finally {
        setLoadingSentence(false);
      }
    },
    [],
  );

  function openSentence(result: RandomSentence) {
    setSubmitError(null);
    setDetailsOpen(false);
    setHistory((prev) => {
      const updated = [...prev, result];
      setHistoryIndex(updated.length - 1);
      return updated;
    });
    setStep("record");
  }

  function goPrevious() {
    if (historyIndex <= 0) return;
    setSubmitError(null);
    setDetailsOpen(false);
    setHistoryIndex((i) => i - 1);
  }

  function goNext() {
    setSubmitError(null);
    if (historyIndex < history.length - 1) {
      setDetailsOpen(false);
      setHistoryIndex((i) => i + 1);
    } else if (languageId) {
      fetchNewSentence(languageId);
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
      // Keep the submitted sentence in history (rather than dropping it) so
      // Previous can navigate back to it -- the backend now overrides an
      // existing translation for the same sentence instead of creating a
      // duplicate, so recording again there replaces this submission.
      // Auto-advance is a per-user preference (Settings) -- off means the
      // just-submitted sentence stays on screen until Next is clicked.
      if (autoLoadNext) fetchNewSentence(languageId);
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Failed to submit translation"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!sentence && !!languageId && !!draft.recording && draft.recording !== lastSubmittedRecording && !isSubmitting;

  if (step === "browse") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/contribute"
            className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
          >
            ← Back to Contribute
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-ink">Translate a Sentence</h1>
        </div>

        <button
          onClick={() => languageId && fetchNewSentence(languageId)}
          disabled={!languageId || loadingSentence}
          className="btn-duo w-full bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          🎲 Translate Randomly
        </button>

        <div className="flex flex-wrap gap-3">
          <input
            value={browseSearch}
            onChange={(e) => setBrowseSearch(e.target.value)}
            placeholder="Search sentences..."
            className="min-w-0 flex-1 rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <select
            value={browseFilter}
            onChange={(e) => setBrowseFilter(e.target.value as TranslatedFilter)}
            className="rounded-lg bg-surface-card px-4 py-3 text-sm text-ink ring-1 ring-border"
          >
            <option value="">All sentences</option>
            <option value="untranslated">Untranslated only</option>
            <option value="translated">Translated only</option>
          </select>
        </div>

        {!languageId && !languageLoading ? (
          <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
        ) : null}
        {sentenceError ? <p className="text-center text-red-600">{sentenceError}</p> : null}

        {loadingBrowse ? (
          <p className="text-ink-muted">Loading...</p>
        ) : browseError ? (
          <p className="text-red-600">{browseError}</p>
        ) : browseItems.length === 0 ? (
          <p className="text-ink-muted">No sentences found.</p>
        ) : (
          <>
            <p className="text-xs text-ink-muted">
              {browseTotal} sentence{browseTotal === 1 ? "" : "s"}
            </p>
            <div className="space-y-2">
              {browseItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openSentence(item)}
                  className={`card-duo flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left shadow-sm transition hover:shadow-md ${
                    item.hasTranslated ? "bg-brand-light/40" : "bg-surface"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{item.englishText}</p>
                  </div>
                  {item.hasTranslated ? (
                    <span className="flex-shrink-0 text-xs font-semibold text-brand-dark">✓ Translated</span>
                  ) : null}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button
        onClick={() => setStep("browse")}
        className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
      >
        ← Back to sentences
      </button>

      {loadingSentence ? (
        <p className="text-ink-muted">Loading...</p>
      ) : sentenceError || !sentence ? (
        <p className="text-red-600">{sentenceError ?? "No sentences available"}</p>
      ) : (
        <>
          <div className="card-duo rounded-2xl bg-surface p-8 shadow-sm">
            <p className="text-2xl font-bold text-ink">{sentence.englishText}</p>
          </div>

          <div className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface py-8 shadow-sm">
            <AudioRecorder
              key={sentence.id}
              maxDurationMs={MAX_DURATION_MS}
              onRecordingComplete={(file, durationMs, checksum) => updateDraft({ recording: { file, durationMs, checksum } })}
              onError={(message) => setSubmitError(message)}
            />
            <p className="text-xs text-ink-muted">Record yourself reading your translation (up to 60s)</p>
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

          <p className="text-center text-sm text-ink-muted">
            Base points, plus bonuses for romanization and IPA.
          </p>

          {!languageId && !languageLoading ? (
            <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
          ) : null}
          {submitError ? <p className="text-center text-red-600">{submitError}</p> : null}

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
              className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-3 font-semibold text-ink transition hover:bg-border"
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
