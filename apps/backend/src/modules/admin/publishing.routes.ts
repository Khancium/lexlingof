import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requirePermission, verifyToken } from "../../middleware/auth.js";
import {
  getConceptRecordings,
  getSentenceTranslations,
  listConceptsForPublishing,
  listSentencesForPublishing,
  publishTranslation,
  publishWordRecording,
  unpublishTranslation,
  unpublishWordRecording,
} from "./publishing.service.js";

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParamSchema = z.object({ id: z.string().uuid() });
const recordingIdParamSchema = z.object({ id: z.string().uuid(), recordingId: z.string().uuid() });
const translationIdParamSchema = z.object({ id: z.string().uuid(), translationId: z.string().uuid() });

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
    const { search, categoryId, limit, offset } = listQuerySchema.parse(request.query);
    return listConceptsForPublishing({ search, categoryId, limit, offset });
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

  fastify.get("/admin/publishing/sentences", async (request) => {
    const { search, categoryId, limit, offset } = listQuerySchema.parse(request.query);
    return listSentencesForPublishing({ search, categoryId, limit, offset });
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
}
