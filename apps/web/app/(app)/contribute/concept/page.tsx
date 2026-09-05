"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Category, type NextConceptResponse } from "@/lib/api";
import { uploadAudioBlob } from "@/lib/upload";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };

export default function ConceptPage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [data, setData] = useState<NextConceptResponse | null>(null);
  const [loadingConcept, setLoadingConcept] = useState(true);
  const [conceptError, setConceptError] = useState<string | null>(null);

  const [synonymIndex, setSynonymIndex] = useState<1 | 2 | 3>(1);
  const [nativeWord, setNativeWord] = useState("");
  const [romanization, setRomanization] = useState("");
  const [ipa, setIpa] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    api.categories.getAll().then(setCategories);
  }, []);

  const loadNextConcept = useCallback(async (forCategoryId: string) => {
    setLoadingConcept(true);
    setConceptError(null);
    setNativeWord("");
    setRomanization("");
    setIpa("");
    setRecording(null);
    setSynonymIndex(1);
    try {
      setData(await api.concepts.getNext(forCategoryId || undefined));
    } catch (err) {
      setData(null);
      setConceptError(err instanceof Error ? err.message : "No concepts available");
    } finally {
      setLoadingConcept(false);
    }
  }, []);

  useEffect(() => {
    loadNextConcept(categoryId);
  }, [categoryId, loadNextConcept]);

  const takesForSelectedSynonym = data?.limits.takesPerSynonym[String(synonymIndex) as "1" | "2" | "3"] ?? 0;
  const takeIndex = Math.min(3, takesForSelectedSynonym + 1) as 1 | 2 | 3;
  const synonymFull = takesForSelectedSynonym >= 3;

  async function handleSubmit() {
    if (!data || !languageId || !recording || synonymFull) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);
    try {
      const audioFileId = await uploadAudioBlob({
        blob: recording.file,
        filename: recording.file.name,
        mimeType: recording.file.type,
        durationMs: recording.durationMs,
        module: "WORD",
      });

      const result = await api.contributions.submitWord({
        audioFileId,
        conceptId: data.concept.id,
        languageId,
        dialectId: dialectId ?? undefined,
        nativeWord: nativeWord.trim(),
        romanization: romanization.trim() || undefined,
        ipa: ipa.trim() || undefined,
        synonymIndex,
        takeIndex,
        durationMs: Math.round(recording.durationMs),
      });

      setSuccessMessage(`Submitted! +${result.pointsAwarded} points`);
      loadNextConcept(categoryId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit recording");
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!recording && nativeWord.trim().length > 0 && !!languageId && !synonymFull && !isSubmitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Record a Word</h1>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEnglish}
            </option>
          ))}
        </select>
      </div>

      {loadingConcept ? (
        <p className="text-ink-muted">Loading...</p>
      ) : conceptError || !data ? (
        <p className="text-red-600">{conceptError ?? "No concepts available"}</p>
      ) : (
        <>
          <div className="rounded-2xl bg-surface p-8 text-center shadow-sm">
            {data.publicUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.publicUrl} alt={data.concept.labelEnglish} className="mx-auto mb-4 h-40 w-40 rounded-lg object-cover" />
            ) : (
              <div className="mx-auto mb-4 flex h-40 w-40 items-center justify-center rounded-lg bg-surface-card text-4xl">🖼️</div>
            )}
            <div className="text-3xl font-bold text-ink">{data.concept.labelEnglish}</div>
            <div className="mt-1 text-sm text-ink-muted">{data.category.name}</div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <span className="text-sm font-medium text-ink-muted">Synonym:</span>
            {([1, 2, 3] as const).map((idx) => {
              const takes = data.limits.takesPerSynonym[String(idx) as "1" | "2" | "3"] ?? 0;
              return (
                <button
                  key={idx}
                  onClick={() => setSynonymIndex(idx)}
                  className={`h-9 w-9 rounded-full text-sm font-bold transition ${
                    synonymIndex === idx
                      ? "bg-brand text-ink-inverted"
                      : takes >= 3
                        ? "bg-surface-card text-ink-muted/50"
                        : "bg-surface-card text-ink-muted hover:bg-border"
                  }`}
                >
                  {idx}
                </button>
              );
            })}
            <span className="text-xs text-ink-muted">Take {takeIndex} of 3</span>
          </div>

          {synonymFull ? (
            <p className="text-center text-emerald-600">This synonym slot is complete. Pick another synonym.</p>
          ) : (
            <>
              <div className="space-y-3">
                <input
                  value={nativeWord}
                  onChange={(e) => setNativeWord(e.target.value)}
                  placeholder="Your word *"
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
              </div>

              <div className="flex justify-center rounded-2xl bg-surface py-8 shadow-sm">
                <AudioRecorder
                  maxDurationMs={3000}
                  onRecordingComplete={(file, durationMs, checksum) => setRecording({ file, durationMs, checksum })}
                  onError={(message) => setSubmitError(message)}
                />
              </div>

              <p className="text-center text-sm text-ink-muted">Base points awarded now, plus a bonus once verified.</p>

              {!languageId && !languageLoading ? (
                <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
              ) : null}
              {submitError ? <p className="text-center text-red-600">{submitError}</p> : null}
              {successMessage ? <p className="text-center text-emerald-600">{successMessage}</p> : null}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full rounded-full bg-brand py-3 font-semibold text-ink-inverted transition hover:bg-brand-dark disabled:opacity-50"
              >
                {isSubmitting ? "Submitting..." : "Submit"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
