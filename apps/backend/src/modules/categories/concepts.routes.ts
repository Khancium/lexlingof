import type { FastifyInstance } from "fastify";
import { and, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { categories, conceptMedia, concepts } from "../../db/schema.js";
import { HttpError } from "../../utils/http-error.js";

const listQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function conceptsRoutes(fastify: FastifyInstance) {
  fastify.get("/concepts", async (request) => {
    const { categoryId, search, limit, offset } = listQuerySchema.parse(request.query);

    const conditions = [eq(concepts.isActive, true), isNull(concepts.deletedAt)];
    if (categoryId) {
      conditions.push(eq(concepts.categoryId, categoryId));
    }
    if (search) {
      conditions.push(ilike(concepts.labelEnglish, `%${search}%`));
    }

    const rows = await db
      .select({
        id: concepts.id,
        categoryId: concepts.categoryId,
        categoryName: categories.nameEnglish,
        slug: concepts.slug,
        labelEnglish: concepts.labelEnglish,
        description: concepts.description,
        difficulty: concepts.difficulty,
      })
      .from(concepts)
      .innerJoin(categories, eq(categories.id, concepts.categoryId))
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    return { items: rows, limit, offset };
  });

  fastify.get("/concepts/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);

    // These two don't depend on each other -- both only need `id`, which is
    // already known from the path param -- so they run in parallel instead
    // of as two sequential round trips.
    const [[row], media] = await Promise.all([
      db
        .select({
          id: concepts.id,
          slug: concepts.slug,
          labelEnglish: concepts.labelEnglish,
          description: concepts.description,
          difficulty: concepts.difficulty,
          isActive: concepts.isActive,
          deletedAt: concepts.deletedAt,
          categoryId: categories.id,
          categoryName: categories.nameEnglish,
          categorySlug: categories.slug,
        })
        .from(concepts)
        .innerJoin(categories, eq(categories.id, concepts.categoryId))
        .where(eq(concepts.id, id))
        .limit(1),
      db.select().from(conceptMedia).where(eq(conceptMedia.conceptId, id)),
    ]);

    if (!row || !row.isActive || row.deletedAt) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    return {
      id: row.id,
      slug: row.slug,
      labelEnglish: row.labelEnglish,
      description: row.description,
      difficulty: row.difficulty,
      category: { id: row.categoryId, name: row.categoryName, slug: row.categorySlug },
      media,
    };
  });
}
