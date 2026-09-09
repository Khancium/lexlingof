"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api, getErrorMessage } from "@/lib/api";
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

// <audio>.duration is Infinity for a lot of MediaRecorder-produced webm
// files (Chromium can't read a duration from the container header), so a
// plain onloadedmetadata read raises "duration must be positive" downstream.
// Seeking to a huge time forces the browser to scan the file and resolve
// the real duration -- the standard workaround for this Chromium bug.
function getAudioFileDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) {
        resolve(el.duration * 1000);
        URL.revokeObjectURL(url);
        return;
      }
      el.currentTime = 1e101;
      el.ontimeupdate = () => {
        el.ontimeupdate = null;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(el.duration) ? el.duration * 1000 : 0);
      };
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read audio file"));
    };
    el.src = url;
  });
}

export default function AudioUploadPage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [title, setTitle] = useState("");
  const [recordingType, setRecordingType] = useState<(typeof RECORDING_TYPES)[number]>("conversation");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [recordedAt, setRecordedAt] = useState("");

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nativeText, setNativeText] = useState("");
  const [romanization, setRomanization] = useState("");
  const [ipa, setIpa] = useState("");
  const [englishTranslation, setEnglishTranslation] = useState("");
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFileSelected(selected: File | undefined | null) {
    if (!selected) return;
    setSubmitError(null);
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setSubmitError("File exceeds the 100MB limit");
      return;
    }
    setFile(selected);
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

  async function handleSubmit() {
    if (!file || !languageId) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const durationMs = await getAudioFileDurationMs(file);
      const validSegments = segments.filter((s) => s.startMs !== "" && s.endMs !== "");

      // A single request hands the audio + fields to the backend's buffer,
      // which acks immediately and finishes the R2 upload + DB writes
      // (submit, transcription, segments) in the background.
      await api.buffer.submitAudioUpload(
        {
          languageId,
          dialectId: dialectId ?? undefined,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          recordingType,
          location: location.trim() || undefined,
          recordedAt: recordedAt || undefined,
          durationMs: Math.round(durationMs),
          transcription:
            nativeText.trim() || romanization.trim() || ipa.trim() || englishTranslation.trim()
              ? {
                  nativeText: nativeText.trim() || undefined,
                  romanization: romanization.trim() || undefined,
                  ipa: ipa.trim() || undefined,
                  englishTranslation: englishTranslation.trim() || undefined,
                }
              : undefined,
          segments: validSegments.length
            ? validSegments.map((s) => ({
                startMs: Number(s.startMs),
                endMs: Number(s.endMs),
                nativeText: s.nativeText.trim() || undefined,
                romanization: s.romanization.trim() || undefined,
                ipa: s.ipa.trim() || undefined,
                speakerLabel: s.speakerLabel.trim() || undefined,
              }))
            : undefined,
        },
        file,
      );

      setFile(null);
      setTitle("");
      setDescription("");
      setLocation("");
      setRecordedAt("");
      setNativeText("");
      setRomanization("");
      setIpa("");
      setEnglishTranslation("");
      setSegments([]);
      setDetailsOpen(false);
      setSegmentsOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Failed to upload audio"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!file && !!languageId && !isSubmitting;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/contribute"
          className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
        >
          ← Back to Contribute
        </Link>
        <h1 className="text-2xl font-bold text-ink">Upload Audio</h1>
      </div>

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
        placeholder="Title (optional)"
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

      <div className="overflow-hidden rounded-2xl bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="font-medium text-ink">Add transcription &amp; translation (optional)</span>
          <span className={`text-ink-muted transition-transform ${detailsOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
        {detailsOpen && (
          <div className="space-y-3 px-5 pb-5">
            <textarea
              value={nativeText}
              onChange={(e) => setNativeText(e.target.value)}
              placeholder="Native-script transcription"
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
            <textarea
              value={englishTranslation}
              onChange={(e) => setEnglishTranslation(e.target.value)}
              placeholder="English translation"
              rows={3}
              className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
            />
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => setSegmentsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="font-medium text-ink">Add time-coded segments (optional)</span>
          <span className={`text-ink-muted transition-transform ${segmentsOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
        {segmentsOpen && (
          <div className="space-y-3 px-5 pb-5">
            <button type="button" onClick={addSegment} className="text-sm font-semibold text-brand hover:underline">
              + Add Time Segment
            </button>

            {segments.map((segment, index) => (
              <div key={index} className="space-y-2 rounded-xl bg-surface-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">Segment {index + 1}</span>
                  <button type="button" onClick={() => removeSegment(index)} className="text-xs text-red-600 hover:underline">
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
          </div>
        )}
      </div>

      {!languageId && !languageLoading ? (
        <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
      ) : null}
      {submitError ? <p className="text-center text-red-600">{submitError}</p> : null}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="btn-duo w-full bg-accent py-3 font-semibold text-ink-inverted transition hover:opacity-90 disabled:opacity-50"
      >
        {isSubmitting ? "Submitting..." : "Submit"}
      </button>
    </div>
  );
}
