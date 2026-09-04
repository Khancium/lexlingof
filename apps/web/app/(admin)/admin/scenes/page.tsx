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
      <h1 className="text-2xl font-bold text-white">Scenes</h1>

      <div className="space-y-3 rounded-xl bg-slate-800 p-5">
        <h2 className="text-lg font-bold text-white">Add New Scene</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Slug"
            className="rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as SceneDifficulty)}
            className="rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700"
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
            className="w-40 rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isCreating ? "Adding..." : "Add Scene"}
          </button>
        </div>
        {createError ? <p className="text-sm text-red-400">{createError}</p> : null}
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="space-y-3">
          {scenes.map((scene) => (
            <div key={scene.id} className="rounded-xl bg-slate-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{scene.title}</p>
                  <p className="text-xs capitalize text-slate-400">
                    {scene.slug} · {scene.difficulty}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setCoverageSceneId(coverageSceneId === scene.id ? null : scene.id);
                    setCoverageMessage(null);
                  }}
                  className="text-xs font-semibold text-blue-400 hover:underline"
                >
                  {coverageSceneId === scene.id ? "Close" : "Add Concept Coverage"}
                </button>
              </div>

              {coverageSceneId === scene.id ? (
                <div className="mt-4 space-y-2 border-t border-slate-700 pt-4">
                  <p className="text-xs text-slate-500">
                    Concept coverage map -- admin-only annotation data, never shown to contributors.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <select
                      value={coverageConceptId}
                      onChange={(e) => setCoverageConceptId(e.target.value)}
                      className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700"
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
                      className="rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700"
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
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  {coverageMessage ? <p className="text-sm text-emerald-400">{coverageMessage}</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
