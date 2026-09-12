"use client";

import { useEffect, useState } from "react";
import { api, type Category, type ConceptListItem } from "@/lib/api";
import { AdminBulkUpload } from "@/components/admin-bulk-upload";
import { AdminBulkImageUrlUpload } from "@/components/admin-bulk-image-url-upload";
import { AdminBulkBar } from "@/components/admin-bulk-bar";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";
import { AdminCreateCategory } from "@/components/admin-create-category";

const DEFAULT_PAGE_SIZE = 50;

export default function AdminConceptsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  // Unpaginated, used only to resolve labels typed into the bulk-by-URL
  // textarea -- the table above only ever holds one page at a time.
  const [allConcepts, setAllConcepts] = useState<ConceptListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newCategoryId, setNewCategoryId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  const [urlEntryId, setUrlEntryId] = useState<string | null>(null);
  const [urlEntryValue, setUrlEntryValue] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [isBulkEditing, setIsBulkEditing] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [cats, res, allRes] = await Promise.all([
        api.categories.getAll(),
        api.concepts.getAll({ limit, offset }),
        api.concepts.getAll({ limit: 1000 }),
      ]);
      setCategories(cats);
      setConcepts(res.items);
      setTotal(res.total);
      setAllConcepts(allRes.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load concepts");
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
    if (!newCategoryId || newLabel.trim().length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await api.admin.createConcept({
        categoryId: newCategoryId,
        labelEnglish: newLabel.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewLabel("");
      setNewDescription("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create concept");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleUploadImage(conceptId: string, file: File | undefined) {
    if (!file) return;
    setUploadingId(conceptId);
    setUploadMessage(null);
    try {
      await api.admin.uploadConceptMedia(conceptId, file);
      setUploadMessage({ id: conceptId, text: "Image uploaded" });
    } catch (err) {
      setUploadMessage({ id: conceptId, text: err instanceof Error ? err.message : "Upload failed", error: true });
    } finally {
      setUploadingId(null);
    }
  }

  function startUrlEntry(conceptId: string) {
    setUrlEntryId(conceptId);
    setUrlEntryValue("");
    setUploadMessage(null);
  }

  async function handleAddImageUrl(conceptId: string) {
    const imageUrl = urlEntryValue.trim();
    if (!imageUrl) return;
    setUploadingId(conceptId);
    setUploadMessage(null);
    try {
      await api.admin.addConceptMediaUrl(conceptId, imageUrl);
      setUploadMessage({ id: conceptId, text: "Image added" });
      setUrlEntryId(null);
    } catch (err) {
      setUploadMessage({ id: conceptId, text: err instanceof Error ? err.message : "Failed to add image", error: true });
    } finally {
      setUploadingId(null);
    }
  }

  async function handleDelete(concept: ConceptListItem) {
    if (!confirm(`Delete "${concept.labelEnglish}"? This cannot be undone from here.`)) return;
    setDeletingId(concept.id);
    try {
      await api.admin.deleteConcept(concept.id);
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(concept: ConceptListItem) {
    setEditingId(concept.id);
    setEditLabel(concept.labelEnglish);
    setEditDescription(concept.description ?? "");
    setEditCategoryId(concept.categoryId);
  }

  async function saveEdit(id: string) {
    setIsSaving(true);
    try {
      await api.admin.updateConcept(id, {
        categoryId: editCategoryId,
        labelEnglish: editLabel.trim(),
        description: editDescription.trim() || undefined,
      });
      setEditingId(null);
      await load();
    } finally {
      setIsSaving(false);
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
    setSelected((prev) => (prev.size === concepts.length ? new Set() : new Set(concepts.map((c) => c.id))));
  }

  async function handleBulkDelete() {
    await api.admin.bulkDeleteConcepts([...selected]);
    setSelected(new Set());
    await load();
  }

  async function handleBulkMoveCategory() {
    if (!bulkCategoryId) return;
    setIsBulkEditing(true);
    try {
      await api.admin.bulkEditConcepts({ ids: [...selected], categoryId: bulkCategoryId });
      setSelected(new Set());
      setBulkCategoryId("");
      await load();
    } finally {
      setIsBulkEditing(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-ink">Concepts</h1>

      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Add New Concept</h2>
        <div className="flex flex-wrap gap-3">
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            className="rounded-lg bg-surface-card px-3 py-2 text-ink ring-1 ring-border"
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEnglish}
              </option>
            ))}
          </select>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (English)"
            className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description"
            className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="btn-duo bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isCreating ? "Adding..." : "Add"}
          </button>
        </div>
        {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
      </div>

      <AdminCreateCategory onCreated={(c) => setCategories((prev) => [...prev, c])} />

      <AdminBulkUpload
        label="Bulk Upload Concepts"
        onUpload={(file) => api.admin.bulkUploadConcepts(file)}
        onDone={load}
      />

      <AdminBulkImageUrlUpload
        label="Bulk Add Concept Images by URL"
        matchItems={allConcepts}
        matchLabel={(c) => c.labelEnglish}
        onSubmit={(pairs) => api.admin.bulkAddConceptMediaUrl(pairs.map((p) => ({ conceptId: p.id, imageUrl: p.imageUrl })))}
        onDone={load}
      />

      <AdminBulkBar count={selected.size} onClear={() => setSelected(new Set())} onDelete={handleBulkDelete}>
        <select
          value={bulkCategoryId}
          onChange={(e) => setBulkCategoryId(e.target.value)}
          className="rounded-full bg-surface-card px-4 py-2 text-sm text-ink ring-1 ring-border"
        >
          <option value="">Move to category...</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEnglish}
            </option>
          ))}
        </select>
        <button
          onClick={handleBulkMoveCategory}
          disabled={!bulkCategoryId || isBulkEditing}
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
        <div className="card-duo overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={concepts.length > 0 && selected.size === concepts.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((concept) =>
                editingId === concept.id ? (
                  <tr key={concept.id} className="border-b border-border bg-surface-card">
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2">
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="w-full rounded bg-surface-card px-2 py-1 text-ink ring-1 ring-border"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editCategoryId}
                        onChange={(e) => setEditCategoryId(e.target.value)}
                        className="w-full rounded bg-surface-card px-2 py-1 text-ink ring-1 ring-border"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nameEnglish}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full rounded bg-surface-card px-2 py-1 text-ink ring-1 ring-border"
                      />
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-muted">--</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(concept.id)}
                          disabled={isSaving}
                          className="btn-duo bg-brand px-3 py-1 text-xs font-semibold text-ink-inverted hover:bg-brand-dark"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="btn-duo btn-duo-secondary bg-surface-card px-3 py-1 text-xs font-semibold text-ink hover:bg-border"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={concept.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(concept.id)} onChange={() => toggleSelected(concept.id)} />
                    </td>
                    <td className="px-4 py-3 text-ink">{concept.labelEnglish}</td>
                    <td className="px-4 py-3 text-ink-muted">{concept.categoryName}</td>
                    <td className="px-4 py-3 text-ink-muted">{concept.description ?? "--"}</td>
                    <td className="px-4 py-3">
                      {urlEntryId === concept.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={urlEntryValue}
                            onChange={(e) => setUrlEntryValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddImageUrl(concept.id);
                              }
                            }}
                            placeholder="Image URL"
                            autoFocus
                            className="w-40 rounded bg-surface-card px-2 py-1 text-xs text-ink placeholder:text-gray-400 ring-1 ring-border"
                          />
                          <button
                            onClick={() => handleAddImageUrl(concept.id)}
                            disabled={uploadingId === concept.id || urlEntryValue.trim().length === 0}
                            className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
                          >
                            {uploadingId === concept.id ? "Adding..." : "Add"}
                          </button>
                          <button onClick={() => setUrlEntryId(null)} className="text-xs text-ink-muted hover:underline">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer text-xs font-semibold text-brand hover:underline">
                            {uploadingId === concept.id ? "Uploading..." : "Upload"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploadingId === concept.id}
                              onChange={(e) => handleUploadImage(concept.id, e.target.files?.[0])}
                            />
                          </label>
                          <span className="text-ink-muted">·</span>
                          <button
                            onClick={() => startUrlEntry(concept.id)}
                            className="text-xs font-semibold text-brand hover:underline"
                          >
                            From URL
                          </button>
                        </div>
                      )}
                      {uploadMessage?.id === concept.id ? (
                        <p className={`mt-1 text-xs ${uploadMessage.error ? "text-red-600" : "text-emerald-600"}`}>
                          {uploadMessage.text}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => startEdit(concept)} className="text-xs font-semibold text-brand hover:underline">
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(concept)}
                          disabled={deletingId === concept.id}
                          className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                        >
                          {deletingId === concept.id ? "Deleting..." : "Delete"}
                        </button>
                        <AdminUndoButton
                          resourceType="concept"
                          identifier={concept.id}
                          onUndone={load}
                          className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline"
                        />
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
