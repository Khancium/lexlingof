import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../db/index.js";
import { audioUploads, contributions, transcriptionSegments, transcriptions } from "../../../db/schema.js";
import { verifyToken } from "../../../middleware/auth.js";
import { HttpError } from "../../../utils/http-error.js";
import { addSegment, addTranscription, submitAudioUpload } from "./audio-upload.service.js";

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .optional();

const submitSchema = z.object({
  audioFileId: z.string().uuid(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  recordingType: z.string().min(1),
  location: z.string().optional(),
  recordedAt: dateStringSchema,
  speakerDescription: z.string().optional(),
  culturalContext: z.string().optional(),
  source: z.string().optional(),
  thirdPartyConsent: z.boolean().optional(),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
});

const transcriptionSchema = z
  .object({
    nativeText: z.string().optional(),
    romanization: z.string().optional(),
    ipa: z.string().optional(),
  })
  .refine((data) => data.nativeText || data.romanization || data.ipa, {
    message: "At least one of nativeText, romanization or ipa is required",
  });

const segmentSchema = z
  .object({
    segmentIndex: z.number().int().min(0),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    nativeText: z.string().optional(),
    romanization: z.string().optional(),
    ipa: z.string().optional(),
    speakerLabel: z.string().optional(),
  })
  .refine((data) => data.endMs > data.startMs, {
    message: "endMs must be greater than startMs",
    path: ["endMs"],
  });

const idParamSchema = z.object({ id: z.string().uuid() });
const segmentParamSchema = z.object({ id: z.string().uuid(), segId: z.string().uuid() });

export default async function audioUploadRoutes(fastify: FastifyInstance) {
  fastify.post("/", { preHandler: verifyToken }, async (request, reply) => {
    const body = submitSchema.parse(request.body);
    const result = await submitAudioUpload(request.user!.id, body);
    reply.code(201).send(result);
  });

  fastify.get("/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = request.user!.id;

    const [upload] = await db
      .select({
        id: audioUploads.id,
        title: audioUploads.title,
        description: audioUploads.description,
        recordingType: audioUploads.recordingType,
        location: audioUploads.location,
        recordedAt: audioUploads.recordedAt,
        speakerDescription: audioUploads.speakerDescription,
        culturalContext: audioUploads.culturalContext,
        source: audioUploads.source,
        thirdPartyConsent: audioUploads.thirdPartyConsent,
        transcriptionStatus: audioUploads.transcriptionStatus,
        createdAt: audioUploads.createdAt,
      })
      .from(audioUploads)
      .innerJoin(contributions, eq(contributions.id, audioUploads.contributionId))
      .where(and(eq(audioUploads.id, id), eq(contributions.userId, userId)))
      .limit(1);

    if (!upload) {
      throw new HttpError(404, "NOT_FOUND", "Audio upload not found");
    }

    const [transcription] = await db
      .select()
      .from(transcriptions)
      .where(and(eq(transcriptions.audioUploadId, id), eq(transcriptions.isCurrent, true)))
      .limit(1);

    const segments = await db
      .select()
      .from(transcriptionSegments)
      .where(eq(transcriptionSegments.audioUploadId, id))
      .orderBy(asc(transcriptionSegments.segmentIndex));

    return { ...upload, transcription: transcription ?? null, segments };
  });

  fastify.post("/:id/transcription", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = transcriptionSchema.parse(request.body);
    return addTranscription(request.user!.id, id, body);
  });

  fastify.post("/:id/segments", { preHandler: verifyToken }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = segmentSchema.parse(request.body);
    const result = await addSegment(request.user!.id, id, body);
    reply.code(201).send(result);
  });

  fastify.delete("/:id/segments/:segId", { preHandler: verifyToken }, async (request, reply) => {
    const { id, segId } = segmentParamSchema.parse(request.params);
    const userId = request.user!.id;

    const [owned] = await db
      .select({ id: audioUploads.id })
      .from(audioUploads)
      .innerJoin(contributions, eq(contributions.id, audioUploads.contributionId))
      .where(and(eq(audioUploads.id, id), eq(contributions.userId, userId)))
      .limit(1);

    if (!owned) {
      throw new HttpError(404, "NOT_FOUND", "Audio upload not found");
    }

    const deleted = await db
      .delete(transcriptionSegments)
      .where(and(eq(transcriptionSegments.id, segId), eq(transcriptionSegments.audioUploadId, id)))
      .returning({ id: transcriptionSegments.id });

    if (deleted.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "Segment not found");
    }

    reply.code(204).send();
  });
}
