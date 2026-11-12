"use client";

import { useEffect, useState } from "react";
import { api, getErrorMessage, type AdminSentence, type AdminSentenceCategory, type SentenceImportItem, type SentenceImportResult } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { AdminBulkBar } from "@/components/admin-bulk-bar";
import { AdminPermanentDeleteButton } from "@/components/admin-permanent-delete-button";
import { Pagination } from "@/components/admin-pagination";
import { AdminUndoButton } from "@/components/admin-undo-button";

const DEFAULT_PAGE_SIZE = 50;

const inputClass = "rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border";

/** Pasted lines are "category <TAB> english <TAB> urdu <TAB> persian" (a | works too, for editors that eat tabs). */
function parsePastedLines(text: string): SentenceImportItem[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = (line.includes("\t") ? line.split("\t") : line.split("|")).map((p) => p.trim());
      return { category: parts[0] ?? "", english: parts[1] ?? "", urdu: parts[2] ?? "", persian: parts[3] ?? "" };
    });
}

export default function AdminSentencesPage() {
  const user = useAuthStore((s) => s.user);
  const isVolunteer = user?.role === "volunteer";

  const [categories, setCategories] = useState<AdminSentenceCategory[]>([]);
  const [sentences, setSentences] = useState<AdminSentence[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  // Volunteer-only "my own additions" filter -- also unlocks their per-row edit/delete buttons.
  const [onlyMine, setOnlyMine] = useState(false);

  // Add one sentence: a category and all three languages.
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newEnglish, setNewEnglish] = useState("");
  const [newUrdu, setNewUrdu] = useState("");
  const [newPersian, setNewPersian] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createInfo, setCreateInfo] = useState<string | null>(null);

  // Editing one sentence in place.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ englishText: "", urduText: "", persianText: "", categoryId: "", sortOrder: "" });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [isBulkHiding, setIsBulkHiding] = useState(false);

  // Category management (admins).
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState({ name: "", sortOrder: "" });

  // Import (admins).
  const [createMissingCategories, setCreateMissingCategories] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<SentenceImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function loadCategories() {
    try {
      setCategories(await api.admin.getSentenceCategories());
    } catch (err) {
      setCategoryError(getErrorMessage(err, "Failed to load categories"));
    }
  }

  // `silent` skips the loading-state swap for a refresh that follows an action already taken on this page.
  async function load(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    setLoadError(null);
    try {
      // An end date is inclusive of the whole day -- see the identical note on the concepts/scenes admin pages.
      const createdFromIso = createdFrom ? new Date(createdFrom).toISOString() : undefined;
      const createdToIso = createdTo ? new Date(`${createdTo}T23:59:59.999Z`).toISOString() : undefined;
      const res = await api.admin.getSentences({
        limit,
        offset,
        createdFrom: createdFromIso,
        createdTo: createdToIso,
        mine: isVolunteer && onlyMine ? true : undefined,
        categoryId: filterCategoryId || undefined,
        search: debouncedSearch || undefined,
      });
      setSentences(res.items);
      setTotal(res.total);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load sentences"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, limit, createdFrom, createdTo, onlyMine, filterCategoryId, debouncedSearch]);

  function refreshAll() {
    return Promise.all([load({ silent: true }), loadCategories()]);
  }

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setOffset(0);
  }

  /* ------------------------------- add a sentence ------------------------------- */
  async function handleCreate() {
    if (!newCategoryId || !newEnglish.trim() || !newUrdu.trim() || !newPersian.trim()) {
      setCreateError("Pick a category and fill in all three languages.");
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    setCreateInfo(null);
    try {
      const result = await api.admin.createSentence({
        categoryId: newCategoryId,
        englishText: newEnglish.trim(),
        urduText: newUrdu.trim(),
        persianText: newPersian.trim(),
      });
      setNewEnglish("");
      setNewUrdu("");
      setNewPersian("");
      if ("pending" in result) {
        setCreateInfo(result.message);
      } else {
        await refreshAll();
      }
    } catch (err) {
      setCreateError(getErrorMessage(err, "Failed to create sentence"));
    } finally {
      setIsCreating(false);
    }
  }

  /* ------------------------------- edit a sentence ------------------------------- */
  function canEdit(sentence: AdminSentence): boolean {
    return !isVolunteer || sentence.createdBy === user?.id;
  }

  function startEdit(sentence: AdminSentence) {
    setEditingId(sentence.id);
    setEditError(null);
    setEditDraft({
      englishText: sentence.englishText,
      urduText: sentence.urduText,
      persianText: sentence.persianText,
      categoryId: sentence.category?.id ?? "",
      sortOrder: String(sentence.sortOrder),
    });
  }

  async function saveEdit(sentence: AdminSentence) {
    const body: Parameters<typeof api.admin.updateSentence>[1] = {};
    if (editDraft.englishText.trim() !== sentence.englishText) body.englishText = editDraft.englishText.trim();
    if (editDraft.urduText.trim() !== sentence.urduText) body.urduText = editDraft.urduText.trim();
    if (editDraft.persianText.trim() !== sentence.persianText) body.persianText = editDraft.persianText.trim();
    if (editDraft.categoryId && editDraft.categoryId !== sentence.category?.id) body.categoryId = editDraft.categoryId;
    const order = Number(editDraft.sortOrder);
    if (editDraft.sortOrder.trim() !== "" && Number.isInteger(order) && order >= 0 && order !== sentence.sortOrder) body.sortOrder = order;
    if (Object.keys(body).length === 0) {
      setEditingId(null);
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      await api.admin.updateSentence(sentence.id, body);
      setEditingId(null);
      await refreshAll();
    } catch (err) {
      setEditError(getErrorMessage(err, "Failed to save the sentence"));
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDelete(sentence: AdminSentence) {
    if (!confirm(`Delete "${sentence.englishText}"? This cannot be undone from here.`)) return;
    setDeletingId(sentence.id);
    try {
      const result = await api.admin.deleteSentence(sentence.id);
      if ("pending" in result) alert(result.message);
      await refreshAll();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to delete sentence"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(sentence: AdminSentence) {
    setTogglingActiveId(sentence.id);
    try {
      await api.admin.updateSentence(sentence.id, { isActive: !sentence.isActive });
      await refreshAll();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to update sentence"));
    } finally {
      setTogglingActiveId(null);
    }
  }

  /* ---------------------------------- selection ---------------------------------- */
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
    await refreshAll();
  }

  async function handleBulkPermanentDelete() {
    const result = await api.admin.bulkPermanentlyDeleteSentences([...selected]);
    setSelected(new Set());
    await refreshAll();
    return result;
  }

  async function handleBulkMoveCategory() {
    if (!bulkCategoryId) return;
    setIsBulkEditing(true);
    try {
      await api.admin.bulkEditSentences({ ids: [...selected], categoryId: bulkCategoryId });
      setSelected(new Set());
      setBulkCategoryId("");
      await refreshAll();
    } catch (err) {
      alert(getErrorMessage(err, "Failed to move sentences"));
    } finally {
      setIsBulkEditing(false);
    }
  }

  async function handleBulkSetActive(isActive: boolean) {
    setIsBulkHiding(true);
    try {
      await api.admin.bulkEditSentences({ ids: [...selected], isActive });
      setSelected(new Set());
      await refreshAll();
    } catch (err) {
      alert(getErrorMessage(err, isActive ? "Failed to unhide sentences" : "Failed to hide sentences"));
    } finally {
      setIsBulkHiding(false);
    }
  }

  /* ---------------------------------- categories ---------------------------------- */
  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    setIsAddingCategory(true);
    setCategoryError(null);
    try {
      await api.admin.createSentenceCategory({ nameEnglish: newCategoryName.trim() });
      setNewCategoryName("");
      await loadCategories();
    } catch (err) {
      setCategoryError(getErrorMessage(err, "Failed to add the category"));
    } finally {
      setIsAddingCategory(false);
    }
  }

  function startEditCategory(c: AdminSentenceCategory) {
    setEditingCategoryId(c.id);
    setCategoryDraft({ name: c.nameEnglish, sortOrder: String(c.sortOrder) });
    setCategoryError(null);
  }

  async function saveCategory(c: AdminSentenceCategory) {
    const body: { nameEnglish?: string; sortOrder?: number } = {};
    if (categoryDraft.name.trim() && categoryDraft.name.trim() !== c.nameEnglish) body.nameEnglish = categoryDraft.name.trim();
    const order = Number(categoryDraft.sortOrder);
    if (categoryDraft.sortOrder.trim() !== "" && Number.isInteger(order) && order >= 0 && order !== c.sortOrder) body.sortOrder = order;
    if (Object.keys(body).length === 0) {
      setEditingCategoryId(null);
      return;
    }
    try {
      await api.admin.updateSentenceCategory(c.id, body);
      setEditingCategoryId(null);
      await refreshAll();
    } catch (err) {
      setCategoryError(getErrorMessage(err, "Failed to save the category"));
    }
  }

  async function toggleCategoryActive(c: AdminSentenceCategory) {
    try {
      await api.admin.updateSentenceCategory(c.id, { isActive: !c.isActive });
      await loadCategories();
    } catch (err) {
      setCategoryError(getErrorMessage(err, "Failed to update the category"));
    }
  }

  async function deleteCategory(c: AdminSentenceCategory) {
    if (!confirm(`Delete the category "${c.nameEnglish}"? It must have no sentences.`)) return;
    try {
      await api.admin.deleteSentenceCategory(c.id);
      if (filterCategoryId === c.id) setFilterCategoryId("");
      await loadCategories();
    } catch (err) {
      setCategoryError(getErrorMessage(err, "Failed to delete the category"));
    }
  }

  /* ------------------------------------ import ------------------------------------ */
  async function runImport(run: () => Promise<SentenceImportResult>) {
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await run();
      setImportResult(res);
      if (res.created > 0) await refreshAll();
      return res;
    } catch (err) {
      setImportError(getErrorMessage(err, "Import failed"));
      return null;
    } finally {
      setIsImporting(false);
    }
  }

  async function handlePasteImport() {
    const items = parsePastedLines(pasteText);
    if (items.length === 0) return;
    const res = await runImport(() => api.admin.bulkImportSentencesText(items, createMissingCategories));
    if (res && res.errors.length === 0) setPasteText("");
  }

  const activeCategories = categories;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-ink">Sentences</h1>
      <p className="text-sm text-ink-muted">
        Every sentence has a category and its English, Urdu and Persian text together, so the three versions are always the same sentence.
        Contributors work through a category in the order shown here.
      </p>

      {/* ------------------------------- Categories ------------------------------- */}
      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Categories</h2>
        {!isVolunteer ? (
          <div className="flex flex-wrap gap-3">
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
              placeholder="New category (e.g. Greetings, Introduction, Work, Agriculture, Husbandry, Household)"
              className={`flex-1 ${inputClass}`}
            />
            <button
              onClick={handleAddCategory}
              disabled={isAddingCategory || !newCategoryName.trim()}
              className="btn-duo bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
            >
              {isAddingCategory ? "Adding..." : "Add category"}
            </button>
          </div>
        ) : null}
        {categoryError ? <p className="text-sm text-red-600">{categoryError}</p> : null}
        {categories.length === 0 ? (
          <p className="text-sm text-ink-muted">No categories yet{isVolunteer ? " -- ask an admin to add some." : " -- add one above, or import sentences and tick \"create missing categories\"."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Sentences</th>
                  <th className="px-3 py-2">Status</th>
                  {!isVolunteer ? <th className="px-3 py-2">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => {
                  const editing = editingCategoryId === c.id;
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink-muted">
                        {editing ? (
                          <input
                            value={categoryDraft.sortOrder}
                            onChange={(e) => setCategoryDraft((d) => ({ ...d, sortOrder: e.target.value }))}
                            className={`w-16 ${inputClass}`}
                            inputMode="numeric"
                          />
                        ) : (
                          c.sortOrder
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {editing ? (
                          <input
                            value={categoryDraft.name}
                            onChange={(e) => setCategoryDraft((d) => ({ ...d, name: e.target.value }))}
                            className={`w-full ${inputClass}`}
                          />
                        ) : (
                          c.nameEnglish
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">
                        {c.activeSentenceCount} visible / {c.sentenceCount}
                      </td>
                      <td className="px-3 py-2">
                        {c.isActive ? (
                          <span className="text-xs text-ink-muted">Visible</span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Hidden</span>
                        )}
                      </td>
                      {!isVolunteer ? (
                        <td className="px-3 py-2">
                          <div className="flex gap-3">
                            {editing ? (
                              <>
                                <button onClick={() => saveCategory(c)} className="text-xs font-semibold text-brand hover:underline">
                                  Save
                                </button>
                                <button onClick={() => setEditingCategoryId(null)} className="text-xs font-semibold text-ink-muted hover:underline">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => startEditCategory(c)} className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline">
                                  Rename / reorder
                                </button>
                                <button onClick={() => toggleCategoryActive(c)} className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline">
                                  {c.isActive ? "Hide" : "Unhide"}
                                </button>
                                <button onClick={() => deleteCategory(c)} className="text-xs font-semibold text-red-600 hover:underline">
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------ Add a sentence ------------------------------ */}
      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Add New Sentence</h2>
        <select value={newCategoryId} onChange={(e) => setNewCategoryId(e.target.value)} className={`w-full sm:w-72 ${inputClass}`}>
          <option value="">Category...</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEnglish}
            </option>
          ))}
        </select>
        <div className="grid gap-3 md:grid-cols-3">
          <input value={newEnglish} onChange={(e) => setNewEnglish(e.target.value)} placeholder="English" className={inputClass} />
          <input value={newUrdu} onChange={(e) => setNewUrdu(e.target.value)} placeholder="اردو (Urdu)" dir="rtl" className={inputClass} />
          <input value={newPersian} onChange={(e) => setNewPersian(e.target.value)} placeholder="فارسی (Persian)" dir="rtl" className={inputClass} />
        </div>
        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="btn-duo bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isCreating ? "Adding..." : "Add sentence"}
        </button>
        {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
        {createInfo ? <p className="text-sm text-emerald-600">{createInfo}</p> : null}
      </div>

      {/* Bulk import and bulk actions are admin-only -- a volunteer's access is single-item create/delete (and
         editing their own), per the explicit scoping decision, so none of this renders for them. */}
      {!isVolunteer ? (
        <>
          <div className="card-duo space-y-4 rounded-2xl bg-surface p-5 shadow-sm">
            <h2 className="text-lg font-bold text-ink">Import Sentences</h2>
            <p className="text-sm text-ink-muted">
              One sentence per row, with its category and all three languages. A row that is missing a language is refused (and listed below with its
              row number), so no sentence is ever imported without its equivalents. Sentences whose English text already exists are skipped.
            </p>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={createMissingCategories} onChange={(e) => setCreateMissingCategories(e.target.checked)} />
              Create categories that don&apos;t exist yet
            </label>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">Paste</p>
              <p className="text-xs text-ink-muted">
                One sentence per line: <code>category</code>, <code>English</code>, <code>Urdu</code>, <code>Persian</code> separated by a tab (copy
                the four columns straight from a spreadsheet) or by <code>|</code>.
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={5}
                placeholder={"Greetings | Good morning. | صبح بخیر۔ | صبح بخیر.\nIntroduction | My name is Ali. | میرا نام علی ہے۔ | نام من علی است."}
                className="w-full rounded-lg bg-surface-card px-3 py-2 font-mono text-xs text-ink placeholder:text-gray-400 ring-1 ring-border"
              />
              <button
                onClick={handlePasteImport}
                disabled={isImporting || pasteText.trim().length === 0}
                className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                {isImporting ? "Importing..." : "Import pasted sentences"}
              </button>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-semibold text-ink">Or upload a file</p>
              <p className="text-xs text-ink-muted">
                CSV (UTF-8) or JSON with the columns <code>category</code>, <code>english</code>, <code>urdu</code>, <code>persian</code>.
              </p>
              <label className="btn-duo btn-duo-secondary inline-block cursor-pointer bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border">
                {isImporting ? "Importing..." : "Choose File (.csv, .json)"}
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="hidden"
                  disabled={isImporting}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) runImport(() => api.admin.bulkUploadSentences(file, createMissingCategories));
                  }}
                />
              </label>
            </div>

            {importError ? <p className="text-sm text-red-600">{importError}</p> : null}
            {importResult ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-600">
                  {importResult.created} sentence(s) added
                  {importResult.categoriesCreated > 0 ? `, ${importResult.categoriesCreated} new categor${importResult.categoriesCreated === 1 ? "y" : "ies"}` : ""}.
                </p>
                {importResult.errors.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-card p-3 text-xs text-red-600">
                    <p className="mb-1 font-semibold">{importResult.errors.length} row(s) were not imported:</p>
                    {importResult.errors.slice(0, 100).map((e, i) => (
                      <p key={i}>
                        Row {e.row}: {e.message}
                      </p>
                    ))}
                    {importResult.errors.length > 100 ? <p>...and {importResult.errors.length - 100} more</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <AdminBulkBar count={selected.size} onClear={() => setSelected(new Set())} onDelete={handleBulkDelete} onPermanentDelete={handleBulkPermanentDelete}>
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
              onClick={() => handleBulkSetActive(false)}
              disabled={isBulkHiding}
              className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-50"
            >
              {isBulkHiding ? "Working..." : "Hide selected"}
            </button>
            <button
              onClick={() => handleBulkSetActive(true)}
              disabled={isBulkHiding}
              className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-50"
            >
              Unhide selected
            </button>
          </AdminBulkBar>
        </>
      ) : null}

      {/* --------------------------------- Filters --------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search (any language)..."
          className="min-w-[12rem] rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
        />
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

      {/* ---------------------------------- List ---------------------------------- */}
      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : loadError ? (
        <p className="text-red-600">{loadError}</p>
      ) : sentences.length === 0 ? (
        <p className="text-ink-muted">No sentences match.</p>
      ) : (
        <div className="card-duo overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">
                  {!isVolunteer ? (
                    <input type="checkbox" checked={sentences.length > 0 && selected.size === sentences.length} onChange={toggleSelectAll} />
                  ) : null}
                </th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">English</th>
                <th className="px-4 py-3">اردو</th>
                <th className="px-4 py-3">فارسی</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentences.map((sentence) => {
                const editing = editingId === sentence.id;
                return (
                  <tr key={sentence.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      {!isVolunteer ? <input type="checkbox" checked={selected.has(sentence.id)} onChange={() => toggleSelected(sentence.id)} /> : null}
                    </td>
                    {editing ? (
                      <td colSpan={6} className="px-4 py-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <select
                              value={editDraft.categoryId}
                              onChange={(e) => setEditDraft((d) => ({ ...d, categoryId: e.target.value }))}
                              className={`${inputClass} text-sm`}
                            >
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nameEnglish}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-2 text-xs text-ink-muted">
                              Position
                              <input
                                value={editDraft.sortOrder}
                                onChange={(e) => setEditDraft((d) => ({ ...d, sortOrder: e.target.value }))}
                                className={`w-20 ${inputClass} text-sm`}
                                inputMode="numeric"
                              />
                            </label>
                          </div>
                          <div className="grid gap-2 md:grid-cols-3">
                            <textarea
                              value={editDraft.englishText}
                              onChange={(e) => setEditDraft((d) => ({ ...d, englishText: e.target.value }))}
                              rows={2}
                              className={`${inputClass} text-sm`}
                            />
                            <textarea
                              value={editDraft.urduText}
                              onChange={(e) => setEditDraft((d) => ({ ...d, urduText: e.target.value }))}
                              rows={2}
                              dir="rtl"
                              className={`${inputClass} text-sm`}
                            />
                            <textarea
                              value={editDraft.persianText}
                              onChange={(e) => setEditDraft((d) => ({ ...d, persianText: e.target.value }))}
                              rows={2}
                              dir="rtl"
                              className={`${inputClass} text-sm`}
                            />
                          </div>
                          {editError ? <p className="text-xs text-red-600">{editError}</p> : null}
                          <div className="flex gap-3">
                            <button
                              onClick={() => saveEdit(sentence)}
                              disabled={isSavingEdit}
                              className="btn-duo bg-brand px-4 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                            >
                              {isSavingEdit ? "Saving..." : "Save"}
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-xs font-semibold text-ink-muted hover:underline">
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-ink-muted">{sentence.category?.name ?? "--"}</td>
                        <td className="px-4 py-3 text-ink-muted">{sentence.sortOrder}</td>
                        <td className="px-4 py-3 text-ink">{sentence.englishText}</td>
                        <td className="px-4 py-3 text-ink" dir="rtl">
                          {sentence.urduText}
                        </td>
                        <td className="px-4 py-3 text-ink" dir="rtl">
                          {sentence.persianText}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{new Date(sentence.createdAt).toLocaleDateString()}</td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      {sentence.isActive ? (
                        <span className="text-xs text-ink-muted">Visible</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Hidden</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-3">
                        {canEdit(sentence) && !editing ? (
                          <button onClick={() => startEdit(sentence)} className="text-xs font-semibold text-brand hover:underline">
                            Edit
                          </button>
                        ) : null}
                        {/* A volunteer may only delete (or request deletion of) their own past additions, and only while the
                           "my own additions" filter is active -- otherwise the button doesn't render at all for them. */}
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
                          <button
                            onClick={() => handleToggleActive(sentence)}
                            disabled={togglingActiveId === sentence.id}
                            className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline disabled:opacity-50"
                          >
                            {togglingActiveId === sentence.id ? "Saving..." : sentence.isActive ? "Hide" : "Unhide"}
                          </button>
                        ) : null}
                        {!isVolunteer ? (
                          <AdminPermanentDeleteButton
                            itemLabel={sentence.englishText}
                            onDelete={() => api.admin.permanentlyDeleteSentence(sentence.id)}
                            onDone={() => refreshAll()}
                          />
                        ) : null}
                        {!isVolunteer ? (
                          <AdminUndoButton
                            resourceType="sentence"
                            identifier={sentence.id}
                            onUndone={() => refreshAll()}
                            className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline"
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={limit} total={total} onChange={setOffset} onLimitChange={handleLimitChange} />}
    </div>
  );
}
