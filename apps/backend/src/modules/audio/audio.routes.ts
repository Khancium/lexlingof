import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { audioFiles, audioUploads, contributionModule, contributions, sceneContributions, translations, userRole, wordRecordings } from "../../db/schema.js";
import { hasPermission, isReviewerEligible, verifyToken } from "../../middleware/auth.js";
import { storageService } from "../../services/storage.service.js";
import { measureDurationMs, trimSilence } from "../../services/audio-trim.service.js";
import {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  MIME_TYPE_TO_FORMAT,
  WORD_MAX_FILE_SIZE_BYTES,
} from "../../services/audio-file.service.js";
import { HttpError } from "../../utils/http-error.js";
import { sanitizeFilename } from "../../utils/filename.js";

type Role = (typeof userRole.enumValues)[number];

/**
 * Who may fetch a playback URL for someone else's audio file: an admin-level
 * reviewer (contributions.manage), or an eligible peer reviewer -- but only
 * while the recording's contribution is actually sitting in the review
 * queue (pending/under_review). Once a contribution is verified/rejected/
 * draft, nobody but the uploader or an admin can pull its audio anymore --
 * this is what closes the IDOR where any logged-in user could play ANY
 * audio file just by knowing its id.
 */
async function canAccessAudioFile(user: { id: string; role: Role }, audioFile: { id: string; uploadedBy: string | null }): Promise<boolean> {
  if (audioFile.uploadedBy === user.id) return true;
  if (await hasPermission(user.role, "contributions.manage")) return true;
  if (!(await isReviewerEligible(user.id, user.role))) return false;

  const [row] = await db
    .select({ id: contributions.id })
    .from(contributions)
    .leftJoin(wordRecordings, eq(wordRecordings.id, contributions.wordRecordingId))
    .leftJoin(translations, eq(translations.id, contributions.translationId))
    .leftJoin(audioUploads, eq(audioUploads.id, contributions.audioUploadId))
    .leftJoin(sceneContributions, eq(sceneContributions.id, contributions.sceneContributionId))
    .where(
      and(
        inArray(contributions.status, ["pending", "under_review"]),
        or(
          eq(wordRecordings.audioFileId, audioFile.id),
          eq(translations.audioFileId, audioFile.id),
          eq(audioUploads.audioFileId, audioFile.id),
          eq(sceneContributions.audioFileId, audioFile.id),
        ),
      ),
    )
    .limit(1);

  return Boolean(row);
}

// Mirrors SILENCE_TRIM_MODULES in audio-file.service.ts -- only these two
// modules get their recordings' leading/trailing silence trimmed.
const SILENCE_TRIM_MODULES = new Set(["WORD", "TRANSLATION"]);

// Kept in sync with PLAY_URL_EXPIRY_SECONDS in storage.service.ts, which
// signs the URL but only returns the string itself.
const PLAY_URL_EXPIRY_SECONDS = 3600;

const uploadUrlSchema = z
  .object({
    module: z.enum(contributionModule.enumValues),
    filename: z.string().min(1),
    mimeType: z.enum(ALLOWED_MIME_TYPES),
    checksumSha256: z.string().min(1),
    fileSizeBytes: z.number().int().positive(),
  })
  .superRefine((data, ctx) => {
    const maxAllowed = data.module === "WORD" ? WORD_MAX_FILE_SIZE_BYTES : DEFAULT_MAX_FILE_SIZE_BYTES;
    if (data.fileSizeBytes > maxAllowed) {
      ctx.addIssue({
        code: "custom",
        path: ["fileSizeBytes"],
        message: `File size exceeds the ${maxAllowed} byte limit for ${data.module} uploads`,
      });
    }
  });

const confirmSchema = z.object({
  durationMs: z.number().int().positive(),
  checksumSha256: z.string().min(1),
});

const idParamSchema = z.object({ id: z.string().uuid() });

/** Runs off the request path -- see the comment at its call site in /:id/confirm. */
async function trimAndPersist(audioFileId: string, storageKey: string, format: string, mimeType: string): Promise<void> {
  const original = await storageService.getAudioObjectBuffer(storageKey);
  const trimResult = await trimSilence(original, format);
  if (!trimResult.trimmed) return;

  await storageService.uploadAudioBuffer(storageKey, trimResult.buffer, mimeType);
  await db.update(audioFiles).set({ durationMs: trimResult.durationMs, updatedAt: new Date() }).where(eq(audioFiles.id, audioFileId));
}

export default async function audioRoutes(fastify: FastifyInstance) {
  fastify.post("/upload-url", { preHandler: verifyToken }, async (request) => {
    const body = uploadUrlSchema.parse(request.body);
    const userId = request.user!.id;

    // The extension comes from the already-validated mime type, not the
    // client-supplied filename -- a raw filename-derived extension could
    // embed path separators into the storage key (see sanitizeFilename's
    // docstring for the general version of this issue).
    const format = MIME_TYPE_TO_FORMAT[body.mimeType];
    const audioFileId = randomUUID();
    const storageKey = `audio/${body.module.toLowerCase()}/${userId}/${audioFileId}.${format}`;

    // The DB insert and the R2 presigned-URL generation don't depend on
    // each other -- run them concurrently instead of as two sequential
    // round trips (the second being a call to R2, not even this DB).
    const [, { uploadUrl, expiresAt }] = await Promise.all([
      db.insert(audioFiles).values({
        id: audioFileId,
        storageKey,
        originalFilename: sanitizeFilename(body.filename),
        mimeType: body.mimeType,
        format,
        fileSizeBytes: body.fileSizeBytes,
        checksumSha256: body.checksumSha256,
        processingStatus: "pending_upload",
        uploadedBy: userId,
        moduleType: body.module,
      }),
      storageService.generateAudioUploadUrl(audioFileId, storageKey, body.mimeType, body.module),
    ]);

    return { audioFileId, uploadUrl, storageKey, expiresAt };
  });

  fastify.post("/:id/confirm", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = confirmSchema.parse(request.body);
    const userId = request.user!.id;

    const [audioFile] = await db
      .select()
      .from(audioFiles)
      .where(and(eq(audioFiles.id, id), eq(audioFiles.uploadedBy, userId)))
      .limit(1);

    if (!audioFile) {
      throw new HttpError(404, "NOT_FOUND", "Audio file not found");
    }

    if (audioFile.checksumSha256 !== body.checksumSha256) {
      throw new HttpError(400, "CHECKSUM_MISMATCH", "The uploaded file's checksum does not match the reserved upload");
    }

    // The reservation is only a promise: confirm used to mark the file "uploaded" without ever
    // looking in the bucket, so a client could confirm a file it never uploaded (a contribution
    // with no audio behind it), and the presigned PUT carries no size limit, so it could upload
    // something far bigger than the size it reserved. Check what is actually stored.
    const stored = await storageService.headAudioObject(audioFile.storageKey);
    if (!stored) {
      throw new HttpError(400, "UPLOAD_NOT_FOUND", "No uploaded file was found for this reservation -- finish uploading it, then confirm");
    }
    const maxAllowedBytes = audioFile.moduleType === "WORD" ? WORD_MAX_FILE_SIZE_BYTES : DEFAULT_MAX_FILE_SIZE_BYTES;
    if (stored.sizeBytes > maxAllowedBytes || stored.sizeBytes > audioFile.fileSizeBytes) {
      // Don't keep an object that is bigger than it was allowed to be.
      await storageService.deleteAudioFile(audioFile.storageKey).catch((err) => {
        console.error(`[audio] could not remove oversized upload ${id}:`, err);
      });
      await db
        .update(audioFiles)
        .set({ processingStatus: "failed", processingError: "Uploaded file is larger than the reserved size", updatedAt: new Date() })
        .where(eq(audioFiles.id, id));
      throw new HttpError(400, "FILE_TOO_LARGE", "The uploaded file is larger than the size that was reserved for it", {
        maxAllowed: Math.min(maxAllowedBytes, audioFile.fileSizeBytes),
        received: stored.sizeBytes,
      });
    }

    // Module 1 (WORD) ONLY. NEVER apply this check to any other module.
    // The 10 s cap is checked against the server's own measurement of the stored file (a word clip
    // is at most 500 KB, so reading it back is cheap); the client's number is only the fallback
    // when the file can't be measured. Other modules keep the client's number here -- measuring a
    // file of up to 100 MB isn't done on the request path -- and the buffered flow, which the web
    // app uses, measures every module's audio itself (storeAudioBuffer).
    let durationMs = body.durationMs;
    if (audioFile.moduleType === "WORD") {
      const measured = await measureDurationMs(await storageService.getAudioObjectBuffer(audioFile.storageKey), audioFile.format);
      if (measured !== null) durationMs = measured;
      if (durationMs > 10000) {
        throw new HttpError(400, "DURATION_LIMIT_EXCEEDED", "Word recordings cannot exceed 10 seconds (10000ms)", {
          maxAllowed: 10000,
          received: durationMs,
        });
      }
    }

    await db
      .update(audioFiles)
      .set({ processingStatus: "uploaded", durationMs, fileSizeBytes: stored.sizeBytes, updatedAt: new Date() })
      .where(eq(audioFiles.id, id));

    // Silence trimming is real I/O (download the whole file from R2, spawn
    // ffmpeg, re-upload) -- for TRANSLATION, which has no duration cap, that
    // can take long enough to be a noticeably slow request. Running it
    // without awaiting here means the client gets its response immediately;
    // the row's durationMs gets corrected in place once trimming finishes.
    // submitWordRecording (word.service.ts) already re-reads durationMs from
    // this row as the authoritative value at submit time rather than
    // trusting what confirm returned, so this is safe even in the rare case
    // a submit call lands before the trim finishes (it just falls back to
    // the pre-trim duration that one time).
    if (SILENCE_TRIM_MODULES.has(audioFile.moduleType)) {
      trimAndPersist(id, audioFile.storageKey, audioFile.format, audioFile.mimeType).catch((err) => {
        console.error(`[audio] silence trim failed for ${id}, keeping original upload:`, err);
      });
    }

    return { audioFileId: id, storageKey: audioFile.storageKey, durationMs, processingStatus: "uploaded" };
  });

  fastify.get("/:id/play-url", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [audioFile] = await db.select().from(audioFiles).where(eq(audioFiles.id, id)).limit(1);
    if (!audioFile) {
      throw new HttpError(404, "NOT_FOUND", "Audio file not found");
    }

    if (!(await canAccessAudioFile(request.user!, audioFile))) {
      throw new HttpError(403, "FORBIDDEN", "You don't have access to this audio file");
    }

    const url = await storageService.generateAudioPlayUrl(audioFile.storageKey);
    const expiresAt = new Date(Date.now() + PLAY_URL_EXPIRY_SECONDS * 1000);

    return { url, expiresAt };
  });
}
