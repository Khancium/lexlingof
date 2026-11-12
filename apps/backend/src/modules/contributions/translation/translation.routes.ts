import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { blockIfRestricted, verifyToken } from "../../../middleware/auth.js";
import { assertOwnsAudioFile } from "../../../services/audio-file.service.js";
import { requireModule } from "../../../services/feature-flags.service.js";
import {
  getNextSentence,
  getSentenceCategoryTiles,
  getSentenceForTranslation,
  listCategorySentences,
  searchSentences,
  submitTranslation,
} from "./translation.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const filterSchema = z.enum(["translated", "untranslated"]);
const pagingSchema = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
const categorySentencesQuerySchema = z.object({ search: z.string().min(1).optional(), filter: filterSchema.optional(), ...pagingSchema });
const nextQuerySchema = z.object({ categoryId: z.string().uuid(), after: z.string().uuid().optional() });
const searchQuerySchema = z.object({
  search: z.string().min(1).optional(),
  filter: filterSchema.optional(),
  categoryId: z.string().uuid().optional(),
  ...pagingSchema,
});

const submitTranslationSchema = z.object({
  nativeText: z.string().min(1).optional(),
  romanization: z.string().optional(),
  ipa: z.string().optional(),
  audioFileId: z.string().uuid(),
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
  // NO durationMs here -- Module 3 has no duration limit.
});

export default async function translationRoutes(fastify: FastifyInstance) {
  // Sentences are browsed by CATEGORY, in order (not at random): tiles -> a category's sentences -> record.
  // Each sentence carries its English, Urdu and Persian text; the contributor picks which to read.
  fastify.get("/sentence-categories", { preHandler: [verifyToken, requireModule(3)] }, async (request) => {
    return getSentenceCategoryTiles(request.user!.id);
  });

  fastify.get("/sentence-categories/:id/sentences", { preHandler: [verifyToken, requireModule(3)] }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { search, filter, limit, offset } = categorySentencesQuerySchema.parse(request.query);
    return listCategorySentences(request.user!.id, id, { search, filter, limit, offset });
  });

  // The next untranslated sentence of a category in its order (after `after`, if given) -- "Next".
  fastify.get("/sentences/next", { preHandler: [verifyToken, requireModule(3)] }, async (request) => {
    const { categoryId, after } = nextQuerySchema.parse(request.query);
    return getNextSentence(request.user!.id, categoryId, after);
  });

  fastify.get("/sentences", { preHandler: verifyToken }, async (request) => {
    const { search, filter, categoryId, limit, offset } = searchQuerySchema.parse(request.query);
    return searchSentences(request.user!.id, { search, filter, categoryId, limit, offset });
  });

  fastify.get("/sentences/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return getSentenceForTranslation(request.user!.id, id);
  });

  fastify.post("/sentences/:id/translation", { preHandler: [verifyToken, requireModule(3), blockIfRestricted] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = submitTranslationSchema.parse(request.body);
    if (body.audioFileId) await assertOwnsAudioFile(request.user!.id, body.audioFileId);
    await getSentenceForTranslation(request.user!.id, id); // 404 if the sentence is gone or hidden
    const result = await submitTranslation(request.user!.id, id, body);
    reply.code(201).send(result);
  });
}
