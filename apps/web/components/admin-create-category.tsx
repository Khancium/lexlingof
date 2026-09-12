"use client";

import { useState } from "react";
import { api, getErrorMessage, type Category } from "@/lib/api";

/** Lets an admin add a brand-new category on its own -- no concept (or, on the scenes page, scene) has to exist yet. Shared by the Concepts and Scenes admin pages, since both let an admin pick a category for something. */
export function AdminCreateCategory({ onCreated }: { onCreated: (category: Category) => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (name.trim().length === 0) return;
    setIsCreating(true);
    setError(null);
    try {
      const created = await api.admin.createCategory({ nameEnglish: name.trim(), icon: icon.trim() || undefined });
      onCreated(created);
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
      <h2 className="text-lg font-bold text-ink">Add New Category</h2>
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
