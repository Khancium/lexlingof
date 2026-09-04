import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { audioFiles, audioFormat, contributionModule } from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";
import { storageService } from "../../services/storage.service.js";
import { HttpError } from "../../utils/http-error.js";

const ALLOWED_MIME_TYPES = [
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-m4a",
] as const;

const MIME_TYPE_TO_FORMAT: Record<(typeof ALLOWED_MIME_TYPES)[number], (typeof audioFormat.enumValues)[number]> = {
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/x-m4a": "m4a",
};

// Module 1 (WORD) clips are capped at 3 seconds, so 500KB comfortably covers
// any codec at a reasonable bitrate. Every other module uses the 100MB limit
// from gamification_config's modules.audio.max_file_bytes.
const WORD_MAX_FILE_SIZE_BYTES = 500_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 104_857_600;

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

export default async function audioRoutes(fastify: FastifyInstance) {
  fastify.post("/upload-url", { preHandler: verifyToken }, async (request) => {
    const body = uploadUrlSchema.parse(request.body);
    const userId = request.user!.id;

    const ext = body.filename.includes(".") ? body.filename.split(".").pop() : undefined;
    if (!ext) {
      throw new HttpError(400, "INVALID_FILENAME", "filename must include a file extension");
    }

    const audioFileId = randomUUID();
    const storageKey = `audio/${body.module.toLowerCase()}/${userId}/${audioFileId}.${ext}`;
    const format = MIME_TYPE_TO_FORMAT[body.mimeType];

    await db.insert(audioFiles).values({
      id: audioFileId,
      storageKey,
      originalFilename: body.filename,
      mimeType: body.mimeType,
      format,
      fileSizeBytes: body.fileSizeBytes,
      checksumSha256: body.checksumSha256,
      processingStatus: "pending_upload",
      uploadedBy: userId,
      moduleType: body.module,
    });

    const { uploadUrl, expiresAt } = await storageService.generateAudioUploadUrl(
      audioFileId,
      storageKey,
      body.mimeType,
      body.module,
    );

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

    // Module 1 (WORD) ONLY. NEVER apply this check to any other module.
    if (audioFile.moduleType === "WORD" && body.durationMs > 3000) {
      throw new HttpError(400, "DURATION_LIMIT_EXCEEDED", "Word recordings cannot exceed 3 seconds (3000ms)", {
        maxAllowed: 3000,
        received: body.durationMs,
      });
    }

    await db
      .update(audioFiles)
      .set({ processingStatus: "uploaded", durationMs: body.durationMs, updatedAt: new Date() })
      .where(eq(audioFiles.id, id));

    return { audioFileId: id, storageKey: audioFile.storageKey, durationMs: body.durationMs, processingStatus: "uploaded" };
  });

  fastify.get("/:id/play-url", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [audioFile] = await db.select().from(audioFiles).where(eq(audioFiles.id, id)).limit(1);
    if (!audioFile) {
      throw new HttpError(404, "NOT_FOUND", "Audio file not found");
    }

    const url = await storageService.generateAudioPlayUrl(audioFile.storageKey);
    const expiresAt = new Date(Date.now() + PLAY_URL_EXPIRY_SECONDS * 1000);

    return { url, expiresAt };
  });
}
