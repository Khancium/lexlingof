"use client";

import { useEffect, useState } from "react";
import { api, type ConceptListItem, type Scene, type SceneDifficulty } from "@/lib/api";

const DIFFICULTIES: SceneDifficulty[] = ["easy", "medium", "hard", "expert"];

export default function AdminScenesPage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<SceneDifficulty>("medium");
  const [estimatedSeconds, setEstimatedSeconds] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [coverageSceneId, setCoverageSceneId] = useState<string | null>(null);
  const [coverageConceptId, setCoverageConceptId] = useState("");
  const [coverageImportance, setCoverageImportance] = useState(1);
  const [coverageMessage, setCoverageMessage] = useState<string | null>(null);
  const [isAddingCoverage, setIsAddingCoverage] = useState(false);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);

  async function load() {
    setLoading(true);
    const [sceneList, conceptRes] = await Promise.all([api.scenes.getAll(), api.concepts.getAll({ limit: 200 })]);
    setScenes(sceneList);
    setConcepts(conceptRes.items);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (slug.trim().length === 0 || title.trim().length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const scene = await api.admin.createScene({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        difficulty,
        estimatedDurationSeconds: estimatedSeconds ? Number(estimatedSeconds) : undefined,
      });
      setSlug("");
      setTitle("");
      setDescription("");
      setEstimatedSeconds("");
      setCoverageSceneId(scene.id);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create scene");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleUploadImage(sceneId: string, file: File | undefined) {
    if (!file) return;
    setUploadingId(sceneId);
    setUploadMessage(null);
    try {
      await api.admin.uploadSceneMedia(sceneId, file);
      setUploadMessage({ id: sceneId, text: "Image uploaded" });
    } catch (err) {
      setUploadMessage({ id: sceneId, text: err instanceof Error ? err.message : "Upload failed", error: true });
    } finally {
      setUploadingId(null);
    }
  }

  async function handleAddCoverage() {
    if (!coverageSceneId || !coverageConceptId) return;
    const concept = concepts.find((c) => c.id === coverageConceptId);
    if (!concept) return;
    setIsAddingCoverage(true);
    setCoverageMessage(null);
    try {
      await api.admin.createSceneConcept({
        sceneId: coverageSceneId,
        conceptId: coverageConceptId,
        categoryId: concept.categoryId,
        importance: coverageImportance,
      });
      setCoverageMessage(`Added "${concept.labelEnglish}" to the coverage map.`);
      setCoverageConceptId("");
    } catch (err) {
      setCoverageMessage(err instanceof Error ? err.message : "Failed to add concept coverage");
    } finally {
      setIsAddingCoverage(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-ink">Scenes</h1>

      <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Add New Scene</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Slug"
            className="rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as SceneDifficulty)}
            className="rounded-lg bg-surface-card px-3 py-2 text-ink ring-1 ring-border"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d} className="capitalize">
                {d}
              </option>
            ))}
          </select>
          <input
            value={estimatedSeconds}
            onChange={(e) => setEstimatedSeconds(e.target.value)}
            placeholder="Est. duration (s)"
            className="w-40 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            className="w-full rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="rounded-full bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isCreating ? "Adding..." : "Add Scene"}
          </button>
        </div>
        {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
      </div>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <div className="space-y-3">
          {scenes.map((scene) => (
            <div key={scene.id} className="rounded-2xl bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-ink">{scene.title}</p>
                  <p className="text-xs capitalize text-ink-muted">
                    {scene.slug} · {scene.difficulty}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer text-xs font-semibold text-brand hover:underline">
                    {uploadingId === scene.id ? "Uploading..." : "Upload Image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingId === scene.id}
                      onChange={(e) => handleUploadImage(scene.id, e.target.files?.[0])}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setCoverageSceneId(coverageSceneId === scene.id ? null : scene.id);
                      setCoverageMessage(null);
                    }}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    {coverageSceneId === scene.id ? "Close" : "Add Concept Coverage"}
                  </button>
                </div>
              </div>

              {uploadMessage?.id === scene.id ? (
                <p className={`text-xs ${uploadMessage.error ? "text-red-600" : "text-emerald-600"}`}>{uploadMessage.text}</p>
              ) : null}

              {coverageSceneId === scene.id ? (
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <p className="text-xs text-ink-muted">
                    Concept coverage map -- admin-only annotation data, never shown to contributors.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <select
                      value={coverageConceptId}
                      onChange={(e) => setCoverageConceptId(e.target.value)}
                      className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink ring-1 ring-border"
                    >
                      <option value="">Select a concept</option>
                      {concepts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.labelEnglish} ({c.categoryName})
                        </option>
                      ))}
                    </select>
                    <select
                      value={coverageImportance}
                      onChange={(e) => setCoverageImportance(Number(e.target.value))}
                      className="rounded-lg bg-surface-card px-3 py-2 text-ink ring-1 ring-border"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          Importance {n}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddCoverage}
                      disabled={isAddingCoverage || !coverageConceptId}
                      className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  {coverageMessage ? <p className="text-sm text-emerald-600">{coverageMessage}</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
