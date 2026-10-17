import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { HttpError } from "../../utils/http-error.js";
import {
  getPublicDictionary,
  getPublicDictionaryFilterOptions,
  getPublicLanguageLearning,
  getPublicLanguageLearningFilterOptions,
} from "./public-content.service.js";

/**
 * Optional shared secret between Lexlingo and whatever site consumes this
 * feed (the Pashtowal WordPress theme) -- not meant to gate a real human
 * visitor (they only ever see the WordPress page, never this API directly),
 * just to stop a third party from hitting this API wholesale and harvesting
 * the entire published catalog in one request. If unset, the API stays
 * fully open -- same "missing config degrades gracefully" pattern as every
 * other optional integration in this codebase (Firebase, Openverse), so a
 * fresh deploy without the key configured doesn't start 401ing WordPress.
 */
async function requirePublicApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.PUBLIC_API_KEY;
  if (!expected) return;
  if (request.headers["x-public-api-key"] !== expected) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid API key");
  }
}

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  // Plain display-name strings (as returned by the *-filters endpoints
  // below), not internal uuids -- a visitor filters on exactly what a
  // contributor's showLocation opt-in already discloses.
  tribe: z.string().trim().optional(),
  city: z.string().trim().optional(),
  village: z.string().trim().optional(),
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
  fastify.addHook("preHandler", requirePublicApiKey);

  fastify.get("/public/dictionary", async (request) => {
    return getPublicDictionary(listQuerySchema.parse(request.query));
  });

  fastify.get("/public/dictionary/filters", async () => {
    return getPublicDictionaryFilterOptions();
  });

  fastify.get("/public/language-learning", async (request) => {
    return getPublicLanguageLearning(listQuerySchema.parse(request.query));
  });

  fastify.get("/public/language-learning/filters", async () => {
    return getPublicLanguageLearningFilterOptions();
  });
}
