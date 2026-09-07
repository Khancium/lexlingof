"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage, type RandomSentence } from "@/lib/api";
import { uploadAudioBlob } from "@/lib/upload";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };
type Draft = { translation: string; romanization: string; ipa: string; recording: Recording | null };

// The backend enforces no duration cap for Module 3, but the spec calls for
// a soft ceiling here ("no 3-second limit, can go up to 60 seconds").
const MAX_DURATION_MS = 60000;

const emptyDraft: Draft = { translation: "", romanization: "", ipa: "", recording: null };

export default function TranslatePage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  // History of sentences visited this session, so Previous/Next can move
  // back and forth without re-fetching or losing in-progress drafts.
  const [history, setHistory] = useState<RandomSentence[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [loadingSentence, setLoadingSentence] = useState(true);
  const [sentenceError, setSentenceError] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
      setSuccessMessage(null);
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

  function goPrevious() {
    if (historyIndex <= 0) return;
    setSuccessMessage(null);
    setSubmitError(null);
    setDetailsOpen(false);
    setHistoryIndex((i) => i - 1);
  }

  function goNext() {
    setSuccessMessage(null);
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
      const audioFileId = await uploadAudioBlob({
        blob: draft.recording.file,
        filename: draft.recording.file.name,
        mimeType: draft.recording.file.type,
        durationMs: draft.recording.durationMs,
        module: "TRANSLATION",
      });

      const result = await api.contributions.submitTranslation(sentence.id, {
        nativeText: draft.translation.trim() || undefined,
        romanization: draft.romanization.trim() || undefined,
        ipa: draft.ipa.trim() || undefined,
        audioFileId,
        languageId,
        dialectId: dialectId ?? undefined,
      });

      setSuccessMessage(`Submitted! +${result.pointsAwarded} points`);
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

  const canSubmit = !!sentence && !!languageId && !!draft.recording && !isSubmitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Translate a Sentence</h1>

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
              <span className="font-medium text-ink">Add translation text (optional)</span>
              <span className={`text-ink-muted transition-transform ${detailsOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {detailsOpen && (
              <div className="space-y-3 px-5 pb-5">
                <textarea
                  value={draft.translation}
                  onChange={(e) => updateDraft({ translation: e.target.value })}
                  placeholder="Translation"
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
          {successMessage ? <p className="text-center text-emerald-600">{successMessage}</p> : null}

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
