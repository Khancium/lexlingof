import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MultipartValue } from "@fastify/multipart";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../db/index.js";
import { pendingSubmissions } from "../../../db/schema.js";
import { verifyToken } from "../../../middleware/auth.js";
import { HttpError } from "../../../utils/http-error.js";
import { enqueueSubmission } from "../../../services/submission-buffer.service.js";

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .optional();

const wordMetaSchema = z.object({
  conceptId: z.string().uuid(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  nativeWord: z.string().max(200).optional(),
  romanization: z.string().optional(),
  ipa: z.string().optional(),
  synonymIndex: z.number().int().min(1).max(3),
  durationMs: z.number().int().min(1).max(5000),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
});

const translationMetaSchema = z.object({
  sentenceId: z.string().uuid(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  nativeText: z.string().min(1).optional(),
  romanization: z.string().optional(),
  ipa: z.string().optional(),
  durationMs: z.number().int().min(1),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
});

const audioUploadMetaSchema = z.object({
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  title: z.string().max(300).optional(),
  description: z.string().optional(),
  recordingType: z.string().min(1),
  location: z.string().optional(),
  recordedAt: dateStringSchema,
  durationMs: z.number().int().min(1),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
  transcription: z
    .object({
      nativeText: z.string().optional(),
      romanization: z.string().optional(),
      ipa: z.string().optional(),
      englishTranslation: z.string().optional(),
    })
    .optional(),
  segments: z
    .array(
      z
        .object({
          startMs: z.number().int().min(0),
          endMs: z.number().int().min(0),
          nativeText: z.string().optional(),
          romanization: z.string().optional(),
          ipa: z.string().optional(),
          speakerLabel: z.string().optional(),
        })
        .refine((s) => s.endMs > s.startMs, { message: "endMs must be greater than startMs" }),
    )
    .optional(),
});

const sceneMetaSchema = z.object({
  sceneId: z.string().uuid(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  durationMs: z.number().int().min(1),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
});

async function readMultipartSubmission(request: FastifyRequest): Promise<{ meta: unknown; audio: { buffer: Buffer; mimetype: string; filename: string } }> {
  const file = await request.file();
  if (!file) {
    throw new HttpError(400, "MISSING_FILE", "An audio file is required");
  }

  const metaField = file.fields.meta as MultipartValue<string> | undefined;
  if (!metaField) {
    throw new HttpError(400, "MISSING_META", "A 'meta' field containing the submission JSON is required");
  }

  let meta: unknown;
  try {
    meta = JSON.parse(metaField.value);
  } catch {
    throw new HttpError(400, "INVALID_META", "meta must be valid JSON");
  }

  const buffer = await file.toBuffer();
  return { meta, audio: { buffer, mimetype: file.mimetype, filename: file.filename } };
}

export default async function bufferRoutes(fastify: FastifyInstance) {
  fastify.post("/word", { preHandler: verifyToken }, async (request, reply) => {
    const { meta, audio } = await readMultipartSubmission(request);
    const { durationMs, ...payload } = wordMetaSchema.parse(meta);

    const { id } = await enqueueSubmission({
      userId: request.user!.id,
      moduleType: "WORD",
      payload,
      audio: { buffer: audio.buffer, mimeType: audio.mimetype, filename: audio.filename, durationMs },
    });

    reply.code(202).send({ bufferId: id, status: "pending" });
  });

  fastify.post("/translation", { preHandler: verifyToken }, async (request, reply) => {
    const { meta, audio } = await readMultipartSubmission(request);
    const { durationMs, ...payload } = translationMetaSchema.parse(meta);

    const { id } = await enqueueSubmission({
      userId: request.user!.id,
      moduleType: "TRANSLATION",
      payload,
      audio: { buffer: audio.buffer, mimeType: audio.mimetype, filename: audio.filename, durationMs },
    });

    reply.code(202).send({ bufferId: id, status: "pending" });
  });

  fastify.post("/audio-upload", { preHandler: verifyToken }, async (request, reply) => {
    const { meta, audio } = await readMultipartSubmission(request);
    const { durationMs, ...payload } = audioUploadMetaSchema.parse(meta);

    const { id } = await enqueueSubmission({
      userId: request.user!.id,
      moduleType: "TRANSCRIPTION",
      payload,
      audio: { buffer: audio.buffer, mimeType: audio.mimetype, filename: audio.filename, durationMs },
    });

    reply.code(202).send({ bufferId: id, status: "pending" });
  });

  fastify.post("/scene", { preHandler: verifyToken }, async (request, reply) => {
    const { meta, audio } = await readMultipartSubmission(request);
    const { durationMs, ...payload } = sceneMetaSchema.parse(meta);

    const { id } = await enqueueSubmission({
      userId: request.user!.id,
      moduleType: "SCENE",
      payload,
      audio: { buffer: audio.buffer, mimeType: audio.mimetype, filename: audio.filename, durationMs },
    });

    reply.code(202).send({ bufferId: id, status: "pending" });
  });

  // Everything the user hasn't seen resolve into a normal contribution yet --
  // "done" rows are deliberately excluded since by then the real contribution
  // already shows up through the regular My Contributions list.
  fastify.get("/mine", { preHandler: verifyToken }, async (request) => {
    const items = await db
      .select({
        id: pendingSubmissions.id,
        moduleType: pendingSubmissions.moduleType,
        status: pendingSubmissions.status,
        errorMessage: pendingSubmissions.errorMessage,
        createdAt: pendingSubmissions.createdAt,
      })
      .from(pendingSubmissions)
      .where(
        and(
          eq(pendingSubmissions.userId, request.user!.id),
          inArray(pendingSubmissions.status, ["pending", "processing", "failed"]),
        ),
      )
      .orderBy(desc(pendingSubmissions.createdAt))
      .limit(20);

    return { items };
  });
}
