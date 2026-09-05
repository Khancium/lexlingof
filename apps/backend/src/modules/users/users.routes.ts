import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  audioUploads,
  contributionModule,
  contributions,
  contributorProfiles,
  dialects,
  languages,
  scenes,
  sceneContributions,
  streaks,
  translations,
  userStats,
  users,
  wordRecordings,
} from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

async function getOwnProfile(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      biography: users.biography,
      level: userStats.level,
      totalPoints: userStats.totalPoints,
      verifiedContributions: userStats.verifiedContributions,
      totalContributions: userStats.totalContributions,
      pointsThisWeek: userStats.pointsThisWeek,
      lastContributionAt: userStats.lastContributionAt,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      locationCountry: contributorProfiles.locationCountry,
      locationCity: contributorProfiles.locationCity,
      locationVillage: contributorProfiles.locationVillage,
      showLocation: contributorProfiles.showLocation,
      languageId: languages.id,
      languageCode: languages.code,
      languageNameEnglish: languages.nameEnglish,
      languageNameNative: languages.nameNative,
      dialectId: dialects.id,
      dialectCode: dialects.code,
      dialectNameEnglish: dialects.nameEnglish,
    })
    .from(users)
    .leftJoin(userStats, eq(userStats.userId, users.id))
    .leftJoin(streaks, eq(streaks.userId, users.id))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, users.id))
    .leftJoin(languages, eq(languages.id, contributorProfiles.primaryLanguageId))
    .leftJoin(dialects, eq(dialects.id, contributorProfiles.primaryDialectId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!row) {
    return null;
  }

  const hasLocation = Boolean(row.locationCountry || row.locationCity || row.locationVillage);

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    level: row.level,
    totalPoints: row.totalPoints ?? 0,
    verifiedContributions: row.verifiedContributions ?? 0,
    totalContributions: row.totalContributions ?? 0,
    currentStreak: row.currentStreak ?? 0,
    longestStreak: row.longestStreak ?? 0,
    language: row.languageId
      ? {
          id: row.languageId,
          code: row.languageCode,
          nameEnglish: row.languageNameEnglish,
          nameNative: row.languageNameNative,
        }
      : null,
    dialect: row.dialectId
      ? { id: row.dialectId, code: row.dialectCode, nameEnglish: row.dialectNameEnglish }
      : null,
    location: hasLocation
      ? {
          country: row.locationCountry,
          city: row.locationCity,
          village: row.locationVillage,
          showLocation: row.showLocation,
        }
      : null,
    biography: row.biography,
    pointsThisWeek: row.pointsThisWeek ?? 0,
    lastContributionAt: row.lastContributionAt,
  };
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const updateMeSchema = z.object({
  displayName: z.string().min(2).optional(),
  biography: z.string().max(2000).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  primaryLanguageId: z.string().uuid().optional(),
  primaryDialectId: z.string().uuid().optional(),
  locationCountry: z.string().optional(),
  locationCity: z.string().optional(),
  locationVillage: z.string().optional(),
  tribe: z.string().optional(),
  showLocation: z.boolean().optional(),
});

const contributionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  moduleType: z.enum(contributionModule.enumValues).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

/* -------------------------------------------------------------------------- */
/*                                    Routes                                  */
/* -------------------------------------------------------------------------- */

export default async function usersRoutes(fastify: FastifyInstance) {
  fastify.get("/me", { preHandler: verifyToken }, async (request) => {
    const profile = await getOwnProfile(request.user!.id);
    if (!profile) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }
    return profile;
  });

  fastify.put("/me", { preHandler: verifyToken }, async (request) => {
    const body = updateMeSchema.parse(request.body);
    const userId = request.user!.id;

    const userFields = pick(body, ["displayName", "biography", "timezone", "locale"]);
    const profileFields = pick(body, [
      "primaryLanguageId",
      "primaryDialectId",
      "locationCountry",
      "locationCity",
      "locationVillage",
      "tribe",
      "showLocation",
    ]);

    if (Object.keys(userFields).length > 0) {
      await db.update(users).set({ ...userFields, updatedAt: new Date() }).where(eq(users.id, userId));
    }

    if (Object.keys(profileFields).length > 0) {
      await db
        .insert(contributorProfiles)
        .values({ userId, ...profileFields })
        .onConflictDoUpdate({
          target: contributorProfiles.userId,
          set: { ...profileFields, updatedAt: new Date() },
        });
    }

    const profile = await getOwnProfile(userId);
    if (!profile) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }
    return profile;
  });

  fastify.get("/me/stats", { preHandler: verifyToken }, async (request) => {
    const userId = request.user!.id;

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1);
    const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId)).limit(1);

    return { stats: stats ?? null, streak: streak ?? null };
  });

  fastify.get("/me/contributions", { preHandler: verifyToken }, async (request) => {
    const { limit, offset, moduleType } = contributionsQuerySchema.parse(request.query);
    const userId = request.user!.id;

    const whereClause = moduleType
      ? and(eq(contributions.userId, userId), isNull(contributions.deletedAt), eq(contributions.moduleType, moduleType))
      : and(eq(contributions.userId, userId), isNull(contributions.deletedAt));

    const rows = await db
      .select({
        id: contributions.id,
        moduleType: contributions.moduleType,
        status: contributions.status,
        totalPoints: contributions.totalPoints,
        submittedAt: contributions.submittedAt,
        verifiedAt: contributions.verifiedAt,
        wordRecordingId: contributions.wordRecordingId,
        audioUploadId: contributions.audioUploadId,
        translationId: contributions.translationId,
        sceneContributionId: contributions.sceneContributionId,
      })
      .from(contributions)
      .where(whereClause)
      .orderBy(desc(contributions.submittedAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db.select({ value: count() }).from(contributions).where(whereClause);

    // Batched by module type (one query per type, not per row) -- with up
    // to `limit` rows per page potentially spanning all four module types,
    // the previous per-row Promise.all could fire that many extra queries
    // for a single page load.
    const wordRecordingIds = rows.filter((r) => r.moduleType === "WORD" && r.wordRecordingId).map((r) => r.wordRecordingId!);
    const audioUploadIds = rows.filter((r) => r.moduleType === "TRANSCRIPTION" && r.audioUploadId).map((r) => r.audioUploadId!);
    const translationIds = rows.filter((r) => r.moduleType === "TRANSLATION" && r.translationId).map((r) => r.translationId!);
    const sceneContributionIds = rows
      .filter((r) => r.moduleType === "SCENE" && r.sceneContributionId)
      .map((r) => r.sceneContributionId!);

    const [wordDetails, audioDetails, translationDetails, sceneDetails] = await Promise.all([
      wordRecordingIds.length
        ? db
            .select({
              id: wordRecordings.id,
              nativeWord: wordRecordings.nativeWord,
              romanization: wordRecordings.romanization,
              durationMs: wordRecordings.durationMs,
            })
            .from(wordRecordings)
            .where(inArray(wordRecordings.id, wordRecordingIds))
        : [],
      audioUploadIds.length
        ? db
            .select({ id: audioUploads.id, title: audioUploads.title, recordingType: audioUploads.recordingType })
            .from(audioUploads)
            .where(inArray(audioUploads.id, audioUploadIds))
        : [],
      translationIds.length
        ? db
            .select({ id: translations.id, nativeText: translations.nativeText, romanization: translations.romanization })
            .from(translations)
            .where(inArray(translations.id, translationIds))
        : [],
      sceneContributionIds.length
        ? db
            .select({ id: sceneContributions.id, sceneId: sceneContributions.sceneId, sceneTitle: scenes.title })
            .from(sceneContributions)
            .leftJoin(scenes, eq(scenes.id, sceneContributions.sceneId))
            .where(inArray(sceneContributions.id, sceneContributionIds))
        : [],
    ]);

    const wordById = new Map(wordDetails.map(({ id, ...d }) => [id, d]));
    const audioById = new Map(audioDetails.map(({ id, ...d }) => [id, d]));
    const translationById = new Map(translationDetails.map(({ id, ...d }) => [id, d]));
    const sceneById = new Map(sceneDetails.map(({ id, ...d }) => [id, d]));

    const items = rows.map(({ wordRecordingId, audioUploadId, translationId, sceneContributionId, ...base }) => {
      let detail: Record<string, unknown> | null = null;
      if (base.moduleType === "WORD" && wordRecordingId) {
        detail = wordById.get(wordRecordingId) ?? null;
      } else if (base.moduleType === "TRANSCRIPTION" && audioUploadId) {
        detail = audioById.get(audioUploadId) ?? null;
      } else if (base.moduleType === "TRANSLATION" && translationId) {
        detail = translationById.get(translationId) ?? null;
      } else if (base.moduleType === "SCENE" && sceneContributionId) {
        detail = sceneById.get(sceneContributionId) ?? null;
      }
      return { ...base, detail };
    });

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  fastify.get("/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [row] = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        createdAt: users.createdAt,
        level: userStats.level,
        totalPoints: userStats.totalPoints,
        verifiedContributions: userStats.verifiedContributions,
        publicProfile: contributorProfiles.publicProfile,
        languageId: languages.id,
        languageCode: languages.code,
        languageNameEnglish: languages.nameEnglish,
      })
      .from(users)
      .leftJoin(userStats, eq(userStats.userId, users.id))
      .leftJoin(contributorProfiles, eq(contributorProfiles.userId, users.id))
      .leftJoin(languages, eq(languages.id, contributorProfiles.primaryLanguageId))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);

    // contributor_profiles.public_profile exists specifically to let a
    // contributor opt out of public visibility; a profile explicitly marked
    // private is treated the same as a missing one.
    if (!row || row.publicProfile === false) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    return {
      id: row.id,
      displayName: row.displayName,
      level: row.level,
      totalPoints: row.totalPoints ?? 0,
      verifiedContributions: row.verifiedContributions ?? 0,
      language: row.languageId
        ? { id: row.languageId, code: row.languageCode, nameEnglish: row.languageNameEnglish }
        : null,
      createdAt: row.createdAt,
    };
  });
}
