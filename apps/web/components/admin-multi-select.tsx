"use client";

import { useEffect, useRef, useState } from "react";

const triggerClass = "rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border";

/** A dropdown that lets more than one option be picked from the same filter at once (e.g. status: pending + verified). Shared by the admin Contributions and Users filter bars. */
export function AdminMultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggle(value: T) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const buttonLabel =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} ${label} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`${triggerClass} flex items-center gap-2 text-left disabled:opacity-50`}
      >
        {buttonLabel}
        <span className="text-ink-muted">▾</span>
      </button>
      {open ? (
        // Anchored to the button's right edge and grown leftward (rather than
        // the default left:0 growing rightward) so filters near the right
        // edge of a narrow/mobile viewport don't open off-screen with no way
        // to reach their far options.
        <div className="absolute right-0 z-10 mt-1 max-h-64 w-max min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg bg-surface p-2 shadow-lg ring-1 ring-border">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-xs text-ink-muted">No options</p>
          ) : (
            options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-surface-card">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))
          )}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs font-semibold text-brand hover:bg-surface-card"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
