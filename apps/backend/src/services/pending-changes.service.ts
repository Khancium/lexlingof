import { and, desc, eq, inArray, sql } from "drizzle-orm";

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

export async function markApproved(id: string, adminId: string, resultResourceId: string | null): Promise<void> {
  await db
    .update(pendingChanges)
    .set({ status: "approved", reviewedBy: adminId, reviewedAt: new Date(), resultResourceId })
    .where(eq(pendingChanges.id, id));
}

export async function markRejected(id: string, adminId: string, reason: string | undefined): Promise<void> {
  await db
    .update(pendingChanges)
    .set({ status: "rejected", reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: reason ?? null })
    .where(eq(pendingChanges.id, id));
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

  return db
    .select()
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
