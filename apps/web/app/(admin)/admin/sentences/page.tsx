"use client";

import { useEffect, useState } from "react";
import { api, type AdminSentence, type Category } from "@/lib/api";

export default function AdminSentencesPage() {
  const [sentences, setSentences] = useState<AdminSentence[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [englishText, setEnglishText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [difficulty, setDifficulty] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [cats, sentenceList] = await Promise.all([api.categories.getAll(), api.admin.getSentences({ limit: 200 })]);
    setCategories(cats);
    setSentences(sentenceList);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (englishText.trim().length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await api.admin.createSentence({
        englishText: englishText.trim(),
        categoryId: categoryId || undefined,
        difficulty,
      });
      setEnglishText("");
      setDifficulty(1);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create sentence");
    } finally {
      setIsCreating(false);
    }
  }

  function categoryName(id: string | null): string {
    if (!id) return "--";
    return categories.find((c) => c.id === id)?.nameEnglish ?? "--";
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Sentences</h1>

      <div className="space-y-3 rounded-xl bg-slate-800 p-5">
        <h2 className="text-lg font-bold text-white">Add New Sentence</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={englishText}
            onChange={(e) => setEnglishText(e.target.value)}
            placeholder="English sentence"
            className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white placeholder-slate-500 ring-1 ring-slate-700"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEnglish}
              </option>
            ))}
          </select>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
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
                <th className="px-4 py-3">English Text</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Difficulty</th>
                <th className="px-4 py-3">Used</th>
              </tr>
            </thead>
            <tbody>
              {sentences.map((sentence) => (
                <tr key={sentence.id} className="border-b border-slate-700/50 last:border-0">
                  <td className="px-4 py-3 text-white">{sentence.englishText}</td>
                  <td className="px-4 py-3 text-slate-300">{categoryName(sentence.categoryId)}</td>
                  <td className="px-4 py-3 text-slate-400">{sentence.difficulty}</td>
                  <td className="px-4 py-3 text-slate-400">{sentence.usageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
