"use client";

const DEFAULT_LIMIT_OPTIONS = [10, 20, 50, 100];

export function Pagination({
  offset,
  limit,
  total,
  onChange,
  onLimitChange,
  limitOptions = DEFAULT_LIMIT_OPTIONS,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  /** Omit to keep the page size fixed (no "per page" selector shown). */
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
}) {
  if (total === 0) return null;

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  // The current limit is always offered even if it's not one of the preset
  // options (e.g. a page loaded with a limit from a previous session/URL
  // that isn't in limitOptions), so the select never silently drops it.
  const options = limitOptions.includes(limit) ? limitOptions : [...limitOptions, limit].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      {pageCount > 1 ? (
        <>
          <button
            onClick={() => onChange(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-sm text-ink-muted">
            Page {page} of {pageCount}
          </span>
          <button
            onClick={() => onChange(offset + limit)}
            disabled={offset + limit >= total}
            className="btn-duo btn-duo-secondary bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border disabled:opacity-40"
          >
            Next →
          </button>
        </>
      ) : null}

      {onLimitChange ? (
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Per page:
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="rounded-lg bg-surface-card px-2 py-1.5 text-sm text-ink ring-1 ring-border"
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
