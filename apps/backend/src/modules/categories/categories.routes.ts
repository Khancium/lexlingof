import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { categories, conceptMedia, concepts } from "../../db/schema.js";
import { HttpError } from "../../utils/http-error.js";

const LIST_CACHE_TTL_MS = 30 * 60 * 1000;

type CategoryWithCount = Awaited<ReturnType<typeof loadActiveCategoriesWithCounts>>;

let listCache: { data: CategoryWithCount; expiresAt: number } | null = null;

async function loadActiveCategoriesWithCounts() {
  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder));

  const conceptRows = await db
    .select({ categoryId: concepts.categoryId })
    .from(concepts)
    .where(and(eq(concepts.isActive, true), isNull(concepts.deletedAt)));

  const countByCategory = new Map<string, number>();
  for (const row of conceptRows) {
    countByCategory.set(row.categoryId, (countByCategory.get(row.categoryId) ?? 0) + 1);
  }

  return categoryRows.map((category) => ({
    ...category,
    conceptCount: countByCategory.get(category.id) ?? 0,
  }));
}

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function categoriesRoutes(fastify: FastifyInstance) {
  fastify.get("/categories", async () => {
    if (!listCache || listCache.expiresAt <= Date.now()) {
      listCache = { data: await loadActiveCategoriesWithCounts(), expiresAt: Date.now() + LIST_CACHE_TTL_MS };
    }
    return listCache.data;
  });

  fastify.get("/categories/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!category) {
      throw new HttpError(404, "NOT_FOUND", "Category not found");
    }

    const conceptRows = await db
      .select()
      .from(concepts)
      .where(and(eq(concepts.categoryId, id), eq(concepts.isActive, true), isNull(concepts.deletedAt)))
      .orderBy(asc(concepts.sortOrder));

    const conceptIds = conceptRows.map((c) => c.id);

    const primaryMedia = conceptIds.length
      ? await db
          .select({ conceptId: conceptMedia.conceptId, publicUrl: conceptMedia.publicUrl })
          .from(conceptMedia)
          .where(and(inArray(conceptMedia.conceptId, conceptIds), eq(conceptMedia.isPrimary, true)))
      : [];

    const publicUrlByConcept = new Map(primaryMedia.map((m) => [m.conceptId, m.publicUrl]));

    return {
      ...category,
      concepts: conceptRows.map((concept) => ({
        ...concept,
        publicUrl: publicUrlByConcept.get(concept.id) ?? null,
      })),
    };
  });
}
