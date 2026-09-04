import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import {
  audioUploads,
  contributions,
  gamificationConfig,
  pointsTransactions,
  transcriptionSegments,
  transcriptions,
  userStats,
} from "../../../db/schema.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { HttpError } from "../../../utils/http-error.js";

// Module 2 audio uploads carry NO 3-second limit anywhere in this file.
// Audio can be any duration -- seconds or hours.

export type SubmitAudioUploadInput = {
  audioFileId: string;
  languageId: string;
  dialectId?: string | null;
  title: string;
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
};

export type AddTranscriptionInput = {
  nativeText?: string | null;
  romanization?: string | null;
  ipa?: string | null;
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
    })
    .from(audioUploads)
    .innerJoin(contributions, eq(contributions.id, audioUploads.contributionId))
    .where(and(eq(audioUploads.id, audioUploadId), eq(contributions.userId, userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Audio upload not found");
  }

  return row;
}

export async function submitAudioUpload(userId: string, data: SubmitAudioUploadInput) {
  return db.transaction(async (tx) => {
    // 1. Insert audio_uploads.
    const [audioUpload] = await tx
      .insert(audioUploads)
      .values({
        audioFileId: data.audioFileId,
        title: data.title,
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

    // 5. Points ledger, idempotent by construction.
    await tx
      .insert(pointsTransactions)
      .values({
        userId,
        contributionId: contribution.id,
        points: basePoints,
        reason: "AUDIO_UPLOADED",
        moduleType: "TRANSCRIPTION",
        idempotencyKey: `${contribution.id}:AUDIO_UPLOADED`,
      })
      .onConflictDoNothing();

    // 6. user_stats counters. (Spec lists only these two counters here --
    // unlike word.service's submitWordRecording, there is no explicit step
    // incrementing user_stats.totalPoints for audio uploads or for
    // addTranscription/addSegment below; see the module-level note.)
    await tx
      .update(userStats)
      .set({
        totalContributions: sql`${userStats.totalContributions} + 1`,
        audioContributions: sql`${userStats.audioContributions} + 1`,
        pendingContributions: sql`${userStats.pendingContributions} + 1`,
        lastContributionAt: new Date(),
        lastContributionModule: "TRANSCRIPTION",
        updatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId));

    // 7. Streak bookkeeping.
    await updateStreakOnContribution(tx, userId);

    // 8.
    return { contributionId: contribution.id, audioUploadId: audioUpload.id, pointsAwarded: basePoints };
  });
}

export async function addTranscription(userId: string, audioUploadId: string, data: AddTranscriptionInput) {
  const { contributionId } = await getOwnedAudioUpload(userId, audioUploadId);

  return db.transaction(async (tx) => {
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
        version,
        isCurrent: true,
        previousVersion: previous?.id ?? null,
      })
      .returning({ id: transcriptions.id });

    if (!transcription) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create transcription");
    }

    let pointsAwarded = 0;
    if (data.nativeText) pointsAwarded += await readConfigValue(tx, "points.audio.native_text");
    if (data.romanization) pointsAwarded += await readConfigValue(tx, "points.audio.romanization");
    if (data.ipa) pointsAwarded += await readConfigValue(tx, "points.audio.ipa");

    if (pointsAwarded > 0) {
      await tx
        .insert(pointsTransactions)
        .values({
          userId,
          contributionId,
          points: pointsAwarded,
          reason: "TRANSCRIPTION_ADDED",
          moduleType: "TRANSCRIPTION",
          idempotencyKey: `${audioUploadId}:TRANSCRIPTION_v${version}`,
        })
        .onConflictDoNothing();
    }

    return { transcriptionId: transcription.id, version, pointsAwarded };
  });
}

export async function addSegment(userId: string, audioUploadId: string, data: AddSegmentInput) {
  const { contributionId } = await getOwnedAudioUpload(userId, audioUploadId);

  // App-level check, mirroring the DB CHECK constraint
  // ck_transcription_segment_order.
  if (data.endMs <= data.startMs) {
    throw new HttpError(400, "INVALID_SEGMENT_RANGE", "endMs must be greater than startMs");
  }

  return db.transaction(async (tx) => {
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

    const pointsAwarded = await readConfigValue(tx, "points.audio.segment");

    await tx
      .insert(pointsTransactions)
      .values({
        userId,
        contributionId,
        points: pointsAwarded,
        reason: "SEGMENT_ADDED",
        moduleType: "TRANSCRIPTION",
        idempotencyKey: `${audioUploadId}:SEGMENT_${data.segmentIndex}`,
      })
      .onConflictDoNothing();

    return { segmentId: segment.id, pointsAwarded };
  });
}
