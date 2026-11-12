import { eq, sql } from "drizzle-orm";

import type { db } from "../db/index.js";
import { contributionModule, pointsTransactions, userStats } from "../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Module = (typeof contributionModule.enumValues)[number];

/**
 * Points are recorded in two places that must never disagree: the
 * `points_transactions` ledger (one row per award, idempotency-keyed) and the
 * `user_stats.total_points` running total that the leaderboard, dashboard and
 * admin sorting all read. Every award that can be retried or replayed goes
 * through here so the two move together -- or neither does.
 *
 * Inserts the ledger row, and only if it was actually new (the idempotency key
 * didn't already exist) adds the points to the user's running total. Returns
 * whether it was new, so a caller can also gate its own once-only side effects
 * (e.g. "verified" counters) on the same signal instead of double-counting on a
 * replay. Must be called inside the same transaction as the rest of the
 * submission/review it belongs to.
 *
 * Awards made at submission time with a brand-new contribution id can't
 * conflict, so those increment `total_points` inline in their existing
 * `user_stats` UPDATE (one fewer round trip -- this deployment is
 * cross-region) instead of calling this.
 */
export async function awardPointsOnce(
  tx: Tx,
  award: {
    userId: string;
    contributionId: string | null;
    points: number;
    reason: string;
    moduleType: Module | null;
    idempotencyKey: string;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(pointsTransactions)
    .values({
      userId: award.userId,
      contributionId: award.contributionId,
      points: award.points,
      reason: award.reason,
      moduleType: award.moduleType,
      idempotencyKey: award.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: pointsTransactions.id });

  if (inserted.length === 0) return false;

  if (award.points !== 0) {
    await tx
      .update(userStats)
      .set({ totalPoints: sql`${userStats.totalPoints} + ${award.points}`, updatedAt: new Date() })
      .where(eq(userStats.userId, award.userId));
  }

  return true;
}

/** Rolling windows behind the "weekly" and "monthly" leaderboards and profile fields. */
export const POINTS_PERIOD_DAYS = { weekly: 7, monthly: 30 } as const;

/**
 * A correlated scalar subquery: the points a user earned in the last `days`
 * days, summed from the ledger.
 *
 * `user_stats.points_this_week` / `points_this_month` look like they should
 * serve this, but nothing in the backend ever wrote them (and nothing resets
 * them on a schedule), so every weekly/monthly figure was permanently 0. The
 * ledger is the source of truth and is always current, so this reads it
 * directly instead of maintaining counters that need a cron job to stay right.
 *
 * `outerUserIdRef` is raw SQL naming the outer query's user-id column
 * (e.g. `"user_stats.user_id"`). It is written out as literal, table-qualified
 * text on purpose -- see the My Contributions note in users.routes.ts: drizzle
 * interpolates a column as a bare name, and `points_transactions` has its own
 * `id`/`user_id`, so an unqualified reference can silently bind to the inner
 * table instead of the outer one. Only ever pass a constant, never user input.
 */
export function pointsInLastDays(outerUserIdRef: string, days: number) {
  return sql<number>`(
    select coalesce(sum(pt.points), 0)::int
    from points_transactions pt
    where pt.user_id = ${sql.raw(outerUserIdRef)}
      and pt.created_at >= now() - interval '${sql.raw(String(Math.trunc(days)))} days'
  )`.mapWith(Number);
}
