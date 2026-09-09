import { asc, db, eq, inArray, sql } from "../db/index.js";
import { contributions, pendingSubmissions, pointsTransactions } from "../db/schema.js";
import { storeAudioBuffer } from "./audio-file.service.js";
import { submitWordRecording, type SubmitWordRecordingInput } from "../modules/contributions/word/word.service.js";
import { submitTranslation, type SubmitTranslationInput } from "../modules/contributions/translation/translation.service.js";
import {
  addSegment,
  addTranscription,
  submitAudioUpload,
  type AddSegmentInput,
  type AddTranscriptionInput,
  type SubmitAudioUploadInput,
} from "../modules/contributions/audio/audio-upload.service.js";
import { submitSceneContribution, type SubmitSceneContributionInput } from "../modules/contributions/scene/scene.service.js";

type ModuleType = (typeof pendingSubmissions.$inferSelect)["moduleType"];
type PendingRow = typeof pendingSubmissions.$inferSelect;

type WordPayload = Omit<SubmitWordRecordingInput, "audioFileId" | "durationMs">;
type TranslationPayload = Omit<SubmitTranslationInput, "audioFileId"> & { sentenceId: string };
type AudioUploadPayload = Omit<SubmitAudioUploadInput, "audioFileId"> & {
  transcription?: AddTranscriptionInput;
  segments?: Omit<AddSegmentInput, "segmentIndex">[];
};
type ScenePayload = Omit<SubmitSceneContributionInput, "audioFileId" | "durationMs"> & { sceneId: string };

// Bounded so a permanently-broken row (bad config, corrupt data) doesn't spin
// forever -- after this many failed attempts it's left in "failed" for a
// human to look at instead of being retried again.
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 5;
const POLL_INTERVAL_MS = 3000;

let isProcessing = false;

/**
 * Buffers a submission's audio directly in the pending_submissions row (as
 * bytea, not on local disk -- a local-disk staging path was tried first, but
 * Railway's container filesystem is wiped on every redeploy, which failed
 * real in-flight submissions during active development. The DB row is
 * durable across redeploys, so this is what makes the buffer actually
 * survive one) and enqueues it, returning immediately -- the caller doesn't
 * wait on the R2 upload or the module's DB transaction. audio is omitted for
 * the rare no-audio case (a translation with no recording is no longer
 * possible since audio became required there, but the type stays permissive
 * for future modules that might not need it).
 */
export async function enqueueSubmission(params: {
  userId: string;
  moduleType: ModuleType;
  payload: WordPayload | TranslationPayload | AudioUploadPayload | ScenePayload;
  audio?: { buffer: Buffer; mimeType: string; filename: string; durationMs: number } | null;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(pendingSubmissions)
    .values({
      userId: params.userId,
      moduleType: params.moduleType,
      payload: params.payload,
      audioBuffer: params.audio?.buffer ?? null,
      audioMimeType: params.audio?.mimeType ?? null,
      audioFilename: params.audio?.filename ?? null,
      audioDurationMs: params.audio?.durationMs != null ? Math.round(params.audio.durationMs) : null,
    })
    .returning({ id: pendingSubmissions.id });

  if (!row) {
    throw new Error("Failed to buffer submission");
  }

  // Fire-and-forget: don't make the caller wait for this. The poll loop
  // below is the safety net if this particular kick is skipped (already
  // processing) or the process restarts before it runs.
  kickProcessor();

  return { id: row.id };
}

export function kickProcessor(): void {
  processPendingSubmissions().catch((err) => {
    console.error("[submission-buffer] processing pass failed", err);
  });
}

/** Called once at server boot: recovers rows stuck "processing" from a crash/restart, and starts the poll loop. */
export function startSubmissionBufferWorker(): void {
  db.update(pendingSubmissions)
    .set({ status: "pending", updatedAt: new Date() })
    .where(eq(pendingSubmissions.status, "processing"))
    .then(() => kickProcessor())
    .catch((err) => console.error("[submission-buffer] startup recovery failed", err));

  setInterval(kickProcessor, POLL_INTERVAL_MS);
}

async function processPendingSubmissions(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    // Single-process claim: safe because this Node process is the only
    // writer (Railway runs one backend instance). A multi-instance
    // deployment would need a `FOR UPDATE SKIP LOCKED` claim instead.
    const rows = await db
      .select()
      .from(pendingSubmissions)
      .where(eq(pendingSubmissions.status, "pending"))
      .orderBy(asc(pendingSubmissions.createdAt))
      .limit(BATCH_SIZE);

    if (rows.length === 0) return;

    await db
      .update(pendingSubmissions)
      .set({ status: "processing", updatedAt: new Date() })
      .where(inArray(pendingSubmissions.id, rows.map((r) => r.id)));

    for (const row of rows) {
      await processOne(row);
    }
  } finally {
    isProcessing = false;
  }
}

async function processOne(row: PendingRow): Promise<void> {
  try {
    const audioFileId = await resolveAudioFileId(row);

    // A retry (after a crash/restart between the submit call committing and
    // this row being marked "done" below) must not resubmit -- that would
    // create a second contribution and double-award points. sourceBufferId
    // is the unique anchor that lets a retry detect "already happened" and
    // just finalize instead.
    const already = await findContributionForBuffer(row.id);
    if (already) {
      await markDone(row.id, already);
      return;
    }

    let result: { contributionId: string; pointsAwarded: number };
    switch (row.moduleType) {
      case "WORD": {
        const p = row.payload as WordPayload;
        if (!audioFileId || row.audioDurationMs == null) throw new Error("WORD submission missing audio");
        const r = await submitWordRecording(row.userId, {
          ...p,
          audioFileId,
          durationMs: row.audioDurationMs,
          sourceBufferId: row.id,
        });
        result = { contributionId: r.contributionId, pointsAwarded: r.pointsAwarded };
        break;
      }
      case "TRANSLATION": {
        const { sentenceId, ...rest } = row.payload as TranslationPayload;
        if (!audioFileId) throw new Error("TRANSLATION submission missing audio");
        const r = await submitTranslation(row.userId, sentenceId, { ...rest, audioFileId, sourceBufferId: row.id });
        result = { contributionId: r.contributionId, pointsAwarded: r.pointsAwarded };
        break;
      }
      case "TRANSCRIPTION": {
        const { transcription, segments, ...rest } = row.payload as AudioUploadPayload;
        if (!audioFileId) throw new Error("TRANSCRIPTION submission missing audio");
        const r = await submitAudioUpload(row.userId, { ...rest, audioFileId, sourceBufferId: row.id });
        let total = r.pointsAwarded;

        const [transcriptionResult, segmentResults] = await Promise.all([
          transcription ? addTranscription(row.userId, r.audioUploadId, transcription) : Promise.resolve(null),
          segments?.length
            ? Promise.all(
                segments.map((s, i) => addSegment(row.userId, r.audioUploadId, { ...s, segmentIndex: i })),
              )
            : Promise.resolve([]),
        ]);

        if (transcriptionResult) total += transcriptionResult.pointsAwarded ?? 0;
        for (const sr of segmentResults) total += sr.pointsAwarded ?? 0;

        result = { contributionId: r.contributionId, pointsAwarded: total };
        break;
      }
      case "SCENE": {
        const { sceneId, ...rest } = row.payload as ScenePayload;
        if (!audioFileId || row.audioDurationMs == null) throw new Error("SCENE submission missing audio");
        const r = await submitSceneContribution(row.userId, sceneId, {
          ...rest,
          audioFileId,
          durationMs: row.audioDurationMs,
          sourceBufferId: row.id,
        });
        result = { contributionId: r.contributionId, pointsAwarded: r.pointsAwarded };
        break;
      }
    }

    await markDone(row.id, result);
  } catch (err) {
    const attempts = row.attempts + 1;
    // DrizzleQueryError's own .message is just the failed SQL + params --
    // the actual reason (e.g. a Postgres error code/detail) lives in .cause.
    // Surfacing that here is what made a real bug (see levelUpdateExpr's
    // missing enum cast) diagnosable instead of just "Failed query: ...".
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    const message = err instanceof Error ? `${err.message}${cause}` : "Unknown error";
    const isPermanent = err instanceof PermanentFailure;
    await db
      .update(pendingSubmissions)
      .set({
        status: isPermanent || attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts,
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(pendingSubmissions.id, row.id));
  }
}

async function markDone(bufferId: string, result: { contributionId: string; pointsAwarded: number }): Promise<void> {
  await db
    .update(pendingSubmissions)
    .set({
      status: "done",
      contributionId: result.contributionId,
      pointsAwarded: result.pointsAwarded,
      updatedAt: new Date(),
    })
    .where(eq(pendingSubmissions.id, bufferId));
}

async function findContributionForBuffer(
  bufferId: string,
): Promise<{ contributionId: string; pointsAwarded: number } | null> {
  const [contribution] = await db
    .select({ id: contributions.id })
    .from(contributions)
    .where(eq(contributions.sourceBufferId, bufferId))
    .limit(1);

  if (!contribution) return null;

  const [totals] = await db
    .select({ total: sql<number>`coalesce(sum(${pointsTransactions.points}), 0)`.mapWith(Number) })
    .from(pointsTransactions)
    .where(eq(pointsTransactions.contributionId, contribution.id));

  return { contributionId: contribution.id, pointsAwarded: totals?.total ?? 0 };
}

/**
 * Idempotent: returns the already-resolved audioFileId on a retry instead of
 * re-uploading (which would orphan the previous R2 object). The audio bytes
 * live in this same row (audioBuffer), so unlike the earlier local-disk
 * design there's nothing external that can go missing between the submit
 * call and this running -- a redeploy in that window just means the worker
 * picks the row back up (via the "processing" -> "pending" reset at startup)
 * and finishes it from the same buffered bytes.
 */
async function resolveAudioFileId(row: PendingRow): Promise<string | null> {
  if (row.resolvedAudioFileId) return row.resolvedAudioFileId;
  if (!row.audioBuffer || !row.audioMimeType || !row.audioFilename) return null;

  const { audioFileId } = await storeAudioBuffer({
    userId: row.userId,
    module: row.moduleType,
    buffer: row.audioBuffer,
    filename: row.audioFilename,
    mimeType: row.audioMimeType,
    durationMs: row.audioDurationMs ?? 0,
  });

  await db
    .update(pendingSubmissions)
    .set({ resolvedAudioFileId: audioFileId, audioBuffer: null, updatedAt: new Date() })
    .where(eq(pendingSubmissions.id, row.id));

  return audioFileId;
}

/** Thrown for errors where retrying can't possibly help -- skips straight to "failed" instead of burning MAX_ATTEMPTS retries. */
class PermanentFailure extends Error {}
