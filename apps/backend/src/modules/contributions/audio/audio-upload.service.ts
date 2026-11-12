import { and, desc, eq, like, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import {
  audioFiles,
  audioUploads,
  contributions,
  gamificationConfig,
  pointsTransactions,
  transcriptionSegments,
  transcriptions,
  userStats,
} from "../../../db/schema.js";
import { writeAuditLog } from "../../../services/audit-log.service.js";
import { insertLevelUpNotificationIfChanged, levelUpdateExpr } from "../../../services/level.service.js";
import { awardPointsOnce } from "../../../services/points.service.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { awardBadgesInBackground } from "../../gamification/gamification.service.js";
import { sendLevelUpNotification } from "../../notifications/push.service.js";
import { HttpError } from "../../../utils/http-error.js";
import { withKeyedLock } from "../../../utils/keyed-lock.js";

// Module 2 audio uploads carry NO duration limit anywhere in this file.
// Audio can be any duration -- seconds or hours.

export type SubmitAudioUploadInput = {
  audioFileId: string;
  languageId: string;
  dialectId?: string | null;
  title?: string | null;
  description?: string | null;
  recordingType: string;
  location?: string | null;
  recordedAt?: string | null;
  speakerDescription?: string | null;
  culturalContext?: string | null;
  source?: string | null;
  thirdPartyConsent?: boolean;
  deviceId?: string | null;
  appVersion?: string | null;
  clientType?: string | null;
  sourceBufferId?: string | null;
};

export type AddTranscriptionInput = {
  nativeText?: string | null;
  romanization?: string | null;
  ipa?: string | null;
  englishTranslation?: string | null;
};

export type AddSegmentInput = {
  segmentIndex: number;
  startMs: number;
  endMs: number;
  nativeText?: string | null;
  romanization?: string | null;
  ipa?: string | null;
  speakerLabel?: string | null;
};

/**
 * Time-coded segments earn points each (points.audio.segment), and there used to be no limit at
 * all on how many one upload could carry -- any new segmentIndex was a new award -- so a short clip
 * with hundreds of tiny segments was a points farm. An upload may now carry at most one segment
 * per SEGMENT_MIN_SPAN_MS of its audio (rounded up, minimum 1), and never more than
 * MAX_SEGMENTS_PER_UPLOAD whatever its length. When the duration is unknown only the hard cap applies.
 */
export const MAX_SEGMENTS_PER_UPLOAD = 300;
const SEGMENT_MIN_SPAN_MS = 500;
// A segment may run slightly past the stored duration (trimming/rounding between the client's
// measurement and the stored one); anything beyond this is not inside the recording.
const SEGMENT_END_TOLERANCE_MS = 1000;

export function maxSegmentsFor(durationMs: number | null | undefined): number {
  if (!durationMs || durationMs <= 0) return MAX_SEGMENTS_PER_UPLOAD;
  return Math.min(MAX_SEGMENTS_PER_UPLOAD, Math.max(1, Math.ceil(durationMs / SEGMENT_MIN_SPAN_MS)));
}

/** The furthest a segment may end for an audio file of this length, or null when the length is unknown. */
export function maxSegmentEndMs(durationMs: number | null | undefined): number | null {
  if (!durationMs || durationMs <= 0) return null;
  return durationMs + Math.max(SEGMENT_END_TOLERANCE_MS, Math.round(durationMs * 0.1));
}

const hasText = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

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

/** Resolves an audio_uploads row and confirms it belongs to userId via its contribution. */
async function getOwnedAudioUpload(userId: string, audioUploadId: string) {
  const [row] = await db
    .select({
      id: audioUploads.id,
      contributionId: audioUploads.contributionId,
      contributionUserId: contributions.userId,
      audioDurationMs: audioFiles.durationMs,
    })
    .from(audioUploads)
    .innerJoin(contributions, eq(contributions.id, audioUploads.contributionId))
    .innerJoin(audioFiles, eq(audioFiles.id, audioUploads.audioFileId))
    .where(and(eq(audioUploads.id, audioUploadId), eq(contributions.userId, userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Audio upload not found");
  }

  return row;
}

export async function submitAudioUpload(userId: string, data: SubmitAudioUploadInput) {
  const [levelRow] = await db.select({ level: userStats.level }).from(userStats).where(eq(userStats.userId, userId)).limit(1);
  const previousLevel = levelRow?.level ?? "BRONZE";

  const result = await db.transaction(async (tx) => {
    // 1. Insert audio_uploads.
    const [audioUpload] = await tx
      .insert(audioUploads)
      .values({
        audioFileId: data.audioFileId,
        title: data.title?.trim() || null,
        description: data.description ?? null,
        recordingType: data.recordingType,
        location: data.location ?? null,
        recordedAt: data.recordedAt ?? null,
        speakerDescription: data.speakerDescription ?? null,
        culturalContext: data.culturalContext ?? null,
        source: data.source ?? null,
        thirdPartyConsent: data.thirdPartyConsent ?? false,
      })
      .returning({ id: audioUploads.id });

    if (!audioUpload) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create audio upload");
    }

    // 2. Insert contributions.
    const [contribution] = await tx
      .insert(contributions)
      .values({
        userId,
        moduleType: "TRANSCRIPTION",
        languageId: data.languageId,
        dialectId: data.dialectId ?? null,
        status: "pending",
        audioUploadId: audioUpload.id,
        deviceId: data.deviceId ?? null,
        appVersion: data.appVersion ?? null,
        clientType: data.clientType ?? null,
        sourceBufferId: data.sourceBufferId ?? null,
      })
      .returning({ id: contributions.id });

    if (!contribution) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create contribution");
    }

    // 3. Point audio_uploads back at its contribution.
    await tx
      .update(audioUploads)
      .set({ contributionId: contribution.id, updatedAt: new Date() })
      .where(eq(audioUploads.id, audioUpload.id));

    // 4. Read points.audio.upload from gamification_config.
    const basePoints = await readConfigValue(tx, "points.audio.upload");

    // 5, 6, 7: independent of each other (none reads a value the others
    // write), so issued together instead of as three sequential round
    // trips -- postgres.js pipelines queries sent this way on one
    // connection. total_points is incremented inline (the contribution id is
    // brand new, so the ledger insert can't conflict); addTranscription and
    // addSegment below go through awardPointsOnce, which keeps the ledger and
    // total_points in step. Both were previously missing.
    // Resolved before the batch below -- see word.service.ts's identical comment.
    const levelExpr = await levelUpdateExpr(1);

    const [, [updatedStats]] = await Promise.all([
      tx
        .insert(pointsTransactions)
        .values({
          userId,
          contributionId: contribution.id,
          points: basePoints,
          reason: "AUDIO_UPLOADED",
          moduleType: "TRANSCRIPTION",
          idempotencyKey: `${contribution.id}:AUDIO_UPLOADED`,
        })
        .onConflictDoNothing(),
      tx
        .update(userStats)
        .set({
          totalContributions: sql`${userStats.totalContributions} + 1`,
          audioContributions: sql`${userStats.audioContributions} + 1`,
          pendingContributions: sql`${userStats.pendingContributions} + 1`,
          totalPoints: sql`${userStats.totalPoints} + ${basePoints}`,
          level: levelExpr,
          lastContributionAt: new Date(),
          lastContributionModule: "TRANSCRIPTION",
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

    return { contributionId: contribution.id, audioUploadId: audioUpload.id, pointsAwarded: basePoints, newLevel: updatedStats.level };
  });

  // Push notification is best-effort external I/O -- sent after the
  // transaction has committed, never inside it, and swallowed on failure so
  // a notification problem never fails the submission itself.
  if (result.newLevel !== previousLevel) {
    try {
      await sendLevelUpNotification(userId, result.newLevel);
    } catch (err) {
      console.error("[audio-upload] sendLevelUpNotification failed:", err);
    }
  }

  awardBadgesInBackground(userId);

  await writeAuditLog({
    actorId: userId,
    actorRole: null,
    action: "contribution_submitted",
    resourceType: "contribution",
    resourceId: result.contributionId,
    afterState: { moduleType: "TRANSCRIPTION" },
  });

  return { contributionId: result.contributionId, audioUploadId: result.audioUploadId, pointsAwarded: result.pointsAwarded };
}

export async function addTranscription(userId: string, audioUploadId: string, data: AddTranscriptionInput) {
  const { contributionId } = await getOwnedAudioUpload(userId, audioUploadId);

  // Serialized per upload: the version number and the "already awarded" total below are both read
  // before they are written, so two overlapping requests must not interleave.
  return withKeyedLock(`transcription:${audioUploadId}`, () =>
    db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ id: transcriptions.id, version: transcriptions.version })
        .from(transcriptions)
        .where(eq(transcriptions.audioUploadId, audioUploadId))
        .orderBy(desc(transcriptions.version))
        .limit(1);

      // Mark existing transcriptions for this upload as no longer current.
      await tx
        .update(transcriptions)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(eq(transcriptions.audioUploadId, audioUploadId));

      const version = (previous?.version ?? 0) + 1;

      const [transcription] = await tx
        .insert(transcriptions)
        .values({
          audioUploadId,
          userId,
          nativeText: data.nativeText ?? null,
          romanization: data.romanization ?? null,
          ipa: data.ipa ?? null,
          englishTranslation: data.englishTranslation ?? null,
          version,
          isCurrent: true,
          previousVersion: previous?.id ?? null,
        })
        .returning({ id: transcriptions.id });

      if (!transcription) {
        throw new HttpError(500, "INSERT_FAILED", "Failed to create transcription");
      }

      // What this version's fields are worth in total...
      let worth = 0;
      if (hasText(data.nativeText)) worth += await readConfigValue(tx, "points.audio.native_text");
      if (hasText(data.romanization)) worth += await readConfigValue(tx, "points.audio.romanization");
      if (hasText(data.ipa)) worth += await readConfigValue(tx, "points.audio.ipa");
      if (hasText(data.englishTranslation)) worth += await readConfigValue(tx, "points.audio.translation");

      // ...minus what earlier versions of this upload already earned. Every version used to be paid
      // in full (its idempotency key is per version), so re-posting the same transcription N times
      // paid it N times. Only the part that is new -- e.g. adding the romanization to a version that
      // only had the native text -- is paid now.
      const [alreadyRow] = await tx
        .select({ total: sql<number>`coalesce(sum(${pointsTransactions.points}), 0)`.mapWith(Number) })
        .from(pointsTransactions)
        .where(and(eq(pointsTransactions.userId, userId), like(pointsTransactions.idempotencyKey, `${audioUploadId}:TRANSCRIPTION_v%`)));
      const pointsAwarded = Math.max(0, worth - (alreadyRow?.total ?? 0));

      if (pointsAwarded > 0) {
        await awardPointsOnce(tx, {
          userId,
          contributionId,
          points: pointsAwarded,
          reason: "TRANSCRIPTION_ADDED",
          moduleType: "TRANSCRIPTION",
          idempotencyKey: `${audioUploadId}:TRANSCRIPTION_v${version}`,
        });
      }

      return { transcriptionId: transcription.id, version, pointsAwarded };
    }),
  );
}

export async function addSegment(userId: string, audioUploadId: string, data: AddSegmentInput) {
  const { contributionId, audioDurationMs } = await getOwnedAudioUpload(userId, audioUploadId);

  // App-level check, mirroring the DB CHECK constraint
  // ck_transcription_segment_order.
  if (data.endMs <= data.startMs) {
    throw new HttpError(400, "INVALID_SEGMENT_RANGE", "endMs must be greater than startMs");
  }

  const latestEnd = maxSegmentEndMs(audioDurationMs);
  if (latestEnd !== null && data.endMs > latestEnd) {
    throw new HttpError(400, "SEGMENT_OUT_OF_RANGE", "That segment ends after the end of the recording");
  }

  // Serialized per upload so the count and duplicate-index checks below can't both pass for two
  // overlapping requests.
  return withKeyedLock(`segments:${audioUploadId}`, () =>
    db.transaction(async (tx) => {
      const existing = await tx
        .select({ segmentIndex: transcriptionSegments.segmentIndex })
        .from(transcriptionSegments)
        .where(eq(transcriptionSegments.audioUploadId, audioUploadId));

      if (existing.some((r) => r.segmentIndex === data.segmentIndex)) {
        throw new HttpError(409, "DUPLICATE_SEGMENT", "This upload already has a segment with that index");
      }
      const limit = maxSegmentsFor(audioDurationMs);
      if (existing.length >= limit) {
        throw new HttpError(409, "SEGMENT_LIMIT_REACHED", `This recording can have at most ${limit} segments`);
      }

      const [segment] = await tx
        .insert(transcriptionSegments)
        .values({
          audioUploadId,
          segmentIndex: data.segmentIndex,
          startMs: data.startMs,
          endMs: data.endMs,
          nativeText: data.nativeText ?? null,
          romanization: data.romanization ?? null,
          ipa: data.ipa ?? null,
          speakerLabel: data.speakerLabel ?? null,
        })
        .returning({ id: transcriptionSegments.id });

      if (!segment) {
        throw new HttpError(500, "INSERT_FAILED", "Failed to create segment");
      }

      // The bonus is "per transcribed segment": a timing-only segment (no text at all) is kept but earns nothing.
      const transcribed = hasText(data.nativeText) || hasText(data.romanization) || hasText(data.ipa);
      const pointsAwarded = transcribed ? await readConfigValue(tx, "points.audio.segment") : 0;

      if (pointsAwarded > 0) {
        await awardPointsOnce(tx, {
          userId,
          contributionId,
          points: pointsAwarded,
          reason: "SEGMENT_ADDED",
          moduleType: "TRANSCRIPTION",
          idempotencyKey: `${audioUploadId}:SEGMENT_${data.segmentIndex}`,
        });
      }

      return { segmentId: segment.id, pointsAwarded };
    }),
  );
}
