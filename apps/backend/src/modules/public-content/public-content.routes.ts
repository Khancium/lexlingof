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

// The two *-filters endpoints take no query params and only change when an
// admin publishes/unpublishes something with a new tribe/city/village value
// disclosed -- a rare, admin-triggered event -- yet were being recomputed
// (a full scan + selectDistinct over every published recording) on every
// single hit from the embedded WordPress page. A short TTL cache, same
// pattern as gamification.routes.ts's corpus-stats cache, cuts that to once
// every 5 minutes regardless of traffic; the list endpoints themselves are
// left uncached since their query-param cardinality (free-text search +
// pagination) would make an unbounded cache key space a bigger liability.
const FILTER_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000;
let dictionaryFilterOptionsCache: { data: Awaited<ReturnType<typeof getPublicDictionaryFilterOptions>>; expiresAt: number } | null = null;
let languageLearningFilterOptionsCache: { data: Awaited<ReturnType<typeof getPublicLanguageLearningFilterOptions>>; expiresAt: number } | null = null;

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
    if (!dictionaryFilterOptionsCache || dictionaryFilterOptionsCache.expiresAt <= Date.now()) {
      dictionaryFilterOptionsCache = { data: await getPublicDictionaryFilterOptions(), expiresAt: Date.now() + FILTER_OPTIONS_CACHE_TTL_MS };
    }
    return dictionaryFilterOptionsCache.data;
  });

  fastify.get("/public/language-learning", async (request) => {
    return getPublicLanguageLearning(listQuerySchema.parse(request.query));
  });

  fastify.get("/public/language-learning/filters", async () => {
    if (!languageLearningFilterOptionsCache || languageLearningFilterOptionsCache.expiresAt <= Date.now()) {
      languageLearningFilterOptionsCache = {
        data: await getPublicLanguageLearningFilterOptions(),
        expiresAt: Date.now() + FILTER_OPTIONS_CACHE_TTL_MS,
      };
    }
    return languageLearningFilterOptionsCache.data;
  });
}
