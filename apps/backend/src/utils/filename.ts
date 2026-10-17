/**
 * Reduces a client-supplied filename to a safe basename before it's used to
 * build a storage key -- strips any directory components (so a filename
 * like "a.png/../../secret" can't inject extra path segments into a
 * Supabase/R2 object key) and any character outside a small safe set.
 * Always returns a non-empty string.
 */
export function sanitizeFilename(filename: string): string {
  const basename = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || "file";
}

/** The sanitized filename's extension, lowercased, or undefined if it has none. */
export function safeExtension(filename: string): string | undefined {
  const safe = sanitizeFilename(filename);
  const dot = safe.lastIndexOf(".");
  if (dot <= 0 || dot === safe.length - 1) return undefined;
  return safe.slice(dot + 1).toLowerCase();
}
