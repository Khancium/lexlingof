import { eq } from "drizzle-orm";

import type { db } from "../db/index.js";
import { streaks, type streakStatus } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StreakStatus = (typeof streakStatus.enumValues)[number];

/** Whole days between two ISO (YYYY-MM-DD) dates, both read as UTC midnight. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

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
    const diffDays = daysBetween(streak.lastActivityDate, todayIso);

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

export type StreakDisplay = {
  currentStreak: number;
  longestStreak: number;
  status: StreakStatus;
};

/**
 * The `streaks` row is only ever touched by updateStreakOnContribution above,
 * which runs exclusively when the user submits something -- so currentStreak
 * only gets corrected to 0 the NEXT time they contribute after breaking it.
 * In between, every read (dashboard, profile, leaderboard) was showing the
 * stale pre-break number: a user who built a 10-day streak and then missed 3
 * days still saw "10" on their dashboard, days after it actually ended,
 * because nothing had recomputed it on read.
 *
 * This derives the true-as-of-now display without writing anything --
 * cheap, side-effect-free, and safe to call from any read path. It also
 * finally uses the `streak_status` enum's "grace" value, which existed in
 * the schema from the start but nothing ever set: a streak that's one day
 * stale isn't broken yet (today isn't over), so it's surfaced as "at risk"
 * rather than silently reported as still fully "active".
 *
 * diffDays semantics (see daysBetween): 0 = already contributed today (or
 * a same-day re-read); 1 = last contribution was yesterday, so the streak
 * survives only if they contribute again today; >=2 = a full day was missed
 * with no contribution, so the streak is broken and reads as 0.
 */
export function computeStreakDisplay(
  row: { currentStreak: number; longestStreak: number; lastActivityDate: string | null } | null | undefined,
  now: Date = new Date(),
): StreakDisplay {
  if (!row || !row.lastActivityDate) {
    return { currentStreak: 0, longestStreak: row?.longestStreak ?? 0, status: "broken" };
  }

  const todayIso = now.toISOString().slice(0, 10);
  const diffDays = daysBetween(row.lastActivityDate, todayIso);

  if (diffDays <= 0) {
    return { currentStreak: row.currentStreak, longestStreak: row.longestStreak, status: "active" };
  }
  if (diffDays === 1) {
    return { currentStreak: row.currentStreak, longestStreak: row.longestStreak, status: "grace" };
  }
  return { currentStreak: 0, longestStreak: row.longestStreak, status: "broken" };
}
