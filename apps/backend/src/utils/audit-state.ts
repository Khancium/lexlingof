import { getTableColumns, type Table } from "drizzle-orm";

/**
 * Turns a `before_state` read back out of the audit log into something Drizzle's
 * `.set()` accepts for `table`.
 *
 * audit_logs stores before/after state as jsonb, so every timestamp comes back
 * as an ISO *string*. Drizzle's timestamp column calls `.toISOString()` on the
 * value it is given, which a string doesn't have -- so undoing any change whose
 * saved state included a non-null timestamp (e.g. a contribution's `verifiedAt`,
 * or the `deletedAt` of a re-applied delete) crashed with a 500.
 *
 * Also drops keys that aren't columns of `table`, so a stray key in a log row
 * can't be written anywhere.
 */
export function reviveAuditState(table: Table, state: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table) as Record<string, { columnType?: string }>;
  const revived: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    const column = columns[key];
    if (!column) continue;
    revived[key] = column.columnType === "PgTimestamp" && typeof value === "string" ? new Date(value) : value;
  }
  return revived;
}
