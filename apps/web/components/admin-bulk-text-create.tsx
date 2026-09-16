"use client";

import { useState } from "react";
import type { BulkUploadResult } from "@/lib/api";

/**
 * Paste-a-list bulk creator: one name/title per line, submitted as a plain
 * string array. Shared by "bulk-add categories" and "bulk-add scene titles"
 * -- both need nothing more than a name per line, unlike concepts (which
 * also need a category per line) or image URLs (which need a URL alongside
 * a match against an existing item).
 */
export function AdminBulkTextCreate({
  label,
  placeholder,
  onSubmit,
  onDone,
}: {
  label: string;
  placeholder: string;
  onSubmit: (lines: string[]) => Promise<BulkUploadResult>;
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

    setIsSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await onSubmit(lines);
      setResult(res);
      if (res.created > 0) {
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
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="text-xs text-ink-muted">One per line.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
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
