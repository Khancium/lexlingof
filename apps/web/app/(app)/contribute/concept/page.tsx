"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  api,
  getErrorMessage,
  type Category,
  type ConceptDetail,
  type ConceptListItem,
  type RecordedSynonyms,
} from "@/lib/api";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import { useAuthStore } from "@/lib/store";
import { seededShuffle } from "@/lib/shuffle";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };
type Step = "categories" | "concepts" | "record";

export default function ConceptPage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const userId = useAuthStore((state) => state.user?.id);

  const [step, setStep] = useState<Step>("categories");

  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<Category | null>(null);

  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [loadingConcepts, setLoadingConcepts] = useState(false);

  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [recordedSynonyms, setRecordedSynonyms] = useState<RecordedSynonyms | null>(null);
  const [loadingConcept, setLoadingConcept] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);

  const [synonymIndex, setSynonymIndex] = useState<1 | 2 | 3>(1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nativeWord, setNativeWord] = useState("");
  const [romanization, setRomanization] = useState("");
  const [ipa, setIpa] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  // Tracks which recording (by object identity) was last successfully
  // submitted, so Submit re-locks after a click instead of staying clickable
  // -- it only unlocks again once `recording` actually changes (a retake, or
  // switching to a different synonym resets both to null).
  const [lastSubmittedRecording, setLastSubmittedRecording] = useState<Recording | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    api.categories.getAll().then((all) => {
      setCategories(userId ? seededShuffle(all, userId) : all);
    });
  }, [userId]);

  function openCategory(c: Category) {
    setCategory(c);
    setStep("concepts");
    setLoadingConcepts(true);
    api.concepts
      .getAll({ categoryId: c.id, limit: 100 })
      .then((res) => setConcepts(res.items))
      .finally(() => setLoadingConcepts(false));
  }

  const openConcept = useCallback(async (item: ConceptListItem) => {
    setStep("record");
    setLoadingConcept(true);
    setConceptError(null);
    setNativeWord("");
    setRomanization("");
    setIpa("");
    setRecording(null);
    setLastSubmittedRecording(null);
    setSynonymIndex(1);
    setDetailsOpen(false);
    setSuccessMessage(null);
    setSubmitError(null);
    try {
      const [detail, recorded] = await Promise.all([
        api.concepts.getById(item.id),
        api.contributions.getWordLimits(item.id),
      ]);
      setConcept(detail);
      setRecordedSynonyms(recorded);
    } catch (err) {
      setConcept(null);
      setConceptError(err instanceof Error ? err.message : "Failed to load object");
    } finally {
      setLoadingConcept(false);
    }
  }, []);

  function selectSynonym(idx: 1 | 2 | 3) {
    if (idx === synonymIndex) return;
    setSynonymIndex(idx);
    setRecording(null);
    setLastSubmittedRecording(null);
    setNativeWord("");
    setRomanization("");
    setIpa("");
    setDetailsOpen(false);
    setSubmitError(null);
    setSuccessMessage(null);
  }

  async function handleSubmit() {
    if (!concept || !languageId || !recording) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);
    try {
      // A single request hands the audio + fields to the backend's buffer,
      // which acks immediately and finishes the R2 upload + DB write in the
      // background -- no waiting on either network hop here. There's no take
      // limit -- recording this synonym again overrides whatever's already
      // stored for it, in the database and in object storage.
      await api.buffer.submitWord(
        {
          conceptId: concept.id,
          languageId,
          dialectId: dialectId ?? undefined,
          nativeWord: nativeWord.trim() || undefined,
          romanization: romanization.trim() || undefined,
          ipa: ipa.trim() || undefined,
          synonymIndex,
          durationMs: Math.round(recording.durationMs),
        },
        recording.file,
      );

      setSuccessMessage("Submitted! Processing in the background -- points will show up on My Contributions shortly.");
      setLastSubmittedRecording(recording);
      setRecordedSynonyms((prev) => (prev ? { ...prev, [synonymIndex]: true } : prev));
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Failed to submit recording"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!recording && recording !== lastSubmittedRecording && !!languageId && !isSubmitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        {step !== "categories" && (
          <button
            onClick={() => (step === "record" ? setStep("concepts") : setStep("categories"))}
            className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
          >
            ← Back
          </button>
        )}
        <h1 className="text-2xl font-bold text-ink">Record a Word</h1>
      </div>

      {step === "categories" && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => openCategory(c)}
              className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface p-6 text-center shadow-sm transition hover:shadow-md"
            >
              <span className="text-4xl">{c.icon ?? "📦"}</span>
              <span className="font-semibold text-ink">{c.nameEnglish}</span>
              <span className="text-xs text-ink-muted">{c.conceptCount} objects</span>
            </button>
          ))}
        </div>
      )}

      {step === "concepts" && (
        <>
          <p className="text-sm text-ink-muted">{category?.nameEnglish}</p>
          {loadingConcepts ? (
            <p className="text-ink-muted">Loading...</p>
          ) : concepts.length === 0 ? (
            <p className="text-ink-muted">No objects in this category yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {concepts.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openConcept(item)}
                  className="card-duo flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface p-6 text-center shadow-sm transition hover:shadow-md"
                >
                  <span className="text-3xl">🖼️</span>
                  <span className="font-semibold text-ink">{item.labelEnglish}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === "record" && (
        <>
          {loadingConcept ? (
            <p className="text-ink-muted">Loading...</p>
          ) : conceptError || !concept ? (
            <p className="text-red-600">{conceptError ?? "Failed to load object"}</p>
          ) : (
            <>
              <div className="card-duo rounded-2xl bg-surface p-8 text-center shadow-sm">
                {concept.media[0]?.publicUrl ? (
                  <Image
                    src={concept.media[0].publicUrl}
                    alt={concept.labelEnglish}
                    width={160}
                    height={160}
                    className="mx-auto mb-4 h-40 w-40 rounded-lg object-cover"
                  />
                ) : (
                  <div className="mx-auto mb-4 flex h-40 w-40 items-center justify-center rounded-lg bg-surface-card text-4xl">
                    🖼️
                  </div>
                )}
                <div className="text-3xl font-bold text-ink">{concept.labelEnglish}</div>
                <div className="mt-1 text-sm text-ink-muted">{concept.category.name}</div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <span className="text-sm font-medium text-ink-muted">Synonym:</span>
                {([1, 2, 3] as const).map((idx) => {
                  const recorded = recordedSynonyms?.[idx] ?? false;
                  return (
                    <button
                      key={idx}
                      onClick={() => selectSynonym(idx)}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition ${
                        synonymIndex === idx
                          ? "bg-brand text-ink-inverted"
                          : recorded
                            ? "bg-brand-light text-brand-dark hover:bg-border"
                            : "bg-surface-card text-ink-muted hover:bg-border"
                      }`}
                    >
                      {recorded && synonymIndex !== idx ? "✓" : idx}
                    </button>
                  );
                })}
              </div>
              {recordedSynonyms?.[synonymIndex] ? (
                <p className="text-center text-xs text-ink-muted">
                  Already recorded -- record again to replace it.
                </p>
              ) : null}

              <div className="card-duo flex flex-col items-center justify-center gap-4 rounded-2xl bg-surface py-10 shadow-sm">
                <AudioRecorder
                  key={synonymIndex}
                  maxDurationMs={5000}
                  onRecordingComplete={(file, durationMs, checksum) => setRecording({ file, durationMs, checksum })}
                  onError={(message) => setSubmitError(message)}
                />
                <p className="text-sm text-ink-muted">Tap to record</p>
              </div>

              <div className="overflow-hidden rounded-2xl bg-surface shadow-sm">
                <button
                  type="button"
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <span className="font-medium text-ink">Add word details (optional)</span>
                  <span className={`text-ink-muted transition-transform ${detailsOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {detailsOpen && (
                  <div className="space-y-3 px-5 pb-5">
                    <input
                      value={nativeWord}
                      onChange={(e) => setNativeWord(e.target.value)}
                      placeholder="Your word"
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
                )}
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
                className="btn-duo w-full bg-brand py-3 font-semibold text-ink-inverted transition hover:bg-brand-dark disabled:opacity-50"
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
