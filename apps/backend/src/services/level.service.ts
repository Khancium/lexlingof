import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { contributorLevel, gamificationConfig, notifications, userStats } from "../db/schema.js";

export type Level = (typeof contributorLevel.enumValues)[number];

// Level is based on total contribution count (not verified count) -- every
// submission counts toward leveling up, not just ones that later pass
// review. These are DEFAULTS only, used if gamification_config is missing a
// key -- the real values come from getLevelThresholds() below, which reads
// levels.silver.min / levels.gold.min / levels.platinum.min so an admin
// editing those in the gamification config actually takes effect (previously
// these were hardcoded here and in apps/web/lib/level.ts, so a config change
// silently did nothing).
const DEFAULT_LEVEL_THRESHOLDS: Record<Exclude<Level, "BRONZE">, number> = {
  SILVER: 100,
  GOLD: 500,
  PLATINUM: 1000,
};

const THRESHOLDS_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedThresholds: { values: Record<Exclude<Level, "BRONZE">, number>; expiresAt: number } | null = null;

const THRESHOLD_CONFIG_KEYS = {
  SILVER: "levels.silver.min",
  GOLD: "levels.gold.min",
  PLATINUM: "levels.platinum.min",
} as const;

export async function getLevelThresholds(): Promise<Record<Exclude<Level, "BRONZE">, number>> {
  if (cachedThresholds && cachedThresholds.expiresAt > Date.now()) {
    return cachedThresholds.values;
  }

  const rows = await db
    .select({ configKey: gamificationConfig.configKey, configValue: gamificationConfig.configValue })
    .from(gamificationConfig)
    .where(and(inArray(gamificationConfig.configKey, Object.values(THRESHOLD_CONFIG_KEYS)), eq(gamificationConfig.isActive, true)));

  const byKey = new Map(rows.map((r) => [r.configKey, (r.configValue as { value: number }).value]));
  const values: Record<Exclude<Level, "BRONZE">, number> = {
    SILVER: byKey.get(THRESHOLD_CONFIG_KEYS.SILVER) ?? DEFAULT_LEVEL_THRESHOLDS.SILVER,
    GOLD: byKey.get(THRESHOLD_CONFIG_KEYS.GOLD) ?? DEFAULT_LEVEL_THRESHOLDS.GOLD,
    PLATINUM: byKey.get(THRESHOLD_CONFIG_KEYS.PLATINUM) ?? DEFAULT_LEVEL_THRESHOLDS.PLATINUM,
  };

  cachedThresholds = { values, expiresAt: Date.now() + THRESHOLDS_CACHE_TTL_MS };
  return values;
}

/** Call after an admin edits any levels.*.min config key so the next read picks it up immediately instead of waiting out the cache TTL. */
export function invalidateLevelThresholdsCache(): void {
  cachedThresholds = null;
}

export async function levelForContributionCount(totalContributions: number): Promise<Level> {
  const t = await getLevelThresholds();
  if (totalContributions >= t.PLATINUM) return "PLATINUM";
  if (totalContributions >= t.GOLD) return "GOLD";
  if (totalContributions >= t.SILVER) return "SILVER";
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
export async function levelUpdateExpr(increment: number) {
  const t = await getLevelThresholds();
  // The bare CASE branches are untyped text literals -- userStats.level is
  // the contributor_level enum, so Postgres rejects the assignment without
  // an explicit cast (error 42804, found by testing this against a live DB).
  return sql<Level>`(case
    when ${userStats.totalContributions} + ${increment} >= ${t.PLATINUM} then 'PLATINUM'
    when ${userStats.totalContributions} + ${increment} >= ${t.GOLD} then 'GOLD'
    when ${userStats.totalContributions} + ${increment} >= ${t.SILVER} then 'SILVER'
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
