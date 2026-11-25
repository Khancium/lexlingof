"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, getErrorMessage, type Category, type Scene } from "@/lib/api";
import { useContributorLanguage } from "@/lib/useContributorLanguage";
import { useAuthStore } from "@/lib/store";
import { seededShuffle } from "@/lib/shuffle";
import { readUrlParam, useUrlStateSync } from "@/lib/url-state";
import { Pagination } from "@/components/admin-pagination";
import AudioRecorder from "@/components/audio-recorder";
import { SuggestBetterImageButton } from "@/components/suggest-better-image-button";

type Recording = { file: File; durationMs: number; checksum: string };
type Step = "categories" | "category" | "record";
type ActiveCategory = { id: string; name: string } | null;

const LIST_PAGE_SIZE = 24;

export default function ScenePage() {
  return (
    <Suspense fallback={<p className="text-ink-muted">Loading...</p>}>
      <ScenePageInner />
    </Suspense>
  );
}

function ScenePageInner() {
  // Arriving from a failed-submission "Submit Again" link (?sceneId=X) --
  // jumps straight into recording that exact scene.
  const searchParams = useSearchParams();
  const deepLinkSceneId = searchParams.get("sceneId");

  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();
  const userId = useAuthStore((state) => state.user?.id);
  const autoLoadNext = useAuthStore((state) => state.user?.autoLoadNext ?? true);

  // The categories tile list. "All scenes" (no categoryId) is its own tile,
  // not one of these -- see the categories step below.
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(() => (readUrlParam("view", "categories") === "list" ? "category" : "categories"));
  // null activeCategory while step === "category" means the "All scenes" tile was picked.
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>(() => {
    const id = readUrlParam("categoryId", "");
    if (!id) return null;
    return { id, name: readUrlParam("categoryName", "") };
  });

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(() => readUrlParam("offset", 0));
  const [limit, setLimit] = useState(() => readUrlParam("limit", LIST_PAGE_SIZE));
  const [loadingScenes, setLoadingScenes] = useState(true);
  const [scenesError, setScenesError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => readUrlParam("search", ""));
  const [debouncedSearch, setDebouncedSearch] = useState(() => readUrlParam("search", ""));

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

  // Guards against a slow, now-stale response overwriting a faster, more
  // recent one -- see the identical guard on the concept contribute page.
  const scenesRequestId = useRef(0);
  // search and debouncedSearch start equal (both read from the URL on
  // mount) -- skip this effect's first run so it doesn't reset a
  // just-restored offset back to 0 before anything's actually changed.
  const isFirstSearchRun = useRef(true);

  useEffect(() => {
    api.categories
      .getAll()
      .then(setCategories)
      .catch((err) => setCategoriesError(getErrorMessage(err, "Failed to load categories")))
      .finally(() => setLoadingCategories(false));
  }, []);

  // Keeps the URL in sync with the open category/search/page, so a reload
  // (or a shared link) lands back on the same spot instead of resetting to
  // the category tiles -- only meaningful once a category (or "All scenes")
  // is open, so the tiles step clears all of these from the URL.
  useUrlStateSync({
    view: step === "category" ? "list" : undefined,
    categoryId: step === "category" ? (activeCategory?.id ?? undefined) : undefined,
    categoryName: step === "category" ? (activeCategory?.name ?? undefined) : undefined,
    search: step === "category" ? debouncedSearch : undefined,
    offset: step === "category" ? offset : undefined,
    limit: step === "category" ? limit : undefined,
  });

  function loadScenes() {
    const requestId = ++scenesRequestId.current;
    setLoadingScenes(true);
    setScenesError(null);
    api.scenes
      .getAll({ categoryId: activeCategory?.id, search: debouncedSearch.trim() || undefined, limit, offset })
      .then((res) => {
        if (requestId !== scenesRequestId.current) return;
        setScenes(userId ? seededShuffle(res.items, userId) : res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (requestId === scenesRequestId.current) setScenesError(getErrorMessage(err, "Failed to load scenes"));
      })
      .finally(() => {
        if (requestId === scenesRequestId.current) setLoadingScenes(false);
      });
  }

  useEffect(() => {
    if (step !== "category") return;
    loadScenes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeCategory, limit, offset, debouncedSearch, userId]);

  // Re-query as the user types, rather than filtering the already-fetched
  // page client-side, since a search can match scenes outside the current page.
  useEffect(() => {
    if (isFirstSearchRun.current) {
      isFirstSearchRun.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  function openCategoryList(category: ActiveCategory) {
    setActiveCategory(category);
    setSearch("");
    setDebouncedSearch("");
    setOffset(0);
    setScenes([]);
    setTotal(0);
    setStep("category");
  }

  function openScene(s: Scene) {
    setScene(s);
    setStep("record");
    setSceneError(null);
    setRecording(null);
    setLastSubmittedRecording(null);
  }

  useEffect(() => {
    if (!deepLinkSceneId) return;
    setLoadingScene(true);
    api.scenes
      .getById(deepLinkSceneId)
      .then((s) => openScene(s))
      .catch((err) => setSceneError(getErrorMessage(err, "Failed to load scene")))
      .finally(() => setLoadingScene(false));
    // Only ever run once, for the initial deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkSceneId]);

  async function loadDifferentScene(excludeId?: string) {
    setLoadingScene(true);
    setSceneError(null);
    setRecording(null);
    setLastSubmittedRecording(null);
    try {
      setScene(await api.scenes.getRandom(excludeId));
    } catch (err) {
      setSceneError(getErrorMessage(err, "No scenes available"));
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
      // Same auto-advance the translate module already does on submit --
      // Previous/Next stay fully functional, this just moves on to the next
      // scene in the current list automatically, or a fresh random one once
      // the list runs out. Gated by the user's Settings preference.
      if (autoLoadNext) {
        const nextItem = scenes[sceneIndex + 1];
        if (nextItem) {
          openScene(nextItem);
        } else {
          loadDifferentScene(scene.id);
        }
      }
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

  function backFromRecord() {
    setStep(activeCategory !== null || scenes.length > 0 ? "category" : "categories");
  }

  /* ------------------------------- categories ------------------------------- */
  if (step === "categories") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Link
            href="/contribute"
            className="btn-duo btn-duo-secondary shrink-0 bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
          >
            <span className="sm:hidden">← Back</span>
            <span className="hidden sm:inline">← Back to Contribute</span>
          </Link>
          <h1 className="sm:min-w-0 sm:flex-1 sm:truncate text-2xl font-bold text-ink">Describe a Scene</h1>
        </div>

        <button
          onClick={() => loadDifferentScene().then(() => setStep("record"))}
          disabled={loadingScene}
          className="btn-duo w-full bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          🎲 Pick a Random Scene
        </button>

        {sceneError ? <p className="text-center text-red-600">{sceneError}</p> : null}

        {loadingCategories ? (
          <p className="text-ink-muted">Loading...</p>
        ) : categoriesError ? (
          <p className="text-red-600">{categoriesError}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            <button
              onClick={() => openCategoryList(null)}
              className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface p-6 text-center shadow-sm transition hover:shadow-md"
            >
              <span className="text-4xl">🗂️</span>
              <span className="font-semibold text-ink">All scenes</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => openCategoryList({ id: c.id, name: c.nameEnglish })}
                className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface p-6 text-center shadow-sm transition hover:shadow-md"
              >
                <span className="text-4xl">{c.icon ?? "📦"}</span>
                <span className="font-semibold text-ink">{c.nameEnglish}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ------------------------------- one category ------------------------------- */
  if (step === "category") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button
            onClick={() => setStep("categories")}
            className="btn-duo btn-duo-secondary shrink-0 bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
          >
            ← All categories
          </button>
          <h1 className="sm:min-w-0 sm:flex-1 sm:truncate text-2xl font-bold text-ink">{activeCategory?.name ?? "All scenes"}</h1>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scenes..."
          className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />

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
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg">
                    <Image src={s.imageUrl} alt="" fill sizes="(min-width: 640px) 220px, 45vw" className="object-cover" />
                  </div>
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-surface-card text-3xl">🖼️</div>
                )}
                <span className="text-sm font-semibold text-ink">{s.title}</span>
                {s.hasContributed ? <span className="text-xs text-brand-dark">✓ Contributed</span> : null}
              </button>
            ))}
          </div>
        )}

        <Pagination
          offset={offset}
          limit={limit}
          total={total}
          onChange={setOffset}
          onLimitChange={(n) => {
            setLimit(n);
            setOffset(0);
          }}
          showPageNumbers
        />
      </div>
    );
  }

  /* ---------------------------------- record ---------------------------------- */
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button
        onClick={backFromRecord}
        className="btn-duo btn-duo-secondary shrink-0 bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
      >
        ← Back to scenes
      </button>

      {loadingScene ? (
        <p className="text-ink-muted">Loading...</p>
      ) : sceneError || !scene ? (
        <p className="text-red-600">{sceneError ?? "No scene selected"}</p>
      ) : (
        <>
          {/* Negative margin cancels the page shell's own px-4/sm:px-6 so
             this reaches the true viewport edge on a phone. */}
          <div className="relative -mx-4 aspect-video overflow-hidden bg-surface sm:mx-0 sm:rounded-2xl">
            {scene.imageUrl ? (
              <Image src={scene.imageUrl} alt={scene.title} fill sizes="100vw" className="object-cover" priority />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-5xl">🖼️</div>
            )}
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-lg font-bold text-white drop-shadow">
              {scene.title}
            </span>
          </div>

          <div className="flex justify-center">
            <SuggestBetterImageButton itemLabel={scene.title} sceneId={scene.id} />
          </div>

          <p className="text-center text-sm text-ink-muted">
            Describe what you see in this image in your own language. Tell us what is happening.
          </p>

          <div className="card-duo flex justify-center rounded-2xl bg-surface py-5 shadow-sm">
            <AudioRecorder
              key={scene.id}
              onRecordingComplete={(file, durationMs, checksum) => setRecording({ file, durationMs, checksum })}
              onError={(message) => setSubmitError(message)}
            />
          </div>

          {!languageId && !languageLoading ? (
            <p className="text-center text-red-600">
              Your language isn&apos;t set yet.{" "}
              <Link href="/onboarding" className="font-semibold underline">
                Complete your profile
              </Link>{" "}
              before contributing.
            </p>
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
