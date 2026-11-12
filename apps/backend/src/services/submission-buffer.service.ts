import { and, asc, db, eq, inArray, sql } from "../db/index.js";
import { contributions, notifications, pendingSubmissions, pointsTransactions, transcriptionSegments, transcriptions } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";
import { storeAudioBuffer } from "./audio-file.service.js";
import { writeAuditLog } from "./audit-log.service.js";
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
// Per user, counting rows still "pending" or "processing" (see the check in enqueueSubmission).
// Well above anything a person can queue by hand -- the worker drains 5 rows every 3 seconds.
const MAX_WAITING_SUBMISSIONS_PER_USER = 25;
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
  // A "Submit Again" resubmission for the exact same word/sentence/scene
  // should clear its old failed entry from My Contributions' Failed
  // Submissions block, not leave it sitting there forever alongside the new
  // attempt -- there's nothing left to act on for the old one once a fresh
  // attempt has been queued.
  await deleteStaleFailedSubmissionsForSameTarget(params.userId, params.moduleType, params.payload);

  // Each queued row holds its whole audio file in the database (up to 110 MB for a Module 2
  // upload) until the worker has uploaded it, and the request itself was read fully into
  // memory. Nothing bounded how many one user could have queued, so a script could fill the
  // database and the server's memory with unprocessed uploads. A person submitting by hand
  // never has this many waiting at once, because the worker drains the queue every few seconds.
  const [waitingRow] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(pendingSubmissions)
    .where(and(eq(pendingSubmissions.userId, params.userId), inArray(pendingSubmissions.status, ["pending", "processing"])));
  if ((waitingRow?.waiting ?? 0) >= MAX_WAITING_SUBMISSIONS_PER_USER) {
    throw new HttpError(429, "TOO_MANY_PENDING", "You already have several submissions waiting to be processed. Please wait a moment for them to finish, then try again.");
  }

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

/**
 * TRANSCRIPTION has no reusable target -- each audio upload is a fresh,
 * independent file, not a resubmission for a pre-existing word/sentence/
 * scene -- so there's nothing to match a new one against and it's skipped
 * entirely.
 */
async function deleteStaleFailedSubmissionsForSameTarget(
  userId: string,
  moduleType: ModuleType,
  payload: WordPayload | TranslationPayload | AudioUploadPayload | ScenePayload,
): Promise<void> {
  if (moduleType === "TRANSCRIPTION") return;

  const matchesSameTarget = (candidate: Record<string, unknown>): boolean => {
    if (moduleType === "WORD") {
      const p = payload as WordPayload;
      return candidate.conceptId === p.conceptId && candidate.synonymIndex === p.synonymIndex;
    }
    if (moduleType === "TRANSLATION") {
      return candidate.sentenceId === (payload as TranslationPayload).sentenceId;
    }
    return candidate.sceneId === (payload as ScenePayload).sceneId;
  };

  const failedRows = await db
    .select({ id: pendingSubmissions.id, payload: pendingSubmissions.payload })
    .from(pendingSubmissions)
    .where(and(eq(pendingSubmissions.userId, userId), eq(pendingSubmissions.moduleType, moduleType), eq(pendingSubmissions.status, "failed")));

  const staleIds = failedRows.filter((r) => matchesSameTarget(r.payload as Record<string, unknown>)).map((r) => r.id);
  if (staleIds.length > 0) {
    await db.delete(pendingSubmissions).where(inArray(pendingSubmissions.id, staleIds));
  }
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

    // Rows in a batch are independent submissions (usually from different
    // users) and processOne() fully catches and records its own failures
    // (never rejects), so there's no reason to process this small batch one
    // row at a time -- that multiplied queue-drain time by BATCH_SIZE for no
    // benefit, each row already paying its own R2 upload + DB transaction
    // cost regardless.
    await Promise.all(rows.map((row) => processOne(row)));
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
      // The contribution exists, but for a TRANSCRIPTION its transcription and segments
      // are applied in a SECOND step after the submit commits. If that step failed
      // (or the process died) the retry used to land here and mark the row done,
      // silently dropping everything the contributor typed. Finish whatever is missing.
      if (row.moduleType === "TRANSCRIPTION") {
        await completeTranscriptionExtras(row, already.contributionId);
      }
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

        // allSettled (not Promise.all): Promise.all rejects at the first failure while the
        // other writes are still in flight, so a retry seconds later could race them and
        // add a duplicate transcription. Letting every task finish first means the retry
        // (completeTranscriptionExtras) always sees a settled state.
        const tasks: Promise<{ pointsAwarded?: number }>[] = [];
        if (transcription) tasks.push(addTranscription(row.userId, r.audioUploadId, transcription));
        (segments ?? []).forEach((s, i) => tasks.push(addSegment(row.userId, r.audioUploadId, { ...s, segmentIndex: i })));
        const settled = await Promise.allSettled(tasks);
        const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
        if (failure) throw failure.reason;
        for (const s of settled) {
          if (s.status === "fulfilled") total += s.value.pointsAwarded ?? 0;
        }

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
    const isFinal = isPermanent || attempts >= MAX_ATTEMPTS;
    await db
      .update(pendingSubmissions)
      .set({
        status: isFinal ? "failed" : "pending",
        attempts,
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(pendingSubmissions.id, row.id));

    // Only notify once the row has actually given up retrying -- an
    // in-progress retry (still "pending") isn't a failure the user needs to
    // act on yet. The technical `message` above stays in errorMessage for
    // debugging; this notification gets a plain-language body instead, since
    // it's the one surfaced directly to the contributor.
    if (isFinal) {
      await db
        .insert(notifications)
        .values({
          userId: row.userId,
          channel: "in_app",
          notificationType: "SUBMISSION_FAILED",
          title: `${MODULE_LABEL[row.moduleType]} submission failed`,
          body: "Something went wrong finishing this submission. Please record and submit it again.",
          data: { pendingSubmissionId: row.id, moduleType: row.moduleType },
        })
        .catch((notifyErr) => console.error("[submission-buffer] failed to create failure notification", notifyErr));

      await writeAuditLog({
        actorId: row.userId,
        actorRole: null,
        action: "submission_failed",
        resourceType: "pending_submission",
        resourceId: row.id,
        afterState: { moduleType: row.moduleType, attempts, isPermanent },
      }).catch((logErr) => console.error("[submission-buffer] failed to write audit log", logErr));
    }
  }
}

const MODULE_LABEL: Record<ModuleType, string> = {
  WORD: "Word",
  TRANSCRIPTION: "Audio upload",
  TRANSLATION: "Translation",
  SCENE: "Scene",
};

/**
 * Idempotently applies the parts of a buffered TRANSCRIPTION that come after the
 * contribution itself: the transcription text and the time segments. Only adds what is
 * missing, so it is safe whether the first attempt applied none, some or all of it.
 * (addTranscription creates a new *version* each call and awards points per version, so
 * it must never be called blindly on a retry.)
 */
async function completeTranscriptionExtras(row: PendingRow, contributionId: string): Promise<void> {
  const [contribution] = await db
    .select({ audioUploadId: contributions.audioUploadId })
    .from(contributions)
    .where(eq(contributions.id, contributionId))
    .limit(1);
  const audioUploadId = contribution?.audioUploadId;
  if (!audioUploadId) return;

  const { transcription, segments } = row.payload as AudioUploadPayload;

  if (transcription) {
    const [existing] = await db
      .select({ id: transcriptions.id })
      .from(transcriptions)
      .where(eq(transcriptions.audioUploadId, audioUploadId))
      .limit(1);
    if (!existing) await addTranscription(row.userId, audioUploadId, transcription);
  }

  if (segments?.length) {
    const haveRows = await db
      .select({ segmentIndex: transcriptionSegments.segmentIndex })
      .from(transcriptionSegments)
      .where(eq(transcriptionSegments.audioUploadId, audioUploadId));
    const have = new Set(haveRows.map((r) => r.segmentIndex));
    const missing = segments.map((s, i) => ({ s, i })).filter(({ i }) => !have.has(i));
    const settled = await Promise.allSettled(missing.map(({ s, i }) => addSegment(row.userId, audioUploadId, { ...s, segmentIndex: i })));
    const failure = settled.find((x): x is PromiseRejectedResult => x.status === "rejected");
    if (failure) throw failure.reason;
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
