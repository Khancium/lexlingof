import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { categories, conceptMedia, concepts, wordRecordings } from "../../db/schema.js";
import { hasPermission, verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";

const LIST_CACHE_TTL_MS = 30 * 60 * 1000;

type CategoryWithCount = Awaited<ReturnType<typeof loadActiveCategoriesWithCounts>>;

let listCache: { data: CategoryWithCount; expiresAt: number } | null = null;

/**
 * Call after any admin mutation that changes which concepts exist or which
 * category they belong to (create/delete/undo/bulk-edit categoryId) --
 * without this, a category tile's counter and progress bar on
 * /contribute/concept stayed wrong for up to LIST_CACHE_TTL_MS (30 minutes)
 * after the change, since the cache had no other invalidation trigger.
 */
export function invalidateCategoriesCache(): void {
  listCache = null;
}

/**
 * Two counts per category: `conceptCount` (every active concept -- what an
 * admin/volunteer sees, matching GET /concepts' own canManage bypass) and
 * `visibleConceptCount` (only concepts with at least one image -- what a
 * plain contributor sees). This cache is shared across every caller
 * regardless of role, so both have to be precomputed here; the route below
 * picks the right one per-request rather than baking a single answer into
 * the shared cache.
 */
async function loadActiveCategoriesWithCounts() {
  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder));

  const conceptRows = await db
    .select({
      categoryId: concepts.categoryId,
      hasImage: sql<boolean>`exists (select 1 from concept_media where concept_media.concept_id = concepts.id)`,
    })
    .from(concepts)
    .where(and(eq(concepts.isActive, true), isNull(concepts.deletedAt)));

  const countByCategory = new Map<string, number>();
  const visibleCountByCategory = new Map<string, number>();
  for (const row of conceptRows) {
    countByCategory.set(row.categoryId, (countByCategory.get(row.categoryId) ?? 0) + 1);
    if (row.hasImage) {
      visibleCountByCategory.set(row.categoryId, (visibleCountByCategory.get(row.categoryId) ?? 0) + 1);
    }
  }

  return categoryRows.map((category) => ({
    ...category,
    conceptCount: countByCategory.get(category.id) ?? 0,
    visibleConceptCount: visibleCountByCategory.get(category.id) ?? 0,
  }));
}

/**
 * How many distinct concepts this user has at least one live recording for,
 * per category -- for the category tiles' progress bars. Kept as its own
 * lightweight per-request query rather than folded into the cached
 * category+conceptCount list above, since that cache is shared across every
 * user and must stay user-agnostic.
 */
async function loadContributedCountsByCategory(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .selectDistinct({ categoryId: concepts.categoryId, conceptId: wordRecordings.conceptId })
    .from(wordRecordings)
    .innerJoin(concepts, eq(concepts.id, wordRecordings.conceptId))
    .where(and(eq(wordRecordings.userId, userId), isNull(wordRecordings.deletedAt)));

  const countByCategory = new Map<string, number>();
  for (const row of rows) {
    countByCategory.set(row.categoryId, (countByCategory.get(row.categoryId) ?? 0) + 1);
  }
  return countByCategory;
}

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function categoriesRoutes(fastify: FastifyInstance) {
  fastify.get("/categories", { preHandler: verifyToken }, async (request) => {
    if (!listCache || listCache.expiresAt <= Date.now()) {
      listCache = { data: await loadActiveCategoriesWithCounts(), expiresAt: Date.now() + LIST_CACHE_TTL_MS };
    }
    const [canManage, contributedByCategory] = await Promise.all([
      hasPermission(request.user!.role, "concepts.manage"),
      loadContributedCountsByCategory(request.user!.id),
    ]);
    return listCache.data.map(({ visibleConceptCount, ...c }) => ({
      ...c,
      conceptCount: canManage ? c.conceptCount : visibleConceptCount,
      contributedCount: contributedByCategory.get(c.id) ?? 0,
    }));
  });

  // No admin path calls this route (unused by the current frontend
  // entirely, in fact) -- kept unauthenticated like it already was, and the
  // image requirement here is unconditional, matching how GET /concepts/:id
  // treats an equally admin-less lookup.
  fastify.get("/categories/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);

    // category and conceptRows are both keyed only on the route param -- fetched
    // concurrently instead of gating conceptRows on category's existence check.
    const [[category], conceptRows] = await Promise.all([
      db.select().from(categories).where(eq(categories.id, id)).limit(1),
      db
        .select()
        .from(concepts)
        .where(
          and(
            eq(concepts.categoryId, id),
            eq(concepts.isActive, true),
            isNull(concepts.deletedAt),
            sql`exists (select 1 from concept_media where concept_media.concept_id = concepts.id)`,
          ),
        )
        .orderBy(asc(concepts.sortOrder)),
    ]);

    if (!category) {
      throw new HttpError(404, "NOT_FOUND", "Category not found");
    }

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
