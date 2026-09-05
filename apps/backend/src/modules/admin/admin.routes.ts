import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  audioFiles,
  audioUploads,
  categories,
  concepts,
  conceptMedia,
  contributionModule,
  contributions,
  contributionStatus,
  gamificationConfig,
  languages,
  featureFlags,
  auditLogs,
  scenes,
  sceneConcepts,
  sceneContributions,
  sceneDifficulty,
  sceneMedia,
  sentences,
  transcriptions,
  translations,
  userRole,
  users,
  userStats,
  wordRecordings,
} from "../../db/schema.js";
import { requirePermission, verifyToken } from "../../middleware/auth.js";
import { storageService } from "../../services/storage.service.js";
import { HttpError } from "../../utils/http-error.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

async function getActorRole(userId: string) {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.role ?? null;
}

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

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const idParamSchema = z.object({ id: z.string().uuid() });
const keyParamSchema = z.object({ key: z.string().min(1) });

const contributionsQuerySchema = z.object({
  status: z.enum(contributionStatus.enumValues).optional(),
  module_type: z.enum(contributionModule.enumValues).optional(),
  language_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateContributionStatusSchema = z.object({
  status: z.enum(contributionStatus.enumValues),
  reason: z.string().optional(),
});

const usersQuerySchema = z.object({
  role: z.enum(userRole.enumValues).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const suspendUserSchema = z.object({ reason: z.string().min(1) });

const createConceptSchema = z.object({
  categoryId: z.string().uuid(),
  labelEnglish: z.string().min(1),
  description: z.string().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
});

const updateConceptSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    labelEnglish: z.string().min(1).optional(),
    description: z.string().optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

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

const sentencesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createSentenceSchema = z.object({
  englishText: z.string().min(1),
  categoryId: z.string().uuid().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
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
    const { status, module_type, language_id, limit, offset } = contributionsQuerySchema.parse(request.query);

    const conditions = [];
    if (status) conditions.push(eq(contributions.status, status));
    if (module_type) conditions.push(eq(contributions.moduleType, module_type));
    if (language_id) conditions.push(eq(contributions.languageId, language_id));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        contributionId: contributions.id,
        moduleType: contributions.moduleType,
        status: contributions.status,
        submittedAt: contributions.submittedAt,
        contributorId: users.id,
        contributorDisplayName: users.displayName,
        wordNativeWord: wordRecordings.nativeWord,
        wordDurationMs: wordRecordings.durationMs,
        audioTitle: audioUploads.title,
        audioNativeText: transcriptions.nativeText,
        translationNativeText: translations.nativeText,
        translationEnglishText: sentences.englishText,
        sceneTitle: scenes.title,
      })
      .from(contributions)
      .innerJoin(users, eq(users.id, contributions.userId))
      .leftJoin(wordRecordings, eq(wordRecordings.id, contributions.wordRecordingId))
      .leftJoin(audioUploads, eq(audioUploads.id, contributions.audioUploadId))
      .leftJoin(transcriptions, and(eq(transcriptions.audioUploadId, audioUploads.id), eq(transcriptions.isCurrent, true)))
      .leftJoin(translations, eq(translations.id, contributions.translationId))
      .leftJoin(sentences, eq(sentences.id, translations.sentenceId))
      .leftJoin(sceneContributions, eq(sceneContributions.id, contributions.sceneContributionId))
      .leftJoin(scenes, eq(scenes.id, sceneContributions.sceneId))
      .where(whereClause)
      .orderBy(desc(contributions.submittedAt))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => {
      let detail: Record<string, unknown> = {};
      switch (row.moduleType) {
        case "WORD":
          detail = { nativeWord: row.wordNativeWord, durationMs: row.wordDurationMs };
          break;
        case "TRANSCRIPTION":
          detail = { title: row.audioTitle, nativeText: row.audioNativeText };
          break;
        case "TRANSLATION":
          detail = { nativeText: row.translationNativeText, englishText: row.translationEnglishText };
          break;
        case "SCENE":
          detail = { title: row.sceneTitle };
          break;
      }
      return {
        contributionId: row.contributionId,
        moduleType: row.moduleType,
        status: row.status,
        submittedAt: row.submittedAt,
        contributor: { id: row.contributorId, displayName: row.contributorDisplayName },
        detail,
      };
    });
  });

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

    const actorRole = await getActorRole(request.user!.id);
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

  /* ---------------------------------- Users ---------------------------------- */

  fastify.get("/admin/users", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { role, search, limit, offset } = usersQuerySchema.parse(request.query);

    const conditions = [];
    if (role) conditions.push(eq(users.role, role));
    if (search) conditions.push(or(ilike(users.displayName, `%${search}%`), ilike(users.email, `%${search}%`)));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        isActive: users.isActive,
        isSuspended: users.isSuspended,
        suspendedReason: users.suspendedReason,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
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
      .set({ isSuspended: true, suspendedAt: new Date(), suspendedReason: body.reason, updatedAt: new Date() })
      .where(eq(users.id, id));

    const actorRole = await getActorRole(request.user!.id);
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
    const wordSlug = body.labelEnglish
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const slug = `${category.slug}-${wordSlug}`;

    const [concept] = await db
      .insert(concepts)
      .values({
        categoryId: body.categoryId,
        slug,
        labelEnglish: body.labelEnglish,
        description: body.description ?? null,
        difficulty: body.difficulty ?? 1,
      })
      .returning();

    reply.code(201).send(concept);
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

  fastify.post("/admin/concepts/:id/media", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);

    const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!concept) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    const { buffer, filename } = await readImageFile(request);
    const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
    const storageFilename = `concepts/${id}/${randomUUID()}.${ext}`;

    const { path, publicUrl, mimeType, fileSizeBytes } = await storageService.uploadSceneImage(buffer, storageFilename);

    const [existingCount] = await db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(conceptMedia).where(eq(conceptMedia.conceptId, id));
    const isPrimary = (existingCount?.value ?? 0) === 0;

    const [media] = await db
      .insert(conceptMedia)
      .values({ conceptId: id, storageKey: path, publicUrl, mimeType, fileSizeBytes, isPrimary })
      .returning();

    reply.code(201).send(media);
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

  fastify.post("/admin/scenes/:id/media", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);

    const [scene] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!scene) {
      throw new HttpError(404, "NOT_FOUND", "Scene not found");
    }

    const { buffer, filename } = await readImageFile(request);
    const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
    const storageFilename = `scenes/${id}/${randomUUID()}.${ext}`;

    const { path, publicUrl, mimeType } = await storageService.uploadSceneImage(buffer, storageFilename);

    const [existingCount] = await db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sceneMedia).where(eq(sceneMedia.sceneId, id));
    const isPrimary = (existingCount?.value ?? 0) === 0;

    const [media] = await db
      .insert(sceneMedia)
      .values({ sceneId: id, storageKey: path, publicUrl, mimeType, isPrimary })
      .returning();

    reply.code(201).send(media);
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
      .returning();

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

    return db
      .select()
      .from(sentences)
      .orderBy(desc(sentences.createdAt))
      .limit(limit)
      .offset(offset);
  });

  fastify.post("/admin/sentences", { preHandler: requirePermission("sentences.manage") }, async (request, reply) => {
    const body = createSentenceSchema.parse(request.body);

    const [sentence] = await db
      .insert(sentences)
      .values({ englishText: body.englishText, categoryId: body.categoryId ?? null, difficulty: body.difficulty ?? 1 })
      .returning();

    reply.code(201).send(sentence);
  });

  /* -------------------------------- Analytics -------------------------------- */

  fastify.get("/admin/analytics", { preHandler: requirePermission("analytics.read") }, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const perDay = await db
      .select({ day: sql<string>`date(${contributions.submittedAt})`, count: sql<number>`count(*)`.mapWith(Number) })
      .from(contributions)
      .where(gte(contributions.submittedAt, thirtyDaysAgo))
      .groupBy(sql`date(${contributions.submittedAt})`)
      .orderBy(sql`date(${contributions.submittedAt})`);

    const topContributors = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        verifiedContributions: userStats.verifiedContributions,
        totalPoints: userStats.totalPoints,
      })
      .from(userStats)
      .innerJoin(users, eq(users.id, userStats.userId))
      .orderBy(desc(userStats.verifiedContributions))
      .limit(10);

    const [pendingRow] = await db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(contributions)
      .where(eq(contributions.status, "pending"));

    const [storageRow] = await db
      .select({
        totalBytes: sql<number>`coalesce(sum(${audioFiles.fileSizeBytes}), 0)`.mapWith(Number),
        totalDurationMs: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)`.mapWith(Number),
        fileCount: sql<number>`count(*)`.mapWith(Number),
      })
      .from(audioFiles);

    // Added for the admin dashboard's overview cards -- nothing above
    // already exposes a total user count or "as of today" breakdowns
    // (contributionsPerDay groups by submission date, not verification date).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalUsersRow] = await db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(users)
      .where(isNull(users.deletedAt));

    const [contributionsTodayRow] = await db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(contributions)
      .where(gte(contributions.submittedAt, todayStart));

    const [verifiedTodayRow] = await db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(contributions)
      .where(and(eq(contributions.status, "verified"), gte(contributions.verifiedAt, todayStart)));

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

    const actorRole = await getActorRole(request.user!.id);
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

    const actorRole = await getActorRole(request.user!.id);
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
