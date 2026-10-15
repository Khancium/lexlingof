import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getPublicDictionary, getPublicLanguageLearning } from "./public-content.service.js";

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Unauthenticated, read-only: the admin-curated public dictionary and
 * language-learning feed, meant for an external site (e.g. a WordPress
 * install) to fetch server-side. Only ever returns what an admin explicitly
 * published via /admin/publishing/* -- never the raw corpus.
 */
export default async function publicContentRoutes(fastify: FastifyInstance) {
  fastify.get("/public/dictionary", async (request) => {
    const { search, categoryId, limit, offset } = listQuerySchema.parse(request.query);
    return getPublicDictionary({ search, categoryId, limit, offset });
  });

  fastify.get("/public/language-learning", async (request) => {
    const { search, categoryId, limit, offset } = listQuerySchema.parse(request.query);
    return getPublicLanguageLearning({ search, categoryId, limit, offset });
  });
}
