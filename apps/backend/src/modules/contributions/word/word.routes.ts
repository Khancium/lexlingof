import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../db/index.js";
import { categories, conceptMedia, concepts, contributions, wordRecordings } from "../../../db/schema.js";
import { verifyToken } from "../../../middleware/auth.js";
import { HttpError } from "../../../utils/http-error.js";
import { checkLimits, submitWordRecording } from "./word.service.js";

const MAX_RECORDINGS_PER_CONCEPT = 9; // 3 synonyms x 3 takes

const nextConceptQuerySchema = z.object({ categoryId: z.string().uuid().optional() });
const conceptIdParamSchema = z.object({ conceptId: z.string().uuid() });

const submitSchema = z.object({
  audioFileId: z.string().uuid(),
  conceptId: z.string().uuid(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  nativeWord: z.string().min(1).max(200),
  romanization: z.string().optional(),
  ipa: z.string().optional(),
  synonymIndex: z.number().int().min(1).max(3),
  takeIndex: z.number().int().min(1).max(3),
  durationMs: z.number().int().min(1).max(3000), // FIRST enforcement layer
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
});

export default async function wordRoutes(fastify: FastifyInstance) {
  fastify.get("/concepts/next", { preHandler: verifyToken }, async (request) => {
    const { categoryId } = nextConceptQuerySchema.parse(request.query);
    const userId = request.user!.id;

    const conceptConditions = [eq(concepts.isActive, true), isNull(concepts.deletedAt)];
    if (categoryId) {
      conceptConditions.push(eq(concepts.categoryId, categoryId));
    }

    const conceptRows = await db
      .select({
        id: concepts.id,
        slug: concepts.slug,
        labelEnglish: concepts.labelEnglish,
        description: concepts.description,
        difficulty: concepts.difficulty,
        categoryId: categories.id,
        categoryName: categories.nameEnglish,
        categorySlug: categories.slug,
      })
      .from(concepts)
      .innerJoin(categories, eq(categories.id, concepts.categoryId))
      .where(and(...conceptConditions))
      .orderBy(concepts.sortOrder);

    if (conceptRows.length === 0) {
      throw new HttpError(404, "NO_CONCEPTS_AVAILABLE", "No concepts match the given filters");
    }

    const recordingCounts = await db
      .select({ conceptId: wordRecordings.conceptId, total: sql<number>`count(*)`.mapWith(Number) })
      .from(wordRecordings)
      .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
      .where(and(eq(contributions.userId, userId), isNull(wordRecordings.deletedAt)))
      .groupBy(wordRecordings.conceptId);

    const countByConcept = new Map(recordingCounts.map((r) => [r.conceptId, r.total]));

    const nextConcept = conceptRows.find((c) => (countByConcept.get(c.id) ?? 0) < MAX_RECORDINGS_PER_CONCEPT);
    if (!nextConcept) {
      throw new HttpError(404, "NO_CONCEPTS_AVAILABLE", "You have completed every available concept");
    }

    const [media] = await db
      .select({ publicUrl: conceptMedia.publicUrl })
      .from(conceptMedia)
      .where(and(eq(conceptMedia.conceptId, nextConcept.id), eq(conceptMedia.isPrimary, true)))
      .limit(1);

    const limits = await checkLimits(userId, nextConcept.id);

    return {
      concept: {
        id: nextConcept.id,
        slug: nextConcept.slug,
        labelEnglish: nextConcept.labelEnglish,
        description: nextConcept.description,
        difficulty: nextConcept.difficulty,
      },
      category: { id: nextConcept.categoryId, name: nextConcept.categoryName, slug: nextConcept.categorySlug },
      publicUrl: media?.publicUrl ?? null,
      limits,
    };
  });

  fastify.get("/contributions/word/:conceptId/limits", { preHandler: verifyToken }, async (request) => {
    const { conceptId } = conceptIdParamSchema.parse(request.params);
    return checkLimits(request.user!.id, conceptId);
  });

  fastify.post("/contributions/word", { preHandler: verifyToken }, async (request, reply) => {
    const body = submitSchema.parse(request.body);
    const result = await submitWordRecording(request.user!.id, body);
    reply.code(201).send(result);
  });
}
