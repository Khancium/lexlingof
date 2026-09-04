import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  auditLogs,
  audioUploads,
  conceptMedia,
  contributionModule,
  contributions,
  contributorLevel,
  gamificationConfig,
  languages,
  notifications,
  pointsTransactions,
  reviews,
  scenes,
  sceneContributions,
  sceneMedia,
  sentences,
  transcriptions,
  translations,
  userStats,
  users,
  wordRecordings,
} from "../../db/schema.js";
import { sendContributionVerifiedNotification, sendLevelUpNotification } from "../notifications/push.service.js";
import { HttpError } from "../../utils/http-error.js";

type Module = (typeof contributionModule.enumValues)[number];
type Level = (typeof contributorLevel.enumValues)[number];
type Decision = "valid" | "needs_correction" | "invalid";

export type SubmitReviewInput = {
  contributionId: string;
  decision: Decision;
  reason?: string | null;
  notes?: string | null;
};

/**
 * The seeded gamification_config keys for verified-contribution bonuses do
 * not follow a uniform `points.{module}.verified_bonus` pattern:
 * TRANSCRIPTION's bonus lives under "audio" (not "transcription"), and
 * TRANSLATION's key is "points.translation.verified" (no "_bonus" suffix).
 * This maps each module to its actual seeded key rather than deriving one
 * from moduleType.toLowerCase(), which would 500 on two of the four modules.
 */
const VERIFIED_BONUS_CONFIG_KEY: Record<Module, string> = {
  WORD: "points.word.verified_bonus",
  TRANSCRIPTION: "points.audio.verified_bonus",
  TRANSLATION: "points.translation.verified",
  SCENE: "points.scene.verified_bonus",
};

const REVIEW_AWARD_CONFIG_KEY = "points.review.award";

function levelForVerifiedCount(verifiedContributions: number): Level {
  if (verifiedContributions >= 1000) return "PLATINUM";
  if (verifiedContributions >= 500) return "GOLD";
  if (verifiedContributions >= 100) return "SILVER";
  return "BRONZE";
}

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

export async function getQueue(reviewerId: string, moduleType?: Module) {
  const conditions = [eq(contributions.status, "pending"), ne(contributions.userId, reviewerId), isNull(contributions.deletedAt)];
  if (moduleType) {
    conditions.push(eq(contributions.moduleType, moduleType));
  }

  // One wide left-join across every module's payload table: each row only
  // has non-null values in the columns for its own module_type, since
  // ck_contribution_single_reference guarantees exactly one *_id is set.
  const rows = await db
    .select({
      contributionId: contributions.id,
      moduleType: contributions.moduleType,
      status: contributions.status,
      submittedAt: contributions.submittedAt,
      contributorId: users.id,
      contributorDisplayName: users.displayName,
      languageId: languages.id,
      languageCode: languages.code,
      languageNameEnglish: languages.nameEnglish,
      // WORD
      wordNativeWord: wordRecordings.nativeWord,
      wordRomanization: wordRecordings.romanization,
      wordIpa: wordRecordings.ipa,
      wordDurationMs: wordRecordings.durationMs,
      wordAudioFileId: wordRecordings.audioFileId,
      // TRANSCRIPTION
      audioTitle: audioUploads.title,
      audioRecordingType: audioUploads.recordingType,
      audioNativeText: transcriptions.nativeText,
      audioUploadAudioFileId: audioUploads.audioFileId,
      // TRANSLATION
      translationNativeText: translations.nativeText,
      translationEnglishText: sentences.englishText,
      translationAudioFileId: translations.audioFileId,
      // SCENE
      sceneAudioFileId: sceneContributions.audioFileId,
      sceneTitle: scenes.title,
      sceneDifficulty: scenes.difficulty,
      sceneImageUrl: sceneMedia.publicUrl,
      // WORD's concept image, joined via wordRecordings.conceptId.
      conceptImageUrl: conceptMedia.publicUrl,
    })
    .from(contributions)
    .innerJoin(users, eq(users.id, contributions.userId))
    .leftJoin(languages, eq(languages.id, contributions.languageId))
    .leftJoin(wordRecordings, eq(wordRecordings.id, contributions.wordRecordingId))
    .leftJoin(
      conceptMedia,
      and(eq(conceptMedia.conceptId, wordRecordings.conceptId), eq(conceptMedia.isPrimary, true)),
    )
    .leftJoin(audioUploads, eq(audioUploads.id, contributions.audioUploadId))
    .leftJoin(transcriptions, and(eq(transcriptions.audioUploadId, audioUploads.id), eq(transcriptions.isCurrent, true)))
    .leftJoin(translations, eq(translations.id, contributions.translationId))
    .leftJoin(sentences, eq(sentences.id, translations.sentenceId))
    .leftJoin(sceneContributions, eq(sceneContributions.id, contributions.sceneContributionId))
    .leftJoin(scenes, eq(scenes.id, sceneContributions.sceneId))
    .leftJoin(sceneMedia, and(eq(sceneMedia.sceneId, scenes.id), eq(sceneMedia.isPrimary, true)))
    .where(and(...conditions))
    .orderBy(asc(contributions.submittedAt))
    .limit(20);

  return rows.map((row) => {
    let detail: Record<string, unknown> = {};
    switch (row.moduleType) {
      case "WORD":
        detail = {
          nativeWord: row.wordNativeWord,
          romanization: row.wordRomanization,
          ipa: row.wordIpa,
          durationMs: row.wordDurationMs,
          audioFileId: row.wordAudioFileId,
          imageUrl: row.conceptImageUrl,
        };
        break;
      case "TRANSCRIPTION":
        detail = {
          title: row.audioTitle,
          recordingType: row.audioRecordingType,
          nativeText: row.audioNativeText,
          audioFileId: row.audioUploadAudioFileId,
        };
        break;
      case "TRANSLATION":
        detail = {
          nativeText: row.translationNativeText,
          englishText: row.translationEnglishText,
          audioFileId: row.translationAudioFileId,
        };
        break;
      case "SCENE":
        detail = {
          audioFileId: row.sceneAudioFileId,
          title: row.sceneTitle,
          difficulty: row.sceneDifficulty,
          imageUrl: row.sceneImageUrl,
        };
        break;
    }

    return {
      contributionId: row.contributionId,
      moduleType: row.moduleType,
      status: row.status,
      submittedAt: row.submittedAt,
      contributor: { id: row.contributorId, displayName: row.contributorDisplayName },
      language: row.languageId ? { id: row.languageId, code: row.languageCode, nameEnglish: row.languageNameEnglish } : null,
      detail,
    };
  });
}

export async function submitReview(reviewerId: string, data: SubmitReviewInput) {
  // 1. Find contribution.
  const [contribution] = await db
    .select({
      id: contributions.id,
      userId: contributions.userId,
      status: contributions.status,
      moduleType: contributions.moduleType,
    })
    .from(contributions)
    .where(eq(contributions.id, data.contributionId))
    .limit(1);

  if (!contribution) {
    throw new HttpError(404, "NOT_FOUND", "Contribution not found");
  }

  // 2. CRITICAL: self-review guard.
  if (contribution.userId === reviewerId) {
    throw new HttpError(403, "SELF_REVIEW_FORBIDDEN", "You cannot review your own contributions");
  }

  // 3. Must still be pending.
  if (contribution.status !== "pending") {
    throw new HttpError(409, "CONTRIBUTION_NOT_PENDING", `Contribution status is '${contribution.status}', not 'pending'`);
  }

  const [reviewer] = await db.select({ role: users.role }).from(users).where(eq(users.id, reviewerId)).limit(1);

  const result = await db.transaction(async (tx) => {
    // 4. Status before the review.
    const statusBefore = contribution.status;

    // 5. Apply the decision.
    let statusAfter: (typeof contributions.status.enumValues)[number];
    if (data.decision === "valid") {
      statusAfter = "verified";
      await tx
        .update(contributions)
        .set({ status: statusAfter, verifiedAt: new Date(), verifiedBy: reviewerId, updatedAt: new Date() })
        .where(eq(contributions.id, contribution.id));
    } else if (data.decision === "needs_correction") {
      statusAfter = "needs_correction";
      await tx.update(contributions).set({ status: statusAfter, updatedAt: new Date() }).where(eq(contributions.id, contribution.id));
    } else {
      statusAfter = "rejected";
      await tx
        .update(contributions)
        .set({ status: statusAfter, rejectedAt: new Date(), rejectedBy: reviewerId, updatedAt: new Date() })
        .where(eq(contributions.id, contribution.id));
    }

    // 7. Insert the immutable review record.
    const [review] = await tx
      .insert(reviews)
      .values({
        contributionId: contribution.id,
        reviewerId,
        decision: data.decision,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        statusBefore,
        statusAfter,
      })
      .returning({ id: reviews.id });

    if (!review) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create review");
    }

    // 8. Reviewer's completed-review count.
    await tx
      .update(userStats)
      .set({ reviewsCompleted: sql`${userStats.reviewsCompleted} + 1`, updatedAt: new Date() })
      .where(eq(userStats.userId, reviewerId));

    // 9. Reviewer points, idempotent per (contribution, reviewer).
    const reviewAward = await readConfigValue(tx, REVIEW_AWARD_CONFIG_KEY);
    await tx
      .insert(pointsTransactions)
      .values({
        userId: reviewerId,
        contributionId: contribution.id,
        points: reviewAward,
        reason: "REVIEW_COMPLETED",
        moduleType: contribution.moduleType,
        idempotencyKey: `${contribution.id}:REVIEWER_${reviewerId}`,
      })
      .onConflictDoNothing();

    let contributorPointsAwarded = 0;
    let levelChange: { oldLevel: Level; newLevel: Level } | null = null;

    if (data.decision === "valid") {
      // 10a. Verified bonus for this module.
      const verifiedBonus = await readConfigValue(tx, VERIFIED_BONUS_CONFIG_KEY[contribution.moduleType]);
      contributorPointsAwarded = verifiedBonus;

      // 10b. Contributor points, idempotent per contribution.
      await tx
        .insert(pointsTransactions)
        .values({
          userId: contribution.userId,
          contributionId: contribution.id,
          points: verifiedBonus,
          reason: "CONTRIBUTION_VERIFIED",
          moduleType: contribution.moduleType,
          idempotencyKey: `${contribution.id}:VERIFIED`,
        })
        .onConflictDoNothing();

      // 10c. Contributor stats: verified/pending counters, per-module
      // counter, total_points, and level.
      const [contributorStats] = await tx
        .select({ verifiedContributions: userStats.verifiedContributions, level: userStats.level })
        .from(userStats)
        .where(eq(userStats.userId, contribution.userId))
        .limit(1);

      if (!contributorStats) {
        throw new HttpError(500, "STATS_MISSING", "user_stats row not found for contributor");
      }

      const newVerifiedContributions = contributorStats.verifiedContributions + 1;
      const oldLevel = contributorStats.level;
      const newLevel = levelForVerifiedCount(newVerifiedContributions);

      const moduleCounterUpdate =
        contribution.moduleType === "WORD"
          ? { verifiedWords: sql`${userStats.verifiedWords} + 1` }
          : contribution.moduleType === "TRANSCRIPTION"
            ? { verifiedAudios: sql`${userStats.verifiedAudios} + 1` }
            : contribution.moduleType === "TRANSLATION"
              ? { verifiedTranslations: sql`${userStats.verifiedTranslations} + 1` }
              : { verifiedScenes: sql`${userStats.verifiedScenes} + 1` };

      await tx
        .update(userStats)
        .set({
          verifiedContributions: sql`${userStats.verifiedContributions} + 1`,
          pendingContributions: sql`${userStats.pendingContributions} - 1`,
          totalPoints: sql`${userStats.totalPoints} + ${verifiedBonus}`,
          level: newLevel,
          updatedAt: new Date(),
          ...moduleCounterUpdate,
        })
        .where(eq(userStats.userId, contribution.userId));

      // 10d. Notify on level change.
      if (newLevel !== oldLevel) {
        levelChange = { oldLevel, newLevel };
        await tx.insert(notifications).values({
          userId: contribution.userId,
          channel: "in_app",
          notificationType: "LEVEL_UP",
          title: `You reached ${newLevel} level!`,
          body: `Congratulations -- your verified contributions moved you from ${oldLevel} to ${newLevel}.`,
          data: { oldLevel, newLevel },
        });
      }
    }

    // 11. Audit trail.
    await tx.insert(auditLogs).values({
      actorId: reviewerId,
      actorRole: reviewer?.role ?? null,
      action: "contribution_review",
      resourceType: "contribution",
      resourceId: contribution.id,
      beforeState: { status: statusBefore },
      afterState: { status: statusAfter, decision: data.decision },
    });

    return {
      reviewId: review.id,
      decision: data.decision,
      contributorPointsAwarded,
      newStatus: statusAfter,
      levelChange,
    };
  });

  // Push notifications are best-effort external I/O -- sent after the
  // transaction has committed, never inside it (so a Firebase hiccup can't
  // hold the transaction open or roll back an otherwise-successful review),
  // and swallowed on failure so a notification problem never fails the
  // review itself.
  if (result.decision === "valid") {
    try {
      await sendContributionVerifiedNotification(contribution.userId, contribution.moduleType, result.contributorPointsAwarded);
    } catch (err) {
      console.error("[reviews] sendContributionVerifiedNotification failed:", err);
    }

    if (result.levelChange) {
      try {
        await sendLevelUpNotification(contribution.userId, result.levelChange.newLevel);
      } catch (err) {
        console.error("[reviews] sendLevelUpNotification failed:", err);
      }
    }
  }

  const { levelChange: _levelChange, ...response } = result;
  return response;
}
