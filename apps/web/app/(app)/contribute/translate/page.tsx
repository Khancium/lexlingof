"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, getErrorMessage, type RandomSentence } from "@/lib/api";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import { useAuthStore } from "@/lib/store";
import { seededShuffle } from "@/lib/shuffle";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };
type Draft = { transcription: string; romanization: string; ipa: string; recording: Recording | null };

// The backend enforces no duration cap for Module 3, but the spec calls for
// a soft ceiling here ("no 3-second limit, can go up to 60 seconds").
const MAX_DURATION_MS = 60000;

const emptyDraft: Draft = { transcription: "", romanization: "", ipa: "", recording: null };

export default function TranslatePage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const userId = useAuthStore((state) => state.user?.id);

  // History of sentences visited this session, so Previous/Next can move
  // back and forth without re-fetching or losing in-progress drafts.
  const [history, setHistory] = useState<RandomSentence[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [loadingSentence, setLoadingSentence] = useState(true);
  const [sentenceError, setSentenceError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<RandomSentence[]>([]);
  const [searching, setSearching] = useState(false);

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
      } catch (err) {
        setSentenceError(getErrorMessage(err, "No sentences available"));
      } finally {
        setLoadingSentence(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (languageId && history.length === 0) fetchNewSentence(languageId);
  }, [languageId, history.length, fetchNewSentence]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      api.contributions
        .searchSentences({ search: search.trim(), limit: 10 })
        .then((res) => setSearchResults(userId ? seededShuffle(res.items, userId) : res.items))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [search, userId]);

  function openSearchResult(result: RandomSentence) {
    setSearch("");
    setSearchResults([]);
    setSubmitError(null);
    setDetailsOpen(false);
    setHistory((prev) => {
      const updated = [...prev, result];
      setHistoryIndex(updated.length - 1);
      return updated;
    });
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
      // Drop the submitted sentence from history and load a fresh one.
      setHistory((prev) => prev.filter((s) => s.id !== sentence.id));
      setHistoryIndex((i) => i - 1);
      fetchNewSentence(languageId);
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Failed to submit translation"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!sentence && !!languageId && !!draft.recording && draft.recording !== lastSubmittedRecording && !isSubmitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/contribute"
          className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
        >
          ← Back to Contribute
        </Link>
        <h1 className="text-2xl font-bold text-ink">Translate a Sentence</h1>
      </div>

      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sentences..."
          className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />
        {search.trim() ? (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-border">
            {searching ? (
              <p className="px-4 py-3 text-sm text-ink-muted">Searching...</p>
            ) : searchResults.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">No matching sentences.</p>
            ) : (
              searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => openSearchResult(result)}
                  className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-card"
                >
                  {result.englishText}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {loadingSentence ? (
        <p className="text-ink-muted">Loading...</p>
      ) : sentenceError || !sentence ? (
        <p className="text-red-600">{sentenceError ?? "No sentences available"}</p>
      ) : (
        <>
          <div className="card-duo rounded-2xl bg-surface p-8 shadow-sm">
            {sentence.category ? (
              <span className="mb-3 inline-block rounded-full bg-surface-card px-2 py-1 text-xs font-semibold text-ink">
                {sentence.category.name}
              </span>
            ) : null}
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
