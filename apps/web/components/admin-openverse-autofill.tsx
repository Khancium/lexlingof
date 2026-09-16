"use client";

import { useState } from "react";
import type { BulkUploadResult } from "@/lib/api";

/**
 * One-click bulk fill: searches Openverse by each item's own name and
 * attaches the top licensed result to every item that currently has no
 * image at all. Shared by the concepts and scenes admin pages.
 */
export function AdminOpenverseAutofill({
  label,
  onSubmit,
  onDone,
}: {
  label: string;
  onSubmit: () => Promise<BulkUploadResult>;
  onDone?: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (
      !window.confirm(
        "Search Openverse for every item currently missing an image and attach the top result? Automatic matches aren't always accurate -- review the results afterward.",
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await onSubmit();
      setResult(res);
      if (res.created > 0) onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-fill failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-duo space-y-2 rounded-2xl bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className="text-xs text-ink-muted">
            Searches Openverse by name and attaches the top licensed result to every item with no image yet.
          </p>
        </div>
        <button
          onClick={handleClick}
          disabled={isSubmitting}
          className="btn-duo whitespace-nowrap bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isSubmitting ? "Filling..." : "Auto-fill from Openverse"}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {result ? (
        <div className="text-xs text-ink-muted">
          <p className="font-semibold text-emerald-600">{result.created} image(s) added.</p>
          {result.errors.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
              {result.errors.length > 10 ? <li>...and {result.errors.length - 10} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
