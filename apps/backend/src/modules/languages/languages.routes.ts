import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { dialects, languages } from "../../db/schema.js";
import { HttpError } from "../../utils/http-error.js";

const LIST_CACHE_TTL_MS = 60 * 60 * 1000;

type LanguageWithDialects = Awaited<ReturnType<typeof loadActiveLanguagesWithDialects>>;

let listCache: { data: LanguageWithDialects; expiresAt: number } | null = null;

async function loadActiveLanguagesWithDialects() {
  const languageRows = await db
    .select()
    .from(languages)
    .where(eq(languages.isActive, true))
    .orderBy(asc(languages.sortOrder));

  const languageIds = languageRows.map((l) => l.id);

  const dialectRows = languageIds.length
    ? await db
        .select()
        .from(dialects)
        .where(and(inArray(dialects.languageId, languageIds), eq(dialects.isActive, true)))
    : [];

  const dialectsByLanguage = new Map<string, typeof dialectRows>();
  for (const dialect of dialectRows) {
    const list = dialectsByLanguage.get(dialect.languageId) ?? [];
    list.push(dialect);
    dialectsByLanguage.set(dialect.languageId, list);
  }

  return languageRows.map((language) => ({
    ...language,
    dialects: dialectsByLanguage.get(language.id) ?? [],
  }));
}

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function languagesRoutes(fastify: FastifyInstance) {
  fastify.get("/languages", async () => {
    if (!listCache || listCache.expiresAt <= Date.now()) {
      listCache = { data: await loadActiveLanguagesWithDialects(), expiresAt: Date.now() + LIST_CACHE_TTL_MS };
    }
    return listCache.data;
  });

  fastify.get("/languages/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [language] = await db.select().from(languages).where(eq(languages.id, id)).limit(1);
    if (!language) {
      throw new HttpError(404, "NOT_FOUND", "Language not found");
    }

    const dialectRows = await db.select().from(dialects).where(eq(dialects.languageId, id));

    return { ...language, dialects: dialectRows };
  });
}
