"use client";

import { useState } from "react";
import type { BulkUploadResult } from "@/lib/api";

/**
 * Bulk-assigns images from third-party URLs. Since a URL fits on one line
 * (unlike a file), this skips the CSV/JSON file step entirely -- the admin
 * just pastes "label, url" pairs. Labels are resolved against `matchItems`
 * client-side so a typo shows up immediately instead of round-tripping to
 * the server first.
 */
export function AdminBulkImageUrlUpload<T extends { id: string }>({
  label,
  matchItems,
  matchLabel,
  onSubmit,
  onDone,
}: {
  label: string;
  matchItems: T[];
  /** Human-readable label for a given item, used to resolve pasted lines to an id. */
  matchLabel: (item: T) => string;
  onSubmit: (pairs: { id: string; imageUrl: string }[]) => Promise<BulkUploadResult>;
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

    const localErrors: { row: number; message: string }[] = [];
    const pairs: { id: string; imageUrl: string }[] = [];

    lines.forEach((line, i) => {
      const commaIndex = line.indexOf(",");
      if (commaIndex === -1) {
        localErrors.push({ row: i + 1, message: `Expected "label, url" -- got "${line}"` });
        return;
      }
      const name = line.slice(0, commaIndex).trim();
      const imageUrl = line.slice(commaIndex + 1).trim();
      const match = matchItems.find((item) => matchLabel(item).toLowerCase() === name.toLowerCase());
      if (!match) {
        localErrors.push({ row: i + 1, message: `No match for "${name}"` });
        return;
      }
      pairs.push({ id: match.id, imageUrl });
    });

    try {
      const serverResult = pairs.length > 0 ? await onSubmit(pairs) : { created: 0, errors: [] };
      setResult({
        created: serverResult.created,
        errors: [...localErrors, ...serverResult.errors.map((e) => ({ ...e, row: e.row }))],
      });
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
      <h2 className="text-lg font-bold text-ink">{label}</h2>
      <p className="text-xs text-ink-muted">
        One per line, format: <code>label, image URL</code>
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"river, https://example.com/river.jpg\nboat, https://example.com/boat.jpg"}
        className="w-full rounded-lg bg-surface-card px-3 py-2 font-mono text-xs text-ink placeholder:text-gray-400 ring-1 ring-border"
      />
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || text.trim().length === 0}
        className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
      >
        {isSubmitting ? "Adding..." : "Add Images"}
      </button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-emerald-600">{result.created} image(s) added.</p>
          {result.errors.length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-card p-3 text-xs text-red-600">
              {result.errors.map((e, i) => (
                <p key={i}>
                  Row {e.row}: {e.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
