"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { api, getErrorMessage, type Scene } from "@/lib/api";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import { useAuthStore } from "@/lib/store";
import { seededShuffle } from "@/lib/shuffle";
import AudioRecorder from "@/components/audio-recorder";

type Recording = { file: File; durationMs: number; checksum: string };
type Step = "browse" | "record";

export default function ScenePage() {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const userId = useAuthStore((state) => state.user?.id);

  const [step, setStep] = useState<Step>("browse");

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(true);
  const [scenesError, setScenesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [scene, setScene] = useState<Scene | null>(null);
  const [loadingScene, setLoadingScene] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  // Tracks which recording (by object identity) was last successfully
  // submitted, so Submit re-locks after a click instead of staying
  // clickable during the brief window before the next scene loads.
  const [lastSubmittedRecording, setLastSubmittedRecording] = useState<Recording | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function loadScenes(searchText: string) {
    setLoadingScenes(true);
    setScenesError(null);
    api.scenes
      .getAll({ search: searchText.trim() || undefined, limit: 100 })
      .then((res) => setScenes(userId ? seededShuffle(res.items, userId) : res.items))
      .catch((err) => setScenesError(err instanceof Error ? err.message : "Failed to load scenes"))
      .finally(() => setLoadingScenes(false));
  }

  useEffect(() => {
    loadScenes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Re-query as the admin types, rather than filtering the already-fetched
  // page client-side, since a search can match scenes outside the first 100.
  useEffect(() => {
    const timeout = setTimeout(() => loadScenes(search), 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openScene(s: Scene) {
    setScene(s);
    setStep("record");
    setSceneError(null);
    setRecording(null);
    setLastSubmittedRecording(null);
  }

  async function loadDifferentScene(excludeId?: string) {
    setLoadingScene(true);
    setSceneError(null);
    setRecording(null);
    setLastSubmittedRecording(null);
    try {
      setScene(await api.scenes.getRandom(excludeId));
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "No scenes available");
    } finally {
      setLoadingScene(false);
    }
  }

  async function handleSubmit() {
    if (!scene || !languageId || !recording) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // A single request hands the audio + fields to the backend's buffer,
      // which acks immediately and finishes the R2 upload + DB write in the
      // background -- no waiting on either network hop here.
      await api.buffer.submitScene(
        {
          sceneId: scene.id,
          durationMs: Math.round(recording.durationMs),
          languageId,
          dialectId: dialectId ?? undefined,
        },
        recording.file,
      );

      setLastSubmittedRecording(recording);
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Failed to submit scene description"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!recording && recording !== lastSubmittedRecording && !!languageId && !isSubmitting;
  const sceneIndex = scene ? scenes.findIndex((s) => s.id === scene.id) : -1;

  function goToAdjacentScene(direction: 1 | -1) {
    if (sceneIndex === -1) return;
    const nextItem = scenes[sceneIndex + direction];
    if (nextItem) openScene(nextItem);
  }

  if (step === "browse") {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/contribute"
            className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-medium text-ink hover:bg-border"
          >
            ← Back to Contribute
          </Link>
          <h1 className="text-2xl font-bold text-ink">Describe a Scene</h1>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scenes..."
          className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />

        <button
          onClick={() => loadDifferentScene().then(() => setStep("record"))}
          className="text-sm font-semibold text-brand hover:underline"
        >
          🎲 Pick a random scene
        </button>

        {loadingScenes ? (
          <p className="text-ink-muted">Loading...</p>
        ) : scenesError ? (
          <p className="text-red-600">{scenesError}</p>
        ) : scenes.length === 0 ? (
          <p className="text-ink-muted">No scenes found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {scenes.map((s) => (
              <button
                key={s.id}
                onClick={() => openScene(s)}
                className={`card-duo relative flex flex-col items-center gap-2 overflow-hidden rounded-2xl p-3 text-center shadow-sm transition hover:shadow-md ${
                  s.hasContributed ? "bg-brand-light/40" : "bg-surface"
                }`}
              >
                {s.imageUrl ? (
                  <Image src={s.imageUrl} alt="" width={96} height={96} className="h-24 w-24 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-surface-card text-3xl">🖼️</div>
                )}
                <span className="text-sm font-semibold text-ink">{s.title}</span>
                {s.hasContributed ? <span className="text-xs text-brand-dark">✓ Contributed</span> : null}
              </button>
            ))}
          </div>
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
        ← Back to scenes
      </button>

      {loadingScene ? (
        <p className="text-ink-muted">Loading...</p>
      ) : sceneError || !scene ? (
        <p className="text-red-600">{sceneError ?? "No scene selected"}</p>
      ) : (
        <>
          <div className="card-duo relative h-80 w-full overflow-hidden rounded-2xl bg-surface shadow-sm">
            {scene.imageUrl ? (
              <Image src={scene.imageUrl} alt={scene.title} fill sizes="100vw" className="object-cover" />
            ) : (
              <div className="flex h-80 w-full items-center justify-center text-5xl">🖼️</div>
            )}
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-lg font-bold text-white drop-shadow">
              {scene.title}
            </span>
          </div>

          <p className="text-center text-ink-muted">
            Describe what you see in this image in your own language. Tell us what is happening. Take as much time as you
            need.
          </p>

          <div className="card-duo flex justify-center rounded-2xl bg-surface py-8 shadow-sm">
            <AudioRecorder
              key={scene.id}
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

          {sceneIndex !== -1 ? (
            <div className="flex gap-3">
              <button
                onClick={() => goToAdjacentScene(-1)}
                disabled={sceneIndex <= 0}
                className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-3 font-semibold text-ink transition hover:bg-border disabled:opacity-50"
              >
                ← Previous
              </button>
              <button
                onClick={() => goToAdjacentScene(1)}
                disabled={sceneIndex >= scenes.length - 1}
                className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-3 font-semibold text-ink transition hover:bg-border disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          ) : null}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-duo w-full bg-amber-600 py-3 font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>

          <button
            onClick={() => loadDifferentScene(scene.id)}
            className="w-full text-center text-sm text-ink-muted hover:text-ink"
          >
            Different scene
          </button>
        </>
      )}
    </div>
  );
}
