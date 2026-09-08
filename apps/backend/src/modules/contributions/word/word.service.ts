import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import { audioFiles, contributions, gamificationConfig, pointsTransactions, streaks, userStats, wordRecordings } from "../../../db/schema.js";
import { insertLevelUpNotificationIfChanged, levelUpdateExpr } from "../../../services/level.service.js";
import { storageService } from "../../../services/storage.service.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { sendLevelUpNotification } from "../../notifications/push.service.js";
import { HttpError } from "../../../utils/http-error.js";

type SynonymIndex = 1 | 2 | 3;

export type RecordedSynonyms = Record<SynonymIndex, boolean>;

export type SubmitWordRecordingInput = {
  audioFileId: string;
  conceptId: string;
  languageId: string;
  dialectId?: string | null;
  nativeWord?: string | null;
  romanization?: string | null;
  ipa?: string | null;
  synonymIndex: number;
  durationMs: number;
  deviceId?: string | null;
  appVersion?: string | null;
  clientType?: string | null;
  sourceBufferId?: string | null;
};

export type SubmitWordRecordingResult = {
  contributionId: string;
  wordRecordingId: string;
  pointsAwarded: number;
  userLevel: string | null;
  currentStreak: number;
};

/** Which of the 3 synonym slots already have a recording -- there is no take limit, just this yes/no per slot. */
export async function getRecordedSynonyms(userId: string, conceptId: string): Promise<RecordedSynonyms> {
  const rows = await db
    .select({ synonymIndex: wordRecordings.synonymIndex })
    .from(wordRecordings)
    .where(and(eq(wordRecordings.userId, userId), eq(wordRecordings.conceptId, conceptId), isNull(wordRecordings.deletedAt)));

  const recorded: RecordedSynonyms = { 1: false, 2: false, 3: false };
  for (const row of rows) recorded[row.synonymIndex as SynonymIndex] = true;
  return recorded;
}

export async function submitWordRecording(userId: string, data: SubmitWordRecordingInput): Promise<SubmitWordRecordingResult> {
  const { synonymIndex, durationMs } = data;

  if (![1, 2, 3].includes(synonymIndex)) {
    throw new HttpError(400, "INVALID_SYNONYM_INDEX", "synonymIndex must be 1, 2 or 3");
  }

  // Second duration enforcement layer (first is Zod at the route; the DB
  // CHECK constraint ck_word_recording_max_duration is the third and last).
  if (durationMs > 5000) {
    throw new HttpError(
      400,
      "DURATION_LIMIT_EXCEEDED",
      "Word recordings cannot exceed 5 seconds. This is the second enforcement layer.",
    );
  }

  // There is no take limit -- recording the same synonym again overrides
  // whatever's already there (in the DB and in R2) instead of being capped
  // or creating a second row. uq_word_recordings_user_concept_synonym is
  // what guarantees at most one live row per user+concept+synonym.
  const [existing] = await db
    .select({ id: wordRecordings.id, audioFileId: wordRecordings.audioFileId, contributionId: wordRecordings.contributionId })
    .from(wordRecordings)
    .where(
      and(
        eq(wordRecordings.userId, userId),
        eq(wordRecordings.conceptId, data.conceptId),
        eq(wordRecordings.synonymIndex, synonymIndex),
        isNull(wordRecordings.deletedAt),
      ),
    )
    .limit(1);

  if (existing && existing.contributionId) {
    return overrideWordRecording(userId, existing as { id: string; audioFileId: string; contributionId: string }, data);
  }

  const [[config], [levelRow]] = await Promise.all([
    db
      .select({ configValue: gamificationConfig.configValue })
      .from(gamificationConfig)
      .where(and(eq(gamificationConfig.configKey, "points.word.base"), eq(gamificationConfig.isActive, true)))
      .limit(1),
    db.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1),
  ]);

  if (!config) {
    throw new HttpError(500, "CONFIG_MISSING", "points.word.base is not configured");
  }
  const basePoints = (config.configValue as { value: number }).value;
  const userLevel = levelRow?.level ?? "BRONZE";

  const result = await db.transaction(async (tx) => {
    // 1. Insert word_recordings (the DB CHECK constraint is the 3rd layer).
    const [wordRecording] = await tx
      .insert(wordRecordings)
      .values({
        userId,
        conceptId: data.conceptId,
        audioFileId: data.audioFileId,
        nativeWord: data.nativeWord ?? null,
        romanization: data.romanization ?? null,
        ipa: data.ipa ?? null,
        synonymIndex,
        durationMs,
      })
      .returning({ id: wordRecordings.id });

    if (!wordRecording) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create word recording");
    }

    // 2. Insert contributions.
    const [contribution] = await tx
      .insert(contributions)
      .values({
        userId,
        moduleType: "WORD",
        languageId: data.languageId,
        dialectId: data.dialectId ?? null,
        status: "pending",
        wordRecordingId: wordRecording.id,
        deviceId: data.deviceId ?? null,
        appVersion: data.appVersion ?? null,
        clientType: data.clientType ?? null,
        sourceBufferId: data.sourceBufferId ?? null,
      })
      .returning({ id: contributions.id });

    if (!contribution) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create contribution");
    }

    // 3. Point word_recordings back at its contribution.
    await tx
      .update(wordRecordings)
      .set({ contributionId: contribution.id, updatedAt: new Date() })
      .where(eq(wordRecordings.id, wordRecording.id));

    // 4, 5, 6: the points ledger insert, user_stats counters, and streak
    // bookkeeping are all independent of each other (none reads a value the
    // others write) -- issued together instead of as three sequential round
    // trips. postgres.js pipelines queries issued this way on one
    // connection, so this genuinely overlaps their network latency instead
    // of just reordering it.
    const [, [updatedStats], { currentStreak }] = await Promise.all([
      tx
        .insert(pointsTransactions)
        .values({
          userId,
          contributionId: contribution.id,
          points: basePoints,
          reason: "WORD_SUBMITTED",
          moduleType: "WORD",
          idempotencyKey: `${contribution.id}:WORD_SUBMITTED`,
        })
        .onConflictDoNothing(),
      tx
        .update(userStats)
        .set({
          totalContributions: sql`${userStats.totalContributions} + 1`,
          wordContributions: sql`${userStats.wordContributions} + 1`,
          pendingContributions: sql`${userStats.pendingContributions} + 1`,
          totalPoints: sql`${userStats.totalPoints} + ${basePoints}`,
          level: levelUpdateExpr(1),
          lastContributionAt: new Date(),
          lastContributionModule: "WORD",
          updatedAt: new Date(),
        })
        .where(eq(userStats.userId, userId))
        .returning({ level: userStats.level }),
      updateStreakOnContribution(tx, userId),
    ]);

    if (!updatedStats) {
      throw new HttpError(500, "STATS_MISSING", "user_stats row not found for user");
    }

    await insertLevelUpNotificationIfChanged(tx, userId, userLevel, updatedStats.level);

    return {
      contributionId: contribution.id,
      wordRecordingId: wordRecording.id,
      pointsAwarded: basePoints,
      userLevel: updatedStats.level,
      currentStreak,
    };
  });

  // Push notification is best-effort external I/O -- sent after the
  // transaction has committed, never inside it, and swallowed on failure so
  // a notification problem never fails the submission itself.
  if (result.userLevel !== userLevel) {
    try {
      await sendLevelUpNotification(userId, result.userLevel);
    } catch (err) {
      console.error("[word] sendLevelUpNotification failed:", err);
    }
  }

  return result;
}

/**
 * Re-recording a synonym that already has a live word_recording: replaces
 * its audio (in R2 and in the row) and puts the contribution back to
 * "pending" for re-review, but does NOT award points or bump user_stats
 * again -- those were already credited the first time this synonym was
 * recorded, and re-crediting on every retake would make the "no take limit"
 * change a free-points exploit.
 */
async function overrideWordRecording(
  userId: string,
  existing: { id: string; audioFileId: string; contributionId: string },
  data: SubmitWordRecordingInput,
): Promise<SubmitWordRecordingResult> {
  const [[levelRow], [streakRow]] = await Promise.all([
    db.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1),
    db.select({ currentStreak: streaks.currentStreak }).from(streaks).where(eq(streaks.userId, userId)).limit(1),
  ]);
  const userLevel = levelRow?.level ?? null;
  const currentStreak = streakRow?.currentStreak ?? 0;

  // Idempotent short-circuit: a buffer-worker retry after a crash resolves
  // to the SAME audioFileId (resolveAudioFileId persists it), so if it's
  // already applied there's nothing left to do -- re-running the override
  // below would delete the audio file it just finished setting.
  if (existing.audioFileId === data.audioFileId) {
    return { contributionId: existing.contributionId, wordRecordingId: existing.id, pointsAwarded: 0, userLevel, currentStreak };
  }

  const oldAudioFileId = existing.audioFileId;
  const [oldAudio] = await db.select({ storageKey: audioFiles.storageKey }).from(audioFiles).where(eq(audioFiles.id, oldAudioFileId)).limit(1);

  await db.transaction(async (tx) => {
    await tx
      .update(wordRecordings)
      .set({
        audioFileId: data.audioFileId,
        nativeWord: data.nativeWord ?? null,
        romanization: data.romanization ?? null,
        ipa: data.ipa ?? null,
        durationMs: data.durationMs,
        updatedAt: new Date(),
      })
      .where(eq(wordRecordings.id, existing.id));

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

    if (oldAudio) {
      // Not a hard delete: pending_submissions.resolvedAudioFileId from the
      // original submission still references this row (kept for that
      // buffer row's own audit trail), so deleting it here would fail the
      // whole override on an FK violation. Quarantining leaves the row (and
      // that reference) intact while making clear the file itself is gone.
      await tx
        .update(audioFiles)
        .set({ processingStatus: "quarantined", processingError: "Superseded by a newer recording for this word/synonym" })
        .where(eq(audioFiles.id, oldAudioFileId));
    }
  });

  if (oldAudio) {
    await storageService.deleteAudioFile(oldAudio.storageKey);
  }

  return { contributionId: existing.contributionId, wordRecordingId: existing.id, pointsAwarded: 0, userLevel, currentStreak };
}
