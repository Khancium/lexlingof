import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { pendingChanges, users } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";

export type PendingTargetType = (typeof pendingChanges.$inferInsert)["targetType"];
export type PendingAction = (typeof pendingChanges.$inferInsert)["action"];

type VolunteerActor = { id: string; role: string };

export async function isAutoApproved(userId: string): Promise<boolean> {
  const [row] = await db.select({ autoApproveVolunteer: users.autoApproveVolunteer }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.autoApproveVolunteer ?? false;
}

export async function setAutoApprove(userId: string, enabled: boolean): Promise<void> {
  await db.update(users).set({ autoApproveVolunteer: enabled, updatedAt: new Date() }).where(eq(users.id, userId));
}

/**
 * Wraps every concepts/scenes/sentences/categories/image create-or-delete
 * route. Admin and super_admin: `apply()` always runs immediately, and this
 * function is otherwise invisible to them -- zero behavior change from
 * before this feature existed. Volunteer with auto-approve on: `apply()`
 * still runs immediately (same as admin), so their work lands the moment
 * they submit it. Volunteer without auto-approve: `apply()` is never
 * called -- the action is captured in `pending_changes` instead, and the
 * caller gets back a `{ pending: true, id }` marker rather than apply()'s
 * own return value, so the route can reply 202 "submitted for approval"
 * instead of 201 "created".
 */
export async function gateVolunteerAction<T>(
  actor: VolunteerActor,
  targetType: PendingTargetType,
  action: PendingAction,
  payload: Record<string, unknown>,
  apply: () => Promise<T>,
): Promise<{ pending: false; result: T } | { pending: true; id: string }> {
  if (actor.role !== "volunteer") {
    return { pending: false, result: await apply() };
  }

  if (await isAutoApproved(actor.id)) {
    return { pending: false, result: await apply() };
  }

  const [row] = await db
    .insert(pendingChanges)
    .values({ volunteerId: actor.id, targetType, action, payload })
    .returning({ id: pendingChanges.id });

  return { pending: true, id: row!.id };
}

export async function getPendingChangeById(id: string) {
  const [row] = await db.select().from(pendingChanges).where(eq(pendingChanges.id, id)).limit(1);
  return row ?? null;
}

/** Only ever transitions a still-pending row -- approving/rejecting something already decided is a no-op guard, not a silent overwrite of the first decision. */
export async function requirePendingRow(id: string) {
  const row = await getPendingChangeById(id);
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Pending change not found");
  }
  if (row.status !== "pending") {
    throw new HttpError(409, "ALREADY_REVIEWED", `This change was already ${row.status}`);
  }
  return row;
}

/**
 * Atomically takes ownership of a still-pending change for approval, in ONE statement
 * (`UPDATE ... WHERE status = 'pending' RETURNING`), and returns the row.
 *
 * Approval used to be check-then-act: requirePendingRow() read the row, the change was
 * applied, and only afterwards did markApproved() update it -- with no `WHERE status =
 * 'pending'` -- so two admins (or one double-click) both passed the check and both
 * applied it. An image add would then be duplicated. Claiming first means exactly one
 * caller wins; the other gets the same 409 a late reviewer always got.
 *
 * If applying the change then fails, call releasePendingChange() so it goes back to
 * "pending" (the admin can still reject it or retry once the underlying problem is fixed).
 */
export async function claimPendingChange(id: string, adminId: string) {
  const [claimed] = await db
    .update(pendingChanges)
    .set({ status: "approved", reviewedBy: adminId, reviewedAt: new Date() })
    .where(and(eq(pendingChanges.id, id), eq(pendingChanges.status, "pending")))
    .returning();
  if (claimed) return claimed;

  const existing = await getPendingChangeById(id);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "Pending change not found");
  }
  throw new HttpError(409, "ALREADY_REVIEWED", `This change was already ${existing.status}`);
}

/** Puts a change claimed by claimPendingChange() back to "pending" because applying it failed. */
export async function releasePendingChange(id: string): Promise<void> {
  await db
    .update(pendingChanges)
    .set({ status: "pending", reviewedBy: null, reviewedAt: null })
    .where(and(eq(pendingChanges.id, id), eq(pendingChanges.status, "approved")));
}

/** Records what an approved change produced (e.g. the new concept's id), after it was applied. */
export async function finishApproval(id: string, resultResourceId: string | null): Promise<void> {
  await db.update(pendingChanges).set({ resultResourceId }).where(eq(pendingChanges.id, id));
}

/** Conditional on "still pending", so a change that was just approved (or rejected) elsewhere can't be overwritten. */
export async function markRejected(id: string, adminId: string, reason: string | undefined): Promise<void> {
  const [rejected] = await db
    .update(pendingChanges)
    .set({ status: "rejected", reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: reason ?? null })
    .where(and(eq(pendingChanges.id, id), eq(pendingChanges.status, "pending")))
    .returning({ id: pendingChanges.id });
  if (!rejected) {
    const existing = await getPendingChangeById(id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Pending change not found");
    throw new HttpError(409, "ALREADY_REVIEWED", `This change was already ${existing.status}`);
  }
}

/** True for a Postgres unique-constraint violation (SQLSTATE 23505), which Drizzle wraps in a DrizzleQueryError. */
export function isUniqueViolation(err: unknown): boolean {
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  return cause?.code === "23505" || (err as { code?: string } | undefined)?.code === "23505";
}

export async function listPendingChanges(filters: {
  volunteerId?: string;
  targetType?: PendingTargetType;
  status?: (typeof pendingChanges.$inferInsert)["status"];
  limit: number;
  offset: number;
}) {
  const conditions = [];
  if (filters.volunteerId) conditions.push(eq(pendingChanges.volunteerId, filters.volunteerId));
  if (filters.targetType) conditions.push(eq(pendingChanges.targetType, filters.targetType));
  if (filters.status) conditions.push(eq(pendingChanges.status, filters.status));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // An image-add change carries the whole file base64-encoded inside `payload` (up to ~13 MB a
  // row), and the list views (the admin panel's list, a volunteer's activity view of up to
  // 500 rows) never show it -- but `select *` shipped every byte of it anyway. Any single
  // value over 2000 characters is replaced by a short marker IN SQL, so it never leaves the
  // database. The full payload is still read (by id) when a change is approved.
  // (Written as literal table-qualified SQL on purpose; see the My Contributions note in
  // users.routes.ts about drizzle's unqualified column references.)
  const { payload: _fullPayload, ...columns } = getTableColumns(pendingChanges);
  return db
    .select({
      ...columns,
      payload: sql<Record<string, unknown>>`(
        select coalesce(
          jsonb_object_agg(e.key, case when length(e.value::text) > 2000 then to_jsonb('[omitted: large value]'::text) else e.value end),
          '{}'::jsonb
        )
        from jsonb_each("pending_changes"."payload") as e
      )`,
    })
    .from(pendingChanges)
    .where(whereClause)
    .orderBy(desc(pendingChanges.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
}

/**
 * Per-volunteer pending counts for the Volunteers panel's list view -- one
 * grouped query scoped to just the given volunteers, not a full-table pull
 * filtered in Node (the exact "never pull a large row set into Node"
 * mistake this codebase has already been burned by once -- see
 * ARCHITECTURE.md §2.7).
 */
export async function countPendingByVolunteer(volunteerIds: string[]): Promise<Map<string, number>> {
  if (volunteerIds.length === 0) return new Map();
  const rows = await db
    .select({ volunteerId: pendingChanges.volunteerId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(pendingChanges)
    .where(and(eq(pendingChanges.status, "pending"), inArray(pendingChanges.volunteerId, volunteerIds)))
    .groupBy(pendingChanges.volunteerId);
  return new Map(rows.map((r) => [r.volunteerId, r.count]));
}
