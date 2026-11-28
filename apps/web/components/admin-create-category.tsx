"use client";

import { useState } from "react";
import { api, getErrorMessage, type Category } from "@/lib/api";

/**
 * Lets an admin (or a volunteer -- volunteers get full access to this form
 * too) add a brand-new category on its own -- no concept (or, on the scenes
 * page, scene) has to exist yet. Shared by the Concepts and Scenes admin
 * pages, since both let the caller pick a category for something.
 *
 * Optionally also renders the existing category list with a Delete button
 * per row (admin-only -- the backend route itself blocks volunteers too),
 * guarded server-side against deleting a category that still has concepts or
 * scene annotations in it.
 */
export function AdminCreateCategory({
  onCreated,
  categories,
  onDeleted,
  canDelete,
  hideCreate,
}: {
  onCreated: (category: Category) => void;
  categories?: Category[];
  onDeleted?: (id: string) => void;
  canDelete?: boolean;
  /** Scenes don't create categories of their own (a new one wouldn't show up here until a scene is tagged with it) -- just the delete list. */
  hideCreate?: boolean;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(category: Category) {
    if (!confirm(`Delete the category "${category.nameEnglish}"? It must have no concepts or scenes in it.`)) return;
    setDeletingId(category.id);
    setError(null);
    try {
      await api.admin.deleteCategory(category.id);
      onDeleted?.(category.id);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete the category"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate() {
    if (name.trim().length === 0) return;
    setIsCreating(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.admin.createCategory({ nameEnglish: name.trim(), icon: icon.trim() || undefined });
      if ("pending" in result) {
        // A volunteer without auto-approve -- nothing was actually created
        // yet, so there's no Category to hand back to the caller.
        setInfo(result.message);
      } else {
        onCreated(result);
      }
      setName("");
      setIcon("");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create category"));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
      <h2 className="text-lg font-bold text-ink">{hideCreate ? "Categories" : "Add New Category"}</h2>
      {!hideCreate ? (
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Category name"
            className="min-w-0 flex-1 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Icon (emoji, optional)"
            className="w-40 rounded-lg bg-surface-card px-3 py-2 text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
          <button
            onClick={handleCreate}
            disabled={isCreating || name.trim().length === 0}
            className="btn-duo bg-brand px-5 py-2 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isCreating ? "Adding..." : "Add"}
          </button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {info ? <p className="text-sm text-emerald-600">{info}</p> : null}
      {categories && categories.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {categories.map((c) => (
            <span
              key={c.id}
              className="flex items-center gap-2 rounded-full bg-surface-card px-3 py-1 text-sm text-ink ring-1 ring-border"
            >
              {c.icon ? <span>{c.icon}</span> : null}
              {c.nameEnglish}
              {canDelete ? (
                <button
                  onClick={() => handleDelete(c)}
                  disabled={deletingId === c.id}
                  className="font-semibold text-red-600 hover:underline disabled:opacity-50"
                  title="Delete category"
                >
                  {deletingId === c.id ? "..." : "✕"}
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
