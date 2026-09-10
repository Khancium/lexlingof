import { and, eq, ilike, inArray, isNull, not, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import {
  audioFiles,
  categories,
  contributions,
  gamificationConfig,
  pointsTransactions,
  sentences,
  translations,
  userStats,
} from "../../../db/schema.js";
import { writeAuditLog } from "../../../services/audit-log.service.js";
import { insertLevelUpNotificationIfChanged, levelUpdateExpr } from "../../../services/level.service.js";
import { storageService } from "../../../services/storage.service.js";
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

/**
 * Search/browse list, used both by the translate page's quick search-and-jump
 * and the Browse Sentences screen (mirroring the concept/scene modules'
 * browse-tiles-with-search pattern). Computes hasTranslated per row (has
 * this user already translated this sentence) the same way concepts/scenes
 * compute hasContributed, and pushes translated sentences to the bottom via
 * ORDER BY on that same boolean (false/untranslated sorts first).
 */
export async function searchSentences(
  userId: string,
  search: string | undefined,
  filter: "translated" | "untranslated" | undefined,
  limit: number,
  offset: number,
) {
  const hasTranslatedExpr = sql<boolean>`exists (
    select 1 from ${translations}
    where ${translations.sentenceId} = ${sentences.id}
      and ${translations.userId} = ${userId}
      and ${translations.deletedAt} is null
  )`;

  const conditions = [eq(sentences.isActive, true), isNull(sentences.deletedAt)];
  if (search) {
    conditions.push(ilike(sentences.englishText, `%${search}%`));
  }
  if (filter === "translated") {
    conditions.push(hasTranslatedExpr);
  } else if (filter === "untranslated") {
    conditions.push(sql`not (${hasTranslatedExpr})`);
  }

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: sentences.id,
        englishText: sentences.englishText,
        categoryId: categories.id,
        categoryName: categories.nameEnglish,
        categorySlug: categories.slug,
        hasTranslated: hasTranslatedExpr,
      })
      .from(sentences)
      .leftJoin(categories, eq(categories.id, sentences.categoryId))
      .where(and(...conditions))
      .orderBy(hasTranslatedExpr, sentences.englishText)
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(and(...conditions)),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    englishText: row.englishText,
    category: row.categoryId ? { id: row.categoryId, name: row.categoryName, slug: row.categorySlug } : null,
    hasTranslated: row.hasTranslated,
  }));

  return { items, limit, offset, total: totalRow?.value ?? 0 };
}

// Sentences are bucketed into fixed-size "groups" for the translate page's
// tile view -- membership is a deterministic pseudo-random order (sorted by
// md5(id), not creation order or alphabetically) computed on the fly rather
// than stored, so it needs no migration/backfill and automatically covers
// sentences added later. It isn't perfectly stable across an admin adding
// or removing sentences (group boundaries can shift), but within a normal
// session it's fixed, which is all the progress bar / tile view needs.
const SENTENCE_GROUP_SIZE = 50;

// This app's DB connection crosses regions (see db/index.ts's prepare:false
// comment) -- round trips are expensive and, worse, transferring many rows
// scales badly (6384 rows measured at ~20s+ vs. ~200ms for 100 rows). The
// naive version of this feature (pull every active sentence id into Node,
// chunk into groups of 50 in JS) took 20-40s per request. Both functions
// below instead do the bucketing AND aggregation entirely in one SQL
// statement each, so only the small, already-aggregated result ever
// crosses the network -- a page of groups is a handful of summary rows, and
// a single group's detail is at most 50 rows.
export async function getSentenceGroups(userId: string, limit: number, offset: number) {
  const [groupRows, [totalRow]] = await Promise.all([
    db.execute<{ group_index: number; sentence_count: number; translated_count: number }>(sql`
      with ordered as (
        select id, (row_number() over (order by md5(id::text)) - 1) as rn
        from ${sentences}
        where ${sentences.isActive} = true and ${sentences.deletedAt} is null
      ),
      grouped as (
        select (rn / ${SENTENCE_GROUP_SIZE})::int as group_index, id
        from ordered
      )
      select
        g.group_index,
        count(*)::int as sentence_count,
        count(t.id)::int as translated_count
      from grouped g
      left join ${translations} t
        on t.sentence_id = g.id and t.user_id = ${userId} and t.deleted_at is null
      group by g.group_index
      order by g.group_index
      limit ${limit} offset ${offset}
    `),
    db.execute<{ total_groups: number }>(sql`
      select ceil(count(*)::numeric / ${SENTENCE_GROUP_SIZE})::int as total_groups
      from ${sentences}
      where ${sentences.isActive} = true and ${sentences.deletedAt} is null
    `),
  ]);

  const items = groupRows.map((r) => ({
    groupIndex: r.group_index,
    sentenceCount: r.sentence_count,
    translatedCount: r.translated_count,
  }));

  return { items, limit, offset, total: totalRow?.total_groups ?? 0 };
}

export async function getSentenceGroupDetail(userId: string, groupIndex: number) {
  const [[totalRow], rows] = await Promise.all([
    db.execute<{ total_groups: number }>(sql`
      select ceil(count(*)::numeric / ${SENTENCE_GROUP_SIZE})::int as total_groups
      from ${sentences}
      where ${sentences.isActive} = true and ${sentences.deletedAt} is null
    `),
    db.execute<{
      id: string;
      english_text: string;
      category_id: string | null;
      category_name: string | null;
      category_slug: string | null;
      has_translated: boolean;
    }>(sql`
      with ordered as (
        select id from ${sentences}
        where ${sentences.isActive} = true and ${sentences.deletedAt} is null
        order by md5(id::text)
        offset ${groupIndex * SENTENCE_GROUP_SIZE} limit ${SENTENCE_GROUP_SIZE}
      )
      select
        s.id,
        s.english_text,
        c.id as category_id,
        c.name_english as category_name,
        c.slug as category_slug,
        exists (
          select 1 from ${translations} t
          where t.sentence_id = s.id and t.user_id = ${userId} and t.deleted_at is null
        ) as has_translated
      from ordered o
      join ${sentences} s on s.id = o.id
      left join ${categories} c on c.id = s.category_id
    `),
  ]);

  const totalGroups = totalRow?.total_groups ?? 0;
  if (groupIndex < 0 || groupIndex >= totalGroups) {
    throw new HttpError(404, "NOT_FOUND", "Sentence group not found");
  }

  const items = rows.map((row) => ({
    id: row.id,
    englishText: row.english_text,
    category: row.category_id ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null,
    hasTranslated: row.has_translated,
  }));

  return { groupIndex, totalGroups, items };
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

  await db.transaction(async (tx) => {
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
  });

  if (oldAudio) {
    await storageService.deleteAudioFile(oldAudio.storageKey);
  }

  return { contributionId: existing.contributionId, translationId: existing.id, pointsAwarded: 0, newLevel: userLevel };
}
