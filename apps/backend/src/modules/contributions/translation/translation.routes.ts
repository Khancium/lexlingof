import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../db/index.js";
import { categories, sentences } from "../../../db/schema.js";
import { verifyToken } from "../../../middleware/auth.js";
import { HttpError } from "../../../utils/http-error.js";
import { getRandomSentence, submitTranslation } from "./translation.service.js";

const randomQuerySchema = z.object({ languageId: z.string().uuid() });
const idParamSchema = z.object({ id: z.string().uuid() });

const submitTranslationSchema = z.object({
  nativeText: z.string().min(1),
  romanization: z.string().optional(),
  ipa: z.string().optional(),
  audioFileId: z.string().uuid().optional(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
  // NO durationMs here -- Module 3 has no duration limit.
});

export default async function translationRoutes(fastify: FastifyInstance) {
  fastify.get("/sentences/random", { preHandler: verifyToken }, async (request) => {
    const { languageId } = randomQuerySchema.parse(request.query);
    return getRandomSentence(request.user!.id, languageId);
  });

  fastify.get("/sentences/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [sentence] = await db
      .select({
        id: sentences.id,
        englishText: sentences.englishText,
        difficulty: sentences.difficulty,
        categoryId: categories.id,
        categoryName: categories.nameEnglish,
        categorySlug: categories.slug,
      })
      .from(sentences)
      .leftJoin(categories, eq(categories.id, sentences.categoryId))
      .where(eq(sentences.id, id))
      .limit(1);

    if (!sentence) {
      throw new HttpError(404, "NOT_FOUND", "Sentence not found");
    }

    return {
      id: sentence.id,
      englishText: sentence.englishText,
      category: sentence.categoryId ? { id: sentence.categoryId, name: sentence.categoryName, slug: sentence.categorySlug } : null,
      difficulty: sentence.difficulty,
    };
  });

  fastify.post("/sentences/:id/translation", { preHandler: verifyToken }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = submitTranslationSchema.parse(request.body);
    const result = await submitTranslation(request.user!.id, id, body);
    reply.code(201).send(result);
  });
}
