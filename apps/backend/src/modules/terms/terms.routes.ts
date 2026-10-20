import type { FastifyInstance } from "fastify";

import { CURRENT_TERMS_VERSION, TERMS_CONTENT } from "../../content/terms.js";

/**
 * Public, unauthenticated, no API key required (unlike public-content.routes.ts,
 * which gates WordPress's feed) -- this is the content Lexlingo's own
 * registration page and a standalone /terms page fetch directly. Returning
 * the version alongside the content means a client can send that exact
 * version back at registration time (auth.routes.ts) without hardcoding it
 * or risking staleness if it's updated between page load and signup.
 */
export default async function termsRoutes(fastify: FastifyInstance) {
  fastify.get("/terms", async () => {
    return { version: CURRENT_TERMS_VERSION, content: TERMS_CONTENT };
  });
}
