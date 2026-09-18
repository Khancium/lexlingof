"use client";

import { useEffect, useState } from "react";
import { api, type AdminSentence, type Category } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { AdminBulkUpload } from "@/components/admin-bulk-upload";
import { AdminBulkBar } from "@/components/admin-bulk-bar";
import { AdminPermanentDeleteButton } from "@/components/admin-permanent-delete-button";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";

const DEFAULT_PAGE_SIZE = 50;

export default function AdminSentencesPage() {
  const user = useAuthStore((s) => s.user);
  const isVolunteer = user?.role === "volunteer";

  const [sentences, setSentences] = useState<AdminSentence[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  // Volunteer-only "my own additions" filter -- also unlocks their per-row
  // Delete button (see the delete-visibility rule near the table below).
  const [onlyMine, setOnlyMine] = useState(false);

  const [englishText, setEnglishText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createInfo, setCreateInfo] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [isBulkEditing, setIsBulkEditing] = useState(false);

  async function load() {
    setLoading(true);
    // An end date is inclusive of the whole day -- see the identical note
    // on the concepts/scenes admin pages.
    const createdFromIso = createdFrom ? new Date(createdFrom).toISOString() : undefined;
    const createdToIso = createdTo ? new Date(`${createdTo}T23:59:59.999Z`).toISOString() : undefined;
    const [cats, res] = await Promise.all([
      api.categories.getAll(),
      api.admin.getSentences({
        limit,
        offset,
        createdFrom: createdFromIso,
        createdTo: createdToIso,
        mine: isVolunteer && onlyMine ? true : undefined,
      }),
    ]);
    setCategories(cats);
    setSentences(res.items);
    setTotal(res.total);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, limit, createdFrom, createdTo, onlyMine]);

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  async function handleCreate() {
    if (englishText.trim().length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    setCreateInfo(null);
    try {
      const result = await api.admin.createSentence({
        englishText: englishText.trim(),
        categoryId: categoryId || undefined,
      });
      setEnglishText("");
      if ("pending" in result) {
        setCreateInfo(result.message);
      } else {
        await load();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create sentence");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(sentence: AdminSentence) {
    if (!confirm(`Delete "${sentence.englishText}"? This cannot be undone from here.`)) return;
    setDeletingId(sentence.id);
    try {
      const result = await api.admin.deleteSentence(sentence.id);
      if ("pending" in result) alert(result.message);
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  function categoryName(id: string | null): string {
    if (!id) return "--";
    return categories.find((c) => c.id === id)?.nameEnglish ?? "--";
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
    setSelected((prev) => (prev.size === sentences.length ? new Set() : new Set(sentences.map((s) => s.id))));
  }

  async function handleBulkDelete() {
    await api.admin.bulkDeleteSentences([...selected]);
    setSelected(new Set());
    await load();
  }

  async function handleBulkPermanentDelete() {
    const result = await api.admin.bulkPermanentlyDeleteSentences([...selected]);
    setSelected(new Set());
    await load();
    return result;
  }

  async function handleBulkMoveCategory() {
    if (!bulkCategoryId) return;
    setIsBulkEditing(true);
    try {
      await api.admin.bulkEditSentences({ ids: [...selected], categoryId: bulkCategoryId });
      setSelected(new Set());
      setBulkCategoryId("");
      await load();
    } finally {
      setIsBulkEditing(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-ink">Sentences</h1>

      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Add New Sentence</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={englishText}
            onChange={(e) => setEnglishText(e.target.value)}
            placeholder="English sentence"
            className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-lg bg-surface-card px-3 py-2 text-ink ring-1 ring-border"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEnglish}
              </option>
            ))}
          </select>
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

      {/* Bulk CSV upload and bulk-delete are admin-only -- a volunteer's
         access is single-item create/delete only, per the explicit scoping
         decision, so neither renders for them. */}
      {!isVolunteer ? (
        <>
          <AdminBulkUpload label="Bulk Upload Sentences" onUpload={(file) => api.admin.bulkUploadSentences(file)} onDone={load} />

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
          </AdminBulkBar>
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
        {createdFrom || createdTo ? (
          <button
            type="button"
            onClick={() => {
              setCreatedFrom("");
              setCreatedTo("");
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
      ) : (
        <div className="card-duo overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">
                  {!isVolunteer ? (
                    <input
                      type="checkbox"
                      checked={sentences.length > 0 && selected.size === sentences.length}
                      onChange={toggleSelectAll}
                    />
                  ) : null}
                </th>
                <th className="px-4 py-3">English Text</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentences.map((sentence) => (
                <tr key={sentence.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {!isVolunteer ? (
                      <input type="checkbox" checked={selected.has(sentence.id)} onChange={() => toggleSelected(sentence.id)} />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink">{sentence.englishText}</td>
                  <td className="px-4 py-3 text-ink-muted">{categoryName(sentence.categoryId)}</td>
                  <td className="px-4 py-3 text-ink-muted">{sentence.usageCount}</td>
                  <td className="px-4 py-3 text-ink-muted">{new Date(sentence.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {/* A volunteer may only delete (or request deletion of) their own
                         past additions, and only while the "my own additions" filter is
                         active -- otherwise the button doesn't render at all for them. */}
                      {!isVolunteer || (onlyMine && sentence.createdBy === user?.id) ? (
                        <button
                          onClick={() => handleDelete(sentence)}
                          disabled={deletingId === sentence.id}
                          className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                        >
                          {deletingId === sentence.id ? "Deleting..." : "Delete"}
                        </button>
                      ) : null}
                      {!isVolunteer ? (
                        <AdminPermanentDeleteButton
                          itemLabel={sentence.englishText}
                          onDelete={() => api.admin.permanentlyDeleteSentence(sentence.id)}
                          onDone={load}
                        />
                      ) : null}
                      <AdminUndoButton
                        resourceType="sentence"
                        identifier={sentence.id}
                        onUndone={load}
                        className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
