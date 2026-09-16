"use client";

import { useState } from "react";
import type { BulkUploadResult } from "@/lib/api";

/**
 * Paste-a-list bulk creator for concepts: "label, category" per line. The
 * category is resolved server-side the same way the CSV/JSON upload
 * resolves it (by slug or English name, case-insensitive), so a typoed
 * category name surfaces as that one line's own error instead of blocking
 * the whole paste.
 */
export function AdminBulkConceptTextCreate({
  onSubmit,
  onDone,
}: {
  onSubmit: (items: { labelEnglish: string; category: string }[]) => Promise<BulkUploadResult>;
  onDone?: () => void;
}) {
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const localErrors: { row: number; message: string }[] = [];
    const items: { labelEnglish: string; category: string }[] = [];

    lines.forEach((line, i) => {
      const commaIndex = line.indexOf(",");
      const labelEnglish = commaIndex === -1 ? "" : line.slice(0, commaIndex).trim();
      const category = commaIndex === -1 ? "" : line.slice(commaIndex + 1).trim();
      if (!labelEnglish || !category) {
        localErrors.push({ row: i + 1, message: `Expected "label, category" -- got "${line}"` });
        return;
      }
      items.push({ labelEnglish, category });
    });

    setIsSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const serverResult = items.length > 0 ? await onSubmit(items) : { created: 0, errors: [] };
      setResult({ created: serverResult.created, errors: [...localErrors, ...serverResult.errors] });
      if (serverResult.created > 0) {
        setText("");
        onDone?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk add failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
      <p className="text-sm font-semibold text-ink">Bulk Add Concepts by Text</p>
      <p className="text-xs text-ink-muted">One per line, format: label, category</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"river, Nature\nboat, Transport"}
        rows={4}
        className="w-full rounded-lg bg-surface-card px-3 py-2 font-mono text-xs text-ink placeholder:text-gray-400 ring-1 ring-border"
      />
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || text.trim().length === 0}
        className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
      >
        {isSubmitting ? "Adding..." : "Add"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {result ? (
        <div className="text-xs text-ink-muted">
          <p className="font-semibold text-emerald-600">{result.created} added.</p>
          {result.errors.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
              {result.errors.length > 10 ? <li>...and {result.errors.length - 10} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
