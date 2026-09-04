import { eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { badges, contributorLevel, notifications, streaks, userBadges, userStats } from "../../db/schema.js";
import { sendBadgeEarnedNotification } from "../notifications/push.service.js";

type Level = (typeof contributorLevel.enumValues)[number];

// Badges use trigger_value as a plain integer, so a level_reached badge's
// target level can't be stored as the literal string "BRONZE" etc. -- it's
// encoded as this ordinal by the seed script (1=BRONZE..4=PLATINUM). This
// mirrors that same encoding rather than a string comparison.
const LEVEL_ORDINAL: Record<Level, number> = { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 };

const MODULE_COUNT_FIELD = {
  WORD: "wordContributions",
  TRANSCRIPTION: "audioContributions",
  TRANSLATION: "translationContributions",
  SCENE: "sceneContributionsCount",
} as const;

export type AwardedBadge = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  earnedAt: Date;
};

export async function evaluateAndAwardBadges(userId: string): Promise<AwardedBadge[]> {
  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1);
  if (!stats) {
    return [];
  }

  const [streak] = await db.select({ currentStreak: streaks.currentStreak }).from(streaks).where(eq(streaks.userId, userId)).limit(1);
  const currentStreak = streak?.currentStreak ?? 0;

  const activeBadges = await db.select().from(badges).where(eq(badges.isActive, true));

  const earnedRows = await db.select({ badgeId: userBadges.badgeId }).from(userBadges).where(eq(userBadges.userId, userId));
  const earnedBadgeIds = new Set(earnedRows.map((r) => r.badgeId));

  const modulesWithContributions = Object.values(MODULE_COUNT_FIELD).filter((field) => stats[field] > 0).length;

  const qualifyingBadgeIds: string[] = [];

  for (const badge of activeBadges) {
    if (earnedBadgeIds.has(badge.id)) {
      continue;
    }

    let qualifies = false;

    switch (badge.triggerType) {
      case "contribution_count": {
        const threshold = badge.triggerValue ?? 0;
        if (badge.triggerModule) {
          qualifies = stats[MODULE_COUNT_FIELD[badge.triggerModule]] >= threshold;
        } else {
          qualifies = stats.totalContributions >= threshold;
        }
        break;
      }
      case "verified_count":
        qualifies = stats.verifiedContributions >= (badge.triggerValue ?? 0);
        break;
      case "streak_days":
        qualifies = currentStreak >= (badge.triggerValue ?? 0);
        break;
      case "level_reached":
        qualifies = LEVEL_ORDINAL[stats.level] >= (badge.triggerValue ?? 0);
        break;
      case "module_completion":
        // A strict "count of modules with >0 contributions >= trigger_value"
        // check, generalizing the literal all-four-nonzero rule so the
        // seeded multi-module (2) and data-explorer (3) badges -- not just
        // complete-contributor (4) -- can actually be earned.
        qualifies = modulesWithContributions >= (badge.triggerValue ?? 4);
        break;
      case "review_count":
        qualifies = stats.reviewsCompleted >= (badge.triggerValue ?? 0);
        break;
      case "manual":
        // Never auto-awarded.
        qualifies = false;
        break;
    }

    if (qualifies) {
      qualifyingBadgeIds.push(badge.id);
    }
  }

  if (qualifyingBadgeIds.length === 0) {
    return [];
  }

  const inserted = await db
    .insert(userBadges)
    .values(qualifyingBadgeIds.map((badgeId) => ({ userId, badgeId })))
    .onConflictDoNothing()
    .returning({ badgeId: userBadges.badgeId, earnedAt: userBadges.earnedAt });

  if (inserted.length === 0) {
    return [];
  }

  const badgeById = new Map(activeBadges.map((b) => [b.id, b]));
  const awarded: AwardedBadge[] = inserted.flatMap((row) => {
    const badge = badgeById.get(row.badgeId);
    if (!badge) return [];
    return [{ id: badge.id, slug: badge.slug, name: badge.name, description: badge.description, icon: badge.icon, category: badge.category, earnedAt: row.earnedAt }];
  });

  if (awarded.length > 0) {
    await db.insert(notifications).values(
      awarded.map((badge) => ({
        userId,
        channel: "push" as const,
        notificationType: "BADGE_EARNED",
        title: `Badge earned: ${badge.name}`,
        body: badge.description,
        data: { badgeId: badge.id, badgeSlug: badge.slug },
      })),
    );

    // Best-effort push per badge; a delivery failure never blocks awarding.
    for (const badge of awarded) {
      try {
        await sendBadgeEarnedNotification(userId, badge.name, badge.icon);
      } catch (err) {
        console.error("[gamification] sendBadgeEarnedNotification failed:", err);
      }
    }
  }

  return awarded;
}
