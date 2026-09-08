"use client";

import { useEffect, useState } from "react";
import { api, type ConceptListItem, type Scene, type SceneDifficulty, type SceneImageKeyword } from "@/lib/api";
import { AdminBulkUpload } from "@/components/admin-bulk-upload";
import { AdminBulkBar } from "@/components/admin-bulk-bar";
import { Pagination } from "@/components/admin-pagination";

const DIFFICULTIES: SceneDifficulty[] = ["easy", "medium", "hard", "expert"];
const PAGE_SIZE = 20;

export default function AdminScenesPage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
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

  const [keywordsSceneId, setKeywordsSceneId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<SceneImageKeyword[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [isAddingKeyword, setIsAddingKeyword] = useState(false);
  const [keywordError, setKeywordError] = useState<string | null>(null);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  // A file the admin has chosen but not yet confirmed -- lets them type
  // keywords for it before the actual upload+tag round trips fire.
  const [pendingUploads, setPendingUploads] = useState<Record<string, { file: File; keywordsText: string }>>({});

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDifficulty, setBulkDifficulty] = useState<SceneDifficulty | "">("");
  const [isBulkEditing, setIsBulkEditing] = useState(false);

  async function load() {
    setLoading(true);
    const [sceneRes, conceptRes] = await Promise.all([
      api.scenes.getAll({ limit: PAGE_SIZE, offset }),
      api.concepts.getAll({ limit: 200 }),
    ]);
    setScenes(sceneRes.items);
    setTotal(sceneRes.total);
    setConcepts(conceptRes.items);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

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

  function selectFileForUpload(sceneId: string, file: File | undefined) {
    if (!file) return;
    setUploadMessage(null);
    setPendingUploads((prev) => ({ ...prev, [sceneId]: { file, keywordsText: "" } }));
  }

  function updatePendingKeywords(sceneId: string, keywordsText: string) {
    setPendingUploads((prev) => (prev[sceneId] ? { ...prev, [sceneId]: { ...prev[sceneId], keywordsText } } : prev));
  }

  function cancelPendingUpload(sceneId: string) {
    setPendingUploads((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
  }

  async function confirmUpload(sceneId: string) {
    const pending = pendingUploads[sceneId];
    if (!pending) return;
    setUploadingId(sceneId);
    setUploadMessage(null);
    try {
      const media = await api.admin.uploadSceneMedia(sceneId, pending.file);

      const keywordList = pending.keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      // Independent inserts against the same image -- fired concurrently
      // instead of one at a time. A duplicate (already-tagged) keyword 409s
      // on its own without blocking the others.
      const results = await Promise.allSettled(keywordList.map((k) => api.admin.addSceneMediaKeyword(media.id, k)));
      const addedCount = results.filter((r) => r.status === "fulfilled").length;

      setUploadMessage({
        id: sceneId,
        text: addedCount > 0 ? `Image uploaded with ${addedCount} keyword${addedCount === 1 ? "" : "s"}` : "Image uploaded",
      });
      cancelPendingUpload(sceneId);
      // If the standalone Keywords panel for this scene happens to be open,
      // refresh it so the just-added keywords show up there too.
      if (keywordsSceneId === sceneId) {
        setKeywords(await api.admin.getSceneKeywords(sceneId));
      }
    } catch (err) {
      setUploadMessage({ id: sceneId, text: err instanceof Error ? err.message : "Upload failed", error: true });
    } finally {
      setUploadingId(null);
    }
  }

  async function handleDelete(scene: Scene) {
    if (!confirm(`Delete "${scene.title}"? This cannot be undone from here.`)) return;
    setDeletingId(scene.id);
    try {
      await api.admin.deleteScene(scene.id);
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === scenes.length ? new Set() : new Set(scenes.map((s) => s.id))));
  }

  async function handleBulkDelete() {
    await api.admin.bulkDeleteScenes([...selected]);
    setSelected(new Set());
    await load();
  }

  async function handleBulkSetDifficulty() {
    if (!bulkDifficulty) return;
    setIsBulkEditing(true);
    try {
      await api.admin.bulkEditScenes({ ids: [...selected], difficulty: bulkDifficulty });
      setSelected(new Set());
      setBulkDifficulty("");
      await load();
    } finally {
      setIsBulkEditing(false);
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

  async function toggleKeywords(sceneId: string) {
    if (keywordsSceneId === sceneId) {
      setKeywordsSceneId(null);
      return;
    }
    setKeywordsSceneId(sceneId);
    setKeywordError(null);
    setNewKeyword("");
    setLoadingKeywords(true);
    try {
      setKeywords(await api.admin.getSceneKeywords(sceneId));
    } catch (err) {
      setKeywordError(err instanceof Error ? err.message : "Failed to load keywords");
    } finally {
      setLoadingKeywords(false);
    }
  }

  async function handleAddKeyword() {
    if (!keywordsSceneId || newKeyword.trim().length === 0) return;
    setIsAddingKeyword(true);
    setKeywordError(null);
    try {
      const created = await api.admin.addSceneKeyword(keywordsSceneId, newKeyword.trim());
      setKeywords((prev) => [...prev, created]);
      setNewKeyword("");
    } catch (err) {
      setKeywordError(err instanceof Error ? err.message : "Failed to add keyword");
    } finally {
      setIsAddingKeyword(false);
    }
  }

  async function handleRemoveKeyword(keywordId: string) {
    if (!keywordsSceneId) return;
    const previous = keywords;
    setKeywords((prev) => prev.filter((k) => k.id !== keywordId));
    try {
      await api.admin.deleteSceneKeyword(keywordsSceneId, keywordId);
    } catch (err) {
      setKeywords(previous);
      setKeywordError(err instanceof Error ? err.message : "Failed to remove keyword");
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-ink">Scenes</h1>

      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
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
            className="btn-duo bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isCreating ? "Adding..." : "Add Scene"}
          </button>
        </div>
        {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
      </div>

      <AdminBulkUpload label="Bulk Upload Scenes" onUpload={(file) => api.admin.bulkUploadScenes(file)} onDone={load} />

      <AdminBulkBar count={selected.size} onClear={() => setSelected(new Set())} onDelete={handleBulkDelete}>
        <select
          value={bulkDifficulty}
          onChange={(e) => setBulkDifficulty(e.target.value as SceneDifficulty)}
          className="rounded-full bg-surface-card px-4 py-2 text-sm text-ink ring-1 ring-border"
        >
          <option value="">Set difficulty...</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d} className="capitalize">
              {d}
            </option>
          ))}
        </select>
        <button
          onClick={handleBulkSetDifficulty}
          disabled={!bulkDifficulty || isBulkEditing}
          className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isBulkEditing ? "Applying..." : "Apply"}
        </button>
      </AdminBulkBar>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <div className="space-y-3">
          {scenes.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={selected.size === scenes.length} onChange={toggleSelectAll} />
              Select all
            </label>
          )}
          {scenes.map((scene) => (
            <div key={scene.id} className="card-duo rounded-2xl bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selected.has(scene.id)} onChange={() => toggleSelected(scene.id)} />
                  <div>
                    <p className="font-semibold text-ink">{scene.title}</p>
                    <p className="text-xs capitalize text-ink-muted">
                      {scene.slug} · {scene.difficulty}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer text-xs font-semibold text-brand hover:underline">
                    {pendingUploads[scene.id] ? "Choose Different Image" : "Upload Image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingId === scene.id}
                      onChange={(e) => selectFileForUpload(scene.id, e.target.files?.[0])}
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
                  <button onClick={() => toggleKeywords(scene.id)} className="text-xs font-semibold text-brand hover:underline">
                    {keywordsSceneId === scene.id ? "Close" : "Keywords"}
                  </button>
                  <button
                    onClick={() => handleDelete(scene)}
                    disabled={deletingId === scene.id}
                    className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                  >
                    {deletingId === scene.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>

              {uploadMessage?.id === scene.id ? (
                <p className={`text-xs ${uploadMessage.error ? "text-red-600" : "text-emerald-600"}`}>{uploadMessage.text}</p>
              ) : null}

              {pendingUploads[scene.id] ? (
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <p className="text-xs text-ink-muted">Selected: {pendingUploads[scene.id].file.name}</p>
                  <div className="flex gap-3">
                    <input
                      value={pendingUploads[scene.id].keywordsText}
                      onChange={(e) => updatePendingKeywords(scene.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmUpload(scene.id);
                        }
                      }}
                      placeholder="Keywords for this image, comma-separated (optional)"
                      className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
                    />
                    <button
                      onClick={() => confirmUpload(scene.id)}
                      disabled={uploadingId === scene.id}
                      className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                    >
                      {uploadingId === scene.id ? "Uploading..." : "Upload"}
                    </button>
                    <button
                      onClick={() => cancelPendingUpload(scene.id)}
                      disabled={uploadingId === scene.id}
                      className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
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
                      className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  {coverageMessage ? <p className="text-sm text-emerald-600">{coverageMessage}</p> : null}
                </div>
              ) : null}

              {keywordsSceneId === scene.id ? (
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <p className="text-xs text-ink-muted">
                    Free-text training labels for this scene&apos;s image -- admin-only, never shown to contributors.
                  </p>
                  {loadingKeywords ? (
                    <p className="text-sm text-ink-muted">Loading...</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {keywords.length === 0 ? (
                        <p className="text-sm text-ink-muted">No keywords yet.</p>
                      ) : (
                        keywords.map((k) => (
                          <span
                            key={k.id}
                            className="flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-sm text-ink ring-1 ring-border"
                          >
                            {k.keyword}
                            <button
                              onClick={() => handleRemoveKeyword(k.id)}
                              className="text-ink-muted hover:text-red-600"
                              aria-label={`Remove keyword ${k.keyword}`}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <input
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddKeyword();
                        }
                      }}
                      placeholder="Add a keyword (e.g. river, boat, sunset)"
                      className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
                    />
                    <button
                      onClick={handleAddKeyword}
                      disabled={isAddingKeyword || newKeyword.trim().length === 0}
                      className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  {keywordError ? <p className="text-sm text-red-600">{keywordError}</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} />}
    </div>
  );
}
