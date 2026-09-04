import { eq } from "drizzle-orm";

import type { db } from "../db/index.js";
import { streaks } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Bumps a user's daily streak after a qualifying contribution. Must run
 * inside the same transaction as the contribution it's recording activity
 * for, and only once per contribution (calling it twice for one contribution
 * would double-count qualifyingContributionsToday).
 */
export async function updateStreakOnContribution(tx: Tx, userId: string): Promise<{ currentStreak: number }> {
  const [streak] = await tx.select().from(streaks).where(eq(streaks.userId, userId)).limit(1);
  if (!streak) {
    throw new HttpError(500, "STREAK_MISSING", "streaks row not found for user");
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  let newCurrentStreak = streak.currentStreak;
  let newQualifying = streak.qualifyingContributionsToday;
  let newStreakStartedAt = streak.streakStartedAt;

  // streaks.last_activity_date defaults to the signup date, so a brand-new
  // user's row can already read lastActivityDate === today before they've
  // ever contributed. qualifyingContributionsToday > 0 is the real signal
  // that today's activity has already been counted.
  if (streak.lastActivityDate === todayIso && streak.qualifyingContributionsToday > 0) {
    newQualifying = streak.qualifyingContributionsToday + 1;
  } else {
    const lastDate = new Date(`${streak.lastActivityDate}T00:00:00Z`);
    const todayDate = new Date(`${todayIso}T00:00:00Z`);
    const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / 86_400_000);

    if (diffDays === 1) {
      newCurrentStreak = streak.currentStreak + 1;
    } else {
      newCurrentStreak = 1;
      newStreakStartedAt = new Date();
    }
    newQualifying = 1;
  }

  const newLongestStreak = Math.max(streak.longestStreak, newCurrentStreak);

  await tx
    .update(streaks)
    .set({
      lastActivityDate: todayIso,
      qualifyingContributionsToday: newQualifying,
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
      status: "active",
      streakStartedAt: newStreakStartedAt,
      updatedAt: new Date(),
    })
    .where(eq(streaks.userId, userId));

  return { currentStreak: newCurrentStreak };
}
