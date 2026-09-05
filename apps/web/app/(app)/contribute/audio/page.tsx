"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Language } from "@/lib/api";
import { uploadAudioBlob } from "@/lib/upload";
import { useContributorLanguage } from "@/lib/useContributorLanguage";

const RECORDING_TYPES = ["conversation", "story", "interview", "speech", "song", "other"] as const;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

type Segment = {
  segmentIndex: number;
  startMs: string;
  endMs: string;
  nativeText: string;
  romanization: string;
  ipa: string;
  speakerLabel: string;
};

function getAudioFileDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      resolve(el.duration * 1000);
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read audio file"));
    };
    el.src = url;
  });
}

export default function AudioUploadPage() {
  const { languageId: defaultLanguageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const [languages, setLanguages] = useState<Language[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [title, setTitle] = useState("");
  const [recordingType, setRecordingType] = useState<(typeof RECORDING_TYPES)[number]>("conversation");
  const [languageId, setLanguageId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [recordedAt, setRecordedAt] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const [audioUploadId, setAudioUploadId] = useState<string | null>(null);
  const [pointsSoFar, setPointsSoFar] = useState(0);

  const [nativeText, setNativeText] = useState("");
  const [romanization, setRomanization] = useState("");
  const [ipa, setIpa] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isSubmittingStep2, setIsSubmittingStep2] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  useEffect(() => {
    api.languages.getAll().then(setLanguages);
  }, []);

  useEffect(() => {
    if (defaultLanguageId && languageId === null) setLanguageId(defaultLanguageId);
  }, [defaultLanguageId, languageId]);

  function handleFileSelected(selected: File | undefined | null) {
    if (!selected) return;
    setStep1Error(null);
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setStep1Error("File exceeds the 100MB limit");
      return;
    }
    setFile(selected);
  }

  async function handleUploadAndContinue() {
    if (!file || !languageId || title.trim().length === 0) return;
    setIsUploading(true);
    setStep1Error(null);
    try {
      const durationMs = await getAudioFileDurationMs(file);

      const audioFileId = await uploadAudioBlob({
        blob: file,
        filename: file.name,
        mimeType: file.type || "audio/mpeg",
        durationMs,
        module: "TRANSCRIPTION",
      });

      const result = await api.contributions.submitAudio({
        audioFileId,
        languageId,
        dialectId: dialectId ?? undefined,
        title: title.trim(),
        description: description.trim() || undefined,
        recordingType,
        location: location.trim() || undefined,
        recordedAt: recordedAt || undefined,
      });

      setAudioUploadId(result.audioUploadId);
      setPointsSoFar(result.pointsAwarded);
      setStep(2);
    } catch (err) {
      setStep1Error(err instanceof Error ? err.message : "Failed to upload audio");
    } finally {
      setIsUploading(false);
    }
  }

  function addSegment() {
    setSegments((prev) => [
      ...prev,
      { segmentIndex: prev.length, startMs: "", endMs: "", nativeText: "", romanization: "", ipa: "", speakerLabel: "" },
    ]);
  }

  function updateSegment(index: number, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSegment(index: number) {
    setSegments((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, segmentIndex: i })));
  }

  async function handleSubmitStep2() {
    if (!audioUploadId) return;
    setIsSubmittingStep2(true);
    setStep2Error(null);
    try {
      let total = pointsSoFar;

      if (nativeText.trim() || romanization.trim() || ipa.trim()) {
        const result = await api.contributions.addTranscription(audioUploadId, {
          nativeText: nativeText.trim() || undefined,
          romanization: romanization.trim() || undefined,
          ipa: ipa.trim() || undefined,
        });
        total += result.pointsAwarded ?? 0;
      }

      for (const segment of segments) {
        if (segment.startMs === "" || segment.endMs === "") continue;
        const result = await api.contributions.addSegment(audioUploadId, {
          segmentIndex: segment.segmentIndex,
          startMs: Number(segment.startMs),
          endMs: Number(segment.endMs),
          nativeText: segment.nativeText.trim() || undefined,
          romanization: segment.romanization.trim() || undefined,
          ipa: segment.ipa.trim() || undefined,
          speakerLabel: segment.speakerLabel.trim() || undefined,
        });
        total += result.pointsAwarded ?? 0;
      }

      setDoneMessage(`Submitted! +${total} points total`);
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : "Failed to submit transcription");
    } finally {
      setIsSubmittingStep2(false);
    }
  }

  const canUpload = !!file && !!languageId && title.trim().length > 0 && !isUploading;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Upload Audio</h1>
        <p className="text-sm text-ink-muted">Step {step} of 2</p>
      </div>

      {step === 1 ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFileSelected(e.dataTransfer.files[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed py-12 text-center transition ${
              isDragging ? "border-brand bg-brand-light" : "border-border"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />
            <p className="text-ink">{file ? file.name : "Drag and drop an audio file, or click to select"}</p>
            {file ? <p className="mt-1 text-sm text-ink-muted">{(file.size / (1024 * 1024)).toFixed(2)} MB</p> : null}
          </div>
          <p className="text-center text-xs text-ink-muted">Maximum file size: 100MB</p>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title *"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />

          <select
            value={recordingType}
            onChange={(e) => setRecordingType(e.target.value as (typeof RECORDING_TYPES)[number])}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink ring-1 ring-border"
          >
            {RECORDING_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>

          <select
            value={languageId ?? ""}
            onChange={(e) => setLanguageId(e.target.value)}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink ring-1 ring-border"
          >
            <option value="" disabled>
              Select a language
            </option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nameEnglish}
              </option>
            ))}
          </select>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <input
            type="date"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink ring-1 ring-border"
          />

          {!defaultLanguageId && !languageLoading && !languageId ? (
            <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
          ) : null}
          {step1Error ? <p className="text-center text-red-600">{step1Error}</p> : null}

          <button
            onClick={handleUploadAndContinue}
            disabled={!canUpload}
            className="w-full rounded-full bg-accent py-3 font-semibold text-ink-inverted transition hover:opacity-90 disabled:opacity-50"
          >
            {isUploading ? "Uploading..." : "Upload & Continue"}
          </button>
        </>
      ) : (
        <>
          <h2 className="text-lg font-bold text-ink">Transcription</h2>
          <textarea
            value={nativeText}
            onChange={(e) => setNativeText(e.target.value)}
            placeholder="Native text"
            rows={4}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <textarea
            value={romanization}
            onChange={(e) => setRomanization(e.target.value)}
            placeholder="Romanization"
            rows={2}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <textarea
            value={ipa}
            onChange={(e) => setIpa(e.target.value)}
            placeholder="IPA"
            rows={2}
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />

          <button onClick={addSegment} className="text-sm font-semibold text-brand hover:underline">
            + Add Time Segment
          </button>

          {segments.map((segment, index) => (
            <div key={index} className="space-y-2 rounded-xl bg-surface-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Segment {index + 1}</span>
                <button onClick={() => removeSegment(index)} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={segment.startMs}
                  onChange={(e) => updateSegment(index, { startMs: e.target.value })}
                  placeholder="Start (ms)"
                  className="w-1/2 rounded-lg bg-surface px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
                />
                <input
                  value={segment.endMs}
                  onChange={(e) => updateSegment(index, { endMs: e.target.value })}
                  placeholder="End (ms)"
                  className="w-1/2 rounded-lg bg-surface px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
                />
              </div>
              <input
                value={segment.nativeText}
                onChange={(e) => updateSegment(index, { nativeText: e.target.value })}
                placeholder="Native text"
                className="w-full rounded-lg bg-surface px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
              />
            </div>
          ))}

          {step2Error ? <p className="text-center text-red-600">{step2Error}</p> : null}
          {doneMessage ? <p className="text-center text-emerald-600">{doneMessage}</p> : null}

          <button
            onClick={handleSubmitStep2}
            disabled={isSubmittingStep2}
            className="w-full rounded-full bg-accent py-3 font-semibold text-ink-inverted transition hover:opacity-90 disabled:opacity-50"
          >
            {isSubmittingStep2 ? "Submitting..." : "Submit"}
          </button>
        </>
      )}
    </div>
  );
}
