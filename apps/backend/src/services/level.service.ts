import { sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { contributorLevel, notifications, userStats } from "../db/schema.js";

export type Level = (typeof contributorLevel.enumValues)[number];

// Level is based on total contribution count (not verified count) -- every
// submission counts toward leveling up, not just ones that later pass
// review. Kept in sync with apps/web/lib/level.ts and
// apps/mobile/src/utils/level.ts.
export const LEVEL_THRESHOLDS: Record<Exclude<Level, "BRONZE">, number> = {
  SILVER: 100,
  GOLD: 500,
  PLATINUM: 1000,
};

export function levelForContributionCount(totalContributions: number): Level {
  if (totalContributions >= LEVEL_THRESHOLDS.PLATINUM) return "PLATINUM";
  if (totalContributions >= LEVEL_THRESHOLDS.GOLD) return "GOLD";
  if (totalContributions >= LEVEL_THRESHOLDS.SILVER) return "SILVER";
  return "BRONZE";
}

/**
 * A SQL CASE expression computing the contributor's new level from
 * userStats.totalContributions + increment, for use as the `level` value in
 * the SAME UPDATE statement that increments totalContributions. Postgres
 * evaluates every SET expression in an UPDATE against the row's pre-update
 * values, so this correctly sees the same "current total" the increment
 * itself is based on -- no extra round trip to fetch the post-increment
 * total first.
 */
export function levelUpdateExpr(increment: number) {
  // The bare CASE branches are untyped text literals -- userStats.level is
  // the contributor_level enum, so Postgres rejects the assignment without
  // an explicit cast (error 42804, found by testing this against a live DB).
  return sql<Level>`(case
    when ${userStats.totalContributions} + ${increment} >= ${LEVEL_THRESHOLDS.PLATINUM} then 'PLATINUM'
    when ${userStats.totalContributions} + ${increment} >= ${LEVEL_THRESHOLDS.GOLD} then 'GOLD'
    when ${userStats.totalContributions} + ${increment} >= ${LEVEL_THRESHOLDS.SILVER} then 'SILVER'
    else 'BRONZE'
  end)::contributor_level`;
}

/** Inserts the in-app "Level Up" notification row when the level actually changed -- a no-op otherwise. Call inside the same transaction as the userStats update, using its returned new level. */
export async function insertLevelUpNotificationIfChanged(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  previousLevel: Level,
  newLevel: Level,
): Promise<void> {
  if (newLevel === previousLevel) return;

  await tx.insert(notifications).values({
    userId,
    channel: "in_app",
    notificationType: "LEVEL_UP",
    title: `You reached ${newLevel} level!`,
    body: `Congratulations -- your contributions moved you from ${previousLevel} to ${newLevel}.`,
    data: { oldLevel: previousLevel, newLevel },
  });
}
