import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  auditLogs,
  audioUploads,
  conceptMedia,
  contributionModule,
  contributions,
  contributorDemographics,
  gamificationConfig,
  languages,
  pointsTransactions,
  reviews,
  scenes,
  sceneContributions,
  sceneMedia,
  sentences,
  transcriptions,
  translations,
  userRole,
  userStats,
  users,
  wordRecordings,
} from "../../db/schema.js";
import { sendContributionVerifiedNotification } from "../notifications/push.service.js";
import { HttpError } from "../../utils/http-error.js";

type Module = (typeof contributionModule.enumValues)[number];
type Decision = "valid" | "needs_correction" | "invalid";
type Role = (typeof userRole.enumValues)[number];

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

async function getDemographics(userId: string): Promise<{ tribeId: string; city: string } | null> {
  const [row] = await db
    .select({ tribeId: contributorDemographics.tribeId, city: contributorDemographics.city })
    .from(contributorDemographics)
    .where(eq(contributorDemographics.userId, userId))
    .limit(1);

  return row ?? null;
}

export async function getQueue(reviewerId: string, reviewerRole: Role, moduleType?: Module) {
  const conditions = [eq(contributions.status, "pending"), ne(contributions.userId, reviewerId), isNull(contributions.deletedAt)];
  if (moduleType) {
    conditions.push(eq(contributions.moduleType, moduleType));
  }

  // Peer review is scoped to the reviewer's own tribe + city -- admins and
  // super_admins are moderators rather than peers, and keep the old
  // unrestricted queue (mirrors requireReviewerEligibility's level-gating
  // exemption for those roles).
  if (reviewerRole === "contributor") {
    const reviewerDemo = await getDemographics(reviewerId);
    if (!reviewerDemo) {
      // No tribe/city on file -- nothing can match, so there's nothing to review.
      return [];
    }
    conditions.push(
      eq(contributorDemographics.tribeId, reviewerDemo.tribeId),
      eq(contributorDemographics.city, reviewerDemo.city),
    );
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
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, contributions.userId))
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

export async function submitReview(reviewerId: string, reviewerRole: Role, data: SubmitReviewInput) {
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

  // 2b. CRITICAL: tribe + city guard. The queue already filters to matches,
  // but that's only a hint -- this is the authoritative check, since a
  // client could POST any contributionId directly. Admins/super_admins are
  // moderators, not peers, and are exempt (mirrors the queue's exemption).
  if (reviewerRole === "contributor") {
    const [reviewerDemo, submitterDemo] = await Promise.all([
      getDemographics(reviewerId),
      getDemographics(contribution.userId),
    ]);
    if (
      !reviewerDemo ||
      !submitterDemo ||
      reviewerDemo.tribeId !== submitterDemo.tribeId ||
      reviewerDemo.city !== submitterDemo.city
    ) {
      throw new HttpError(403, "TRIBE_CITY_MISMATCH", "You can only review contributions from your own tribe and city");
    }
  }

  // 3. Must still be pending.
  if (contribution.status !== "pending") {
    throw new HttpError(409, "CONTRIBUTION_NOT_PENDING", `Contribution status is '${contribution.status}', not 'pending'`);
  }

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
      // counter, and total_points. Level is NOT recalculated here -- it
      // depends on total contribution count (set at submission time in
      // each module's submit service), not verified count, so verifying a
      // contribution doesn't move it.
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
          updatedAt: new Date(),
          ...moduleCounterUpdate,
        })
        .where(eq(userStats.userId, contribution.userId));
    }

    // 11. Audit trail.
    await tx.insert(auditLogs).values({
      actorId: reviewerId,
      actorRole: reviewerRole,
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
  }

  return result;
}
