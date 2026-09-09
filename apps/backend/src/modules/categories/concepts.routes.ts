import type { FastifyInstance } from "fastify";
import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { categories, conceptMedia, concepts, wordRecordings } from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";

const listQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function conceptsRoutes(fastify: FastifyInstance) {
  fastify.get("/concepts", { preHandler: verifyToken }, async (request) => {
    const { categoryId, search, limit, offset } = listQuerySchema.parse(request.query);

    const conditions = [eq(concepts.isActive, true), isNull(concepts.deletedAt)];
    if (categoryId) {
      conditions.push(eq(concepts.categoryId, categoryId));
    }
    if (search) {
      conditions.push(ilike(concepts.labelEnglish, `%${search}%`));
    }

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: concepts.id,
          categoryId: concepts.categoryId,
          categoryName: categories.nameEnglish,
          slug: concepts.slug,
          labelEnglish: concepts.labelEnglish,
          description: concepts.description,
          imageUrl: conceptMedia.publicUrl,
          // Tile shading needs a per-user "have I already recorded this
          // concept" signal -- computed here in the list query itself so the
          // tile grid doesn't need N follow-up requests to find out.
          hasContributed: sql<boolean>`exists (
            select 1 from ${wordRecordings}
            where ${wordRecordings.conceptId} = ${concepts.id}
              and ${wordRecordings.userId} = ${request.user!.id}
              and ${wordRecordings.deletedAt} is null
          )`,
        })
        .from(concepts)
        .innerJoin(categories, eq(categories.id, concepts.categoryId))
        .leftJoin(conceptMedia, and(eq(conceptMedia.conceptId, concepts.id), eq(conceptMedia.isPrimary, true)))
        .where(and(...conditions))
        .limit(limit)
        .offset(offset),
      db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(concepts).where(and(...conditions)),
    ]);

    return { items: rows, limit, offset, total: totalRow?.value ?? 0 };
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
      category: { id: row.categoryId, name: row.categoryName, slug: row.categorySlug },
      media,
    };
  });
}
