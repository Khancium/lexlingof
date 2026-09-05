"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Scene } from "@/lib/api";
import { uploadAudioBlob } from "@/lib/upload";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };

const DIFFICULTY_COLOR: Record<Scene["difficulty"], string> = {
  easy: "bg-emerald-600",
  medium: "bg-yellow-600",
  hard: "bg-orange-600",
  expert: "bg-red-600",
};

export default function ScenePage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const [scene, setScene] = useState<Scene | null>(null);
  const [loadingScene, setLoadingScene] = useState(true);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadScene = useCallback(async (excludeId?: string) => {
    setLoadingScene(true);
    setSceneError(null);
    setRecording(null);
    setSuccessMessage(null);
    try {
      setScene(await api.scenes.getRandom(excludeId));
    } catch (err) {
      setScene(null);
      setSceneError(err instanceof Error ? err.message : "No scenes available");
    } finally {
      setLoadingScene(false);
    }
  }, []);

  useEffect(() => {
    loadScene();
  }, [loadScene]);

  async function handleSubmit() {
    if (!scene || !languageId || !recording) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const audioFileId = await uploadAudioBlob({
        blob: recording.file,
        filename: recording.file.name,
        mimeType: recording.file.type,
        durationMs: recording.durationMs,
        module: "SCENE",
      });

      const result = await api.scenes.submitContribution(scene.id, {
        audioFileId,
        durationMs: Math.round(recording.durationMs),
        languageId,
        dialectId: dialectId ?? undefined,
      });

      setSuccessMessage(`Submitted! +${result.pointsAwarded} points`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit scene description");
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!recording && !!languageId && !isSubmitting;

  if (loadingScene) {
    return <p className="text-ink-muted">Loading...</p>;
  }
  if (sceneError || !scene) {
    return <p className="text-red-600">{sceneError ?? "No scenes available"}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-surface shadow-sm">
        {scene.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.imageUrl} alt={scene.title} className="h-80 w-full object-cover" />
        ) : (
          <div className="flex h-80 w-full items-center justify-center text-5xl">🖼️</div>
        )}
        <span
          className={`absolute bottom-3 left-3 rounded px-2 py-1 text-xs font-bold capitalize text-white ${DIFFICULTY_COLOR[scene.difficulty]}`}
        >
          {scene.difficulty}
        </span>
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-lg font-bold text-white drop-shadow">
          {scene.title}
        </span>
      </div>

      <p className="text-center text-ink-muted">
        Describe what you see in this image in your own language. Tell us what is happening. Take as much time as you
        need.
      </p>

      <div className="flex justify-center rounded-2xl bg-surface py-8 shadow-sm">
        <AudioRecorder
          onRecordingComplete={(file, durationMs, checksum) => setRecording({ file, durationMs, checksum })}
          onError={(message) => setSubmitError(message)}
        />
      </div>

      <p className="text-center text-sm text-ink-muted">
        Base: 20 pts. Bonuses: longer description (60s+), today&apos;s daily scene, expert difficulty.
      </p>

      {!languageId && !languageLoading ? (
        <p className="text-center text-red-600">Set your language in your profile before contributing.</p>
      ) : null}
      {submitError ? <p className="text-center text-red-600">{submitError}</p> : null}
      {successMessage ? <p className="text-center text-emerald-600">{successMessage}</p> : null}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-full bg-amber-600 py-3 font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
      >
        {isSubmitting ? "Submitting..." : "Submit"}
      </button>

      <button onClick={() => loadScene(scene.id)} className="w-full text-center text-sm text-ink-muted hover:text-ink">
        Different scene
      </button>
    </div>
  );
}
