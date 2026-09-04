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
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { HttpError } from "../../../utils/http-error.js";

// Module 3 translations carry NO 3-second limit anywhere in this file.
// Audio can be any duration.

export type SubmitTranslationInput = {
  nativeText: string;
  romanization?: string | null;
  ipa?: string | null;
  audioFileId?: string | null;
  languageId: string;
  dialectId?: string | null;
  deviceId?: string | null;
  appVersion?: string | null;
  clientType?: string | null;
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
      difficulty: sentences.difficulty,
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
    difficulty: sentence.difficulty,
  };
}

export async function submitTranslation(userId: string, sentenceId: string, data: SubmitTranslationInput) {
  return db.transaction(async (tx) => {
    // 1. Insert translations.
    const [translation] = await tx
      .insert(translations)
      .values({
        sentenceId,
        audioFileId: data.audioFileId ?? null,
        nativeText: data.nativeText,
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

    // 4. Points.
    let pointsAwarded = await readConfigValue(tx, "points.translation.base");
    if (data.audioFileId) pointsAwarded += await readConfigValue(tx, "points.translation.audio");
    if (data.romanization) pointsAwarded += await readConfigValue(tx, "points.translation.roman");
    if (data.ipa) pointsAwarded += await readConfigValue(tx, "points.translation.ipa");

    // 5. Points ledger, idempotent by construction.
    await tx
      .insert(pointsTransactions)
      .values({
        userId,
        contributionId: contribution.id,
        points: pointsAwarded,
        reason: "TRANSLATION_SUBMITTED",
        moduleType: "TRANSLATION",
        idempotencyKey: `${contribution.id}:TRANSLATION_SUBMITTED`,
      })
      .onConflictDoNothing();

    // 6. user_stats counters. (Spec lists only these two here; see the
    // module-level note on user_stats.totalPoints in the summary.)
    await tx
      .update(userStats)
      .set({
        totalContributions: sql`${userStats.totalContributions} + 1`,
        translationContributions: sql`${userStats.translationContributions} + 1`,
        pendingContributions: sql`${userStats.pendingContributions} + 1`,
        lastContributionAt: new Date(),
        lastContributionModule: "TRANSLATION",
        updatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId));

    // 7. Streak bookkeeping.
    await updateStreakOnContribution(tx, userId);

    // 8.
    return { contributionId: contribution.id, translationId: translation.id, pointsAwarded };
  });
}
