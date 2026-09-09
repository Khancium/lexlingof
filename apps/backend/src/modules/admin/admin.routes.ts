import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { parse as csvParse } from "csv-parse/sync";
import { ZipArchive } from "archiver";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  audioFiles,
  audioUploads,
  categories,
  concepts,
  conceptMedia,
  contributionKeywords,
  contributionModule,
  contributions,
  contributionStatus,
  contributorDemographics,
  dialects,
  educationLevelEnum,
  gamificationConfig,
  genderEnum,
  languages,
  featureFlags,
  auditLogs,
  quarters,
  scenes,
  sceneConcepts,
  sceneContributions,
  sceneDifficulty,
  sceneImageKeywords,
  sceneMedia,
  sentences,
  subTribes,
  transcriptions,
  translations,
  tribes,
  userRole,
  users,
  userStats,
  villages,
  wordRecordings,
} from "../../db/schema.js";
import { invalidateUserCache, requirePermission, verifyToken } from "../../middleware/auth.js";
import { deleteUserAccount } from "../../services/account.service.js";
import { invalidateLevelThresholdsCache } from "../../services/level.service.js";
import { storageService } from "../../services/storage.service.js";
import { HttpError } from "../../utils/http-error.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

async function writeAuditLog(params: {
  actorId: string;
  actorRole: (typeof userRole.enumValues)[number] | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}) {
  await db.insert(auditLogs).values({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    beforeState: params.beforeState ?? null,
    afterState: params.afterState ?? null,
  });
}

async function readImageFile(request: FastifyRequest) {
  const file = await request.file();
  if (!file) {
    throw new HttpError(400, "MISSING_FILE", "A multipart image file is required");
  }
  if (!file.mimetype.startsWith("image/")) {
    throw new HttpError(400, "INVALID_FILE_TYPE", "Only image files are accepted");
  }

  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(400, "FILE_TOO_LARGE", `Image exceeds the ${MAX_IMAGE_BYTES} byte limit`);
  }

  return { buffer, filename: file.filename, mimetype: file.mimetype };
}

async function insertConceptMedia(conceptId: string, buffer: Buffer, filename: string) {
  const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
  const storageFilename = `concepts/${conceptId}/${randomUUID()}.${ext}`;
  const { path, publicUrl, mimeType, fileSizeBytes } = await storageService.uploadSceneImage(buffer, storageFilename);

  const [existingCount] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(conceptMedia)
    .where(eq(conceptMedia.conceptId, conceptId));
  const isPrimary = (existingCount?.value ?? 0) === 0;

  const [media] = await db
    .insert(conceptMedia)
    .values({ conceptId, storageKey: path, publicUrl, mimeType, fileSizeBytes, isPrimary })
    .returning();
  return media;
}

async function addConceptImageFromUrl(conceptId: string, imageUrl: string) {
  const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  if (!concept) {
    throw new HttpError(404, "NOT_FOUND", "Concept not found");
  }
  const { buffer, filename } = await storageService.fetchImageFromUrl(imageUrl);
  return insertConceptMedia(conceptId, buffer, filename);
}

async function insertSceneMedia(sceneId: string, buffer: Buffer, filename: string) {
  const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
  const storageFilename = `scenes/${sceneId}/${randomUUID()}.${ext}`;
  const { path, publicUrl, mimeType } = await storageService.uploadSceneImage(buffer, storageFilename);

  const [existingCount] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(sceneMedia)
    .where(eq(sceneMedia.sceneId, sceneId));
  const isPrimary = (existingCount?.value ?? 0) === 0;

  const [media] = await db
    .insert(sceneMedia)
    .values({ sceneId, storageKey: path, publicUrl, mimeType, isPrimary })
    .returning();
  return media;
}

async function addSceneImageFromUrl(sceneId: string, imageUrl: string) {
  const [scene] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, sceneId)).limit(1);
  if (!scene) {
    throw new HttpError(404, "NOT_FOUND", "Scene not found");
  }
  const { buffer, filename } = await storageService.fetchImageFromUrl(imageUrl);
  return insertSceneMedia(sceneId, buffer, filename);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const MAX_BULK_FILE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Bulk-import file formats: CSV (header row + data rows) or JSON (an array
 * of row objects). Both parse down to the same `Record<string, string>[]`
 * shape so every bulk endpoint below only has to deal with one representation
 * regardless of which format the admin uploaded.
 */
async function readBulkRows(request: FastifyRequest): Promise<Record<string, string>[]> {
  const file = await request.file();
  if (!file) {
    throw new HttpError(400, "MISSING_FILE", "A CSV or JSON file is required");
  }

  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_BULK_FILE_BYTES) {
    throw new HttpError(400, "FILE_TOO_LARGE", `File exceeds the ${MAX_BULK_FILE_BYTES} byte limit`);
  }

  const isJson = file.filename.toLowerCase().endsWith(".json") || file.mimetype === "application/json";

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf-8"));
    } catch {
      throw new HttpError(400, "INVALID_FILE", "File is not valid JSON");
    }
    if (!Array.isArray(parsed)) {
      throw new HttpError(400, "INVALID_FILE", "JSON file must contain an array of row objects");
    }
    return parsed.map((row) =>
      Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)])),
    );
  }

  try {
    return csvParse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  } catch {
    throw new HttpError(400, "INVALID_FILE", "File is not valid CSV");
  }
}

type BulkResult = { created: number; errors: { row: number; message: string }[] };

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const idParamSchema = z.object({ id: z.string().uuid() });
const keyParamSchema = z.object({ key: z.string().min(1) });

const contributionsQuerySchema = z.object({
  status: z.enum(contributionStatus.enumValues).optional(),
  module_type: z.enum(contributionModule.enumValues).optional(),
  language_id: z.string().uuid().optional(),
  dialect_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  // Contributor display name or email -- distinct from a module's own text
  // content, which isn't searched here.
  search: z.string().min(1).optional(),
  tribe_id: z.string().uuid().optional(),
  sub_tribe_id: z.string().uuid().optional(),
  country: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  village_id: z.string().uuid().optional(),
  quarter_id: z.string().uuid().optional(),
  gender: z.enum(genderEnum.enumValues).optional(),
  education_level: z.enum(educationLevelEnum.enumValues).optional(),
  profession: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateRemarksSchema = z.object({ remarks: z.string().trim().max(2000) });
const addContributionKeywordSchema = z.object({ keyword: z.string().trim().min(1).max(100) });
const contributionKeywordParamSchema = z.object({ id: z.string().uuid(), keywordId: z.string().uuid() });

const updateContributionStatusSchema = z.object({
  status: z.enum(contributionStatus.enumValues),
  reason: z.string().optional(),
});

const usersQuerySchema = z.object({
  role: z.enum(userRole.enumValues).optional(),
  search: z.string().optional(),
  status: z.enum(["active", "restricted", "suspended"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const suspendUserSchema = z.object({ reason: z.string().min(1) });
const cooloffUserSchema = z.object({ reason: z.string().min(1), days: z.coerce.number().int().min(1).max(365) });
const restrictUserSchema = z.object({ reason: z.string().min(1) });

const createConceptSchema = z.object({
  categoryId: z.string().uuid(),
  labelEnglish: z.string().min(1),
  description: z.string().optional(),
});

const updateConceptSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    labelEnglish: z.string().min(1).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

const imageUrlSchema = z.object({ imageUrl: z.string().url() });

// imageUrl is deliberately just a non-empty string here (not `.url()`) --
// fetchImageFromUrl() does its own URL parsing per item, so one malformed
// URL in a bulk batch surfaces as that item's own error instead of a
// whole-request 400 that would block every valid row alongside it.
const bulkConceptImageUrlSchema = z.object({
  items: z.array(z.object({ conceptId: z.string().uuid(), imageUrl: z.string().min(1) })).min(1).max(200),
});

const bulkSceneImageUrlSchema = z.object({
  items: z.array(z.object({ sceneId: z.string().uuid(), imageUrl: z.string().min(1) })).min(1).max(200),
});

const bulkIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

const bulkEditConceptsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  categoryId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
}).refine((data) => data.categoryId !== undefined || data.isActive !== undefined, {
  message: "At least one field to change is required",
});

const createSceneSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  difficulty: z.enum(sceneDifficulty.enumValues).optional(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
});

const updateSceneSchema = z
  .object({
    slug: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    difficulty: z.enum(sceneDifficulty.enumValues).optional(),
    estimatedDurationSeconds: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
    isDaily: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

const bulkEditScenesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  difficulty: z.enum(sceneDifficulty.enumValues).optional(),
  isActive: z.boolean().optional(),
}).refine((data) => data.difficulty !== undefined || data.isActive !== undefined, {
  message: "At least one field to change is required",
});

const createSceneConceptSchema = z.object({
  sceneId: z.string().uuid(),
  conceptId: z.string().uuid(),
  categoryId: z.string().uuid(),
  importance: z.number().int().min(1).max(5).optional(),
});

const annotateSceneConceptSchema = z.object({
  annotatedPresence: z.boolean(),
  annotationSource: z.string().min(1),
});

const addSceneImageKeywordSchema = z.object({ keyword: z.string().trim().min(1).max(100) });
const sceneKeywordParamSchema = z.object({ id: z.string().uuid(), keywordId: z.string().uuid() });
const sceneMediaIdParamSchema = z.object({ mediaId: z.string().uuid() });

const sentencesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createSentenceSchema = z.object({
  englishText: z.string().min(1),
  categoryId: z.string().uuid().optional(),
});

const bulkEditSentencesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  categoryId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
}).refine((data) => data.categoryId !== undefined || data.isActive !== undefined, {
  message: "At least one field to change is required",
});

const updateGamificationConfigSchema = z.object({ value: z.number() });
const updateFeatureFlagSchema = z.object({ isEnabled: z.boolean() });
const promoteAdminSchema = z.object({ userId: z.string().uuid() });

const auditLogsQuerySchema = z.object({
  action: z.string().optional(),
  resource_type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/* -------------------------------------------------------------------------- */
/*                                    Routes                                  */
/* -------------------------------------------------------------------------- */

export default async function adminRoutes(fastify: FastifyInstance) {
  // @fastify/multipart is now registered once, globally, in index.ts (with
  // a 110MB ceiling); MAX_IMAGE_BYTES below is this module's own, stricter
  // business-rule cap for concept/scene images specifically.

  fastify.addHook("preHandler", verifyToken);

  /* ------------------------------ Contributions ------------------------------ */

  fastify.get("/admin/contributions", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const q = contributionsQuerySchema.parse(request.query);

    const conditions = [isNull(contributions.deletedAt)];
    if (q.status) conditions.push(eq(contributions.status, q.status));
    if (q.module_type) conditions.push(eq(contributions.moduleType, q.module_type));
    if (q.language_id) conditions.push(eq(contributions.languageId, q.language_id));
    if (q.dialect_id) conditions.push(eq(contributions.dialectId, q.dialect_id));
    if (q.user_id) conditions.push(eq(contributions.userId, q.user_id));
    if (q.search) conditions.push(or(ilike(users.displayName, `%${q.search}%`), ilike(users.email, `%${q.search}%`))!);
    if (q.tribe_id) conditions.push(eq(contributorDemographics.tribeId, q.tribe_id));
    if (q.sub_tribe_id) conditions.push(eq(contributorDemographics.subTribeId, q.sub_tribe_id));
    if (q.country) conditions.push(eq(contributorDemographics.country, q.country));
    if (q.city) conditions.push(eq(contributorDemographics.city, q.city));
    if (q.village_id) conditions.push(eq(contributorDemographics.villageId, q.village_id));
    if (q.quarter_id) conditions.push(eq(contributorDemographics.quarterId, q.quarter_id));
    if (q.gender) conditions.push(eq(contributorDemographics.gender, q.gender));
    if (q.education_level) conditions.push(eq(contributorDemographics.educationLevel, q.education_level));
    if (q.profession) conditions.push(ilike(contributorDemographics.profession, `%${q.profession}%`));
    const whereClause = and(...conditions);

    // Demographics-based filters (and the search-by-contributor box) need
    // the same joins present on both the page query and the count query, or
    // a filtered page could report a total from an unfiltered count -- so
    // the join chain is duplicated here rather than factored out (drizzle's
    // builder types don't abstract cleanly across a varying select()).
    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          contributionId: contributions.id,
          moduleType: contributions.moduleType,
          status: contributions.status,
          submittedAt: contributions.submittedAt,
          remarks: contributions.remarks,
          contributorId: users.id,
          contributorDisplayName: users.displayName,
          contributorEmail: users.email,
          wordNativeWord: wordRecordings.nativeWord,
          wordDurationMs: wordRecordings.durationMs,
          wordAudioFileId: wordRecordings.audioFileId,
          audioTitle: audioUploads.title,
          audioNativeText: transcriptions.nativeText,
          audioAudioFileId: audioUploads.audioFileId,
          translationNativeText: translations.nativeText,
          translationEnglishText: sentences.englishText,
          translationAudioFileId: translations.audioFileId,
          sceneTitle: scenes.title,
          sceneAudioFileId: sceneContributions.audioFileId,
        })
        .from(contributions)
        .innerJoin(users, eq(users.id, contributions.userId))
        .leftJoin(contributorDemographics, eq(contributorDemographics.userId, users.id))
        .leftJoin(wordRecordings, eq(wordRecordings.id, contributions.wordRecordingId))
        .leftJoin(audioUploads, eq(audioUploads.id, contributions.audioUploadId))
        .leftJoin(transcriptions, and(eq(transcriptions.audioUploadId, audioUploads.id), eq(transcriptions.isCurrent, true)))
        .leftJoin(translations, eq(translations.id, contributions.translationId))
        .leftJoin(sentences, eq(sentences.id, translations.sentenceId))
        .leftJoin(sceneContributions, eq(sceneContributions.id, contributions.sceneContributionId))
        .leftJoin(scenes, eq(scenes.id, sceneContributions.sceneId))
        .where(whereClause)
        .orderBy(desc(contributions.submittedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(contributions)
        .innerJoin(users, eq(users.id, contributions.userId))
        .leftJoin(contributorDemographics, eq(contributorDemographics.userId, users.id))
        .where(whereClause),
    ]);

    const items = rows.map((row) => {
      let detail: Record<string, unknown> = {};
      switch (row.moduleType) {
        case "WORD":
          detail = { nativeWord: row.wordNativeWord, durationMs: row.wordDurationMs, audioFileId: row.wordAudioFileId };
          break;
        case "TRANSCRIPTION":
          detail = { title: row.audioTitle, nativeText: row.audioNativeText, audioFileId: row.audioAudioFileId };
          break;
        case "TRANSLATION":
          detail = {
            nativeText: row.translationNativeText,
            englishText: row.translationEnglishText,
            audioFileId: row.translationAudioFileId,
          };
          break;
        case "SCENE":
          detail = { title: row.sceneTitle, audioFileId: row.sceneAudioFileId };
          break;
      }
      return {
        contributionId: row.contributionId,
        moduleType: row.moduleType,
        status: row.status,
        submittedAt: row.submittedAt,
        remarks: row.remarks,
        contributor: { id: row.contributorId, displayName: row.contributorDisplayName, email: row.contributorEmail },
        detail,
      };
    });

    return { items, limit: q.limit, offset: q.offset, total: totalRow?.value ?? 0 };
  });

  fastify.put("/admin/contributions/:id/remarks", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { remarks } = updateRemarksSchema.parse(request.body);

    const [existing] = await db.select({ id: contributions.id }).from(contributions).where(eq(contributions.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Contribution not found");
    }

    await db.update(contributions).set({ remarks: remarks || null, updatedAt: new Date() }).where(eq(contributions.id, id));

    return { id, remarks: remarks || null };
  });

  fastify.delete("/admin/contributions/:id", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [existing] = await db.select({ id: contributions.id }).from(contributions).where(eq(contributions.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Contribution not found");
    }

    await db.update(contributions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contributions.id, id));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_contribution_delete",
      resourceType: "contribution",
      resourceId: id,
    });

    return { id, deleted: true };
  });

  // Bulk versions of the single-row status/delete actions above, for the
  // admin contributions page's checkbox multi-select. Each id is processed
  // independently (skipping ones that don't exist or are already deleted)
  // rather than failing the whole batch on one bad id, and gets its own
  // audit log entry -- same as if an admin had clicked each row by hand.
  fastify.post("/admin/contributions/bulk-status", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { ids, status, reason } = z
      .object({ ids: z.array(z.string().uuid()).min(1), status: z.enum(contributionStatus.enumValues), reason: z.string().optional() })
      .parse(request.body);

    const rows = await db.select({ id: contributions.id, status: contributions.status }).from(contributions).where(inArray(contributions.id, ids));
    if (rows.length === 0) return { updated: 0 };

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "rejected") updates.rejectionReason = reason ?? null;

    await db.update(contributions).set(updates).where(inArray(contributions.id, rows.map((r) => r.id)));

    const actorRole = request.user!.role;
    await Promise.all(
      rows.map((row) =>
        writeAuditLog({
          actorId: request.user!.id,
          actorRole,
          action: "admin_contribution_status_change",
          resourceType: "contribution",
          resourceId: row.id,
          beforeState: { status: row.status },
          afterState: { status, reason: reason ?? null },
        }),
      ),
    );

    return { updated: rows.length };
  });

  fastify.post("/admin/contributions/bulk-delete", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    const rows = await db
      .select({ id: contributions.id })
      .from(contributions)
      .where(and(inArray(contributions.id, ids), isNull(contributions.deletedAt)));
    if (rows.length === 0) return { deleted: 0 };

    await db.update(contributions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(contributions.id, rows.map((r) => r.id)));

    const actorRole = request.user!.role;
    await Promise.all(
      rows.map((row) =>
        writeAuditLog({
          actorId: request.user!.id,
          actorRole,
          action: "admin_contribution_delete",
          resourceType: "contribution",
          resourceId: row.id,
        }),
      ),
    );

    return { deleted: rows.length };
  });

  /* --------------------------- Contribution keywords -------------------------- */
  // ADMIN ONLY: free-text training-data labels for any of the four modules'
  // contributions. Never exposed to contributors.

  fastify.get("/admin/contributions/:id/keywords", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const items = await db
      .select({ id: contributionKeywords.id, keyword: contributionKeywords.keyword })
      .from(contributionKeywords)
      .where(eq(contributionKeywords.contributionId, id))
      .orderBy(asc(contributionKeywords.createdAt));

    return { items };
  });

  fastify.post("/admin/contributions/:id/keywords", { preHandler: requirePermission("contributions.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = addContributionKeywordSchema.parse(request.body);

    const [contribution] = await db.select({ id: contributions.id }).from(contributions).where(eq(contributions.id, id)).limit(1);
    if (!contribution) {
      throw new HttpError(404, "NOT_FOUND", "Contribution not found");
    }

    const [keyword] = await db
      .insert(contributionKeywords)
      .values({ contributionId: id, keyword: body.keyword })
      .onConflictDoNothing({ target: [contributionKeywords.contributionId, contributionKeywords.keyword] })
      .returning();

    if (!keyword) {
      throw new HttpError(409, "DUPLICATE_KEYWORD", "That keyword is already on this contribution");
    }

    reply.code(201).send(keyword);
  });

  fastify.delete(
    "/admin/contributions/:id/keywords/:keywordId",
    { preHandler: requirePermission("contributions.manage") },
    async (request, reply) => {
      const { id, keywordId } = contributionKeywordParamSchema.parse(request.params);

      const deleted = await db
        .delete(contributionKeywords)
        .where(and(eq(contributionKeywords.id, keywordId), eq(contributionKeywords.contributionId, id)))
        .returning({ id: contributionKeywords.id });

      if (deleted.length === 0) {
        throw new HttpError(404, "NOT_FOUND", "Keyword not found on this contribution");
      }

      reply.code(204).send();
    },
  );

  fastify.put("/admin/contributions/:id/status", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateContributionStatusSchema.parse(request.body);

    const [contribution] = await db.select({ status: contributions.status }).from(contributions).where(eq(contributions.id, id)).limit(1);
    if (!contribution) {
      throw new HttpError(404, "NOT_FOUND", "Contribution not found");
    }

    const updates: Record<string, unknown> = { status: body.status, updatedAt: new Date() };
    if (body.status === "rejected") {
      updates.rejectionReason = body.reason ?? null;
    }

    await db.update(contributions).set(updates).where(eq(contributions.id, id));

    const actorRole = request.user!.role;
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole,
      action: "admin_contribution_status_change",
      resourceType: "contribution",
      resourceId: id,
      beforeState: { status: contribution.status },
      afterState: { status: body.status, reason: body.reason ?? null },
    });

    return { id, status: body.status };
  });

  // Admin-only download variant of the regular /audio/:id/play-url -- same
  // presigned GET, but with a Content-Disposition that forces a save-as
  // instead of inline playback. Kept separate from the general audio module
  // (rather than adding a query param there) so this stays gated behind
  // contributions.manage specifically.
  fastify.get("/admin/audio/:id/download-url", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [audioFile] = await db
      .select({ storageKey: audioFiles.storageKey, format: audioFiles.format })
      .from(audioFiles)
      .where(eq(audioFiles.id, id))
      .limit(1);
    if (!audioFile) {
      throw new HttpError(404, "NOT_FOUND", "Audio file not found");
    }

    const url = await storageService.generateAudioDownloadUrl(audioFile.storageKey, `${id}.${audioFile.format}`);
    return { url };
  });

  // Bulk download as a single zip -- used when 2+ rows are selected on the
  // admin contributions page, instead of triggering N separate browser
  // downloads (which several browsers throttle/block past the first few).
  // Streams straight from R2 through archiver into the response instead of
  // buffering the whole zip in memory first.
  fastify.post("/admin/contributions/bulk-download-zip", { preHandler: requirePermission("contributions.manage") }, async (request, reply) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    const rows = await db
      .select({
        contributionId: contributions.id,
        moduleType: contributions.moduleType,
        contributorDisplayName: users.displayName,
        wordAudioFileId: wordRecordings.audioFileId,
        audioAudioFileId: audioUploads.audioFileId,
        translationAudioFileId: translations.audioFileId,
        sceneAudioFileId: sceneContributions.audioFileId,
      })
      .from(contributions)
      .innerJoin(users, eq(users.id, contributions.userId))
      .leftJoin(wordRecordings, eq(wordRecordings.id, contributions.wordRecordingId))
      .leftJoin(audioUploads, eq(audioUploads.id, contributions.audioUploadId))
      .leftJoin(translations, eq(translations.id, contributions.translationId))
      .leftJoin(sceneContributions, eq(sceneContributions.id, contributions.sceneContributionId))
      .where(inArray(contributions.id, ids));

    const targets = rows
      .map((row) => {
        const audioFileId =
          row.moduleType === "WORD"
            ? row.wordAudioFileId
            : row.moduleType === "TRANSCRIPTION"
              ? row.audioAudioFileId
              : row.moduleType === "TRANSLATION"
                ? row.translationAudioFileId
                : row.sceneAudioFileId;
        return { contributionId: row.contributionId, moduleType: row.moduleType, contributorDisplayName: row.contributorDisplayName, audioFileId };
      })
      .filter((t): t is typeof t & { audioFileId: string } => !!t.audioFileId);

    if (targets.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "None of the selected contributions have audio to download");
    }

    const audioRows = await db
      .select({ id: audioFiles.id, storageKey: audioFiles.storageKey, format: audioFiles.format })
      .from(audioFiles)
      .where(inArray(audioFiles.id, targets.map((t) => t.audioFileId)));
    const audioById = new Map(audioRows.map((a) => [a.id, a]));

    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="contributions-${Date.now()}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("warning", (err: Error) => console.error("[admin] zip warning:", err));
    archive.on("error", (err: Error) => console.error("[admin] zip error:", err));

    const usedNames = new Set<string>();
    for (const target of targets) {
      const audio = audioById.get(target.audioFileId);
      if (!audio) continue;
      const stream = await storageService.getAudioObjectStream(audio.storageKey);
      const safeName = `${target.moduleType}_${target.contributorDisplayName}_${target.contributionId.slice(0, 8)}.${audio.format}`.replace(
        /[^a-zA-Z0-9_.-]/g,
        "_",
      );
      let name = safeName;
      let suffix = 1;
      while (usedNames.has(name)) {
        name = `${safeName}_${++suffix}`;
      }
      usedNames.add(name);
      archive.append(stream, { name });
    }

    archive.finalize();
    return reply.send(archive);
  });

  /* ---------------------------------- Users ---------------------------------- */

  fastify.get("/admin/users", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { role, search, status, limit, offset } = usersQuerySchema.parse(request.query);

    const conditions = [isNull(users.deletedAt)];
    if (role) conditions.push(eq(users.role, role));
    if (search) conditions.push(or(ilike(users.displayName, `%${search}%`), ilike(users.email, `%${search}%`))!);
    if (status === "suspended") conditions.push(eq(users.isSuspended, true));
    if (status === "restricted") conditions.push(and(eq(users.isRestricted, true), eq(users.isSuspended, false))!);
    if (status === "active") conditions.push(and(eq(users.isSuspended, false), eq(users.isRestricted, false))!);
    const whereClause = and(...conditions);

    const selection = {
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      isSuspended: users.isSuspended,
      suspendedReason: users.suspendedReason,
      suspendedUntil: users.suspendedUntil,
      isRestricted: users.isRestricted,
      restrictedReason: users.restrictedReason,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      totalContributions: userStats.totalContributions,
      verifiedContributions: userStats.verifiedContributions,
      totalPoints: userStats.totalPoints,
      level: userStats.level,
    };

    const [items, [totalRow]] = await Promise.all([
      db
        .select(selection)
        .from(users)
        .leftJoin(userStats, eq(userStats.userId, users.id))
        .where(whereClause)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(users).where(whereClause),
    ]);

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  fastify.post("/admin/users/:id/restrict", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = restrictUserSchema.parse(request.body);

    const [user] = await db.select({ isRestricted: users.isRestricted }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

    await db
      .update(users)
      .set({ isRestricted: true, restrictedAt: new Date(), restrictedReason: body.reason, updatedAt: new Date() })
      .where(eq(users.id, id));
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_user_restrict",
      resourceType: "user",
      resourceId: id,
      beforeState: { isRestricted: user.isRestricted },
      afterState: { isRestricted: true, reason: body.reason },
    });

    return { id, isRestricted: true };
  });

  fastify.post("/admin/users/:id/unrestrict", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [user] = await db.select({ isRestricted: users.isRestricted }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

    await db
      .update(users)
      .set({ isRestricted: false, restrictedAt: null, restrictedReason: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_user_unrestrict",
      resourceType: "user",
      resourceId: id,
      beforeState: { isRestricted: user.isRestricted },
      afterState: { isRestricted: false },
    });

    return { id, isRestricted: false };
  });

  // A cool-off ban is just users.isSuspended with an expiry -- verifyToken
  // and login both already auto-lift it once suspendedUntil passes (see
  // middleware/auth.ts and auth.service.ts), so this route only needs to set
  // the expiry, not schedule anything.
  fastify.post("/admin/users/:id/cooloff", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = cooloffUserSchema.parse(request.body);
    const until = new Date(Date.now() + body.days * 24 * 60 * 60 * 1000);

    const [user] = await db.select({ isSuspended: users.isSuspended }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

    await db
      .update(users)
      .set({ isSuspended: true, suspendedAt: new Date(), suspendedReason: body.reason, suspendedUntil: until, updatedAt: new Date() })
      .where(eq(users.id, id));
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_user_cooloff",
      resourceType: "user",
      resourceId: id,
      beforeState: { isSuspended: user.isSuspended },
      afterState: { isSuspended: true, reason: body.reason, until: until.toISOString(), days: body.days },
    });

    return { id, isSuspended: true, suspendedUntil: until };
  });

  fastify.post("/admin/users/:id/suspend", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = suspendUserSchema.parse(request.body);

    const [user] = await db.select({ isSuspended: users.isSuspended }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    await db
      .update(users)
      .set({ isSuspended: true, suspendedAt: new Date(), suspendedReason: body.reason, suspendedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    invalidateUserCache(id);

    const actorRole = request.user!.role;
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole,
      action: "admin_user_suspend",
      resourceType: "user",
      resourceId: id,
      beforeState: { isSuspended: user.isSuspended },
      afterState: { isSuspended: true, reason: body.reason },
    });

    return { id, isSuspended: true };
  });

  fastify.post("/admin/users/:id/unsuspend", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [user] = await db.select({ isSuspended: users.isSuspended }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

    await db
      .update(users)
      .set({ isSuspended: false, suspendedAt: null, suspendedReason: null, suspendedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_user_unsuspend",
      resourceType: "user",
      resourceId: id,
      beforeState: { isSuspended: user.isSuspended },
      afterState: { isSuspended: false },
    });

    return { id, isSuspended: false };
  });

  // "Banning" a user IS deleting their account (per product decision) --
  // there's no separate permanent-suspend state. This reuses the exact same
  // soft-delete/PII-scrub used by the self-service /users/me DELETE, so an
  // admin-banned account behaves identically to a self-deleted one (corpus
  // data survives, email stays permanently blocked from re-registration).
  fastify.delete("/admin/users/:id", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [user] = await db.select({ email: users.email, deletedAt: users.deletedAt }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");
    if (user.deletedAt) throw new HttpError(409, "ALREADY_DELETED", "This account has already been deleted");

    await deleteUserAccount(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_user_ban_delete",
      resourceType: "user",
      resourceId: id,
      beforeState: { deletedAt: null },
      afterState: { deletedAt: new Date().toISOString() },
    });

    return { id, deleted: true };
  });

  /* ------------------------------- Concepts ------------------------------- */

  fastify.post("/admin/concepts", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const body = createConceptSchema.parse(request.body);

    const [category] = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, body.categoryId)).limit(1);
    if (!category) {
      throw new HttpError(404, "NOT_FOUND", "Category not found");
    }

    // concepts.slug is NOT NULL and globally unique; the request body has no
    // slug field, so this derives one from the category + label, matching
    // the convention used by the database seed (category-prefixed slug).
    const slug = `${category.slug}-${slugify(body.labelEnglish)}`;

    const [concept] = await db
      .insert(concepts)
      .values({
        categoryId: body.categoryId,
        slug,
        labelEnglish: body.labelEnglish,
        description: body.description ?? null,
      })
      .returning();

    reply.code(201).send(concept);
  });

  // Bulk create from a CSV or JSON file. Expected row fields: category
  // (slug or English name -- resolved against existing categories),
  // labelEnglish (required), description (optional). Rows that fail
  // validation are skipped and reported back individually rather than
  // failing the whole batch.
  fastify.post("/admin/concepts/bulk", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const rows = await readBulkRows(request);
    const allCategories = await db.select({ id: categories.id, slug: categories.slug, nameEnglish: categories.nameEnglish }).from(categories);
    const categoryByKey = new Map(
      allCategories.flatMap((c) => [
        [c.slug.toLowerCase(), c],
        [c.nameEnglish.toLowerCase(), c],
      ]),
    );

    const result: BulkResult = { created: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2; // +1 for 0-index, +1 for the header row
      const categoryKey = (row.category ?? "").trim().toLowerCase();
      const labelEnglish = (row.labelEnglish ?? "").trim();

      const category = categoryByKey.get(categoryKey);
      if (!category) {
        result.errors.push({ row: rowNum, message: `Unknown category "${row.category ?? ""}"` });
        continue;
      }
      if (!labelEnglish) {
        result.errors.push({ row: rowNum, message: "labelEnglish is required" });
        continue;
      }

      try {
        await db.insert(concepts).values({
          categoryId: category.id,
          slug: `${category.slug}-${slugify(labelEnglish)}`,
          labelEnglish,
          description: row.description?.trim() || null,
        });
        result.created++;
      } catch (err) {
        result.errors.push({ row: rowNum, message: err instanceof Error ? err.message : "Insert failed" });
      }
    }

    return result;
  });

  fastify.put("/admin/concepts/:id", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateConceptSchema.parse(request.body);

    const [existing] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    const [updated] = await db.update(concepts).set({ ...body, updatedAt: new Date() }).where(eq(concepts.id, id)).returning();
    return updated;
  });

  fastify.post("/admin/concepts/bulk-delete", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    await db.update(concepts).set({ isActive: false, deletedAt: new Date() }).where(inArray(concepts.id, ids));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_concept_bulk_delete",
      resourceType: "concept",
      afterState: { ids },
    });

    return { deleted: ids.length };
  });

  fastify.post("/admin/concepts/bulk-edit", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { ids, ...fields } = bulkEditConceptsSchema.parse(request.body);

    await db.update(concepts).set({ ...fields, updatedAt: new Date() }).where(inArray(concepts.id, ids));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_concept_bulk_edit",
      resourceType: "concept",
      afterState: { ids, ...fields },
    });

    return { updated: ids.length };
  });

  fastify.delete("/admin/concepts/:id", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [existing] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    await db.update(concepts).set({ isActive: false, deletedAt: new Date() }).where(eq(concepts.id, id));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_concept_delete",
      resourceType: "concept",
      resourceId: id,
    });

    return { id, deleted: true };
  });

  fastify.post("/admin/concepts/:id/media", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);

    const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!concept) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    const { buffer, filename } = await readImageFile(request);
    const media = await insertConceptMedia(id, buffer, filename);

    reply.code(201).send(media);
  });

  // Same as above but the image is fetched server-side from a third-party
  // URL instead of uploaded as multipart -- still re-encoded and re-hosted
  // through uploadSceneImage() so it ends up on our own CDN either way.
  fastify.post("/admin/concepts/:id/media/url", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { imageUrl } = imageUrlSchema.parse(request.body);

    const media = await addConceptImageFromUrl(id, imageUrl);
    reply.code(201).send(media);
  });

  // Bulk variant: a JSON array of {conceptId, imageUrl} pairs, one row per
  // concept. Unlike the CSV/JSON bulk-create endpoint, a URL fits inline in a
  // row so images can be assigned in bulk without touching each concept
  // individually. Each item is independent -- one bad URL doesn't block the
  // rest.
  fastify.post("/admin/concepts/media/bulk-url", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { items } = bulkConceptImageUrlSchema.parse(request.body);

    const results = await Promise.allSettled(items.map((item) => addConceptImageFromUrl(item.conceptId, item.imageUrl)));
    const errors = results.flatMap((r, i) =>
      r.status === "rejected" ? [{ row: i + 1, message: r.reason instanceof Error ? r.reason.message : "Failed" }] : [],
    );

    return { created: results.length - errors.length, errors };
  });

  /* --------------------------------- Scenes --------------------------------- */

  fastify.post("/admin/scenes", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const body = createSceneSchema.parse(request.body);

    const [scene] = await db
      .insert(scenes)
      .values({
        slug: body.slug,
        title: body.title,
        description: body.description ?? null,
        difficulty: body.difficulty ?? "medium",
        estimatedDurationSeconds: body.estimatedDurationSeconds ?? null,
      })
      .returning();

    reply.code(201).send(scene);
  });

  // Bulk create from a CSV or JSON file. Expected row fields: slug
  // (required, must be globally unique), title (required), description
  // (optional), difficulty (optional, one of sceneDifficulty's values,
  // defaults to "medium"), estimatedDurationSeconds (optional). Images
  // still have to be uploaded individually afterward via the media endpoint
  // -- bulk row data can't carry a file per row.
  fastify.post("/admin/scenes/bulk", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const rows = await readBulkRows(request);
    const result: BulkResult = { created: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2;
      const slug = (row.slug ?? "").trim();
      const title = (row.title ?? "").trim();

      if (!slug) {
        result.errors.push({ row: rowNum, message: "slug is required" });
        continue;
      }
      if (!title) {
        result.errors.push({ row: rowNum, message: "title is required" });
        continue;
      }
      const difficultyRaw = (row.difficulty ?? "medium").trim().toLowerCase();
      if (!sceneDifficulty.enumValues.includes(difficultyRaw as (typeof sceneDifficulty.enumValues)[number])) {
        result.errors.push({
          row: rowNum,
          message: `Invalid difficulty "${row.difficulty}" (must be one of ${sceneDifficulty.enumValues.join(", ")})`,
        });
        continue;
      }
      const estimatedDurationSeconds = row.estimatedDurationSeconds ? Number(row.estimatedDurationSeconds) : null;
      if (row.estimatedDurationSeconds && (!Number.isInteger(estimatedDurationSeconds) || estimatedDurationSeconds! <= 0)) {
        result.errors.push({ row: rowNum, message: `Invalid estimatedDurationSeconds "${row.estimatedDurationSeconds}"` });
        continue;
      }

      try {
        await db.insert(scenes).values({
          slug,
          title,
          description: row.description?.trim() || null,
          difficulty: difficultyRaw as (typeof sceneDifficulty.enumValues)[number],
          estimatedDurationSeconds,
        });
        result.created++;
      } catch (err) {
        result.errors.push({ row: rowNum, message: err instanceof Error ? err.message : "Insert failed" });
      }
    }

    return result;
  });

  fastify.put("/admin/scenes/:id", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateSceneSchema.parse(request.body);

    const [existing] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Scene not found");
    }

    const [updated] = await db.update(scenes).set({ ...body, updatedAt: new Date() }).where(eq(scenes.id, id)).returning();
    return updated;
  });

  fastify.post("/admin/scenes/bulk-delete", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    await db.update(scenes).set({ isActive: false, deletedAt: new Date() }).where(inArray(scenes.id, ids));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_scene_bulk_delete",
      resourceType: "scene",
      afterState: { ids },
    });

    return { deleted: ids.length };
  });

  fastify.post("/admin/scenes/bulk-edit", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { ids, ...fields } = bulkEditScenesSchema.parse(request.body);

    await db.update(scenes).set({ ...fields, updatedAt: new Date() }).where(inArray(scenes.id, ids));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_scene_bulk_edit",
      resourceType: "scene",
      afterState: { ids, ...fields },
    });

    return { updated: ids.length };
  });

  fastify.delete("/admin/scenes/:id", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [existing] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Scene not found");
    }

    await db.update(scenes).set({ isActive: false, deletedAt: new Date() }).where(eq(scenes.id, id));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_scene_delete",
      resourceType: "scene",
      resourceId: id,
    });

    return { id, deleted: true };
  });

  fastify.post("/admin/scenes/:id/media", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);

    const [scene] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!scene) {
      throw new HttpError(404, "NOT_FOUND", "Scene not found");
    }

    const { buffer, filename } = await readImageFile(request);
    const media = await insertSceneMedia(id, buffer, filename);

    reply.code(201).send(media);
  });

  fastify.post("/admin/scenes/:id/media/url", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { imageUrl } = imageUrlSchema.parse(request.body);

    const media = await addSceneImageFromUrl(id, imageUrl);
    reply.code(201).send(media);
  });

  // Bulk variant: a JSON array of {sceneId, imageUrl} pairs. Each item is
  // independent -- one bad URL doesn't block the rest.
  fastify.post("/admin/scenes/media/bulk-url", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { items } = bulkSceneImageUrlSchema.parse(request.body);

    const results = await Promise.allSettled(items.map((item) => addSceneImageFromUrl(item.sceneId, item.imageUrl)));
    const errors = results.flatMap((r, i) =>
      r.status === "rejected" ? [{ row: i + 1, message: r.reason instanceof Error ? r.reason.message : "Failed" }] : [],
    );

    return { created: results.length - errors.length, errors };
  });

  /* --------------------------- Scene image keywords -------------------------- */
  // ADMIN ONLY: free-text training-data labels. Never exposed to contributors.

  // Media-scoped: attaches to the exact image just uploaded above, which
  // matters because a re-upload isn't primary (a scene can end up with
  // several sceneMedia rows) -- the scene-scoped routes below resolve to
  // whichever image is primary, which would silently tag the wrong image
  // if used right after uploading a second one.
  fastify.post("/admin/scenes/media/:mediaId/keywords", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { mediaId } = sceneMediaIdParamSchema.parse(request.params);
    const body = addSceneImageKeywordSchema.parse(request.body);

    const [media] = await db.select({ id: sceneMedia.id }).from(sceneMedia).where(eq(sceneMedia.id, mediaId)).limit(1);
    if (!media) {
      throw new HttpError(404, "NOT_FOUND", "Scene image not found");
    }

    const [keyword] = await db
      .insert(sceneImageKeywords)
      .values({ sceneMediaId: mediaId, keyword: body.keyword })
      .onConflictDoNothing({ target: [sceneImageKeywords.sceneMediaId, sceneImageKeywords.keyword] })
      .returning();

    if (!keyword) {
      throw new HttpError(409, "DUPLICATE_KEYWORD", "That keyword is already on this image");
    }

    reply.code(201).send(keyword);
  });

  // Scene-scoped: resolved to that scene's primary image, used by the
  // standalone "Keywords" review/edit panel.

  fastify.get("/admin/scenes/:id/keywords", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [media] = await db
      .select({ id: sceneMedia.id })
      .from(sceneMedia)
      .where(and(eq(sceneMedia.sceneId, id), eq(sceneMedia.isPrimary, true)))
      .limit(1);
    if (!media) {
      return { items: [] };
    }

    const items = await db
      .select({ id: sceneImageKeywords.id, keyword: sceneImageKeywords.keyword })
      .from(sceneImageKeywords)
      .where(eq(sceneImageKeywords.sceneMediaId, media.id))
      .orderBy(asc(sceneImageKeywords.createdAt));

    return { items };
  });

  fastify.post("/admin/scenes/:id/keywords", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = addSceneImageKeywordSchema.parse(request.body);

    const [media] = await db
      .select({ id: sceneMedia.id })
      .from(sceneMedia)
      .where(and(eq(sceneMedia.sceneId, id), eq(sceneMedia.isPrimary, true)))
      .limit(1);
    if (!media) {
      throw new HttpError(400, "NO_IMAGE", "Upload an image for this scene before adding keywords");
    }

    const [keyword] = await db
      .insert(sceneImageKeywords)
      .values({ sceneMediaId: media.id, keyword: body.keyword })
      .onConflictDoNothing({ target: [sceneImageKeywords.sceneMediaId, sceneImageKeywords.keyword] })
      .returning();

    if (!keyword) {
      throw new HttpError(409, "DUPLICATE_KEYWORD", "That keyword is already on this image");
    }

    reply.code(201).send(keyword);
  });

  fastify.delete("/admin/scenes/:id/keywords/:keywordId", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id, keywordId } = sceneKeywordParamSchema.parse(request.params);

    const deleted = await db
      .delete(sceneImageKeywords)
      .where(
        and(
          eq(sceneImageKeywords.id, keywordId),
          inArray(
            sceneImageKeywords.sceneMediaId,
            db.select({ id: sceneMedia.id }).from(sceneMedia).where(eq(sceneMedia.sceneId, id)),
          ),
        ),
      )
      .returning({ id: sceneImageKeywords.id });

    if (deleted.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "Keyword not found on this scene");
    }

    reply.code(204).send();
  });

  /* ----------------------------- Scene concepts ----------------------------- */
  // ADMIN ONLY: this is the concept coverage map, never exposed to
  // contributors. Nothing in this file returns scene_concepts to a
  // contributor-facing route.

  fastify.post("/admin/scene-concepts", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const body = createSceneConceptSchema.parse(request.body);

    const [sceneConcept] = await db
      .insert(sceneConcepts)
      .values({
        sceneId: body.sceneId,
        conceptId: body.conceptId,
        categoryId: body.categoryId,
        importance: body.importance ?? 1,
      })
      .onConflictDoNothing({ target: [sceneConcepts.sceneId, sceneConcepts.conceptId] })
      .returning();

    if (!sceneConcept) {
      throw new HttpError(409, "DUPLICATE_COVERAGE", "That concept is already in this scene's coverage map");
    }

    reply.code(201).send(sceneConcept);
  });

  fastify.put("/admin/scene-concepts/:id/annotate", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = annotateSceneConceptSchema.parse(request.body);

    const [existing] = await db.select({ id: sceneConcepts.id }).from(sceneConcepts).where(eq(sceneConcepts.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Scene concept not found");
    }

    // annotated_presence is set ONLY here, by a human annotator acting
    // through this endpoint -- never inferred automatically or from audio.
    const [updated] = await db
      .update(sceneConcepts)
      .set({ annotatedPresence: body.annotatedPresence, annotationSource: body.annotationSource, annotationDate: new Date() })
      .where(eq(sceneConcepts.id, id))
      .returning();

    return updated;
  });

  /* ------------------------------- Sentences ------------------------------- */

  // No list endpoint exists anywhere else -- translation.routes.ts only
  // exposes a random single sentence and get-by-id, neither of which can
  // enumerate all sentences for an admin list view.
  fastify.get("/admin/sentences", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { limit, offset } = sentencesQuerySchema.parse(request.query);

    const [items, [totalRow]] = await Promise.all([
      db
        .select()
        .from(sentences)
        .where(isNull(sentences.deletedAt))
        .orderBy(desc(sentences.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(isNull(sentences.deletedAt)),
    ]);

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  fastify.post("/admin/sentences", { preHandler: requirePermission("sentences.manage") }, async (request, reply) => {
    const body = createSentenceSchema.parse(request.body);

    const [sentence] = await db
      .insert(sentences)
      .values({ englishText: body.englishText, categoryId: body.categoryId ?? null })
      .returning();

    reply.code(201).send(sentence);
  });

  // Bulk create from a CSV or JSON file. Expected row fields: englishText
  // (required), category (optional, slug or English name).
  fastify.post("/admin/sentences/bulk", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const rows = await readBulkRows(request);
    const allCategories = await db.select({ id: categories.id, slug: categories.slug, nameEnglish: categories.nameEnglish }).from(categories);
    const categoryByKey = new Map(
      allCategories.flatMap((c) => [
        [c.slug.toLowerCase(), c],
        [c.nameEnglish.toLowerCase(), c],
      ]),
    );

    const result: BulkResult = { created: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2;
      const englishText = (row.englishText ?? "").trim();

      if (!englishText) {
        result.errors.push({ row: rowNum, message: "englishText is required" });
        continue;
      }
      let categoryId: string | null = null;
      const categoryKey = (row.category ?? "").trim().toLowerCase();
      if (categoryKey) {
        const category = categoryByKey.get(categoryKey);
        if (!category) {
          result.errors.push({ row: rowNum, message: `Unknown category "${row.category}"` });
          continue;
        }
        categoryId = category.id;
      }

      try {
        await db.insert(sentences).values({ englishText, categoryId });
        result.created++;
      } catch (err) {
        result.errors.push({ row: rowNum, message: err instanceof Error ? err.message : "Insert failed" });
      }
    }

    return result;
  });

  fastify.post("/admin/sentences/bulk-delete", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    await db.update(sentences).set({ isActive: false, deletedAt: new Date() }).where(inArray(sentences.id, ids));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_sentence_bulk_delete",
      resourceType: "sentence",
      afterState: { ids },
    });

    return { deleted: ids.length };
  });

  fastify.post("/admin/sentences/bulk-edit", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { ids, ...fields } = bulkEditSentencesSchema.parse(request.body);

    await db.update(sentences).set({ ...fields, updatedAt: new Date() }).where(inArray(sentences.id, ids));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_sentence_bulk_edit",
      resourceType: "sentence",
      afterState: { ids, ...fields },
    });

    return { updated: ids.length };
  });

  fastify.delete("/admin/sentences/:id", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [existing] = await db.select({ id: sentences.id }).from(sentences).where(eq(sentences.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Sentence not found");
    }

    await db.update(sentences).set({ isActive: false, deletedAt: new Date() }).where(eq(sentences.id, id));

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_sentence_delete",
      resourceType: "sentence",
      resourceId: id,
    });

    return { id, deleted: true };
  });

  /* -------------------------------- Analytics -------------------------------- */

  fastify.get("/admin/analytics", { preHandler: requirePermission("analytics.read") }, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Added for the admin dashboard's overview cards -- nothing above
    // already exposes a total user count or "as of today" breakdowns
    // (contributionsPerDay groups by submission date, not verification date).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // None of these 7 reads depend on each other -- fetched concurrently
    // instead of as 7 sequential round trips, which matters because the DB
    // is in a different region from this backend.
    const [perDay, topContributors, [pendingRow], [storageRow], [totalUsersRow], [contributionsTodayRow], [verifiedTodayRow]] =
      await Promise.all([
        db
          .select({ day: sql<string>`date(${contributions.submittedAt})`, count: sql<number>`count(*)`.mapWith(Number) })
          .from(contributions)
          .where(gte(contributions.submittedAt, thirtyDaysAgo))
          .groupBy(sql`date(${contributions.submittedAt})`)
          .orderBy(sql`date(${contributions.submittedAt})`),
        db
          .select({
            userId: users.id,
            displayName: users.displayName,
            verifiedContributions: userStats.verifiedContributions,
            totalPoints: userStats.totalPoints,
          })
          .from(userStats)
          .innerJoin(users, eq(users.id, userStats.userId))
          .orderBy(desc(userStats.verifiedContributions))
          .limit(10),
        db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(contributions)
          .where(eq(contributions.status, "pending")),
        db
          .select({
            totalBytes: sql<number>`coalesce(sum(${audioFiles.fileSizeBytes}), 0)`.mapWith(Number),
            totalDurationMs: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)`.mapWith(Number),
            fileCount: sql<number>`count(*)`.mapWith(Number),
          })
          .from(audioFiles),
        db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(users)
          .where(isNull(users.deletedAt)),
        db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(contributions)
          .where(gte(contributions.submittedAt, todayStart)),
        db
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(contributions)
          .where(and(eq(contributions.status, "verified"), gte(contributions.verifiedAt, todayStart))),
      ]);

    return {
      contributionsPerDay: perDay,
      totalUsers: totalUsersRow?.value ?? 0,
      contributionsToday: contributionsTodayRow?.value ?? 0,
      verifiedToday: verifiedTodayRow?.value ?? 0,
      topContributors,
      reviewQueueDepth: pendingRow?.value ?? 0,
      audioStorage: {
        totalBytes: storageRow?.totalBytes ?? 0,
        totalDurationMs: storageRow?.totalDurationMs ?? 0,
        fileCount: storageRow?.fileCount ?? 0,
      },
    };
  });

  // A ready-to-consume manifest of {imageUrl, keywords} for both image-based
  // modules, meant to make building an AI training dataset straightforward:
  // Word/concept images get a single keyword (the concept's own label --
  // there's no separate annotation step for those), Scene images get
  // whatever free-text keywords were entered against them above.
  fastify.get("/admin/training-data/images", { preHandler: requirePermission("analytics.read") }, async () => {
    const [conceptRows, sceneMediaRows, sceneKeywordRows] = await Promise.all([
      db
        .select({ imageUrl: conceptMedia.publicUrl, label: concepts.labelEnglish })
        .from(conceptMedia)
        .innerJoin(concepts, eq(concepts.id, conceptMedia.conceptId))
        .where(isNull(concepts.deletedAt)),
      db.select({ id: sceneMedia.id, imageUrl: sceneMedia.publicUrl }).from(sceneMedia),
      db.select({ sceneMediaId: sceneImageKeywords.sceneMediaId, keyword: sceneImageKeywords.keyword }).from(sceneImageKeywords),
    ]);

    const keywordsByMedia = new Map<string, string[]>();
    for (const row of sceneKeywordRows) {
      const list = keywordsByMedia.get(row.sceneMediaId) ?? [];
      list.push(row.keyword);
      keywordsByMedia.set(row.sceneMediaId, list);
    }

    const items = [
      ...conceptRows
        .filter((r) => r.imageUrl)
        .map((r) => ({ module: "WORD" as const, imageUrl: r.imageUrl!, keywords: [r.label] })),
      ...sceneMediaRows
        .filter((r) => r.imageUrl)
        .map((r) => ({ module: "SCENE" as const, imageUrl: r.imageUrl!, keywords: keywordsByMedia.get(r.id) ?? [] })),
    ];

    return { items };
  });

  /* ------------------------------ Super-admin ------------------------------ */

  fastify.get("/superadmin/gamification", { preHandler: requirePermission("system.manage") }, async () => {
    return db.select().from(gamificationConfig).orderBy(asc(gamificationConfig.configKey));
  });

  fastify.put("/superadmin/gamification/:key", { preHandler: requirePermission("system.manage") }, async (request) => {
    const { key } = keyParamSchema.parse(request.params);
    const body = updateGamificationConfigSchema.parse(request.body);

    const [existing] = await db
      .select({ configValue: gamificationConfig.configValue })
      .from(gamificationConfig)
      .where(eq(gamificationConfig.configKey, key))
      .limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Config key not found");
    }

    const [updated] = await db
      .update(gamificationConfig)
      .set({ configValue: { value: body.value }, updatedBy: request.user!.id, updatedAt: new Date() })
      .where(eq(gamificationConfig.configKey, key))
      .returning();

    // Without this, a level threshold edit wouldn't take effect anywhere
    // (backend leveling logic or the frontend's progress-bar display) until
    // the 5-minute cache TTL happened to expire on its own.
    if (key.startsWith("levels.")) {
      invalidateLevelThresholdsCache();
    }

    const actorRole = request.user!.role;
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole,
      action: "superadmin_gamification_config_update",
      resourceType: "gamification_config",
      beforeState: { configKey: key, configValue: existing.configValue },
      afterState: { configKey: key, configValue: { value: body.value } },
    });

    return updated;
  });

  fastify.get("/superadmin/audit-logs", { preHandler: requirePermission("audit.read") }, async (request) => {
    const { action, resource_type, limit, offset } = auditLogsQuerySchema.parse(request.query);

    const conditions = [];
    if (action) conditions.push(eq(auditLogs.action, action));
    if (resource_type) conditions.push(eq(auditLogs.resourceType, resource_type));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
  });

  // No list endpoint existed -- only the toggle-by-key PUT below -- so there
  // was no way to enumerate flags for an admin UI to render switches for.
  fastify.get("/superadmin/feature-flags", { preHandler: requirePermission("system.manage") }, async () => {
    return db.select().from(featureFlags).orderBy(asc(featureFlags.flagKey));
  });

  fastify.put("/superadmin/feature-flags/:key", { preHandler: requirePermission("system.manage") }, async (request) => {
    const { key } = keyParamSchema.parse(request.params);
    const body = updateFeatureFlagSchema.parse(request.body);

    const [existing] = await db.select({ isEnabled: featureFlags.isEnabled }).from(featureFlags).where(eq(featureFlags.flagKey, key)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Feature flag not found");
    }

    const [updated] = await db
      .update(featureFlags)
      .set({ isEnabled: body.isEnabled, updatedBy: request.user!.id, updatedAt: new Date() })
      .where(eq(featureFlags.flagKey, key))
      .returning();

    const actorRole = request.user!.role;
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole,
      action: "superadmin_feature_flag_update",
      resourceType: "feature_flag",
      beforeState: { flagKey: key, isEnabled: existing.isEnabled },
      afterState: { flagKey: key, isEnabled: body.isEnabled },
    });

    return updated;
  });

  fastify.post("/superadmin/admins", { preHandler: requirePermission("system.manage") }, async (request) => {
    // "Only super_admin can do this" is called out explicitly, distinct from
    // the section's system.manage gate -- enforced directly here rather
    // than solely relying on today's role_permissions seed (where only
    // super_admin happens to hold system.manage), so this stays true even
    // if that grant ever changes.
    if (request.user!.role !== "super_admin") {
      throw new HttpError(403, "FORBIDDEN", "Only a super_admin can grant admin access");
    }

    const body = promoteAdminSchema.parse(request.body);

    const [targetUser] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, body.userId)).limit(1);
    if (!targetUser) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    await db.update(users).set({ role: "admin", updatedAt: new Date() }).where(eq(users.id, body.userId));
    invalidateUserCache(body.userId);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: "super_admin",
      action: "superadmin_grant_admin",
      resourceType: "user",
      resourceId: body.userId,
      beforeState: { role: targetUser.role },
      afterState: { role: "admin" },
    });

    return { userId: body.userId, role: "admin" };
  });
}
