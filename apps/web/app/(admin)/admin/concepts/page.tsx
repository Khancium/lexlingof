"use client";

import { Fragment, useEffect, useState } from "react";
import { api, type Category, type ConceptListItem, type OpenverseImageResult } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { AdminBulkUpload } from "@/components/admin-bulk-upload";
import { AdminBulkImageUrlUpload } from "@/components/admin-bulk-image-url-upload";
import { AdminBulkTextCreate } from "@/components/admin-bulk-text-create";
import { AdminBulkConceptTextCreate } from "@/components/admin-bulk-concept-text-create";
import { AdminOpenversePicker } from "@/components/admin-openverse-picker";
import { AdminMediaManager } from "@/components/admin-media-manager";
import { ImageCropper } from "@/components/image-cropper";
import { AdminOpenverseAutofill } from "@/components/admin-openverse-autofill";
import { AdminBulkBar } from "@/components/admin-bulk-bar";
import { AdminPermanentDeleteButton } from "@/components/admin-permanent-delete-button";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";
import { AdminCreateCategory } from "@/components/admin-create-category";

const DEFAULT_PAGE_SIZE = 50;

export default function AdminConceptsPage() {
  const user = useAuthStore((s) => s.user);
  const isVolunteer = user?.role === "volunteer";

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

  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterHasImage, setFilterHasImage] = useState<"" | "yes" | "no">("");
  // Volunteer-only "my own additions" filter -- also unlocks their per-row
  // Delete button (see the delete-visibility rule near the table below).
  const [onlyMine, setOnlyMine] = useState(false);

  const [newCategoryId, setNewCategoryId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createInfo, setCreateInfo] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  const [urlEntryId, setUrlEntryId] = useState<string | null>(null);
  const [openverseConceptId, setOpenverseConceptId] = useState<string | null>(null);
  const [imagesConceptId, setImagesConceptId] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ conceptId: string; url: string } | null>(null);
  const [urlEntryValue, setUrlEntryValue] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [isBulkAutofilling, setIsBulkAutofilling] = useState(false);
  const [bulkAutofillInfo, setBulkAutofillInfo] = useState<string | null>(null);
  const [isBulkDeletingImages, setIsBulkDeletingImages] = useState(false);
  const [isBulkHiding, setIsBulkHiding] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // An end date is inclusive of the whole day, not just 00:00 -- picking
      // "today" should still match something added at 11pm today.
      const createdFromIso = createdFrom ? new Date(createdFrom).toISOString() : undefined;
      const createdToIso = createdTo ? new Date(`${createdTo}T23:59:59.999Z`).toISOString() : undefined;
      const [cats, res, allRes] = await Promise.all([
        api.categories.getAll(),
        api.concepts.getAll({
          limit,
          offset,
          createdFrom: createdFromIso,
          createdTo: createdToIso,
          categoryId: filterCategoryId || undefined,
          hasImage: filterHasImage || undefined,
          mine: isVolunteer && onlyMine ? true : undefined,
          // Volunteers don't hold concepts.manage, so this is silently
          // ignored for them server-side and they only ever see active rows.
          includeHidden: true,
        }),
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
  }, [offset, limit, createdFrom, createdTo, filterCategoryId, filterHasImage, onlyMine]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  async function handleCreate() {
    if (!newCategoryId || newLabel.trim().length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    setCreateInfo(null);
    try {
      const result = await api.admin.createConcept({
        categoryId: newCategoryId,
        labelEnglish: newLabel.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewLabel("");
      setNewDescription("");
      if ("pending" in result) {
        // Nothing was actually created yet -- a volunteer submission
        // awaiting admin approval, so there's no new row to reload for.
        setCreateInfo(result.message);
      } else {
        await load();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create concept");
    } finally {
      setIsCreating(false);
    }
  }

  // A picked file is cropped client-side (16:9, matching the server's own
  // auto-crop target) before it ever reaches uploadConceptMedia -- the
  // server still center-crops on top of this as a safety net, but starting
  // from an admin-chosen crop means that safety net rarely has to do
  // anything, instead of always deciding the framing unattended.
  function handleFileSelected(conceptId: string, file: File | undefined) {
    if (!file) return;
    setCropTarget({ conceptId, url: URL.createObjectURL(file) });
  }

  async function handleCropApply(blob: Blob) {
    if (!cropTarget) return;
    const { conceptId, url } = cropTarget;
    URL.revokeObjectURL(url);
    setCropTarget(null);
    const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
    await handleUploadImage(conceptId, file);
  }

  async function handleUploadImage(conceptId: string, file: File | undefined) {
    if (!file) return;
    setUploadingId(conceptId);
    setUploadMessage(null);
    try {
      const result = await api.admin.uploadConceptMedia(conceptId, file);
      setUploadMessage({ id: conceptId, text: "pending" in result ? result.message : "Image uploaded" });
    } catch (err) {
      setUploadMessage({ id: conceptId, text: err instanceof Error ? err.message : "Upload failed", error: true });
    } finally {
      setUploadingId(null);
    }
  }

  async function handleAddImageOpenverse(conceptId: string, image: OpenverseImageResult) {
    setUploadingId(conceptId);
    setUploadMessage(null);
    try {
      const result = await api.admin.addConceptMediaOpenverse(conceptId, image);
      setUploadMessage({ id: conceptId, text: "pending" in result ? result.message : "Image added from Openverse" });
    } catch (err) {
      setUploadMessage({ id: conceptId, text: err instanceof Error ? err.message : "Failed to add image", error: true });
      throw err;
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
      const result = await api.admin.addConceptMediaUrl(conceptId, imageUrl);
      setUploadMessage({ id: conceptId, text: "pending" in result ? result.message : "Image added" });
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
      const result = await api.admin.deleteConcept(concept.id);
      if ("pending" in result) alert(result.message);
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  // Hiding just flips isActive -- unlike Delete, this never touches
  // deletedAt, so it's fully reversible and the row stays visible (and
  // manageable) right here in the admin table instead of disappearing into
  // the soft-delete/undo flow.
  async function handleToggleActive(concept: ConceptListItem) {
    setTogglingActiveId(concept.id);
    try {
      await api.admin.updateConcept(concept.id, { isActive: !concept.isActive });
      await load();
    } finally {
      setTogglingActiveId(null);
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

  async function handleBulkPermanentDelete() {
    const result = await api.admin.bulkPermanentlyDeleteConcepts([...selected]);
    setSelected(new Set());
    await load();
    return result;
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

  // Scoped to whatever's currently selected -- typically everything matching
  // the category/date filters via "select all" -- rather than the standalone
  // widget above's corpus-wide sweep. Concepts in the selection that already
  // have an image are left untouched (conceptsWithoutImage filters those out
  // server-side), so re-running this after a partial success is safe.
  async function handleBulkAutofillOpenverse() {
    setIsBulkAutofilling(true);
    setBulkAutofillInfo(null);
    try {
      const result = await api.admin.bulkOpenverseAutofillConcepts([...selected]);
      setBulkAutofillInfo(
        `Added ${result.created} image(s).` + (result.errors.length > 0 ? ` ${result.errors.length} failed.` : ""),
      );
      setSelected(new Set());
      await load();
    } finally {
      setIsBulkAutofilling(false);
    }
  }

  // Clears every image (any source) on every selected concept -- the
  // opposite of the autofill above, for clearing out a bad batch (e.g. a
  // wrong Openverse auto-fill run) without opening each concept's image
  // manager individually.
  async function handleBulkDeleteImages() {
    if (!confirm(`Remove all images from ${selected.size} selected concept(s)? This cannot be undone.`)) return;
    setIsBulkDeletingImages(true);
    setBulkAutofillInfo(null);
    try {
      const result = await api.admin.bulkDeleteConceptMedia([...selected]);
      setBulkAutofillInfo(`Removed ${result.deleted} image(s).`);
      setSelected(new Set());
      await load();
    } finally {
      setIsBulkDeletingImages(false);
    }
  }

  // Hide/unhide just flips isActive in bulk via the same bulk-edit endpoint
  // the category-move button already uses -- no separate hide-specific
  // route needed.
  async function handleBulkHide() {
    setIsBulkHiding(true);
    try {
      await api.admin.bulkEditConcepts({ ids: [...selected], isActive: false });
      setSelected(new Set());
      await load();
    } finally {
      setIsBulkHiding(false);
    }
  }

  async function handleBulkUnhide() {
    setIsBulkHiding(true);
    try {
      await api.admin.bulkEditConcepts({ ids: [...selected], isActive: true });
      setSelected(new Set());
      await load();
    } finally {
      setIsBulkHiding(false);
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
        {createInfo ? <p className="text-sm text-emerald-600">{createInfo}</p> : null}
      </div>

      <AdminCreateCategory onCreated={(c) => setCategories((prev) => [...prev, c])} />

      {/* Bulk CSV/paste-a-list create and bulk-delete are admin-only -- a
         volunteer's access is single-item create/delete only, per the
         explicit scoping decision, so none of these widgets render for them. */}
      {!isVolunteer ? (
        <>
          <AdminBulkTextCreate
            label="Bulk Add Categories by Text"
            placeholder={"Nature\nTransport\nEmotions"}
            onSubmit={(names) => api.admin.bulkCreateCategoriesText(names)}
            onDone={load}
          />

          <AdminBulkUpload
            label="Bulk Upload Concepts"
            onUpload={(file) => api.admin.bulkUploadConcepts(file)}
            onDone={load}
          />

          <AdminBulkConceptTextCreate onSubmit={(items) => api.admin.bulkCreateConceptsText(items)} onDone={load} />

          <AdminBulkImageUrlUpload
            label="Bulk Add Concept Images by URL"
            matchItems={allConcepts}
            matchLabel={(c) => c.labelEnglish}
            onSubmit={(pairs) => api.admin.bulkAddConceptMediaUrl(pairs.map((p) => ({ conceptId: p.id, imageUrl: p.imageUrl })))}
            onDone={load}
          />

          <AdminOpenverseAutofill
            label="Auto-fill Missing Concept Images from Openverse"
            onSubmit={() => api.admin.bulkOpenverseAutofillConcepts()}
            onDone={load}
          />

          <AdminBulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            onDelete={handleBulkDelete}
            onPermanentDelete={handleBulkPermanentDelete}
          >
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
            <button
              onClick={handleBulkAutofillOpenverse}
              disabled={isBulkAutofilling}
              className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-50"
            >
              {isBulkAutofilling ? "Adding images..." : "Add images from Openverse"}
            </button>
            <button
              onClick={handleBulkDeleteImages}
              disabled={isBulkDeletingImages}
              className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-red-600 hover:bg-border disabled:opacity-50"
            >
              {isBulkDeletingImages ? "Removing images..." : "Remove all images"}
            </button>
            <button
              onClick={handleBulkHide}
              disabled={isBulkHiding}
              className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-50"
            >
              {isBulkHiding ? "Hiding..." : "Hide selected"}
            </button>
            <button
              onClick={handleBulkUnhide}
              disabled={isBulkHiding}
              className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-50"
            >
              Unhide selected
            </button>
          </AdminBulkBar>
          {bulkAutofillInfo ? <p className="text-sm text-emerald-600">{bulkAutofillInfo}</p> : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {isVolunteer ? (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => {
                setOnlyMine(e.target.checked);
                setOffset(0);
              }}
            />
            Show only my additions
          </label>
        ) : null}
        <select
          value={filterCategoryId}
          onChange={(e) => {
            setFilterCategoryId(e.target.value);
            setOffset(0);
          }}
          className="rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEnglish}
            </option>
          ))}
        </select>
        <select
          value={filterHasImage}
          onChange={(e) => {
            setFilterHasImage(e.target.value as "" | "yes" | "no");
            setOffset(0);
          }}
          className="rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
        >
          <option value="">Image: any</option>
          <option value="yes">Has image</option>
          <option value="no">No image</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Added
          <input
            type="date"
            value={createdFrom}
            onChange={(e) => {
              setCreatedFrom(e.target.value);
              setOffset(0);
            }}
            className="rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
          />
          to
          <input
            type="date"
            value={createdTo}
            onChange={(e) => {
              setCreatedTo(e.target.value);
              setOffset(0);
            }}
            className="rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
          />
        </label>
        {createdFrom || createdTo || filterCategoryId || filterHasImage ? (
          <button
            type="button"
            onClick={() => {
              setCreatedFrom("");
              setCreatedTo("");
              setFilterCategoryId("");
              setFilterHasImage("");
              setOffset(0);
            }}
            className="text-sm font-semibold text-brand hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

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
                  {!isVolunteer ? (
                    <input
                      type="checkbox"
                      checked={concepts.length > 0 && selected.size === concepts.length}
                      onChange={toggleSelectAll}
                    />
                  ) : null}
                </th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((concept) => (
                <Fragment key={concept.id}>
                {editingId === concept.id ? (
                  <tr className="border-b border-border bg-surface-card">
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
                    <td className="px-4 py-2 text-xs text-ink-muted">--</td>
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
                      {!isVolunteer ? (
                        <input type="checkbox" checked={selected.has(concept.id)} onChange={() => toggleSelected(concept.id)} />
                      ) : null}
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
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              concept.imageUrl ? "bg-emerald-100 text-emerald-700" : "bg-surface-card text-ink-muted ring-1 ring-border"
                            }`}
                          >
                            {concept.imageUrl ? "✓ Image" : "No image"}
                          </span>
                          <label className="cursor-pointer text-xs font-semibold text-brand hover:underline">
                            {uploadingId === concept.id ? "Uploading..." : "Upload"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploadingId === concept.id}
                              onChange={(e) => handleFileSelected(concept.id, e.target.files?.[0])}
                            />
                          </label>
                          <span className="text-ink-muted">·</span>
                          <button
                            onClick={() => startUrlEntry(concept.id)}
                            className="text-xs font-semibold text-brand hover:underline"
                          >
                            From URL
                          </button>
                          <span className="text-ink-muted">·</span>
                          <button
                            onClick={() => setOpenverseConceptId(concept.id)}
                            className="text-xs font-semibold text-brand hover:underline"
                          >
                            Openverse
                          </button>
                          <span className="text-ink-muted">·</span>
                          <button
                            onClick={() => setImagesConceptId(imagesConceptId === concept.id ? null : concept.id)}
                            className="text-xs font-semibold text-brand hover:underline"
                          >
                            {imagesConceptId === concept.id ? "Close Images" : "Images"}
                          </button>
                        </div>
                      )}
                      {uploadMessage?.id === concept.id ? (
                        <p className={`mt-1 text-xs ${uploadMessage.error ? "text-red-600" : "text-emerald-600"}`}>
                          {uploadMessage.text}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{new Date(concept.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {concept.isActive ? (
                        <span className="text-xs text-ink-muted">Visible</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                          Hidden
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => startEdit(concept)} className="text-xs font-semibold text-brand hover:underline">
                          Edit
                        </button>
                        {!isVolunteer ? (
                          <button
                            onClick={() => handleToggleActive(concept)}
                            disabled={togglingActiveId === concept.id}
                            className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline disabled:opacity-50"
                          >
                            {togglingActiveId === concept.id ? "Saving..." : concept.isActive ? "Hide" : "Unhide"}
                          </button>
                        ) : null}
                        {/* A volunteer may only delete (or request deletion of) their own
                           past additions, and only while the "my own additions" filter is
                           active -- otherwise the button doesn't render at all for them. */}
                        {!isVolunteer || (onlyMine && concept.createdBy === user?.id) ? (
                          <button
                            onClick={() => handleDelete(concept)}
                            disabled={deletingId === concept.id}
                            className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                          >
                            {deletingId === concept.id ? "Deleting..." : "Delete"}
                          </button>
                        ) : null}
                        {!isVolunteer ? (
                          <AdminPermanentDeleteButton
                            itemLabel={concept.labelEnglish}
                            onDelete={() => api.admin.permanentlyDeleteConcept(concept.id)}
                            onDone={load}
                          />
                        ) : null}
                        <AdminUndoButton
                          resourceType="concept"
                          identifier={concept.id}
                          onUndone={load}
                          className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline"
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {imagesConceptId === concept.id ? (
                  <tr className="border-b border-border bg-surface-card/50 last:border-0">
                    <td colSpan={8} className="px-4 py-4">
                      <AdminMediaManager
                        itemId={concept.id}
                        aspectRatio={16 / 9}
                        outputWidth={1600}
                        outputHeight={900}
                        getMedia={api.admin.getConceptMedia}
                        deleteMedia={api.admin.deleteConceptMedia}
                        cropMedia={api.admin.cropConceptMedia}
                        onChanged={load}
                      />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}

      {openverseConceptId ? (
        <AdminOpenversePicker
          defaultQuery={concepts.find((c) => c.id === openverseConceptId)?.labelEnglish ?? ""}
          onSelect={(image) => handleAddImageOpenverse(openverseConceptId, image)}
          onClose={() => setOpenverseConceptId(null)}
        />
      ) : null}

      {cropTarget ? (
        <ImageCropper
          imageSrc={cropTarget.url}
          aspectRatio={16 / 9}
          outputWidth={1600}
          outputHeight={900}
          title="Crop image (16:9)"
          onCancel={() => {
            URL.revokeObjectURL(cropTarget.url);
            setCropTarget(null);
          }}
          onApply={handleCropApply}
        />
      ) : null}
    </div>
  );
}
