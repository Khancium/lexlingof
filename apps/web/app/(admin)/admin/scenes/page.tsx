"use client";

import { useEffect, useState } from "react";
import { api, type ConceptListItem, type Scene, type SceneDifficulty, type SceneImageKeyword } from "@/lib/api";
import { AdminBulkUpload } from "@/components/admin-bulk-upload";
import { AdminBulkImageUrlUpload } from "@/components/admin-bulk-image-url-upload";
import { AdminBulkBar } from "@/components/admin-bulk-bar";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";
import { AdminCreateCategory } from "@/components/admin-create-category";

const DIFFICULTIES: SceneDifficulty[] = ["easy", "medium", "hard", "expert"];
const DEFAULT_PAGE_SIZE = 20;

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Checkbox list + filter for picking any number of concepts at once -- shared by the creation form and the per-scene coverage panel. */
function ConceptMultiSelect({
  concepts,
  selectedIds,
  onToggle,
  filter,
  onFilterChange,
}: {
  concepts: ConceptListItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? concepts.filter((c) => c.labelEnglish.toLowerCase().includes(needle) || c.categoryName.toLowerCase().includes(needle))
    : concepts;

  return (
    <div className="space-y-2">
      <input
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter concepts..."
        className="w-full rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
      />
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg p-2 ring-1 ring-border">
        {filtered.length === 0 ? (
          <p className="px-1 py-1 text-sm text-ink-muted">No matching concepts.</p>
        ) : (
          filtered.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-ink hover:bg-surface-card"
            >
              <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => onToggle(c.id)} />
              {c.labelEnglish} <span className="text-xs text-ink-muted">({c.categoryName})</span>
            </label>
          ))
        )}
      </div>
      {selectedIds.size > 0 ? <p className="text-xs text-ink-muted">{selectedIds.size} selected</p> : null}
    </div>
  );
}

export default function AdminScenesPage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  // Unpaginated, used only to resolve titles typed into the bulk-by-URL textarea.
  const [allScenes, setAllScenes] = useState<Scene[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<SceneDifficulty>("medium");
  const [estimatedSeconds, setEstimatedSeconds] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newKeywordsText, setNewKeywordsText] = useState("");
  const [newConceptIds, setNewConceptIds] = useState<Set<string>>(new Set());
  const [newConceptFilter, setNewConceptFilter] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [coverageSceneId, setCoverageSceneId] = useState<string | null>(null);
  const [coverageConceptIds, setCoverageConceptIds] = useState<Set<string>>(new Set());
  const [coverageFilter, setCoverageFilter] = useState("");
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
  // Same idea, but for a pasted third-party URL instead of a chosen file.
  const [pendingUrlUploads, setPendingUrlUploads] = useState<Record<string, { url: string; keywordsText: string }>>({});

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDifficulty, setBulkDifficulty] = useState<SceneDifficulty | "">("");
  const [isBulkEditing, setIsBulkEditing] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [sceneRes, conceptRes, allSceneRes] = await Promise.all([
        api.scenes.getAll({ limit, offset }),
        api.concepts.getAll({ limit: 200 }),
        api.scenes.getAll({ limit: 1000 }),
      ]);
      setScenes(sceneRes.items);
      setTotal(sceneRes.total);
      setConcepts(conceptRes.items);
      setAllScenes(allSceneRes.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load scenes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, limit]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

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

      // Image upload (plus its keywords, which need the resulting media id)
      // and concept coverage rows are all independent of each other once the
      // scene exists -- fired concurrently instead of as sequential round
      // trips, and one failing (e.g. a keyword that's already covered)
      // doesn't block the others.
      const tasks: Promise<unknown>[] = [];

      const imageUpload = newImageFile
        ? api.admin.uploadSceneMedia(scene.id, newImageFile)
        : newImageUrl.trim()
          ? api.admin.addSceneMediaUrl(scene.id, newImageUrl.trim())
          : null;
      if (imageUpload) {
        tasks.push(
          imageUpload.then((media) => {
            const keywordList = newKeywordsText
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean);
            return Promise.allSettled(keywordList.map((k) => api.admin.addSceneMediaKeyword(media.id, k)));
          }),
        );
      }

      for (const conceptId of newConceptIds) {
        const concept = concepts.find((c) => c.id === conceptId);
        if (!concept) continue;
        tasks.push(api.admin.createSceneConcept({ sceneId: scene.id, conceptId, categoryId: concept.categoryId }));
      }

      await Promise.allSettled(tasks);

      setSlug("");
      setTitle("");
      setDescription("");
      setEstimatedSeconds("");
      setNewImageFile(null);
      setNewImageUrl("");
      setNewKeywordsText("");
      setNewConceptIds(new Set());
      setNewConceptFilter("");
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
    setPendingUrlUploads((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
    setPendingUploads((prev) => ({ ...prev, [sceneId]: { file, keywordsText: "" } }));
  }

  function startUrlUpload(sceneId: string) {
    setUploadMessage(null);
    setPendingUploads((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
    setPendingUrlUploads((prev) => ({ ...prev, [sceneId]: { url: "", keywordsText: "" } }));
  }

  function updatePendingUrl(sceneId: string, url: string) {
    setPendingUrlUploads((prev) => (prev[sceneId] ? { ...prev, [sceneId]: { ...prev[sceneId], url } } : prev));
  }

  function updatePendingUrlKeywords(sceneId: string, keywordsText: string) {
    setPendingUrlUploads((prev) => (prev[sceneId] ? { ...prev, [sceneId]: { ...prev[sceneId], keywordsText } } : prev));
  }

  function cancelPendingUrlUpload(sceneId: string) {
    setPendingUrlUploads((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
  }

  async function confirmUrlUpload(sceneId: string) {
    const pending = pendingUrlUploads[sceneId];
    if (!pending || pending.url.trim().length === 0) return;
    setUploadingId(sceneId);
    setUploadMessage(null);
    try {
      const media = await api.admin.addSceneMediaUrl(sceneId, pending.url.trim());

      const keywordList = pending.keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const results = await Promise.allSettled(keywordList.map((k) => api.admin.addSceneMediaKeyword(media.id, k)));
      const addedCount = results.filter((r) => r.status === "fulfilled").length;

      setUploadMessage({
        id: sceneId,
        text: addedCount > 0 ? `Image added with ${addedCount} keyword${addedCount === 1 ? "" : "s"}` : "Image added",
      });
      cancelPendingUrlUpload(sceneId);
      if (keywordsSceneId === sceneId) {
        setKeywords(await api.admin.getSceneKeywords(sceneId));
      }
    } catch (err) {
      setUploadMessage({ id: sceneId, text: err instanceof Error ? err.message : "Failed to add image", error: true });
    } finally {
      setUploadingId(null);
    }
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
    setSelected((prev) => toggleInSet(prev, id));
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
    if (!coverageSceneId || coverageConceptIds.size === 0) return;
    setIsAddingCoverage(true);
    setCoverageMessage(null);
    try {
      const ids = [...coverageConceptIds];
      const results = await Promise.allSettled(
        ids.map((conceptId) => {
          const concept = concepts.find((c) => c.id === conceptId);
          if (!concept) return Promise.reject(new Error("Unknown concept"));
          return api.admin.createSceneConcept({ sceneId: coverageSceneId, conceptId, categoryId: concept.categoryId });
        }),
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      setCoverageMessage(
        succeeded === ids.length
          ? `Added ${succeeded} concept${succeeded === 1 ? "" : "s"} to the coverage map.`
          : `Added ${succeeded} of ${ids.length} -- the rest may already be covered.`,
      );
      setCoverageConceptIds(new Set());
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

      {/* Categories only belong to concepts, not scenes directly -- this is
         here so an admin tagging a scene's concept coverage can create a
         brand-new category on the spot (e.g. for a concept that doesn't
         exist yet either) without leaving this page for the Concepts one. */}
      <AdminCreateCategory onCreated={() => {}} />

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
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg bg-surface-card px-3 py-2 text-sm font-semibold text-ink ring-1 ring-border hover:bg-border">
              {newImageFile ? "Change Image" : "Choose Image (optional)"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  setNewImageFile(e.target.files?.[0] ?? null);
                  if (e.target.files?.[0]) setNewImageUrl("");
                }}
              />
            </label>
            {newImageFile ? <span className="text-xs text-ink-muted">{newImageFile.name}</span> : null}
            {!newImageFile ? (
              <>
                <span className="text-xs text-ink-muted">or</span>
                <input
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="Image URL"
                  className="min-w-64 flex-1 rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
                />
              </>
            ) : null}
          </div>
          {newImageFile || newImageUrl.trim() ? (
            <input
              value={newKeywordsText}
              onChange={(e) => setNewKeywordsText(e.target.value)}
              placeholder="Keywords for this image, comma-separated (optional)"
              className="w-full rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
            />
          ) : null}
        </div>

        <div className="space-y-1 border-t border-border pt-3">
          <p className="text-xs font-medium text-ink-muted">
            Concept coverage (optional) -- admin-only annotation data, never shown to contributors.
          </p>
          <ConceptMultiSelect
            concepts={concepts}
            selectedIds={newConceptIds}
            onToggle={(id) => setNewConceptIds((prev) => toggleInSet(prev, id))}
            filter={newConceptFilter}
            onFilterChange={setNewConceptFilter}
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="btn-duo bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isCreating ? "Adding..." : "Add Scene"}
        </button>
        {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
      </div>

      <AdminBulkUpload label="Bulk Upload Scenes" onUpload={(file) => api.admin.bulkUploadScenes(file)} onDone={load} />

      <AdminBulkImageUrlUpload
        label="Bulk Add Scene Images by URL"
        matchItems={allScenes}
        matchLabel={(s) => s.title}
        onSubmit={(pairs) => api.admin.bulkAddSceneMediaUrl(pairs.map((p) => ({ sceneId: p.id, imageUrl: p.imageUrl })))}
        onDone={load}
      />

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
      ) : loadError ? (
        <p className="text-red-600">{loadError}</p>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selected.has(scene.id)} onChange={() => toggleSelected(scene.id)} />
                  <div>
                    <p className="font-semibold text-ink">{scene.title}</p>
                    <p className="text-xs capitalize text-ink-muted">
                      {scene.slug} · {scene.difficulty}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
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
                    onClick={() => startUrlUpload(scene.id)}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    From URL
                  </button>
                  <button
                    onClick={() => {
                      setCoverageSceneId(coverageSceneId === scene.id ? null : scene.id);
                      setCoverageConceptIds(new Set());
                      setCoverageFilter("");
                      setCoverageMessage(null);
                    }}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    {coverageSceneId === scene.id ? "Close Coverage" : "Add Concept Coverage"}
                  </button>
                  <button onClick={() => toggleKeywords(scene.id)} className="text-xs font-semibold text-brand hover:underline">
                    {keywordsSceneId === scene.id ? "Close Keywords" : "Keywords"}
                  </button>
                  <button
                    onClick={() => handleDelete(scene)}
                    disabled={deletingId === scene.id}
                    className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                  >
                    {deletingId === scene.id ? "Deleting..." : "Delete"}
                  </button>
                  <AdminUndoButton
                    resourceType="scene"
                    identifier={scene.id}
                    onUndone={load}
                    className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline"
                  />
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

              {pendingUrlUploads[scene.id] ? (
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <input
                    value={pendingUrlUploads[scene.id].url}
                    onChange={(e) => updatePendingUrl(scene.id, e.target.value)}
                    placeholder="Image URL"
                    autoFocus
                    className="w-full rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
                  />
                  <div className="flex gap-3">
                    <input
                      value={pendingUrlUploads[scene.id].keywordsText}
                      onChange={(e) => updatePendingUrlKeywords(scene.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmUrlUpload(scene.id);
                        }
                      }}
                      placeholder="Keywords for this image, comma-separated (optional)"
                      className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
                    />
                    <button
                      onClick={() => confirmUrlUpload(scene.id)}
                      disabled={uploadingId === scene.id || pendingUrlUploads[scene.id].url.trim().length === 0}
                      className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                    >
                      {uploadingId === scene.id ? "Adding..." : "Add"}
                    </button>
                    <button
                      onClick={() => cancelPendingUrlUpload(scene.id)}
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
                  <ConceptMultiSelect
                    concepts={concepts}
                    selectedIds={coverageConceptIds}
                    onToggle={(id) => setCoverageConceptIds((prev) => toggleInSet(prev, id))}
                    filter={coverageFilter}
                    onFilterChange={setCoverageFilter}
                  />
                  <button
                    onClick={handleAddCoverage}
                    disabled={isAddingCoverage || coverageConceptIds.size === 0}
                    className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                  >
                    {isAddingCoverage
                      ? "Adding..."
                      : `Add${coverageConceptIds.size > 0 ? ` ${coverageConceptIds.size}` : ""} Concept${coverageConceptIds.size === 1 ? "" : "s"}`}
                  </button>
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

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
