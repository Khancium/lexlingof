"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Language, type RandomSentence } from "@/lib/api";
import { uploadAudioBlob } from "@/lib/upload";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };

// The backend enforces no duration cap for Module 3, but the spec calls for
// a soft ceiling here ("no 3-second limit, can go up to 60 seconds").
const MAX_DURATION_MS = 60000;

export default function TranslatePage() {
  const { languageId: defaultLanguageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [languageId, setLanguageId] = useState<string | null>(null);

  const [sentence, setSentence] = useState<RandomSentence | null>(null);
  const [loadingSentence, setLoadingSentence] = useState(true);
  const [sentenceError, setSentenceError] = useState<string | null>(null);

  const [translation, setTranslation] = useState("");
  const [romanization, setRomanization] = useState("");
  const [ipa, setIpa] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    api.languages.getAll().then(setLanguages);
  }, []);

  useEffect(() => {
    if (defaultLanguageId && languageId === null) setLanguageId(defaultLanguageId);
  }, [defaultLanguageId, languageId]);

  const loadSentence = useCallback(async (forLanguageId: string) => {
    setLoadingSentence(true);
    setSentenceError(null);
    setTranslation("");
    setRomanization("");
    setIpa("");
    setRecording(null);
    setSuccessMessage(null);
    try {
      setSentence(await api.contributions.getRandomSentence(forLanguageId));
    } catch (err) {
      setSentence(null);
      setSentenceError(err instanceof Error ? err.message : "No sentences available");
    } finally {
      setLoadingSentence(false);
    }
  }, []);

  useEffect(() => {
    if (languageId) loadSentence(languageId);
  }, [languageId, loadSentence]);

  async function handleSubmit() {
    if (!sentence || !languageId || translation.trim().length === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      let audioFileId: string | undefined;
      if (recording) {
        audioFileId = await uploadAudioBlob({
          blob: recording.file,
          filename: recording.file.name,
          mimeType: recording.file.type,
          durationMs: recording.durationMs,
          module: "TRANSLATION",
        });
      }

      const result = await api.contributions.submitTranslation(sentence.id, {
        nativeText: translation.trim(),
        romanization: romanization.trim() || undefined,
        ipa: ipa.trim() || undefined,
        audioFileId,
        languageId,
        dialectId: dialectId ?? undefined,
      });

      setSuccessMessage(`Submitted! +${result.pointsAwarded} points`);
      loadSentence(languageId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit translation");
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!sentence && !!languageId && translation.trim().length > 0 && !isSubmitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Translate a Sentence</h1>

      {languages.length > 1 ? (
        <select
          value={languageId ?? ""}
          onChange={(e) => setLanguageId(e.target.value)}
          className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink ring-1 ring-border"
        >
          {languages.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nameEnglish}
            </option>
          ))}
        </select>
      ) : null}

      {loadingSentence ? (
        <p className="text-ink-muted">Loading...</p>
      ) : sentenceError || !sentence ? (
        <p className="text-red-600">{sentenceError ?? "No sentences available"}</p>
      ) : (
        <>
          <div className="rounded-2xl bg-surface p-8 shadow-sm">
            {sentence.category ? (
              <span className="mb-3 inline-block rounded-full bg-surface-card px-2 py-1 text-xs font-semibold text-ink">
                {sentence.category.name}
              </span>
            ) : null}
            <p className="text-2xl font-bold text-ink">{sentence.englishText}</p>
          </div>

          <textarea
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
            placeholder="Translation *"
            rows={3}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <input
            value={romanization}
            onChange={(e) => setRomanization(e.target.value)}
            placeholder="Romanization"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <input
            value={ipa}
            onChange={(e) => setIpa(e.target.value)}
            placeholder="IPA"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />

          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface py-8 shadow-sm">
            <AudioRecorder
              maxDurationMs={MAX_DURATION_MS}
              onRecordingComplete={(file, durationMs, checksum) => setRecording({ file, durationMs, checksum })}
              onError={(message) => setSubmitError(message)}
            />
            <p className="text-xs text-ink-muted">Optional -- record yourself reading your translation (up to 60s)</p>
          </div>

          <p className="text-center text-sm text-ink-muted">
            Base points, plus bonuses for romanization, IPA, and an audio recording.
          </p>

          {!defaultLanguageId && !languageLoading ? (
            <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
          ) : null}
          {submitError ? <p className="text-center text-red-600">{submitError}</p> : null}
          {successMessage ? <p className="text-center text-emerald-600">{successMessage}</p> : null}

          <div className="flex gap-3">
            <button
              onClick={() => languageId && loadSentence(languageId)}
              className="flex-1 rounded-full bg-surface-card py-3 font-semibold text-ink transition hover:bg-border"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-[2] rounded-full bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
