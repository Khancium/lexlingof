import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  audioFiles,
  audioUploads,
  badges,
  categories,
  concepts,
  contributions,
  contributorProfiles,
  dialects,
  languages,
  sceneContributions,
  streaks,
  translations,
  userBadges,
  users,
  userStats,
  wordRecordings,
} from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";

/* -------------------------------------------------------------------------- */
/*                                 Leaderboard                                */
/* -------------------------------------------------------------------------- */

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // Spec names only "all_time" as the default; weekly/monthly are accepted
  // and actually change the ranking metric (userStats already carries
  // pointsThisWeek/pointsThisMonth for exactly this purpose) rather than
  // being silently ignored, which would otherwise mislead a client asking
  // for a weekly board into getting the all-time one back.
  period: z.enum(["all_time", "weekly", "monthly"]).default("all_time"),
});

const PERIOD_POINTS_COLUMN = {
  all_time: userStats.totalPoints,
  weekly: userStats.pointsThisWeek,
  monthly: userStats.pointsThisMonth,
} as const;

/* -------------------------------------------------------------------------- */
/*                                Corpus stats                                */
/* -------------------------------------------------------------------------- */

const CORPUS_STATS_CACHE_TTL_MS = 60 * 60 * 1000;
let corpusStatsCache: { data: Awaited<ReturnType<typeof loadCorpusStats>>; expiresAt: number } | null = null;

async function loadCorpusStats() {
  const totalActiveContributorsRows = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(users)
    .where(and(eq(users.role, "contributor"), eq(users.isActive, true), isNull(users.deletedAt)));
  const totalActiveContributors = totalActiveContributorsRows[0]?.value ?? 0;

  const totalContributionsRows = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(contributions)
    .where(isNull(contributions.deletedAt));
  const totalContributions = totalContributionsRows[0]?.value ?? 0;

  const verifiedContributionsRows = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(contributions)
    .where(and(eq(contributions.status, "verified"), isNull(contributions.deletedAt)));
  const verifiedContributions = verifiedContributionsRows[0]?.value ?? 0;

  // Audio duration for verified contributions is split across four payload
  // tables (each holding its own audio_file_id), so this sums each path
  // separately rather than attempting one sparse multi-way join.
  let audioMs = 0;
  const [wordMs] = await db
    .select({ value: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)`.mapWith(Number) })
    .from(wordRecordings)
    .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
    .innerJoin(audioFiles, eq(audioFiles.id, wordRecordings.audioFileId))
    .where(eq(contributions.status, "verified"));
  audioMs += wordMs?.value ?? 0;

  const [uploadMs] = await db
    .select({ value: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)`.mapWith(Number) })
    .from(audioUploads)
    .innerJoin(contributions, eq(contributions.id, audioUploads.contributionId))
    .innerJoin(audioFiles, eq(audioFiles.id, audioUploads.audioFileId))
    .where(eq(contributions.status, "verified"));
  audioMs += uploadMs?.value ?? 0;

  const [translationMs] = await db
    .select({ value: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)`.mapWith(Number) })
    .from(translations)
    .innerJoin(contributions, eq(contributions.id, translations.contributionId))
    .innerJoin(audioFiles, eq(audioFiles.id, translations.audioFileId))
    .where(eq(contributions.status, "verified"));
  audioMs += translationMs?.value ?? 0;

  const [sceneMs] = await db
    .select({ value: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)`.mapWith(Number) })
    .from(sceneContributions)
    .innerJoin(contributions, eq(contributions.id, sceneContributions.contributionId))
    .innerJoin(audioFiles, eq(audioFiles.id, sceneContributions.audioFileId))
    .where(eq(contributions.status, "verified"));
  audioMs += sceneMs?.value ?? 0;

  const countByModule = await db
    .select({ moduleType: contributions.moduleType, value: sql<number>`count(*)`.mapWith(Number) })
    .from(contributions)
    .where(isNull(contributions.deletedAt))
    .groupBy(contributions.moduleType);

  const countByModuleType = { WORD: 0, TRANSCRIPTION: 0, TRANSLATION: 0, SCENE: 0 };
  for (const row of countByModule) {
    countByModuleType[row.moduleType] = row.value;
  }

  const activeLanguagesRows = await db
    .select({ value: sql<number>`count(distinct ${contributions.languageId})`.mapWith(Number) })
    .from(contributions)
    .where(isNull(contributions.deletedAt));
  const activeLanguages = activeLanguagesRows[0]?.value ?? 0;

  const activeDialectsRows = await db
    .select({ value: sql<number>`count(distinct ${contributions.dialectId})`.mapWith(Number) })
    .from(contributions)
    .where(and(isNull(contributions.deletedAt), sql`${contributions.dialectId} is not null`));
  const activeDialects = activeDialectsRows[0]?.value ?? 0;

  return {
    totalActiveContributors,
    totalContributions,
    verifiedContributions,
    audioHours: Math.round((audioMs / 3_600_000) * 100) / 100,
    countByModuleType,
    activeLanguages,
    activeDialects,
  };
}

/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */

const userIdParamSchema = z.object({ userId: z.string().uuid() });

export default async function gamificationRoutes(fastify: FastifyInstance) {
  fastify.get("/leaderboard", async (request) => {
    const { limit, offset, period } = leaderboardQuerySchema.parse(request.query);
    const pointsColumn = PERIOD_POINTS_COLUMN[period];

    const rows = await db
      .select({
        rank: sql<number>`row_number() over (order by ${pointsColumn} desc)`.mapWith(Number),
        userId: users.id,
        displayName: users.displayName,
        level: userStats.level,
        totalPoints: pointsColumn,
        verifiedContributions: userStats.verifiedContributions,
        currentStreak: streaks.currentStreak,
        languageId: languages.id,
        languageCode: languages.code,
        languageNameEnglish: languages.nameEnglish,
      })
      .from(userStats)
      .innerJoin(users, eq(users.id, userStats.userId))
      .leftJoin(streaks, eq(streaks.userId, users.id))
      .leftJoin(contributorProfiles, eq(contributorProfiles.userId, users.id))
      .leftJoin(languages, eq(languages.id, contributorProfiles.primaryLanguageId))
      .where(and(eq(users.isSuspended, false), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(sql`${pointsColumn} desc`)
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({
      rank: row.rank,
      userId: row.userId,
      displayName: row.displayName,
      level: row.level,
      totalPoints: row.totalPoints,
      verifiedContributions: row.verifiedContributions,
      currentStreak: row.currentStreak ?? 0,
      language: row.languageId ? { id: row.languageId, code: row.languageCode, nameEnglish: row.languageNameEnglish } : null,
    }));
  });

  fastify.get("/corpus/stats", async () => {
    if (!corpusStatsCache || corpusStatsCache.expiresAt <= Date.now()) {
      corpusStatsCache = { data: await loadCorpusStats(), expiresAt: Date.now() + CORPUS_STATS_CACHE_TTL_MS };
    }
    return corpusStatsCache.data;
  });

  fastify.get("/badges", async () => {
    return db
      .select()
      .from(badges)
      .where(and(eq(badges.isActive, true), eq(badges.isHidden, false)))
      .orderBy(badges.sortOrder);
  });

  fastify.get("/badges/user/:userId", { preHandler: verifyToken }, async (request) => {
    const { userId } = userIdParamSchema.parse(request.params);

    if (request.user!.id !== userId) {
      throw new HttpError(403, "FORBIDDEN", "You can only view your own badges");
    }

    const earned = await db
      .select({
        id: badges.id,
        slug: badges.slug,
        name: badges.name,
        description: badges.description,
        icon: badges.icon,
        category: badges.category,
        earnedAt: userBadges.earnedAt,
      })
      .from(userBadges)
      .innerJoin(badges, eq(badges.id, userBadges.badgeId))
      .where(eq(userBadges.userId, userId));

    const earnedBadgeIds = earned.map((b) => b.id);

    const available = await db
      .select({
        id: badges.id,
        slug: badges.slug,
        name: badges.name,
        description: badges.description,
        icon: badges.icon,
        category: badges.category,
      })
      .from(badges)
      .where(
        and(
          eq(badges.isActive, true),
          eq(badges.isHidden, false),
          earnedBadgeIds.length > 0 ? sql`${badges.id} not in (${sql.join(earnedBadgeIds.map((id) => sql`${id}`), sql`, `)})` : sql`true`,
        ),
      )
      .orderBy(badges.sortOrder);

    return { earned, available };
  });

  fastify.get("/corpus/categories", async () => {
    // scene_concepts is admin-only annotation data and must never appear
    // here -- only Module 1 (word) verified-recording coverage is shown.
    // None of these three depend on each other's results -- run them
    // concurrently instead of as three sequential round trips.
    const [categoryRows, totalConceptRows, coveredConceptRows] = await Promise.all([
      db
        .select({ id: categories.id, slug: categories.slug, nameEnglish: categories.nameEnglish })
        .from(categories)
        .where(eq(categories.isActive, true))
        .orderBy(categories.sortOrder),
      db
        .select({ categoryId: concepts.categoryId, value: sql<number>`count(*)`.mapWith(Number) })
        .from(concepts)
        .where(and(eq(concepts.isActive, true), isNull(concepts.deletedAt)))
        .groupBy(concepts.categoryId),
      db
        .select({ categoryId: concepts.categoryId, value: sql<number>`count(distinct ${concepts.id})`.mapWith(Number) })
        .from(concepts)
        .innerJoin(wordRecordings, and(eq(wordRecordings.conceptId, concepts.id), isNull(wordRecordings.deletedAt)))
        .innerJoin(contributions, and(eq(contributions.id, wordRecordings.contributionId), eq(contributions.status, "verified")))
        .where(and(eq(concepts.isActive, true), isNull(concepts.deletedAt)))
        .groupBy(concepts.categoryId),
    ]);
    const totalByCategory = new Map(totalConceptRows.map((r) => [r.categoryId, r.value]));
    const coveredByCategory = new Map(coveredConceptRows.map((r) => [r.categoryId, r.value]));

    return categoryRows.map((category) => {
      const totalConcepts = totalByCategory.get(category.id) ?? 0;
      const conceptsWithRecordings = coveredByCategory.get(category.id) ?? 0;
      const wordRecordingCoveragePct = totalConcepts > 0 ? Math.round((conceptsWithRecordings / totalConcepts) * 10000) / 100 : 0;

      return {
        id: category.id,
        slug: category.slug,
        name: category.nameEnglish,
        totalConcepts,
        conceptsWithRecordings,
        wordRecordingCoveragePct,
      };
    });
  });

  // No per-language contribution breakdown existed anywhere -- needed for
  // the public corpus page's language bar chart.
  fastify.get("/corpus/languages", async () => {
    const rows = await db
      .select({
        id: languages.id,
        code: languages.code,
        nameEnglish: languages.nameEnglish,
        contributionCount: sql<number>`count(${contributions.id})`.mapWith(Number),
      })
      .from(languages)
      .leftJoin(contributions, and(eq(contributions.languageId, languages.id), isNull(contributions.deletedAt)))
      .where(eq(languages.isActive, true))
      .groupBy(languages.id, languages.code, languages.nameEnglish)
      .orderBy(desc(sql`count(${contributions.id})`));

    return rows;
  });
}
