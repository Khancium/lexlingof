import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import { contributions, gamificationConfig, pointsTransactions, userStats, wordRecordings } from "../../../db/schema.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { HttpError } from "../../../utils/http-error.js";

type SynonymIndex = 1 | 2 | 3;

export type WordLimits = {
  synonymCount: number;
  takesPerSynonym: Record<SynonymIndex, number>;
  canAddSynonym: boolean;
  canAddTake: boolean;
  nextSynonymIndex: SynonymIndex | null;
  nextTakeIndex: 1 | 2 | 3 | null;
};

export type SubmitWordRecordingInput = {
  audioFileId: string;
  conceptId: string;
  languageId: string;
  dialectId?: string | null;
  nativeWord?: string | null;
  romanization?: string | null;
  ipa?: string | null;
  synonymIndex: number;
  takeIndex: number;
  durationMs: number;
  deviceId?: string | null;
  appVersion?: string | null;
  clientType?: string | null;
};

/**
 * Existing recordings for this user + concept. word_recordings has no direct
 * userId column, so ownership is resolved through its (nullable, set after
 * creation) contribution_id -> contributions.user_id.
 */
async function getExistingRecordings(userId: string, conceptId: string) {
  return db
    .select({ synonymIndex: wordRecordings.synonymIndex, takeIndex: wordRecordings.takeIndex })
    .from(wordRecordings)
    .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
    .where(
      and(
        eq(contributions.userId, userId),
        eq(wordRecordings.conceptId, conceptId),
        isNull(wordRecordings.deletedAt),
      ),
    );
}

export async function checkLimits(userId: string, conceptId: string): Promise<WordLimits> {
  const rows = await getExistingRecordings(userId, conceptId);

  const takesPerSynonym: Record<SynonymIndex, number> = { 1: 0, 2: 0, 3: 0 };
  const synonymsSeen = new Set<SynonymIndex>();

  for (const row of rows) {
    const synonymIndex = row.synonymIndex as SynonymIndex;
    synonymsSeen.add(synonymIndex);
    takesPerSynonym[synonymIndex] += 1;
  }

  const synonymCount = synonymsSeen.size;
  const canAddSynonym = synonymCount < 3;

  // "Current synonym" is the first one (in order 1, 2, 3) that doesn't yet
  // have all 3 takes -- i.e. the one a client would naturally continue
  // recording next. null means all 9 slots (3 synonyms x 3 takes) are full.
  let nextSynonymIndex: SynonymIndex | null = null;
  for (const idx of [1, 2, 3] as SynonymIndex[]) {
    if (takesPerSynonym[idx] < 3) {
      nextSynonymIndex = idx;
      break;
    }
  }

  const nextTakeIndex = nextSynonymIndex ? ((takesPerSynonym[nextSynonymIndex] + 1) as 1 | 2 | 3) : null;
  const canAddTake = nextSynonymIndex !== null;

  return { synonymCount, takesPerSynonym, canAddSynonym, canAddTake, nextSynonymIndex, nextTakeIndex };
}

export async function submitWordRecording(userId: string, data: SubmitWordRecordingInput) {
  const { synonymIndex, takeIndex, durationMs } = data;

  // 1. Layer: synonymIndex range.
  if (![1, 2, 3].includes(synonymIndex)) {
    throw new HttpError(400, "INVALID_SYNONYM_INDEX", "synonymIndex must be 1, 2 or 3");
  }

  // 2. Layer: takeIndex range.
  if (![1, 2, 3].includes(takeIndex)) {
    throw new HttpError(400, "INVALID_TAKE_INDEX", "takeIndex must be 1, 2 or 3");
  }

  // 3. Second duration enforcement layer (first is Zod at the route; the DB
  // CHECK constraint ck_word_recording_max_duration is the fourth and last).
  if (durationMs > 3000) {
    throw new HttpError(
      400,
      "DURATION_LIMIT_EXCEEDED",
      "Word recordings cannot exceed 3 seconds. This is the second enforcement layer.",
    );
  }

  // 4. Duplicate check. The DB unique index on word_recordings is keyed by
  // (contribution_id, concept_id, synonym_index, take_index) -- since every
  // submission gets its own new contribution_id, that index alone can't stop
  // the same user re-recording the same slot under a second contribution.
  const [duplicate] = await db
    .select({ id: wordRecordings.id })
    .from(wordRecordings)
    .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
    .where(
      and(
        eq(contributions.userId, userId),
        eq(wordRecordings.conceptId, data.conceptId),
        eq(wordRecordings.synonymIndex, synonymIndex),
        eq(wordRecordings.takeIndex, takeIndex),
        isNull(wordRecordings.deletedAt),
      ),
    )
    .limit(1);

  if (duplicate) {
    throw new HttpError(409, "DUPLICATE_RECORDING", "A recording already exists for this concept, synonym and take");
  }

  return db.transaction(async (tx) => {
    // 5. Insert word_recordings (the DB CHECK constraint is the 4th layer).
    const [wordRecording] = await tx
      .insert(wordRecordings)
      .values({
        conceptId: data.conceptId,
        audioFileId: data.audioFileId,
        nativeWord: data.nativeWord ?? null,
        romanization: data.romanization ?? null,
        ipa: data.ipa ?? null,
        synonymIndex,
        takeIndex,
        durationMs,
      })
      .returning({ id: wordRecordings.id });

    if (!wordRecording) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create word recording");
    }

    // 6. Insert contributions.
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
      })
      .returning({ id: contributions.id });

    if (!contribution) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create contribution");
    }

    // 7. Point word_recordings back at its contribution.
    await tx
      .update(wordRecordings)
      .set({ contributionId: contribution.id, updatedAt: new Date() })
      .where(eq(wordRecordings.id, wordRecording.id));

    // 8. Read points.word.base from gamification_config.
    const [config] = await tx
      .select({ configValue: gamificationConfig.configValue })
      .from(gamificationConfig)
      .where(and(eq(gamificationConfig.configKey, "points.word.base"), eq(gamificationConfig.isActive, true)))
      .limit(1);

    if (!config) {
      throw new HttpError(500, "CONFIG_MISSING", "points.word.base is not configured");
    }

    const basePoints = (config.configValue as { value: number }).value;

    // 9. Points ledger, idempotent by construction.
    await tx
      .insert(pointsTransactions)
      .values({
        userId,
        contributionId: contribution.id,
        points: basePoints,
        reason: "WORD_SUBMITTED",
        moduleType: "WORD",
        idempotencyKey: `${contribution.id}:WORD_SUBMITTED`,
      })
      .onConflictDoNothing();

    // 10 & 11. user_stats counters and points.
    await tx
      .update(userStats)
      .set({
        totalContributions: sql`${userStats.totalContributions} + 1`,
        wordContributions: sql`${userStats.wordContributions} + 1`,
        pendingContributions: sql`${userStats.pendingContributions} + 1`,
        totalPoints: sql`${userStats.totalPoints} + ${basePoints}`,
        lastContributionAt: new Date(),
        lastContributionModule: "WORD",
        updatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId));

    // 12. Streak bookkeeping.
    const { currentStreak } = await updateStreakOnContribution(tx, userId);

    const [level] = await tx.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1);

    // 13.
    return {
      contributionId: contribution.id,
      wordRecordingId: wordRecording.id,
      pointsAwarded: basePoints,
      userLevel: level?.level ?? null,
      currentStreak,
    };
  });
}
