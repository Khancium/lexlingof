import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { containsPattern } from "../../../utils/sql-like.js";
import { db } from "../../../db/index.js";
import {
  audioFiles,
  contributions,
  gamificationConfig,
  pointsTransactions,
  publishedTranslations,
  sentenceCategories,
  sentences,
  translations,
  userStats,
} from "../../../db/schema.js";
import { writeAuditLog } from "../../../services/audit-log.service.js";
import { insertLevelUpNotificationIfChanged, levelUpdateExpr } from "../../../services/level.service.js";
import { storageService } from "../../../services/storage.service.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { awardBadgesInBackground } from "../../gamification/gamification.service.js";
import { sendLevelUpNotification } from "../../notifications/push.service.js";
import { HttpError } from "../../../utils/http-error.js";

// Module 3 translations carry NO duration limit anywhere in this file.
// Audio can be any duration.

export type SubmitTranslationInput = {
  nativeText?: string | null;
  romanization?: string | null;
  ipa?: string | null;
  audioFileId: string;
  languageId: string;
  dialectId?: string | null;
  deviceId?: string | null;
  appVersion?: string | null;
  clientType?: string | null;
  sourceBufferId?: string | null;
};

async function readConfigValue(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], configKey: string): Promise<number> {
  const [config] = await tx
    .select({ configValue: gamificationConfig.configValue })
    .from(gamificationConfig)
    .where(and(eq(gamificationConfig.configKey, configKey), eq(gamificationConfig.isActive, true)))
    .limit(1);

  if (!config) {
    throw new HttpError(500, "CONFIG_MISSING", `${configKey} is not configured`);
  }

  return (config.configValue as { value: number }).value;
}

/**
 * Sentences are browsed BY CATEGORY, in the order an admin gave them -- not at random. A sentence is
 * one meaning in three languages (English, Urdu, Persian) on one row, so every read returns all three
 * and the contributor picks which one to read; a recording of it applies to all of them.
 */
export type SentenceItem = {
  id: string;
  englishText: string;
  urduText: string;
  persianText: string;
  sortOrder: number;
  category: { id: string; name: string; slug: string } | null;
  hasTranslated: boolean;
};

/** Has THIS user already recorded a live translation of the sentence? */
const translatedByUser = (userId: string) => sql<boolean>`exists (
    select 1 from ${translations}
    where ${translations.sentenceId} = ${sentences.id}
      and ${translations.userId} = ${userId}
      and ${translations.deletedAt} is null
  )`;

const sentenceSelection = (userId: string) => ({
  id: sentences.id,
  englishText: sentences.englishText,
  urduText: sentences.urduText,
  persianText: sentences.persianText,
  sortOrder: sentences.sortOrder,
  categoryId: sentenceCategories.id,
  categoryName: sentenceCategories.nameEnglish,
  categorySlug: sentenceCategories.slug,
  hasTranslated: translatedByUser(userId),
});

type SentenceRow = {
  id: string;
  englishText: string;
  urduText: string | null;
  persianText: string | null;
  sortOrder: number;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  hasTranslated: boolean;
};

function toSentenceItem(row: SentenceRow): SentenceItem {
  return {
    id: row.id,
    englishText: row.englishText,
    urduText: row.urduText ?? "",
    persianText: row.persianText ?? "",
    sortOrder: row.sortOrder,
    category: row.categoryId ? { id: row.categoryId, name: row.categoryName ?? "", slug: row.categorySlug ?? "" } : null,
    hasTranslated: row.hasTranslated,
  };
}

const liveSentence = and(eq(sentences.isActive, true), isNull(sentences.deletedAt));
const inOrder = [asc(sentences.sortOrder), asc(sentences.createdAt), asc(sentences.id)] as const;

/**
 * The category tiles: every active category that has at least one active sentence, in the admin's
 * order, with how many of its sentences this user has already translated. One grouped query -- only
 * the small aggregated result crosses the network (this DB connection is cross-region).
 */
export async function getSentenceCategoryTiles(userId: string) {
  const items = await db
    .select({
      id: sentenceCategories.id,
      slug: sentenceCategories.slug,
      name: sentenceCategories.nameEnglish,
      sortOrder: sentenceCategories.sortOrder,
      sentenceCount: sql<number>`count(distinct ${sentences.id})`.mapWith(Number),
      translatedCount: sql<number>`count(distinct ${translations.id})`.mapWith(Number),
    })
    .from(sentenceCategories)
    .innerJoin(sentences, and(eq(sentences.sentenceCategoryId, sentenceCategories.id), liveSentence))
    .leftJoin(translations, and(eq(translations.sentenceId, sentences.id), eq(translations.userId, userId), isNull(translations.deletedAt)))
    .where(eq(sentenceCategories.isActive, true))
    .groupBy(sentenceCategories.id)
    .orderBy(asc(sentenceCategories.sortOrder), asc(sentenceCategories.nameEnglish));

  return { items };
}

/** One category's sentences, in order, with this user's progress -- optionally narrowed by a search (any language) or translated/untranslated. */
export async function listCategorySentences(
  userId: string,
  categoryId: string,
  opts: { search?: string; filter?: "translated" | "untranslated"; limit: number; offset: number },
) {
  const [category] = await db
    .select({ id: sentenceCategories.id, name: sentenceCategories.nameEnglish, slug: sentenceCategories.slug })
    .from(sentenceCategories)
    .where(and(eq(sentenceCategories.id, categoryId), eq(sentenceCategories.isActive, true)))
    .limit(1);
  if (!category) throw new HttpError(404, "NOT_FOUND", "Category not found");

  const conditions = [liveSentence, eq(sentences.sentenceCategoryId, categoryId)];
  if (opts.search) {
    const pattern = containsPattern(opts.search);
    conditions.push(or(ilike(sentences.englishText, pattern), ilike(sentences.urduText, pattern), ilike(sentences.persianText, pattern))!);
  }
  if (opts.filter === "translated") conditions.push(translatedByUser(userId));
  else if (opts.filter === "untranslated") conditions.push(sql`not (${translatedByUser(userId)})`);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select(sentenceSelection(userId))
      .from(sentences)
      .leftJoin(sentenceCategories, eq(sentenceCategories.id, sentences.sentenceCategoryId))
      .where(and(...conditions))
      .orderBy(...inOrder)
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(and(...conditions)),
  ]);

  return { category, items: rows.map(toSentenceItem), total: totalRow?.value ?? 0, limit: opts.limit, offset: opts.offset };
}

/**
 * The next sentence in a category this user hasn't translated yet, in the category's order -- the
 * replacement for the old "random sentence". With `afterSentenceId` it continues from that sentence
 * (strictly after it in the order), so "Next" walks the category front to back; without it, it is the
 * first untranslated one. 404 when there is nothing left (after that point).
 */
export async function getNextSentence(userId: string, categoryId: string, afterSentenceId?: string): Promise<SentenceItem> {
  const conditions = [liveSentence, eq(sentences.sentenceCategoryId, categoryId), sql`not (${translatedByUser(userId)})`];

  if (afterSentenceId) {
    const [after] = await db
      .select({ id: sentences.id })
      .from(sentences)
      .where(and(eq(sentences.id, afterSentenceId), eq(sentences.sentenceCategoryId, categoryId)))
      .limit(1);
    // Compared against the row itself, inside the database. Passing its created_at back as a parameter loses
    // the microseconds (a JS Date only has milliseconds), which made "after X" include X.
    if (after) {
      conditions.push(
        sql`(${sentences.sortOrder}, ${sentences.createdAt}, ${sentences.id}) > (select a.sort_order, a.created_at, a.id from ${sentences} a where a.id = ${after.id}::uuid)`,
      );
    }
  }

  const [row] = await db
    .select(sentenceSelection(userId))
    .from(sentences)
    .leftJoin(sentenceCategories, eq(sentenceCategories.id, sentences.sentenceCategoryId))
    .where(and(...conditions))
    .orderBy(...inOrder)
    .limit(1);

  if (!row) {
    throw new HttpError(
      404,
      "NO_SENTENCES_AVAILABLE",
      afterSentenceId ? "No more untranslated sentences after this one in this category" : "You've translated every sentence in this category",
    );
  }
  return toSentenceItem(row);
}

export async function getSentenceForTranslation(userId: string, id: string): Promise<SentenceItem> {
  const [row] = await db
    .select(sentenceSelection(userId))
    .from(sentences)
    .leftJoin(sentenceCategories, eq(sentenceCategories.id, sentences.sentenceCategoryId))
    .where(and(eq(sentences.id, id), liveSentence))
    .limit(1);
  // Hidden and soft-deleted sentences can't be fetched (or translated) by their id.
  if (!row) throw new HttpError(404, "NOT_FOUND", "Sentence not found");
  return toSentenceItem(row);
}

/** Free-text search across all categories and all three languages (the forum composer's "discuss a sentence" picker). */
export async function searchSentences(
  userId: string,
  opts: { search?: string; filter?: "translated" | "untranslated"; categoryId?: string; limit: number; offset: number },
) {
  const conditions = [liveSentence];
  if (opts.categoryId) conditions.push(eq(sentences.sentenceCategoryId, opts.categoryId));
  if (opts.search) {
    const pattern = containsPattern(opts.search);
    conditions.push(or(ilike(sentences.englishText, pattern), ilike(sentences.urduText, pattern), ilike(sentences.persianText, pattern))!);
  }
  if (opts.filter === "translated") conditions.push(translatedByUser(userId));
  else if (opts.filter === "untranslated") conditions.push(sql`not (${translatedByUser(userId)})`);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select(sentenceSelection(userId))
      .from(sentences)
      .leftJoin(sentenceCategories, eq(sentenceCategories.id, sentences.sentenceCategoryId))
      .where(and(...conditions))
      .orderBy(asc(sentenceCategories.sortOrder), asc(sentenceCategories.nameEnglish), ...inOrder)
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(and(...conditions)),
  ]);

  return { items: rows.map(toSentenceItem), limit: opts.limit, offset: opts.offset, total: totalRow?.value ?? 0 };
}

export async function submitTranslation(userId: string, sentenceId: string, data: SubmitTranslationInput) {
  // There is no take limit -- re-recording a translation for the same
  // sentence overrides whatever's already there (in the DB and in R2)
  // instead of creating a second contribution. uq_translations_user_sentence
  // is what guarantees at most one live row per user+sentence, mirroring
  // word_recordings' per-synonym override.
  const [existing] = await db
    .select({ id: translations.id, audioFileId: translations.audioFileId, contributionId: translations.contributionId })
    .from(translations)
    .where(and(eq(translations.userId, userId), eq(translations.sentenceId, sentenceId), isNull(translations.deletedAt)))
    .limit(1);

  if (existing && existing.contributionId) {
    return overrideTranslation(userId, existing as { id: string; audioFileId: string | null; contributionId: string }, data);
  }

  const [levelRow] = await db.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1);
  const previousLevel = levelRow?.level ?? "BRONZE";

  const result = await db.transaction(async (tx) => {
    // 1. Insert translations.
    const [translation] = await tx
      .insert(translations)
      .values({
        userId,
        sentenceId,
        audioFileId: data.audioFileId,
        nativeText: data.nativeText?.trim() || null,
        romanization: data.romanization ?? null,
        ipa: data.ipa ?? null,
        version: 1,
        isCurrent: true,
      })
      .returning({ id: translations.id });

    if (!translation) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create translation");
    }

    // 2. Insert contributions.
    const [contribution] = await tx
      .insert(contributions)
      .values({
        userId,
        moduleType: "TRANSLATION",
        languageId: data.languageId,
        dialectId: data.dialectId ?? null,
        status: "pending",
        translationId: translation.id,
        deviceId: data.deviceId ?? null,
        appVersion: data.appVersion ?? null,
        clientType: data.clientType ?? null,
        sourceBufferId: data.sourceBufferId ?? null,
      })
      .returning({ id: contributions.id });

    if (!contribution) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create contribution");
    }

    // 3. Point translations back at its contribution.
    await tx
      .update(translations)
      .set({ contributionId: contribution.id, updatedAt: new Date() })
      .where(eq(translations.id, translation.id));

    // 4. Points -- base is always read; the three bonuses are independent
    // config lookups gated by different conditions, fetched together
    // instead of as sequential round trips.
    const [base, audioBonus, romanBonus, ipaBonus] = await Promise.all([
      readConfigValue(tx, "points.translation.base"),
      data.audioFileId ? readConfigValue(tx, "points.translation.audio") : Promise.resolve(0),
      data.romanization ? readConfigValue(tx, "points.translation.roman") : Promise.resolve(0),
      data.ipa ? readConfigValue(tx, "points.translation.ipa") : Promise.resolve(0),
    ]);
    const pointsAwarded = base + audioBonus + romanBonus + ipaBonus;

    // Resolved before the batch below -- see word.service.ts's identical comment.
    const levelExpr = await levelUpdateExpr(1);

    // 5, 6, 7: independent of each other -- issued together instead of as
    // three sequential round trips. total_points is incremented inline here
    // (the contribution id is brand new, so the ledger insert below can't hit
    // its idempotency key) -- it was previously missing, so the leaderboard
    // never saw translation points.
    const [, [updatedStats]] = await Promise.all([
      tx
        .insert(pointsTransactions)
        .values({
          userId,
          contributionId: contribution.id,
          points: pointsAwarded,
          reason: "TRANSLATION_SUBMITTED",
          moduleType: "TRANSLATION",
          idempotencyKey: `${contribution.id}:TRANSLATION_SUBMITTED`,
        })
        .onConflictDoNothing(),
      tx
        .update(userStats)
        .set({
          totalContributions: sql`${userStats.totalContributions} + 1`,
          translationContributions: sql`${userStats.translationContributions} + 1`,
          pendingContributions: sql`${userStats.pendingContributions} + 1`,
          totalPoints: sql`${userStats.totalPoints} + ${pointsAwarded}`,
          level: levelExpr,
          lastContributionAt: new Date(),
          lastContributionModule: "TRANSLATION",
          updatedAt: new Date(),
        })
        .where(eq(userStats.userId, userId))
        .returning({ level: userStats.level }),
      updateStreakOnContribution(tx, userId),
    ]);

    if (!updatedStats) {
      throw new HttpError(500, "STATS_MISSING", "user_stats row not found for user");
    }

    await insertLevelUpNotificationIfChanged(tx, userId, previousLevel, updatedStats.level);

    // 8.
    return { contributionId: contribution.id, translationId: translation.id, pointsAwarded, newLevel: updatedStats.level };
  });

  // Push notification is best-effort external I/O -- sent after the
  // transaction has committed, never inside it, and swallowed on failure so
  // a notification problem never fails the submission itself.
  if (result.newLevel !== previousLevel) {
    try {
      await sendLevelUpNotification(userId, result.newLevel);
    } catch (err) {
      console.error("[translation] sendLevelUpNotification failed:", err);
    }
  }

  awardBadgesInBackground(userId);

  await writeAuditLog({
    actorId: userId,
    actorRole: null,
    action: "contribution_submitted",
    resourceType: "contribution",
    resourceId: result.contributionId,
    afterState: { moduleType: "TRANSLATION", sentenceId },
  });

  return { contributionId: result.contributionId, translationId: result.translationId, pointsAwarded: result.pointsAwarded };
}

/**
 * Re-recording a translation that already has a live row for this
 * user+sentence: replaces its audio (in R2 and in the row) and puts the
 * contribution back to "pending" for re-review, but does NOT award points
 * again -- those were already credited the first time this sentence was
 * translated, and re-crediting on every retake would make "no take limit" a
 * free-points exploit. Mirrors word.service.ts's overrideWordRecording.
 */
async function overrideTranslation(
  userId: string,
  existing: { id: string; audioFileId: string | null; contributionId: string },
  data: SubmitTranslationInput,
) {
  const [levelRow] = await db.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1);
  const userLevel = levelRow?.level ?? null;

  // Idempotent short-circuit: a buffer-worker retry after a crash resolves
  // to the SAME audioFileId (resolveAudioFileId persists it), so if it's
  // already applied there's nothing left to do -- re-running the override
  // below would delete the audio file it just finished setting.
  if (existing.audioFileId === data.audioFileId) {
    return { contributionId: existing.contributionId, translationId: existing.id, pointsAwarded: 0, newLevel: userLevel };
  }

  const oldAudioFileId = existing.audioFileId;
  const [oldAudio] = oldAudioFileId
    ? await db.select({ storageKey: audioFiles.storageKey }).from(audioFiles).where(eq(audioFiles.id, oldAudioFileId)).limit(1)
    : [null];

  const withdrawn = await db.transaction(async (tx) => {
    // See overrideWordRecording: the public API serves a published translation by its row, not by
    // its review status, so withdraw it in the same transaction as the audio swap and let an admin
    // re-publish after re-reviewing.
    const unpublished = await tx
      .delete(publishedTranslations)
      .where(eq(publishedTranslations.translationId, existing.id))
      .returning({ sentenceId: publishedTranslations.sentenceId, publishedBy: publishedTranslations.publishedBy });

    await tx
      .update(translations)
      .set({
        audioFileId: data.audioFileId,
        nativeText: data.nativeText?.trim() || null,
        romanization: data.romanization ?? null,
        ipa: data.ipa ?? null,
        updatedAt: new Date(),
      })
      .where(eq(translations.id, existing.id));

    await tx
      .update(contributions)
      .set({
        status: "pending",
        verifiedAt: null,
        verifiedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null,
        version: sql`${contributions.version} + 1`,
        // My Contributions (users.routes.ts GET /me/contributions) orders by
        // submittedAt, not updatedAt -- without bumping this too, a retake
        // succeeds completely but stays sorted at its ORIGINAL submission
        // time, so it can get buried under newer contributions and look like
        // it never happened even though it worked.
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contributions.id, existing.contributionId));

    if (oldAudio && oldAudioFileId) {
      // Not a hard delete: a buffer row's resolvedAudioFileId from the
      // original submission may still reference this row, so deleting it
      // here would fail the whole override on an FK violation. Quarantining
      // leaves the row (and that reference) intact while making clear the
      // file itself is gone.
      await tx
        .update(audioFiles)
        .set({ processingStatus: "quarantined", processingError: "Superseded by a newer recording for this translation" })
        .where(eq(audioFiles.id, oldAudioFileId));
    }

    return unpublished;
  });

  if (withdrawn.length > 0) {
    await writeAuditLog({
      actorId: userId,
      actorRole: null,
      action: "published_translation_withdrawn_on_retake",
      resourceType: "translation",
      resourceId: existing.id,
      beforeState: { published: true, sentenceId: withdrawn[0]!.sentenceId, publishedBy: withdrawn[0]!.publishedBy },
      afterState: { published: false, reason: "contributor re-recorded; needs re-review and re-publishing" },
    });
  }

  if (oldAudio) {
    // Best-effort, same reasoning as the identical override path in
    // word.service.ts -- the DB write already committed, so a storage
    // failure here must not 500 a retake that otherwise succeeded.
    try {
      await storageService.deleteAudioFile(oldAudio.storageKey);
    } catch (err) {
      console.error(`[translation] translation ${existing.id} overridden but old storage object could not be removed:`, err);
    }
  }

  return { contributionId: existing.contributionId, translationId: existing.id, pointsAwarded: 0, newLevel: userLevel };
}
