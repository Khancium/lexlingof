import type { FastifyInstance } from "fastify";
import { and, eq, gte, ilike, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { categories, conceptMedia, concepts, wordRecordings } from "../../db/schema.js";
import { hasPermission, verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";

const listQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  search: z.string().min(1).optional(),
  // Admin-only in practice (the contributor browse UI has no date picker),
  // but kept on the shared public endpoint rather than a separate
  // admin-only list route -- see the module-level note in admin.routes.ts
  // about not duplicating concept/scene listing.
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  hasImage: z.enum(["yes", "no"]).optional(),
  // Volunteer's "my own additions" filter -- true restricts the list to
  // concepts this caller themselves created (concepts.createdBy). Same
  // convention as the scene/sentence list routes.
  mine: z.coerce.boolean().optional(),
  // Admin-only: include hidden (isActive false, not deleted) concepts too.
  // Silently ignored for anyone without concepts.manage -- see the check
  // below -- so a contributor can never pass this to see hidden items.
  includeHidden: z.coerce.boolean().optional(),
  // 1000 (not 200) so admin pages can fetch the full concept list in one
  // request for client-side matching (e.g. the bulk-add-images-by-URL and
  // scene-coverage pickers) without paginating just to build a lookup map.
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function conceptsRoutes(fastify: FastifyInstance) {
  fastify.get("/concepts", { preHandler: verifyToken }, async (request) => {
    const { categoryId, search, createdFrom, createdTo, hasImage, mine, includeHidden, limit, offset } = listQuerySchema.parse(
      request.query,
    );

    const canSeeHidden = includeHidden && (await hasPermission(request.user!.role, "concepts.manage"));
    const conditions = canSeeHidden ? [isNull(concepts.deletedAt)] : [eq(concepts.isActive, true), isNull(concepts.deletedAt)];
    if (categoryId) {
      conditions.push(eq(concepts.categoryId, categoryId));
    }
    if (mine) {
      conditions.push(eq(concepts.createdBy, request.user!.id));
    }
    if (search) {
      conditions.push(ilike(concepts.labelEnglish, `%${search}%`));
    }
    if (createdFrom) {
      conditions.push(gte(concepts.createdAt, new Date(createdFrom)));
    }
    if (createdTo) {
      conditions.push(lte(concepts.createdAt, new Date(createdTo)));
    }
    // Literal, table-qualified SQL text rather than interpolating
    // ${concepts.id} -- drizzle renders an interpolated column as a bare,
    // unqualified name, and concept_media has its own "id" column too, so a
    // bare "id" inside this subquery would resolve to concept_media.id
    // instead of the outer concepts.id (comparing a row against itself),
    // exactly the pitfall documented in ARCHITECTURE.md §2.7.
    if (hasImage === "yes") {
      conditions.push(sql`exists (select 1 from concept_media where concept_media.concept_id = concepts.id)`);
    } else if (hasImage === "no") {
      conditions.push(sql`not exists (select 1 from concept_media where concept_media.concept_id = concepts.id)`);
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
          createdAt: concepts.createdAt,
          createdBy: concepts.createdBy,
          isActive: concepts.isActive,
          imageUrl: conceptMedia.publicUrl,
          imageMediaId: conceptMedia.id,
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
