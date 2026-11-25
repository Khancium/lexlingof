"use client";

import { useEffect, useRef } from "react";

/**
 * Reads a single value out of the current URL's query string, falling back
 * to `fallback` (and its type) when the param is absent -- reads straight
 * from `window.location.search` rather than Next's `useSearchParams()` so
 * callers don't need a Suspense boundary just to restore pagination state.
 *
 * Declared as overloads rather than a single `<T extends ...>` generic --
 * that form infers the literal type of whatever default is passed (e.g.
 * `readUrlParam("offset", 0)` typed as `0`, not `number`), which then
 * poisons the `useState` it seeds and breaks every later `setOffset(n)`
 * call. An overload per primitive sidesteps inference entirely.
 */
export function readUrlParam(key: string, fallback: string): string;
export function readUrlParam(key: string, fallback: number): number;
export function readUrlParam(key: string, fallback: boolean): boolean;
export function readUrlParam(key: string, fallback: string | number | boolean): string | number | boolean {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw === null || raw === "") return fallback;
  if (typeof fallback === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? fallback : n;
  }
  if (typeof fallback === "boolean") return raw === "true";
  return raw;
}

/**
 * Mirrors the given state into the URL's query string via
 * `history.replaceState` (no navigation, no re-render) so a reload restores
 * the same page/filters/search instead of resetting to defaults. Keys whose
 * value is undefined, "", or false are left out of the URL entirely.
 *
 * Skips the very first run so mounting with default state doesn't
 * immediately stamp `?offset=0&limit=20...` onto a bare URL.
 */
export function useUrlStateSync(state: Record<string, string | number | boolean | undefined>): void {
  const skipFirst = useRef(true);
  const serialized = JSON.stringify(state);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) {
      if (value === undefined || value === "" || value === false) continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
    // `serialized` is the real dependency -- `state` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);
}
