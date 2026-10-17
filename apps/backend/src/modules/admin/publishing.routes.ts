import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requirePermission, verifyToken } from "../../middleware/auth.js";
import {
  contributionStatus,
  conceptGrammaticalGender,
  conceptGrammaticalNumber,
  conceptPartOfSpeech,
  educationLevelEnum,
  genderEnum,
} from "../../db/schema.js";
import {
  getConceptRecordings,
  getSentenceTranslations,
  listConceptsForPublishing,
  listSentencesForPublishing,
  publishTranslation,
  publishWordRecording,
  setRecordingsGrammar,
  unpublishAllRecordingsForConcept,
  unpublishAllTranslationsForSentence,
  unpublishTranslation,
  unpublishWordRecording,
} from "./publishing.service.js";

// Same CSV-multi-value convention as admin.routes.ts's contributionsQuerySchema.
function csvOf<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v.split(",") : undefined),
    z.array(z.enum(values)).min(1).optional(),
  );
}
function csvOfUuid() {
  return z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v.split(",") : undefined),
    z.array(z.string().uuid()).min(1).optional(),
  );
}

// Mirrors admin.routes.ts's contributionsQuerySchema (minus module_type,
// implicit per endpoint below) -- the same contributor-attribute filters
// used to browse Contributions apply here too, narrowing which concepts/
// sentences show up rather than which contribution rows do.
const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  status: csvOf(contributionStatus.enumValues),
  languageId: csvOfUuid(),
  dialectId: csvOfUuid(),
  userId: z.string().uuid().optional(),
  tribeId: csvOfUuid(),
  subTribeId: csvOfUuid(),
  country: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  villageId: csvOfUuid(),
  quarterId: csvOfUuid(),
  gender: csvOf(genderEnum.enumValues),
  educationLevel: csvOf(educationLevelEnum.enumValues),
  profession: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParamSchema = z.object({ id: z.string().uuid() });
const recordingIdParamSchema = z.object({ id: z.string().uuid(), recordingId: z.string().uuid() });
const translationIdParamSchema = z.object({ id: z.string().uuid(), translationId: z.string().uuid() });

// Each field nullable-and-optional: omit to leave as-is, send null to clear, send a value to set.
// recordingIds: which of the concept's recordings to apply this to -- one id
// for a single edit, several for mass assignment across a multi-select.
const recordingGrammarSchema = z.object({
  recordingIds: z.array(z.string().uuid()).min(1),
  grammaticalGender: z.enum(conceptGrammaticalGender.enumValues).nullable().optional(),
  partOfSpeech: z.enum(conceptPartOfSpeech.enumValues).nullable().optional(),
  grammaticalNumber: z.enum(conceptGrammaticalNumber.enumValues).nullable().optional(),
});

/**
 * Admin curation for the public dictionary (words) and public
 * language-learning feed (sentences) -- picking which verified contributor
 * recordings get exposed on the external site. Gated by `publishing.manage`
 * (see database/seeds/patch-publishing-permissions.ts), separate from
 * admin.routes.ts so this doesn't add more bulk to that already-large file.
 */
export default async function publishingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", verifyToken);
  fastify.addHook("preHandler", requirePermission("publishing.manage"));

  fastify.get("/admin/publishing/concepts", async (request) => {
    return listConceptsForPublishing(listQuerySchema.parse(request.query));
  });

  fastify.get("/admin/publishing/concepts/:id/recordings", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return { items: await getConceptRecordings(id) };
  });

  fastify.put("/admin/publishing/concepts/:id/recordings/:recordingId", async (request, reply) => {
    const { id, recordingId } = recordingIdParamSchema.parse(request.params);
    await publishWordRecording(id, recordingId, request.user!.id);
    reply.code(204).send();
  });

  fastify.delete("/admin/publishing/concepts/:id/recordings/:recordingId", async (request, reply) => {
    const { recordingId } = recordingIdParamSchema.parse(request.params);
    await unpublishWordRecording(recordingId);
    reply.code(204).send();
  });

  // Withdraws the whole concept from the public dictionary at once (every published recording for it).
  fastify.delete("/admin/publishing/concepts/:id/recordings", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await unpublishAllRecordingsForConcept(id);
    reply.code(204).send();
  });

  // Applies to every recordingId in the body at once -- a single id for one
  // recording, several for mass assignment across a multi-select.
  fastify.put("/admin/publishing/concepts/:id/recordings/grammar", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { recordingIds, ...grammar } = recordingGrammarSchema.parse(request.body);
    await setRecordingsGrammar(id, recordingIds, grammar);
    reply.code(204).send();
  });

  fastify.get("/admin/publishing/sentences", async (request) => {
    return listSentencesForPublishing(listQuerySchema.parse(request.query));
  });

  fastify.get("/admin/publishing/sentences/:id/translations", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return { items: await getSentenceTranslations(id) };
  });

  fastify.put("/admin/publishing/sentences/:id/translations/:translationId", async (request, reply) => {
    const { id, translationId } = translationIdParamSchema.parse(request.params);
    await publishTranslation(id, translationId, request.user!.id);
    reply.code(204).send();
  });

  fastify.delete("/admin/publishing/sentences/:id/translations/:translationId", async (request, reply) => {
    const { translationId } = translationIdParamSchema.parse(request.params);
    await unpublishTranslation(translationId);
    reply.code(204).send();
  });

  // Withdraws the whole sentence from the public language-learning feed at once (every published translation for it).
  fastify.delete("/admin/publishing/sentences/:id/translations", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await unpublishAllTranslationsForSentence(id);
    reply.code(204).send();
  });
}
