import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { sentenceCategories, sentences } from "../../db/schema.js";
import { forbidVolunteers, requirePermission, verifyToken } from "../../middleware/auth.js";
import { writeAuditLog } from "../../services/audit-log.service.js";
import { createSentenceCategory, findSentenceCategoryByName } from "../../services/sentence.service.js";
import { HttpError } from "../../utils/http-error.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const nameSchema = z.string().trim().min(1).max(100);

const createSchema = z.object({ nameEnglish: nameSchema, sortOrder: z.number().int().min(0).optional() });
const updateSchema = z
  .object({ nameEnglish: nameSchema.optional(), sortOrder: z.number().int().min(0).optional(), isActive: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

/**
 * Categories for sentences (greetings, introductions, work, agriculture, household...). Anyone who can
 * manage sentences can read them -- a volunteer needs the list to add a sentence -- but creating,
 * renaming, reordering and deleting them is admin-only: a category is shared structure, not an item.
 */
export default async function sentenceCategoriesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", verifyToken);
  const read = requirePermission("sentences.manage");
  const write = [read, forbidVolunteers];

  fastify.get("/admin/sentence-categories", { preHandler: read }, async () => {
    const items = await db
      .select({
        id: sentenceCategories.id,
        slug: sentenceCategories.slug,
        nameEnglish: sentenceCategories.nameEnglish,
        sortOrder: sentenceCategories.sortOrder,
        isActive: sentenceCategories.isActive,
        createdAt: sentenceCategories.createdAt,
        sentenceCount: sql<number>`count(${sentences.id}) filter (where ${sentences.deletedAt} is null)`.mapWith(Number),
        activeSentenceCount: sql<number>`count(${sentences.id}) filter (where ${sentences.deletedAt} is null and ${sentences.isActive})`.mapWith(Number),
      })
      .from(sentenceCategories)
      .leftJoin(sentences, eq(sentences.sentenceCategoryId, sentenceCategories.id))
      .groupBy(sentenceCategories.id)
      .orderBy(asc(sentenceCategories.sortOrder), asc(sentenceCategories.nameEnglish));
    return { items };
  });

  fastify.post("/admin/sentence-categories", { preHandler: write }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const { category, created } = await createSentenceCategory(body.nameEnglish, body.sortOrder);

    if (created) {
      await writeAuditLog({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_sentence_category_create",
        resourceType: "sentence_category",
        resourceId: category.id,
        afterState: { nameEnglish: category.nameEnglish, slug: category.slug },
      });
    }
    // An existing category with that name comes back as-is (200) instead of an error or a duplicate.
    reply.code(created ? 201 : 200).send(category);
  });

  fastify.put("/admin/sentence-categories/:id", { preHandler: write }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateSchema.parse(request.body);

    const [existing] = await db.select().from(sentenceCategories).where(eq(sentenceCategories.id, id)).limit(1);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Sentence category not found");

    if (body.nameEnglish !== undefined) {
      const clash = await findSentenceCategoryByName(body.nameEnglish);
      if (clash && clash.id !== id) throw new HttpError(409, "DUPLICATE", `There is already a category called "${clash.nameEnglish}"`);
    }

    // The slug is deliberately left alone on a rename: imports and links may already use it.
    const [updated] = await db
      .update(sentenceCategories)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(sentenceCategories.id, id))
      .returning();

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_sentence_category_update",
      resourceType: "sentence_category",
      resourceId: id,
      beforeState: { nameEnglish: existing.nameEnglish, sortOrder: existing.sortOrder, isActive: existing.isActive },
      afterState: body,
    });
    return updated;
  });

  fastify.delete("/admin/sentence-categories/:id", { preHandler: write }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);

    const [existing] = await db.select().from(sentenceCategories).where(eq(sentenceCategories.id, id)).limit(1);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Sentence category not found");

    // Counts hidden and soft-deleted sentences too: the foreign key would refuse the delete anyway, and
    // "move or permanently delete them first" is a clearer answer than a constraint error.
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(sentences)
      .where(eq(sentences.sentenceCategoryId, id));
    if (n > 0) {
      throw new HttpError(409, "CATEGORY_NOT_EMPTY", `This category still has ${n} sentence(s) -- move or permanently delete them first, or just hide the category`);
    }

    await db.delete(sentenceCategories).where(eq(sentenceCategories.id, id));
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_sentence_category_delete",
      resourceType: "sentence_category",
      resourceId: id,
      beforeState: { nameEnglish: existing.nameEnglish, slug: existing.slug },
    });
    reply.code(204).send();
  });
}
