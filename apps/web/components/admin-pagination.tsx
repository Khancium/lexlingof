"use client";

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex items-center justify-center gap-4">
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
    </div>
  );
}
