import { randomUUID, createHash } from "node:crypto";

import { db } from "../db/index.js";
import { audioFiles, audioFormat, contributionModule } from "../db/schema.js";
import { trimSilence } from "./audio-trim.service.js";
import { HttpError } from "../utils/http-error.js";
import { storageService } from "./storage.service.js";

// Silence trimming only applies to the two modules the dictionary/language-
// learning feed actually surfaces to the public site -- a scene narration or
// a free-form transcription upload may have intentional pauses that aren't
// ours to remove.
const SILENCE_TRIM_MODULES: ReadonlySet<ContributionModuleType> = new Set(["WORD", "TRANSLATION"]);

export const ALLOWED_MIME_TYPES = [
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-m4a",
  // An audio-only webm recording (voice-memo apps, some Android recorders)
  // is frequently reported by the OS/browser as "video/webm" even though it
  // has no video track -- the container format is identical to audio/webm,
  // so this is accepted and treated the same rather than rejecting a real
  // audio file on a mislabeled mimetype.
  "video/webm",
] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MIME_TYPE_TO_FORMAT: Record<AllowedAudioMimeType, (typeof audioFormat.enumValues)[number]> = {
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/x-m4a": "m4a",
  "video/webm": "webm",
};

// Module 1 (WORD) clips are capped at 3 seconds, so 500KB comfortably covers
// any codec at a reasonable bitrate. Every other module uses the 100MB limit
// from gamification_config's modules.audio.max_file_bytes.
export const WORD_MAX_FILE_SIZE_BYTES = 500_000;
export const DEFAULT_MAX_FILE_SIZE_BYTES = 104_857_600;

type ContributionModuleType = (typeof contributionModule.enumValues)[number];

/**
 * Uploads an already-in-memory audio buffer straight to R2 and records it in
 * audio_files, skipping the presigned-URL reserve/PUT/confirm round trips
 * entirely -- used by the submission-buffer worker, which already holds the
 * bytes server-side. Performs the same validation the old presigned flow's
 * two endpoints did (allowed mime type, per-module size cap, WORD's 5-second
 * duration cap) so buffered submissions can't bypass either check.
 */
export async function storeAudioBuffer(params: {
  userId: string;
  module: ContributionModuleType;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  durationMs: number;
}): Promise<{ audioFileId: string; storageKey: string }> {
  if (!ALLOWED_MIME_TYPES.includes(params.mimeType as AllowedAudioMimeType)) {
    throw new HttpError(400, "INVALID_MIME_TYPE", `${params.mimeType} is not an accepted audio type`);
  }
  // Normalize the mislabeled-video-container case to its real audio type so
  // nothing downstream (storage Content-Type, <audio> playback) ever sees
  // "video/webm" for what is actually audio-only content.
  const mimeType: AllowedAudioMimeType = params.mimeType === "video/webm" ? "audio/webm" : (params.mimeType as AllowedAudioMimeType);

  const maxAllowed = params.module === "WORD" ? WORD_MAX_FILE_SIZE_BYTES : DEFAULT_MAX_FILE_SIZE_BYTES;
  if (params.buffer.byteLength > maxAllowed) {
    throw new HttpError(400, "FILE_TOO_LARGE", `File size exceeds the ${maxAllowed} byte limit for ${params.module} uploads`);
  }

  // Module 1 (WORD) ONLY. NEVER apply this check to any other module.
  if (params.module === "WORD" && params.durationMs > 5000) {
    throw new HttpError(400, "DURATION_LIMIT_EXCEEDED", "Word recordings cannot exceed 5 seconds (5000ms)", {
      maxAllowed: 5000,
      received: params.durationMs,
    });
  }

  const ext = params.filename.includes(".") ? params.filename.split(".").pop() : undefined;
  if (!ext) {
    throw new HttpError(400, "INVALID_FILENAME", "filename must include a file extension");
  }

  const audioFileId = randomUUID();
  const storageKey = `audio/${params.module.toLowerCase()}/${params.userId}/${audioFileId}.${ext}`;
  const format = MIME_TYPE_TO_FORMAT[mimeType];

  // Clip long leading/trailing silence before this ever reaches R2 -- the
  // buffered flow already holds the bytes server-side, so this is the
  // cheapest point to do it. durationMs stored below is always the final,
  // post-trim measured value (never the client-reported one), same
  // authoritative source submitWordRecording reads back later.
  let finalBuffer = params.buffer;
  let finalDurationMs = Math.round(params.durationMs);
  if (SILENCE_TRIM_MODULES.has(params.module)) {
    const trimResult = await trimSilence(params.buffer, format);
    finalBuffer = trimResult.buffer;
    finalDurationMs = trimResult.durationMs;
  }

  const checksumSha256 = createHash("sha256").update(finalBuffer).digest("hex");

  // The DB insert and the R2 upload don't depend on each other -- run them
  // concurrently instead of as two sequential round trips.
  await Promise.all([
    db.insert(audioFiles).values({
      id: audioFileId,
      storageKey,
      originalFilename: params.filename,
      mimeType,
      format,
      fileSizeBytes: finalBuffer.byteLength,
      checksumSha256,
      processingStatus: "uploaded",
      durationMs: finalDurationMs,
      uploadedBy: params.userId,
      moduleType: params.module,
    }),
    storageService.uploadAudioBuffer(storageKey, finalBuffer, mimeType),
  ]);

  return { audioFileId, storageKey };
}
