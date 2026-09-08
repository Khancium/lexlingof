import { and, eq, inArray, isNull, not, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import {
  categories,
  contributions,
  gamificationConfig,
  pointsTransactions,
  sentences,
  translations,
  userStats,
} from "../../../db/schema.js";
import { insertLevelUpNotificationIfChanged, levelUpdateExpr } from "../../../services/level.service.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { sendLevelUpNotification } from "../../notifications/push.service.js";
import { HttpError } from "../../../utils/http-error.js";

// Module 3 translations carry NO 3-second limit anywhere in this file.
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

export async function getRandomSentence(userId: string, languageId: string) {
  // The literal exclusion query given in spec only filters by user_id and
  // module_type, which would make the languageId parameter unused. Since
  // this is a multi-language platform (every contribution carries a
  // language_id), a sentence a user already translated into Pashto should
  // still be offered for Urdu -- so the exclusion is scoped per language
  // here, deviating from the literal SQL to make languageId meaningful.
  const translatedSentenceIds = db
    .select({ sentenceId: translations.sentenceId })
    .from(translations)
    .innerJoin(contributions, eq(contributions.id, translations.contributionId))
    .where(
      and(
        eq(contributions.userId, userId),
        eq(contributions.moduleType, "TRANSLATION"),
        eq(contributions.languageId, languageId),
      ),
    );

  const [sentence] = await db
    .select({
      id: sentences.id,
      englishText: sentences.englishText,
      categoryId: categories.id,
      categoryName: categories.nameEnglish,
      categorySlug: categories.slug,
    })
    .from(sentences)
    .leftJoin(categories, eq(categories.id, sentences.categoryId))
    .where(and(eq(sentences.isActive, true), isNull(sentences.deletedAt), not(inArray(sentences.id, translatedSentenceIds))))
    .orderBy(sql`random()`)
    .limit(1);

  if (!sentence) {
    throw new HttpError(404, "NO_SENTENCES_AVAILABLE", "No untranslated sentences remain for this language");
  }

  await db.update(sentences).set({ usageCount: sql`${sentences.usageCount} + 1` }).where(eq(sentences.id, sentence.id));

  return {
    id: sentence.id,
    englishText: sentence.englishText,
    category: sentence.categoryId ? { id: sentence.categoryId, name: sentence.categoryName, slug: sentence.categorySlug } : null,
  };
}

export async function submitTranslation(userId: string, sentenceId: string, data: SubmitTranslationInput) {
  const [levelRow] = await db.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1);
  const previousLevel = levelRow?.level ?? "BRONZE";

  const result = await db.transaction(async (tx) => {
    // 1. Insert translations.
    const [translation] = await tx
      .insert(translations)
      .values({
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

    // 5, 6, 7: independent of each other -- issued together instead of as
    // three sequential round trips. (Spec lists only two user_stats
    // counters here; see the module-level note on totalPoints.)
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
          level: levelUpdateExpr(1),
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

  return { contributionId: result.contributionId, translationId: result.translationId, pointsAwarded: result.pointsAwarded };
}
