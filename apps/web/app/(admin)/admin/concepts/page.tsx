"use client";

import { useEffect, useState } from "react";
import { api, type Category, type ConceptListItem } from "@/lib/api";

export default function AdminConceptsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [newCategoryId, setNewCategoryId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDifficulty, setNewDifficulty] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDifficulty, setEditDifficulty] = useState(1);
  const [editCategoryId, setEditCategoryId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [cats, res] = await Promise.all([api.categories.getAll(), api.concepts.getAll({ limit: 200 })]);
    setCategories(cats);
    setConcepts(res.items);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!newCategoryId || newLabel.trim().length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await api.admin.createConcept({
        categoryId: newCategoryId,
        labelEnglish: newLabel.trim(),
        description: newDescription.trim() || undefined,
        difficulty: newDifficulty,
      });
      setNewLabel("");
      setNewDescription("");
      setNewDifficulty(1);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create concept");
    } finally {
      setIsCreating(false);
    }
  }

  function startEdit(concept: ConceptListItem) {
    setEditingId(concept.id);
    setEditLabel(concept.labelEnglish);
    setEditDescription(concept.description ?? "");
    setEditDifficulty(Number(concept.difficulty) || 1);
    setEditCategoryId(concept.categoryId);
  }

  async function saveEdit(id: string) {
    setIsSaving(true);
    try {
      await api.admin.updateConcept(id, {
        categoryId: editCategoryId,
        labelEnglish: editLabel.trim(),
        description: editDescription.trim() || undefined,
        difficulty: editDifficulty,
      });
      setEditingId(null);
      await load();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Concepts</h1>

      <div className="space-y-3 rounded-xl bg-slate-800 p-5">
        <h2 className="text-lg font-bold text-white">Add New Concept</h2>
        <div className="flex flex-wrap gap-3">
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            className="rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700"
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
            className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description"
            className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <select
            value={newDifficulty}
            onChange={(e) => setNewDifficulty(Number(e.target.value))}
            className="rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700"
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                Difficulty {d}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isCreating ? "Adding..." : "Add"}
          </button>
        </div>
        {createError ? <p className="text-sm text-red-400">{createError}</p> : null}
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700 text-slate-400">
              <tr>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Difficulty</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((concept) =>
                editingId === concept.id ? (
                  <tr key={concept.id} className="border-b border-slate-700/50 bg-slate-900/40">
                    <td className="px-4 py-2">
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="w-full rounded bg-slate-900 px-2 py-1 text-white ring-1 ring-slate-700"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editCategoryId}
                        onChange={(e) => setEditCategoryId(e.target.value)}
                        className="w-full rounded bg-slate-900 px-2 py-1 text-white ring-1 ring-slate-700"
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
                        className="w-full rounded bg-slate-900 px-2 py-1 text-white ring-1 ring-slate-700"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editDifficulty}
                        onChange={(e) => setEditDifficulty(Number(e.target.value))}
                        className="rounded bg-slate-900 px-2 py-1 text-white ring-1 ring-slate-700"
                      >
                        {[1, 2, 3, 4, 5].map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(concept.id)}
                          disabled={isSaving}
                          className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={concept.id} className="border-b border-slate-700/50 last:border-0">
                    <td className="px-4 py-3 text-white">{concept.labelEnglish}</td>
                    <td className="px-4 py-3 text-slate-300">{concept.categoryName}</td>
                    <td className="px-4 py-3 text-slate-400">{concept.description ?? "--"}</td>
                    <td className="px-4 py-3 text-slate-400">{concept.difficulty}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => startEdit(concept)} className="text-xs font-semibold text-blue-400 hover:underline">
                        Edit
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
