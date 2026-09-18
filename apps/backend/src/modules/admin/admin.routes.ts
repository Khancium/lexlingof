import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
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
  contributorLevel,
  dialects,
  educationLevelEnum,
  gamificationConfig,
  genderEnum,
  languages,
  featureFlags,
  auditLogs,
  pendingChanges,
  quarters,
  reviews,
  scenes,
  sceneConcepts,
  sceneContributions,
  sceneDifficulty,
  sceneImageKeywords,
  sceneMedia,
  sentences,
  subTribes,
  suggestions,
  transcriptions,
  translations,
  tribes,
  userRole,
  users,
  userStats,
  villages,
  wordRecordings,
} from "../../db/schema.js";
import { hasPermission, invalidateUserCache, requirePermission, verifyToken } from "../../middleware/auth.js";
import { buildAttribution, searchOpenverseImages } from "../../services/openverse.service.js";
import { deleteUserAccount } from "../../services/account.service.js";
import { authService } from "../auth/auth.service.js";
import { writeAuditLog, writeAuditLogs } from "../../services/audit-log.service.js";
import { invalidateLevelThresholdsCache, levelUpdateExpr } from "../../services/level.service.js";
import { invalidateCategoriesCache } from "../categories/categories.routes.js";
import { gateVolunteerAction, getPendingChangeById, requirePendingRow, markApproved, markRejected, listPendingChanges, countPendingByVolunteer, setAutoApprove, isAutoApproved } from "../../services/pending-changes.service.js";
import { storageService } from "../../services/storage.service.js";
import { buildUsersCsv, buildUsersPdf, fetchUserReportRows, userReportQuery } from "./user-report.service.js";
import { HttpError } from "../../utils/http-error.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/** Content-Disposition filenames go through unescaped, so everything outside a safe ASCII set is dropped rather than quoted. */
function fileSlug(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "user";
}

async function sendReport(
  reply: FastifyReply,
  rows: Awaited<ReturnType<typeof fetchUserReportRows>>,
  format: "csv" | "pdf",
  baseName: string,
  generatedBy: string,
) {
  if (format === "pdf") {
    const pdf = await buildUsersPdf(rows, generatedBy);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${baseName}.pdf"`)
      .send(pdf);
  }
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${baseName}.csv"`)
    .send(buildUsersCsv(rows));
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

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

type MediaAttribution = { sourceProvider: string; sourceUrl: string; attribution: string };

async function insertConceptMedia(conceptId: string, buffer: Buffer, filename: string, source?: MediaAttribution) {
  const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
  const storageFilename = `concepts/${conceptId}/${randomUUID()}.${ext}`;
  const { path, publicUrl, mimeType, fileSizeBytes } = await storageService.uploadConceptImage(buffer, storageFilename);

  const [existingCount] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(conceptMedia)
    .where(eq(conceptMedia.conceptId, conceptId));
  const isPrimary = (existingCount?.value ?? 0) === 0;

  const [media] = await db
    .insert(conceptMedia)
    .values({
      conceptId,
      storageKey: path,
      publicUrl,
      mimeType,
      fileSizeBytes,
      isPrimary,
      sourceProvider: source?.sourceProvider ?? null,
      sourceUrl: source?.sourceUrl ?? null,
      attribution: source?.attribution ?? null,
    })
    .returning();
  return media;
}

async function addConceptImageFromUrl(conceptId: string, imageUrl: string, source?: MediaAttribution) {
  const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  if (!concept) {
    throw new HttpError(404, "NOT_FOUND", "Concept not found");
  }
  const { buffer, filename } = await storageService.fetchImageFromUrl(imageUrl);
  return insertConceptMedia(conceptId, buffer, filename, source);
}

async function insertSceneMedia(sceneId: string, buffer: Buffer, filename: string, source?: MediaAttribution) {
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
    .values({
      sceneId,
      storageKey: path,
      publicUrl,
      mimeType,
      isPrimary,
      sourceProvider: source?.sourceProvider ?? null,
      sourceUrl: source?.sourceUrl ?? null,
      attribution: source?.attribution ?? null,
    })
    .returning();
  return media;
}

async function addSceneImageFromUrl(sceneId: string, imageUrl: string, source?: MediaAttribution) {
  const [scene] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, sceneId)).limit(1);
  if (!scene) {
    throw new HttpError(404, "NOT_FOUND", "Scene not found");
  }
  const { buffer, filename } = await storageService.fetchImageFromUrl(imageUrl);
  return insertSceneMedia(sceneId, buffer, filename, source);
}

/**
 * An Openverse image (whether it's the client's chosen search result or one
 * the bulk auto-fill picked server-side) -> the MediaAttribution shape
 * stored alongside the re-hosted image. Trusting the client-submitted
 * attribution string (rather than rebuilding it server-side) is fine here --
 * this is admin-only, and worst case a mismatched credit line is a data
 * quality issue, not a security one, the same trust level already extended
 * to an admin-supplied "From URL" image.
 */
function attributionFromOpenverse(image: { foreignLandingUrl: string; attribution: string }): MediaAttribution {
  return { sourceProvider: "openverse", sourceUrl: image.foreignLandingUrl, attribution: image.attribution };
}

/** Concepts/scenes currently missing any image at all -- the autofill target set when no explicit ids are given. */
async function conceptsWithoutImage(ids?: string[]) {
  const conditions = [isNull(concepts.deletedAt), isNull(conceptMedia.id)];
  if (ids?.length) conditions.push(inArray(concepts.id, ids));
  return db
    .select({ id: concepts.id, labelEnglish: concepts.labelEnglish })
    .from(concepts)
    .leftJoin(conceptMedia, eq(conceptMedia.conceptId, concepts.id))
    .where(and(...conditions));
}

async function scenesWithoutImage(ids?: string[]) {
  const conditions = [isNull(scenes.deletedAt), isNull(sceneMedia.id)];
  if (ids?.length) conditions.push(inArray(scenes.id, ids));
  return db
    .select({ id: scenes.id, title: scenes.title })
    .from(scenes)
    .leftJoin(sceneMedia, eq(sceneMedia.sceneId, scenes.id))
    .where(and(...conditions));
}

/** Like requirePermission, but passes if the caller holds ANY of the listed codes -- for endpoints (e.g. the shared Openverse search) usable from both the concepts and scenes admin pages, which are gated by different permission codes. */
function requireAnyPermission(...permissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
      return;
    }
    if (request.user.role === "super_admin") return;
    const role = request.user.role;
    const checks = await Promise.all(permissions.map((p) => hasPermission(role, p)));
    if (!checks.some(Boolean)) {
      reply.code(403).send({ code: "FORBIDDEN", required: permissions.join(" or ") });
    }
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type ContentKind = "concept" | "scene" | "sentence";

type PermanentDeleteOutcome = { id: string; deleted: boolean; reason?: string; code?: "NOT_FOUND" | "HAS_CONTRIBUTIONS" };

const CONTENT_LABEL: Record<ContentKind, string> = { concept: "Concept", scene: "Scene", sentence: "Sentence" };

type Module = (typeof contributionModule.enumValues)[number];
type Status = (typeof contributionStatus.enumValues)[number];

const MODULE_COUNT_COLUMN = {
  WORD: userStats.wordContributions,
  TRANSCRIPTION: userStats.audioContributions,
  TRANSLATION: userStats.translationContributions,
  SCENE: userStats.sceneContributionsCount,
} as const;

const MODULE_VERIFIED_COLUMN = {
  WORD: userStats.verifiedWords,
  TRANSCRIPTION: userStats.verifiedAudios,
  TRANSLATION: userStats.verifiedTranslations,
  SCENE: userStats.verifiedScenes,
} as const;

/**
 * Deleting a contribution (admin moderation, not the contributor's own undo)
 * used to touch only the `contributions` row -- `user_stats.totalContributions`
 * and its siblings kept whatever value the original submission had already
 * added, forever. That's what a live mobile-responsiveness check on this
 * account (farrukh@lexlingo.app) surfaced: user_stats read 4 total
 * contributions and 0 verified, but the `contributions` table had zero rows
 * for this user -- every one of the 4 had been admin-deleted at some point,
 * none of the increments were ever reversed, so the dashboard progress bar,
 * level, and "My Contributions" total were all reporting phantom activity.
 *
 * Deliberately does NOT touch points_transactions/totalPoints: unlike the
 * count columns (which should always mirror "how many non-deleted
 * contributions exist"), whether a moderation delete should also claw back
 * the points already earned is a separate product decision, and reversing
 * points safely means inserting idempotency-keyed reversal transactions, not
 * just decrementing a counter -- out of scope for this fix.
 */
const MODULE_COUNT_KEY = {
  WORD: "wordContributions",
  TRANSCRIPTION: "audioContributions",
  TRANSLATION: "translationContributions",
  SCENE: "sceneContributionsCount",
} as const;

const MODULE_VERIFIED_KEY = {
  WORD: "verifiedWords",
  TRANSCRIPTION: "verifiedAudios",
  TRANSLATION: "verifiedTranslations",
  SCENE: "verifiedScenes",
} as const;

/**
 * +1 when a deleted contribution is restored via Undo, -1 when one is
 * deleted -- same set of columns either way, since restoring is exactly
 * "re-apply the increment the original submission made". `greatest(x, 0)`
 * guards the -1 direction against ever going negative; it's a no-op for +1.
 */
async function adjustContributionStats(userId: string, moduleType: Module, status: Status, delta: 1 | -1): Promise<void> {
  const levelExpr = await levelUpdateExpr(delta);
  const moduleCountColumn = MODULE_COUNT_COLUMN[moduleType];

  const updates: Record<string, unknown> = {
    totalContributions: sql`greatest(${userStats.totalContributions} + ${delta}, 0)`,
    [MODULE_COUNT_KEY[moduleType]]: sql`greatest(${moduleCountColumn} + ${delta}, 0)`,
    level: levelExpr,
    updatedAt: new Date(),
  };

  if (status === "verified") {
    const verifiedColumn = MODULE_VERIFIED_COLUMN[moduleType];
    updates.verifiedContributions = sql`greatest(${userStats.verifiedContributions} + ${delta}, 0)`;
    updates[MODULE_VERIFIED_KEY[moduleType]] = sql`greatest(${verifiedColumn} + ${delta}, 0)`;
  } else if (status === "pending" || status === "under_review") {
    updates.pendingContributions = sql`greatest(${userStats.pendingContributions} + ${delta}, 0)`;
  }
  // Deliberately no "rejected" branch: reviews.service.ts's invalid-decision
  // path only ever decrements pendingContributions, it never increments
  // userStats.rejectedContributions -- so that column sits at 0 for every
  // user regardless of how many of their contributions were actually
  // rejected (a separate, pre-existing bug, not introduced here). Adjusting
  // an always-zero counter here isn't symmetric: delete's greatest(x-1,0)
  // floors as a no-op (already 0), but undo's blind +1 would then move it to
  // 1 -- a real value drifting further from the always-0 truth. Left alone
  // until that root cause is fixed.

  await db.update(userStats).set(updates).where(eq(userStats.userId, userId));
}

/**
 * See adjustContributionStats above -- deleting a contribution used to
 * leave user_stats permanently inflated (found live: farrukh@lexlingo.app's
 * user_stats read 4 total contributions / 0 verified while the
 * `contributions` table had zero rows for them -- all 4 had been
 * admin-deleted at some point and none of the increments were ever
 * reversed). Deliberately does NOT touch points_transactions/totalPoints --
 * whether a moderation delete should also claw back already-earned points
 * is a separate product decision, and doing it safely means idempotency-
 * keyed reversal transactions, not just decrementing a counter.
 */
function reverseContributionStatsOnDelete(userId: string, moduleType: Module, status: Status): Promise<void> {
  return adjustContributionStats(userId, moduleType, status, -1);
}

/**
 * Permanently removes one concept/scene/sentence: the actual DB row (not a
 * soft delete) plus its images in Supabase Storage. The regular DELETE
 * routes only set is_active/deleted_at, which hides a row from the app but
 * leaves both the row and its uploaded files in place forever -- this is
 * the "and actually delete it" counterpart.
 *
 * REFUSES when contributor recordings reference the row (word_recordings /
 * scene_contributions / translations). Those FKs would block the delete
 * anyway, but the point is that cascading through them would destroy real
 * corpus audio and leave already-awarded points and user_stats counters
 * describing contributions that no longer exist. Soft delete stays the
 * correct tool there. The count is deliberately NOT filtered by deleted_at:
 * a soft-deleted recording still holds the foreign key, so it still blocks.
 *
 * Storage objects are removed only AFTER the DB row is gone, and a storage
 * failure is logged rather than thrown -- by that point the delete has
 * already succeeded, and an orphaned file wasting space is a much smaller
 * problem than reporting failure for work that did happen.
 */
async function permanentlyDeleteContent(kind: ContentKind, id: string): Promise<PermanentDeleteOutcome> {
  const storageKeys: string[] = [];

  if (kind === "concept") {
    const [existing] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!existing) return { id, deleted: false, reason: "Concept not found", code: "NOT_FOUND" };

    const media = await db.select({ storageKey: conceptMedia.storageKey }).from(conceptMedia).where(eq(conceptMedia.conceptId, id));
    storageKeys.push(...media.map((m) => m.storageKey));
  } else if (kind === "scene") {
    const [existing] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!existing) return { id, deleted: false, reason: "Scene not found", code: "NOT_FOUND" };

    const media = await db.select({ storageKey: sceneMedia.storageKey }).from(sceneMedia).where(eq(sceneMedia.sceneId, id));
    storageKeys.push(...media.map((m) => m.storageKey));
  } else {
    const [existing] = await db.select({ id: sentences.id }).from(sentences).where(eq(sentences.id, id)).limit(1);
    if (!existing) return { id, deleted: false, reason: "Sentence not found", code: "NOT_FOUND" };
    // Sentences are plain text -- no media, nothing in object storage.
  }

  try {
    await db.transaction(async (tx) => {
      if (kind === "concept") {
        // Admin-only scene-coverage annotations -- these FK to concepts
        // without a cascade, so they'd block the delete, but they carry no
        // contributor data and are meaningless once the concept is gone.
        // Inside the transaction so a blocked delete rolls these back too.
        await tx.delete(sceneConcepts).where(eq(sceneConcepts.conceptId, id));
        // concept_media rows cascade with the concept row itself.
        await tx.delete(concepts).where(eq(concepts.id, id));
      } else if (kind === "scene") {
        // scene_media (and its scene_image_keywords) plus scene_concepts all
        // cascade with the scene row.
        await tx.delete(scenes).where(eq(scenes.id, id));
      } else {
        await tx.delete(sentences).where(eq(sentences.id, id));
      }
    });
  } catch (err) {
    // The contributor-recording guard is the FK violation itself, not a
    // pre-flight count. Counting first and then deleting is a
    // time-of-check/time-of-use race: this app's DB is cross-region, so
    // seconds pass between the two statements, and the submission-buffer
    // worker can land a recording right in that window (which is exactly
    // how this was found -- a 500 on the FK instead of a clean refusal).
    // Letting Postgres arbitrate is atomic; the count below only runs on
    // this cold path, purely to word the message.
    if (!isForeignKeyViolation(err)) throw err;
    return { id, deleted: false, reason: await describeBlockingReferences(kind, id), code: "HAS_CONTRIBUTIONS" };
  }

  if (storageKeys.length > 0) {
    try {
      await storageService.deleteImages(storageKeys);
    } catch (err) {
      console.error(`[admin] ${kind} ${id} was deleted but its storage objects could not be removed:`, err);
    }
  }

  return { id, deleted: true };
}

/** Postgres 23503 = foreign_key_violation. postgres.js nests the real error under DrizzleQueryError's `cause`. */
function isForeignKeyViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const causeCode = ((err as { cause?: { code?: string } })?.cause)?.code;
  return code === "23503" || causeCode === "23503";
}

async function describeBlockingReferences(kind: ContentKind, id: string): Promise<string> {
  if (kind === "concept") {
    const [row] = await db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(wordRecordings)
      .where(eq(wordRecordings.conceptId, id));
    return `${row?.value ?? "Some"} contributor recording(s) reference this concept`;
  }
  if (kind === "scene") {
    const [row] = await db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(sceneContributions)
      .where(eq(sceneContributions.sceneId, id));
    return `${row?.value ?? "Some"} contributor recording(s) reference this scene`;
  }
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(translations)
    .where(eq(translations.sentenceId, id));
  return `${row?.value ?? "Some"} contributor translation(s) reference this sentence`;
}

/**
 * The audit entry deliberately carries no beforeState: there's nothing left
 * to restore, so the generic undo endpoint correctly refuses this action
 * with NOT_REVERTIBLE rather than pretending a permanent delete is
 * reversible.
 */
async function logPermanentDelete(request: FastifyRequest, kind: ContentKind, id: string): Promise<void> {
  await writeAuditLog({
    actorId: request.user!.id,
    actorRole: request.user!.role,
    action: `admin_${kind}_permanent_delete`,
    resourceType: kind,
    resourceId: id,
    afterState: { permanentlyDeleted: true },
  });
}

/** Bulk form of the above: one INSERT for the whole batch instead of one per deleted item. */
async function logPermanentDeletes(request: FastifyRequest, kind: ContentKind, ids: string[]): Promise<void> {
  await writeAuditLogs(
    ids.map((id) => ({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: `admin_${kind}_permanent_delete`,
      resourceType: kind,
      resourceId: id,
      afterState: { permanentlyDeleted: true },
    })),
  );
}

async function runPermanentDelete(request: FastifyRequest, kind: ContentKind, id: string) {
  const outcome = await permanentlyDeleteContent(kind, id);

  if (!outcome.deleted) {
    if (outcome.code === "NOT_FOUND") {
      throw new HttpError(404, "NOT_FOUND", `${CONTENT_LABEL[kind]} not found`);
    }
    throw new HttpError(
      409,
      "HAS_CONTRIBUTIONS",
      `${outcome.reason} -- permanently deleting it would destroy contributor recordings. Use the normal delete instead, which hides it from the app while keeping those recordings intact.`,
    );
  }

  await logPermanentDelete(request, kind, id);
  if (kind === "concept") invalidateCategoriesCache();
  return { id, deleted: true, permanent: true };
}

/**
 * Each permanent delete is several round trips plus object-storage calls, so
 * at cross-region latency a serial loop over a 50-item selection ran for
 * minutes. Items are independent (each guards itself with the FK-violation
 * catch), so they run in bounded batches instead -- capped rather than
 * unbounded so a 1000-item selection cannot exhaust the connection pool.
 */
const PERMANENT_DELETE_CONCURRENCY = 5;

async function runBulkPermanentDelete(request: FastifyRequest, kind: ContentKind, ids: string[]) {
  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (let i = 0; i < ids.length; i += PERMANENT_DELETE_CONCURRENCY) {
    const batch = ids.slice(i, i + PERMANENT_DELETE_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (id) => ({ id, outcome: await permanentlyDeleteContent(kind, id) })),
    );
    for (const { id, outcome } of outcomes) {
      if (outcome.deleted) deleted.push(id);
      else skipped.push({ id, reason: outcome.reason ?? "Could not be deleted" });
    }
  }

  // One audit write per batch run rather than one per item -- writeAuditLogs
  // is the existing bulk form and turns N round trips into one.
  if (deleted.length > 0) {
    await logPermanentDeletes(request, kind, deleted);
    if (kind === "concept") invalidateCategoriesCache();
  }

  return { deleted: deleted.length, skipped };
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

/**
 * CSV bulk-import rows were previously inserted one `await db.insert(...)`
 * at a time -- correct, but a few-thousand-row upload became a few thousand
 * sequential round trips to a remote Postgres instance. This inserts a
 * whole chunk in one statement, and only falls back to one insert per row
 * (to attribute the error to the exact offending row) if the chunk insert
 * throws -- e.g. a duplicate slug collides with an existing row.
 */
async function insertBulkInChunks<V extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  items: { rowNum: number; value: V }[],
  result: BulkResult,
  chunkSize = 500,
): Promise<void> {
  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    try {
      await db.insert(table).values(chunk.map((c) => c.value));
      result.created += chunk.length;
    } catch {
      for (const { rowNum, value } of chunk) {
        try {
          await db.insert(table).values(value);
          result.created++;
        } catch (err) {
          result.errors.push({ row: rowNum, message: err instanceof Error ? err.message : "Insert failed" });
        }
      }
    }
  }
}

/**
 * Shared by both bulk-concept-create routes (CSV/JSON file upload and the
 * plain-text paste box) -- everything past "how did these rows arrive" is
 * identical: resolve each row's category by slug or English name, generate
 * the slug, and validate. `rowNumOffset` lets each caller keep its own
 * row-numbering convention (a CSV's rows are 1-indexed *after* a header
 * row; a plain array has no header).
 */
async function buildConceptInserts(
  rows: { labelEnglish?: string; category?: string; description?: string }[],
  rowNumOffset: number,
): Promise<{ toInsert: { rowNum: number; value: typeof concepts.$inferInsert }[]; errors: { row: number; message: string }[] }> {
  const allCategories = await db.select({ id: categories.id, slug: categories.slug, nameEnglish: categories.nameEnglish }).from(categories);
  const categoryByKey = new Map(
    allCategories.flatMap((c) => [
      [c.slug.toLowerCase(), c],
      [c.nameEnglish.toLowerCase(), c],
    ]),
  );

  const toInsert: { rowNum: number; value: typeof concepts.$inferInsert }[] = [];
  const errors: { row: number; message: string }[] = [];

  // Duplicate check is slug-based (case-insensitive by construction --
  // slugify() lowercases) rather than a separate lower(label) comparison,
  // matching the single-create route. Existing slugs are fetched once,
  // scoped to touched categories only rather than the whole concepts table,
  // and then grown in-memory as the batch itself queues up slugs -- so two
  // "River" / "river" rows in the SAME paste are caught too, not just
  // against what's already in the database.
  const touchedCategoryIds = [...new Set(rows.map((r) => categoryByKey.get((r.category ?? "").trim().toLowerCase())?.id).filter(Boolean))] as string[];
  const existingSlugs = new Set(
    touchedCategoryIds.length
      ? (
          await db
            .select({ slug: concepts.slug })
            .from(concepts)
            .where(and(inArray(concepts.categoryId, touchedCategoryIds), isNull(concepts.deletedAt)))
        ).map((c) => c.slug)
      : [],
  );

  rows.forEach((row, i) => {
    const rowNum = i + rowNumOffset;
    const categoryKey = (row.category ?? "").trim().toLowerCase();
    const labelEnglish = (row.labelEnglish ?? "").trim();

    const category = categoryByKey.get(categoryKey);
    if (!category) {
      errors.push({ row: rowNum, message: `Unknown category "${row.category ?? ""}"` });
      return;
    }
    if (!labelEnglish) {
      errors.push({ row: rowNum, message: "labelEnglish is required" });
      return;
    }

    const slug = `${category.slug}-${slugify(labelEnglish)}`;
    // Silently skip -- no error, no created count -- rather than surfacing
    // a "row N: already exists" error for what the admin almost certainly
    // considers a non-event (they just tried to add something already there).
    if (existingSlugs.has(slug)) {
      return;
    }
    existingSlugs.add(slug);

    toInsert.push({
      rowNum,
      value: {
        categoryId: category.id,
        slug,
        labelEnglish,
        description: row.description?.trim() || null,
      },
    });
  });

  return { toInsert, errors };
}

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const idParamSchema = z.object({ id: z.string().uuid() });
const keyParamSchema = z.object({ key: z.string().min(1) });

// Lets a single query param carry more than one value as a comma-separated
// list (e.g. "?status=pending,verified") so the admin contributions filters
// can multi-select within one dropdown instead of being stuck to one value
// at a time. Absent/empty stays undefined so existing single-value callers
// (and the "no filter applied" case) are unaffected.
function csvOf<T extends [string, ...string[]]>(values: T) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v.split(",") : undefined),
    z.array(z.enum(values)).min(1).optional(),
  );
}
function csvOfUuid() {
  return z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v.split(",") : undefined),
    z.array(z.string().uuid()).min(1).optional(),
  );
}

const contributionsQuerySchema = z.object({
  status: csvOf(contributionStatus.enumValues),
  module_type: csvOf(contributionModule.enumValues),
  language_id: csvOfUuid(),
  dialect_id: csvOfUuid(),
  user_id: z.string().uuid().optional(),
  // Contributor display name or email -- distinct from a module's own text
  // content, which isn't searched here.
  search: z.string().min(1).optional(),
  tribe_id: csvOfUuid(),
  sub_tribe_id: csvOfUuid(),
  country: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  village_id: csvOfUuid(),
  quarter_id: csvOfUuid(),
  gender: csvOf(genderEnum.enumValues),
  education_level: csvOf(educationLevelEnum.enumValues),
  profession: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateRemarksSchema = z.object({ remarks: z.string().trim().max(2000) });
const addContributionKeywordSchema = z.object({ keyword: z.string().trim().min(1).max(100) });
const contributionKeywordParamSchema = z.object({ id: z.string().uuid(), keywordId: z.string().uuid() });

const updateContributionStatusSchema = z.object({
  status: z.enum(contributionStatus.enumValues),
  reason: z.string().optional(),
});

// Same multi-select CSV convention as the contributions filters, extended
// across both halves of a user record: the signup form (contributor_demographics)
// and the activity rollup (user_stats). Every field is optional and an absent
// one adds no condition, so the unfiltered list behaves exactly as before.
const usersQuerySchema = z.object({
  role: csvOf(userRole.enumValues),
  search: z.string().optional(),
  status: csvOf(["active", "restricted", "suspended"]),
  // Signup form fields.
  gender: csvOf(genderEnum.enumValues),
  education_level: csvOf(educationLevelEnum.enumValues),
  tribe_id: csvOfUuid(),
  sub_tribe_id: csvOfUuid(),
  village_id: csvOfUuid(),
  quarter_id: csvOfUuid(),
  country: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  mother_tongue: z.string().min(1).optional(),
  profession: z.string().min(1).optional(),
  min_age: z.coerce.number().int().min(0).optional(),
  max_age: z.coerce.number().int().min(0).optional(),
  // Activity / contribution metrics.
  level: csvOf(contributorLevel.enumValues),
  min_contributions: z.coerce.number().int().min(0).optional(),
  max_contributions: z.coerce.number().int().min(0).optional(),
  min_verified: z.coerce.number().int().min(0).optional(),
  min_points: z.coerce.number().int().min(0).optional(),
  max_points: z.coerce.number().int().min(0).optional(),
  min_reviews: z.coerce.number().int().min(0).optional(),
  activity: z.enum(["contributed", "never_contributed"]).optional(),
  joined_from: z.string().datetime().optional(),
  joined_to: z.string().datetime().optional(),
  sort: z.enum(["created_desc", "created_asc", "contributions_desc", "points_desc", "name_asc"]).default("created_desc"),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

type UsersQuery = z.infer<typeof usersQuerySchema>;

/** Shared by the list endpoint and the report endpoints so a report over the current filters always covers exactly the rows the table is showing. */
function buildUserConditions(q: UsersQuery) {
  const conditions: SQL[] = [isNull(users.deletedAt)];
  if (q.role?.length) conditions.push(inArray(users.role, q.role));
  if (q.search) conditions.push(or(ilike(users.displayName, `%${q.search}%`), ilike(users.email, `%${q.search}%`))!);

  if (q.status?.length) {
    const statusParts: SQL[] = [];
    if (q.status.includes("suspended")) statusParts.push(eq(users.isSuspended, true));
    if (q.status.includes("restricted")) statusParts.push(and(eq(users.isRestricted, true), eq(users.isSuspended, false))!);
    if (q.status.includes("active")) statusParts.push(and(eq(users.isSuspended, false), eq(users.isRestricted, false))!);
    if (statusParts.length) conditions.push(or(...statusParts)!);
  }

  if (q.gender?.length) conditions.push(inArray(contributorDemographics.gender, q.gender));
  if (q.education_level?.length) conditions.push(inArray(contributorDemographics.educationLevel, q.education_level));
  if (q.tribe_id?.length) conditions.push(inArray(contributorDemographics.tribeId, q.tribe_id));
  if (q.sub_tribe_id?.length) conditions.push(inArray(contributorDemographics.subTribeId, q.sub_tribe_id));
  if (q.village_id?.length) conditions.push(inArray(contributorDemographics.villageId, q.village_id));
  if (q.quarter_id?.length) conditions.push(inArray(contributorDemographics.quarterId, q.quarter_id));
  if (q.country) conditions.push(ilike(contributorDemographics.country, `%${q.country}%`));
  if (q.city) conditions.push(ilike(contributorDemographics.city, `%${q.city}%`));
  if (q.mother_tongue) conditions.push(ilike(contributorDemographics.motherTongue, `%${q.mother_tongue}%`));
  if (q.profession) conditions.push(ilike(contributorDemographics.profession, `%${q.profession}%`));
  if (q.min_age !== undefined) conditions.push(gte(contributorDemographics.age, q.min_age));
  if (q.max_age !== undefined) conditions.push(lte(contributorDemographics.age, q.max_age));

  if (q.level?.length) conditions.push(inArray(userStats.level, q.level));
  // user_stats is LEFT JOINed, so a user who has never contributed has NULL
  // counters rather than 0. coalesce keeps those rows comparable instead of
  // silently dropping them out of every numeric filter.
  if (q.min_contributions !== undefined) conditions.push(sql`coalesce(${userStats.totalContributions}, 0) >= ${q.min_contributions}`);
  if (q.max_contributions !== undefined) conditions.push(sql`coalesce(${userStats.totalContributions}, 0) <= ${q.max_contributions}`);
  if (q.min_verified !== undefined) conditions.push(sql`coalesce(${userStats.verifiedContributions}, 0) >= ${q.min_verified}`);
  if (q.min_points !== undefined) conditions.push(sql`coalesce(${userStats.totalPoints}, 0) >= ${q.min_points}`);
  if (q.max_points !== undefined) conditions.push(sql`coalesce(${userStats.totalPoints}, 0) <= ${q.max_points}`);
  if (q.min_reviews !== undefined) conditions.push(sql`coalesce(${userStats.reviewsCompleted}, 0) >= ${q.min_reviews}`);
  if (q.activity === "contributed") conditions.push(sql`coalesce(${userStats.totalContributions}, 0) > 0`);
  if (q.activity === "never_contributed") conditions.push(sql`coalesce(${userStats.totalContributions}, 0) = 0`);

  if (q.joined_from) conditions.push(gte(users.createdAt, new Date(q.joined_from)));
  if (q.joined_to) conditions.push(lte(users.createdAt, new Date(q.joined_to)));

  return and(...conditions)!;
}

function userSortOrder(sort: UsersQuery["sort"]) {
  switch (sort) {
    case "created_asc":
      return asc(users.createdAt);
    case "contributions_desc":
      return sql`coalesce(${userStats.totalContributions}, 0) desc`;
    case "points_desc":
      return sql`coalesce(${userStats.totalPoints}, 0) desc`;
    case "name_asc":
      return asc(users.displayName);
    default:
      return desc(users.createdAt);
  }
}

const reportFormatSchema = z.object({ format: z.enum(["csv", "pdf"]).default("csv") });
// Capped at the list endpoint's own page ceiling: a bulk report is generated
// from an explicit selection made in the table, so it can never legitimately
// exceed one full page of results.
const bulkReportSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  format: z.enum(["csv", "pdf"]).default("csv"),
});

const suspendUserSchema = z.object({ reason: z.string().min(1) });
const cooloffUserSchema = z.object({ reason: z.string().min(1), days: z.coerce.number().int().min(1).max(365) });
const restrictUserSchema = z.object({ reason: z.string().min(1) });

const adminSetCredentialsSchema = z
  .object({
    email: z.string().trim().email().min(1).optional(),
    password: z.string().min(8).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((b) => b.email !== undefined || b.password !== undefined || b.displayName !== undefined, {
    message: "Provide at least one of email, password, or displayName",
  });

const createCategorySchema = z.object({
  nameEnglish: z.string().trim().min(1),
  icon: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

// Capped at 500, matching insertBulkInChunks' chunk size -- a paste bigger
// than that belongs in the CSV/JSON upload instead.
const bulkCategoryTextSchema = z.object({
  names: z.array(z.string().trim().min(1)).min(1).max(500),
});

const createConceptSchema = z.object({
  categoryId: z.string().uuid(),
  labelEnglish: z.string().min(1),
  description: z.string().optional(),
});

const bulkConceptTextSchema = z.object({
  items: z.array(z.object({ labelEnglish: z.string().trim().min(1), category: z.string().trim().min(1) })).min(1).max(500),
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

const openverseSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(40).default(20),
});

/** The subset of an OpenverseImageResult a client actually chose -- re-validated rather than trusting the shape blindly, since the browser could send anything back. */
const openverseImageRefSchema = z.object({
  url: z.string().url(),
  foreignLandingUrl: z.string().url(),
  attribution: z.string().min(1),
});

const addConceptOpenverseSchema = z.object({ image: openverseImageRefSchema });
const addSceneOpenverseSchema = z.object({ image: openverseImageRefSchema });

const bulkOpenverseAutofillSchema = z.object({
  // Explicit ids to fill (from a selection), or omit to autofill every item
  // in the given content type that currently has no image at all.
  ids: z.array(z.string().uuid()).max(200).optional(),
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

// Unlike the CSV bulk upload, a slug isn't asked for here -- generated from
// each title instead (with a numeric suffix on collision), since typing a
// slug for every line defeats the point of a fast paste-a-list box.
const bulkSceneTextSchema = z.object({
  titles: z.array(z.string().trim().min(1)).min(1).max(500),
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
const mediaIdParamSchema = z.object({ mediaId: z.string().uuid() });

const sentencesQuerySchema = z.object({
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  // Volunteer's "my own additions" filter -- true restricts the list to
  // sentences this caller themselves created (sentences.createdBy).
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
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
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/* -------------------------------------------------------------------------- */
/*                    Volunteer-gated create/delete appliers                  */
/* -------------------------------------------------------------------------- */
// The actual insert/update logic for every action a volunteer's submission
// can represent -- called directly by the live route for an admin (or an
// auto-approved volunteer), and replayed with the same payload by the
// pending-changes approval route once an admin approves it. Keeping this in
// one function per action means the "apply now" and "apply on approval"
// paths can never drift apart.

async function applyCreateCategory(body: z.infer<typeof createCategorySchema>, actor: { id: string; role: string }) {
  const slug = slugify(body.nameEnglish);

  const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
  if (existing) {
    throw new HttpError(409, "ALREADY_EXISTS", `A category with slug "${slug}" already exists`);
  }

  const [category] = await db
    .insert(categories)
    .values({ slug, nameEnglish: body.nameEnglish, icon: body.icon ?? null, sortOrder: body.sortOrder ?? 0 })
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role as (typeof userRole.enumValues)[number],
    action: "admin_category_create",
    resourceType: "category",
    resourceId: category!.id,
    afterState: { nameEnglish: body.nameEnglish, slug },
  });

  return category!;
}

async function applyCreateConcept(body: z.infer<typeof createConceptSchema>, actor: { id: string; role: string }, createdBy: string | null) {
  const [category] = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, body.categoryId)).limit(1);
  if (!category) {
    throw new HttpError(404, "NOT_FOUND", "Category not found");
  }

  const slug = `${category.slug}-${slugify(body.labelEnglish)}`;

  const [duplicate] = await db
    .select()
    .from(concepts)
    .where(and(eq(concepts.slug, slug), isNull(concepts.deletedAt)))
    .limit(1);
  if (duplicate) {
    return duplicate;
  }

  const [concept] = await db
    .insert(concepts)
    .values({
      categoryId: body.categoryId,
      slug,
      labelEnglish: body.labelEnglish,
      description: body.description ?? null,
      createdBy,
    })
    .returning();

  invalidateCategoriesCache();
  return concept!;
}

async function applyCreateScene(body: z.infer<typeof createSceneSchema>, actor: { id: string; role: string }, createdBy: string | null) {
  const [duplicate] = await db
    .select()
    .from(scenes)
    .where(and(sql`lower(${scenes.title}) = lower(${body.title})`, isNull(scenes.deletedAt)))
    .limit(1);
  if (duplicate) {
    return duplicate;
  }

  const [scene] = await db
    .insert(scenes)
    .values({
      slug: body.slug,
      title: body.title,
      description: body.description ?? null,
      difficulty: body.difficulty ?? "medium",
      estimatedDurationSeconds: body.estimatedDurationSeconds ?? null,
      createdBy,
    })
    .returning();

  return scene!;
}

async function applyCreateSentence(body: z.infer<typeof createSentenceSchema>, actor: { id: string; role: string }, createdBy: string | null) {
  const [duplicate] = await db
    .select()
    .from(sentences)
    .where(and(sql`lower(${sentences.englishText}) = lower(${body.englishText})`, isNull(sentences.deletedAt)))
    .limit(1);
  if (duplicate) {
    return duplicate;
  }

  const [sentence] = await db
    .insert(sentences)
    .values({ englishText: body.englishText, categoryId: body.categoryId ?? null, createdBy })
    .returning();

  return sentence!;
}

/**
 * Shared by both the live delete route (admin, or a volunteer with
 * auto-approve on) and the pending-changes approval route. `requireOwner`
 * is set only when a volunteer submitted the delete themselves -- enforced
 * again here (not just in the route) so an approved pending_changes row can
 * never apply against a row a different volunteer created in the meantime.
 */
async function applyDeleteConcept(id: string, actor: { id: string; role: string }, requireOwner?: string) {
  const [existing] = await db
    .select({ id: concepts.id, isActive: concepts.isActive, deletedAt: concepts.deletedAt, createdBy: concepts.createdBy })
    .from(concepts)
    .where(eq(concepts.id, id))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "Concept not found");
  }
  if (requireOwner && existing.createdBy !== requireOwner) {
    throw new HttpError(403, "FORBIDDEN", "You can only delete concepts you added yourself");
  }

  await db.update(concepts).set({ isActive: false, deletedAt: new Date() }).where(eq(concepts.id, id));

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role as (typeof userRole.enumValues)[number],
    action: "admin_concept_delete",
    resourceType: "concept",
    resourceId: id,
    beforeState: { isActive: existing.isActive, deletedAt: existing.deletedAt },
    afterState: { isActive: false },
  });

  invalidateCategoriesCache();
  return { id, deleted: true };
}

async function applyDeleteScene(id: string, actor: { id: string; role: string }, requireOwner?: string) {
  const [existing] = await db
    .select({ id: scenes.id, isActive: scenes.isActive, deletedAt: scenes.deletedAt, createdBy: scenes.createdBy })
    .from(scenes)
    .where(eq(scenes.id, id))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "Scene not found");
  }
  if (requireOwner && existing.createdBy !== requireOwner) {
    throw new HttpError(403, "FORBIDDEN", "You can only delete scenes you added yourself");
  }

  await db.update(scenes).set({ isActive: false, deletedAt: new Date() }).where(eq(scenes.id, id));

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role as (typeof userRole.enumValues)[number],
    action: "admin_scene_delete",
    resourceType: "scene",
    resourceId: id,
    beforeState: { isActive: existing.isActive, deletedAt: existing.deletedAt },
    afterState: { isActive: false },
  });

  return { id, deleted: true };
}

async function applyDeleteSentence(id: string, actor: { id: string; role: string }, requireOwner?: string) {
  const [existing] = await db
    .select({ id: sentences.id, isActive: sentences.isActive, deletedAt: sentences.deletedAt, createdBy: sentences.createdBy })
    .from(sentences)
    .where(eq(sentences.id, id))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "Sentence not found");
  }
  if (requireOwner && existing.createdBy !== requireOwner) {
    throw new HttpError(403, "FORBIDDEN", "You can only delete sentences you added yourself");
  }

  await db.update(sentences).set({ isActive: false, deletedAt: new Date() }).where(eq(sentences.id, id));

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role as (typeof userRole.enumValues)[number],
    action: "admin_sentence_delete",
    resourceType: "sentence",
    resourceId: id,
    beforeState: { isActive: existing.isActive, deletedAt: existing.deletedAt },
    afterState: { isActive: false },
  });

  return { id, deleted: true };
}

/**
 * The three ways an image reaches a concept/scene -- upload, "From URL", and
 * Openverse -- funnel into one shape here so pending_changes only needs one
 * targetType ("concept_media"/"scene_media") for all three, distinguished by
 * `source`. A raw upload's bytes are base64'd into the JSON payload rather
 * than staged as a separate temp file: simpler (no extra storage lifecycle
 * to clean up if the request is later rejected), at the cost of the
 * pending_changes row being noticeably larger for that one source until it's
 * reviewed -- acceptable given volunteer image submissions are expected to
 * be reviewed promptly, not accumulate indefinitely.
 */
type MediaCreatePayload = { targetId: string } & (
  | { source: "upload"; bufferBase64: string; filename: string }
  | { source: "url"; imageUrl: string }
  | { source: "openverse"; image: { url: string; foreignLandingUrl: string; attribution: string } }
);

async function applyCreateConceptMedia(payload: MediaCreatePayload) {
  const conceptId = payload.targetId;
  if (payload.source === "upload") {
    return insertConceptMedia(conceptId, Buffer.from(payload.bufferBase64, "base64"), payload.filename);
  }
  if (payload.source === "url") {
    return addConceptImageFromUrl(conceptId, payload.imageUrl);
  }
  return addConceptImageFromUrl(conceptId, payload.image.url, attributionFromOpenverse(payload.image));
}

async function applyCreateSceneMedia(payload: MediaCreatePayload) {
  const sceneId = payload.targetId;
  if (payload.source === "upload") {
    return insertSceneMedia(sceneId, Buffer.from(payload.bufferBase64, "base64"), payload.filename);
  }
  if (payload.source === "url") {
    return addSceneImageFromUrl(sceneId, payload.imageUrl);
  }
  return addSceneImageFromUrl(sceneId, payload.image.url, attributionFromOpenverse(payload.image));
}

/**
 * Replays one pending_changes row against the real tables -- the single
 * place that knows how to turn every (targetType, action) combination back
 * into a call to the same apply* function the live route would have used.
 * Domain-level validity (does the referenced category/concept/scene still
 * exist, is there now a duplicate, etc.) is deliberately re-checked here
 * rather than trusted from submission time -- time may have passed, and the
 * corpus may have changed underneath the pending request.
 */
async function applyPendingChange(row: typeof pendingChanges.$inferSelect): Promise<string | null> {
  const volunteerActor = { id: row.volunteerId, role: "volunteer" };
  const ownerId = row.volunteerId;

  switch (row.targetType) {
    case "category": {
      const body = createCategorySchema.parse(row.payload);
      const result = await applyCreateCategory(body, volunteerActor);
      return result.id;
    }
    case "concept": {
      if (row.action === "create") {
        const body = createConceptSchema.parse(row.payload);
        const result = await applyCreateConcept(body, volunteerActor, ownerId);
        return result.id;
      }
      const { id } = row.payload as { id: string };
      await applyDeleteConcept(id, volunteerActor, ownerId);
      return null;
    }
    case "scene": {
      if (row.action === "create") {
        const body = createSceneSchema.parse(row.payload);
        const result = await applyCreateScene(body, volunteerActor, ownerId);
        return result.id;
      }
      const { id } = row.payload as { id: string };
      await applyDeleteScene(id, volunteerActor, ownerId);
      return null;
    }
    case "sentence": {
      if (row.action === "create") {
        const body = createSentenceSchema.parse(row.payload);
        const result = await applyCreateSentence(body, volunteerActor, ownerId);
        return result.id;
      }
      const { id } = row.payload as { id: string };
      await applyDeleteSentence(id, volunteerActor, ownerId);
      return null;
    }
    case "concept_media": {
      const result = await applyCreateConceptMedia(row.payload as MediaCreatePayload);
      return result!.id;
    }
    case "scene_media": {
      const result = await applyCreateSceneMedia(row.payload as MediaCreatePayload);
      return result!.id;
    }
    default: {
      const _exhaustive: never = row.targetType;
      throw new HttpError(400, "UNKNOWN_TARGET_TYPE", `Unknown target type: ${String(_exhaustive)}`);
    }
  }
}

const setAutoApproveSchema = z.object({ enabled: z.boolean() });
const rejectPendingChangeSchema = z.object({ reason: z.string().optional() });
const bulkPendingIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
const setVolunteerSchema = z.object({ enabled: z.boolean() });
const pendingChangesQuerySchema = z.object({
  volunteerId: z.string().uuid().optional(),
  targetType: z.enum(["category", "concept", "scene", "sentence", "concept_media", "scene_media"]).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
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
    if (q.status) conditions.push(inArray(contributions.status, q.status));
    if (q.module_type) conditions.push(inArray(contributions.moduleType, q.module_type));
    if (q.language_id) conditions.push(inArray(contributions.languageId, q.language_id));
    if (q.dialect_id) conditions.push(inArray(contributions.dialectId, q.dialect_id));
    if (q.user_id) conditions.push(eq(contributions.userId, q.user_id));
    if (q.search) conditions.push(or(ilike(users.displayName, `%${q.search}%`), ilike(users.email, `%${q.search}%`))!);
    if (q.tribe_id) conditions.push(inArray(contributorDemographics.tribeId, q.tribe_id));
    if (q.sub_tribe_id) conditions.push(inArray(contributorDemographics.subTribeId, q.sub_tribe_id));
    if (q.country) conditions.push(eq(contributorDemographics.country, q.country));
    if (q.city) conditions.push(eq(contributorDemographics.city, q.city));
    if (q.village_id) conditions.push(inArray(contributorDemographics.villageId, q.village_id));
    if (q.quarter_id) conditions.push(inArray(contributorDemographics.quarterId, q.quarter_id));
    if (q.gender) conditions.push(inArray(contributorDemographics.gender, q.gender));
    if (q.education_level) conditions.push(inArray(contributorDemographics.educationLevel, q.education_level));
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

    const [existing] = await db
      .select({ id: contributions.id, userId: contributions.userId, moduleType: contributions.moduleType, status: contributions.status })
      .from(contributions)
      .where(eq(contributions.id, id))
      .limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Contribution not found");
    }

    await db.update(contributions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contributions.id, id));
    await reverseContributionStatsOnDelete(existing.userId, existing.moduleType, existing.status);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_contribution_delete",
      resourceType: "contribution",
      resourceId: id,
      beforeState: { deletedAt: null },
      afterState: { deletedAt: new Date().toISOString() },
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

    const rows = await db
      .select({
        id: contributions.id,
        status: contributions.status,
        verifiedAt: contributions.verifiedAt,
        verifiedBy: contributions.verifiedBy,
        rejectedAt: contributions.rejectedAt,
        rejectedBy: contributions.rejectedBy,
        rejectionReason: contributions.rejectionReason,
      })
      .from(contributions)
      .where(inArray(contributions.id, ids));
    if (rows.length === 0) return { updated: 0 };

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "rejected") updates.rejectionReason = reason ?? null;

    await db.update(contributions).set(updates).where(inArray(contributions.id, rows.map((r) => r.id)));

    const actorRole = request.user!.role;
    await writeAuditLogs(
      rows.map((row) => {
        const { id, ...beforeState } = row;
        return {
          actorId: request.user!.id,
          actorRole,
          action: "admin_contribution_status_change",
          resourceType: "contribution",
          resourceId: id,
          beforeState,
          afterState: { status, reason: reason ?? null },
        };
      }),
    );

    return { updated: rows.length };
  });

  fastify.post("/admin/contributions/bulk-delete", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    const rows = await db
      .select({ id: contributions.id, userId: contributions.userId, moduleType: contributions.moduleType, status: contributions.status })
      .from(contributions)
      .where(and(inArray(contributions.id, ids), isNull(contributions.deletedAt)));
    if (rows.length === 0) return { deleted: 0 };

    await db.update(contributions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(contributions.id, rows.map((r) => r.id)));

    // Same reversal as the single-item delete above, one per affected
    // contributor -- run with bounded concurrency rather than sequentially,
    // same reasoning as the permanent-delete batching (see below).
    const REVERSAL_CONCURRENCY = 5;
    for (let i = 0; i < rows.length; i += REVERSAL_CONCURRENCY) {
      const batch = rows.slice(i, i + REVERSAL_CONCURRENCY);
      await Promise.all(batch.map((row) => reverseContributionStatsOnDelete(row.userId, row.moduleType, row.status)));
    }

    const actorRole = request.user!.role;
    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole,
        action: "admin_contribution_delete",
        resourceType: "contribution",
        resourceId: row.id,
        beforeState: { deletedAt: null },
        afterState: { deletedAt: new Date().toISOString() },
      })),
    );

    return { deleted: rows.length };
  });

  /* --------------------------- Contribution reviews --------------------------- */
  // Every peer review left on one contribution, for the admin detail panel:
  // who reviewed it, what they decided, and any note they left, plus a
  // tally per decision. audio_files carries denormalized counters for the
  // same thing, but those are per audio file, not per contribution, and
  // carry no reviewer identity -- this reads the reviews table directly.

  fastify.get("/admin/contributions/:id/reviews", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const items = await db
      .select({
        id: reviews.id,
        decision: reviews.decision,
        reason: reviews.reason,
        notes: reviews.notes,
        statusBefore: reviews.statusBefore,
        statusAfter: reviews.statusAfter,
        createdAt: reviews.createdAt,
        reviewerId: users.id,
        reviewerName: users.displayName,
        reviewerEmail: users.email,
      })
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.reviewerId))
      .where(eq(reviews.contributionId, id))
      .orderBy(desc(reviews.createdAt));

    const tally = { valid: 0, invalid: 0, cannot_decide: 0, needs_correction: 0 };
    for (const r of items) {
      if (r.decision in tally) tally[r.decision as keyof typeof tally] += 1;
    }

    return { items, tally, total: items.length };
  });

  /* --------------------------- Contribution keywords -------------------------- */
  // ADMIN ONLY: free-text training-data labels for any of the four modules'
  // contributions. Never exposed to contributors.

  fastify.get("/admin/contributions/:id/keywords", { preHandler: requirePermission("contributions.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const items = await db
      .select({ id: contributionKeywords.id, keyword: contributionKeywords.keyword, audioFileId: contributionKeywords.audioFileId })
      .from(contributionKeywords)
      .where(eq(contributionKeywords.contributionId, id))
      .orderBy(asc(contributionKeywords.createdAt));

    return { items };
  });

  fastify.post("/admin/contributions/:id/keywords", { preHandler: requirePermission("contributions.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = addContributionKeywordSchema.parse(request.body);

    const [contribution] = await db
      .select({
        id: contributions.id,
        wordAudioFileId: wordRecordings.audioFileId,
        audioAudioFileId: audioUploads.audioFileId,
        translationAudioFileId: translations.audioFileId,
        sceneAudioFileId: sceneContributions.audioFileId,
      })
      .from(contributions)
      .leftJoin(wordRecordings, eq(wordRecordings.id, contributions.wordRecordingId))
      .leftJoin(audioUploads, eq(audioUploads.id, contributions.audioUploadId))
      .leftJoin(translations, eq(translations.id, contributions.translationId))
      .leftJoin(sceneContributions, eq(sceneContributions.id, contributions.sceneContributionId))
      .where(eq(contributions.id, id))
      .limit(1);
    if (!contribution) {
      throw new HttpError(404, "NOT_FOUND", "Contribution not found");
    }

    // Denormalized onto the keyword row at creation time (see the column's
    // comment in schema.ts) so every training-data label is directly
    // attached to the audio file it describes, not just to the contribution.
    const audioFileId =
      contribution.wordAudioFileId ?? contribution.audioAudioFileId ?? contribution.translationAudioFileId ?? contribution.sceneAudioFileId ?? null;

    const [keyword] = await db
      .insert(contributionKeywords)
      .values({ contributionId: id, keyword: body.keyword, audioFileId })
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

    const [contribution] = await db
      .select({
        status: contributions.status,
        verifiedAt: contributions.verifiedAt,
        verifiedBy: contributions.verifiedBy,
        rejectedAt: contributions.rejectedAt,
        rejectedBy: contributions.rejectedBy,
        rejectionReason: contributions.rejectionReason,
      })
      .from(contributions)
      .where(eq(contributions.id, id))
      .limit(1);
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
      beforeState: contribution,
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
    const query = usersQuerySchema.parse(request.query);
    const { limit, offset } = query;
    const whereClause = buildUserConditions(query);

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
      reviewsCompleted: userStats.reviewsCompleted,
      gender: contributorDemographics.gender,
      age: contributorDemographics.age,
      city: contributorDemographics.city,
      country: contributorDemographics.country,
      motherTongue: contributorDemographics.motherTongue,
      tribeName: tribes.name,
    };

    const [items, [totalRow]] = await Promise.all([
      db
        .select(selection)
        .from(users)
        .leftJoin(userStats, eq(userStats.userId, users.id))
        .leftJoin(contributorDemographics, eq(contributorDemographics.userId, users.id))
        .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
        .where(whereClause)
        .orderBy(userSortOrder(query.sort))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(users)
        .leftJoin(userStats, eq(userStats.userId, users.id))
        .leftJoin(contributorDemographics, eq(contributorDemographics.userId, users.id))
        .where(whereClause),
    ]);

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  /**
   * Just enough to render a contributor picker. The full list endpoint joins
   * user_stats, contributor_demographics and tribes and runs a COUNT -- all
   * of it wasted when the caller only needs "Name (email)" in a <select>,
   * and it was pulling 500 such rows on every admin contributions page load.
   */
  fastify.get("/admin/users/options", { preHandler: requirePermission("users.manage") }, async () => {
    const items = await db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.displayName));
    return { items };
  });

  // Everything filled in at signup (contributor_demographics) plus a
  // crude activity summary (user_stats) for the admin "Details" view --
  // the list endpoint above only carries the handful of columns the table
  // needs, not the full onboarding form or activity breakdown.
  fastify.get("/admin/users/:id", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [row] = await userReportQuery(and(eq(users.id, id), isNull(users.deletedAt))!).limit(1);

    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    return row;
  });

  /* --------------------------- User reports (CSV/PDF) -------------------------- */

  /** A single user's full record as a downloadable file. */
  fastify.get("/admin/users/:id/report", { preHandler: requirePermission("users.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { format } = reportFormatSchema.parse(request.query);

    const rows = await fetchUserReportRows([id]);
    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    const slug = fileSlug(rows[0]!.fullName ?? rows[0]!.displayName);
    return sendReport(reply, rows, format, `lexlingo-user-${slug}`, request.user?.email ?? "admin");
  });

  /** One combined report covering every user selected in the table. */
  fastify.post("/admin/users/report", { preHandler: requirePermission("users.manage") }, async (request, reply) => {
    const { ids, format } = bulkReportSchema.parse(request.body);

    const rows = await fetchUserReportRows(ids);
    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "No matching users found");
    }
    // Preserve the order the admin selected in, not the order Postgres
    // happened to return -- a consolidated report that reshuffles rows is
    // hard to reconcile against the table it was generated from.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));

    const stamp = new Date().toISOString().slice(0, 10);
    return sendReport(reply, ordered, format, `lexlingo-users-${ordered.length}-${stamp}`, request.user?.email ?? "admin");
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

  // Lets an admin/super_admin reset a user's email, password, and/or display
  // name -- e.g. a user locked out with no working recovery email. Changing
  // an admin or super_admin's own credentials this way would be a privilege-
  // escalation shortcut (reset their password, log in as them), so that's
  // restricted to super_admin acting on another admin; nobody can use this
  // route on a super_admin at all -- that account manages its own
  // credentials via the normal self-service change-password flow.
  fastify.post("/admin/users/:id/credentials", { preHandler: requirePermission("users.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = adminSetCredentialsSchema.parse(request.body);
    const actor = request.user!;

    const [target] = await db.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    if (target.role === "super_admin") {
      throw new HttpError(403, "FORBIDDEN", "A super_admin's credentials can't be changed from this panel");
    }
    if (target.role === "admin" && actor.role !== "super_admin") {
      throw new HttpError(403, "FORBIDDEN", "Only a super_admin can change another admin's credentials");
    }

    if (body.email && body.email.toLowerCase() !== target.email.toLowerCase()) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, body.email), isNull(users.deletedAt)))
        .limit(1);
      if (existing) {
        throw new HttpError(409, "EMAIL_TAKEN", "Another account already uses this email");
      }
    }

    const updated = await authService.adminUpdateCredentials(id, body);
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "admin_user_credentials_update",
      resourceType: "user",
      resourceId: id,
      beforeState: { email: target.email },
      // The new password itself is never logged -- only whether one was set.
      afterState: { email: updated.email, displayName: updated.displayName, passwordChanged: body.password !== undefined },
    });

    return updated;
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

  /* ------------------------------ Categories ------------------------------- */
  // No creation route existed at all before this -- every category in the
  // corpus came from the initial seed script, so an admin could never add
  // one on their own, not even an empty one to organize future concepts
  // into. Deliberately just a category by itself: nothing here requires or
  // creates a concept alongside it.

  fastify.post(
    "/admin/categories",
    { preHandler: requirePermission("concepts.manage") },
    async (request, reply) => {
      const body = createCategorySchema.parse(request.body);

      const outcome = await gateVolunteerAction(
        request.user!,
        "category",
        "create",
        { nameEnglish: body.nameEnglish, icon: body.icon ?? null, sortOrder: body.sortOrder ?? 0 },
        () => applyCreateCategory(body, request.user!),
      );

      if (outcome.pending) {
        reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
        return;
      }
      reply.code(201).send(outcome.result);
    },
  );

  // Paste-a-list bulk sibling of the single-category form above -- one name
  // per line, slug auto-generated the same way. A name colliding with an
  // existing category (or a duplicate earlier in the same paste) is a
  // per-row error rather than failing the whole batch, same convention as
  // every other bulk-* route in this file.
  fastify.post("/admin/categories/bulk-text", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { names } = bulkCategoryTextSchema.parse(request.body);

    const existingSlugs = new Set(
      (await db.select({ slug: categories.slug }).from(categories)).map((c) => c.slug),
    );

    const result: BulkResult = { created: 0, errors: [] };
    const toInsert: { rowNum: number; value: typeof categories.$inferInsert }[] = [];

    names.forEach((rawName, i) => {
      const rowNum = i + 1;
      const nameEnglish = rawName.trim();
      const slug = slugify(nameEnglish);
      if (existingSlugs.has(slug)) {
        result.errors.push({ row: rowNum, message: `A category with slug "${slug}" already exists` });
        return;
      }
      existingSlugs.add(slug); // reserve within this batch too, so two identical pasted names don't both insert
      toInsert.push({ rowNum, value: { slug, nameEnglish } });
    });

    // No audit log here, matching /admin/concepts/bulk and /admin/scenes/bulk
    // just below -- audit_logs.resourceId is a uuid column, and a chunked
    // multi-row INSERT (insertBulkInChunks) doesn't return per-row ids to
    // key one against, unlike the single-category route above.
    await insertBulkInChunks(categories, toInsert, result);
    return result;
  });

  /* ------------------------------- Concepts ------------------------------- */

  fastify.post("/admin/concepts", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const body = createConceptSchema.parse(request.body);
    const actor = request.user!;
    const createdBy = actor.role === "volunteer" ? actor.id : null;

    const outcome = await gateVolunteerAction(actor, "concept", "create", body, () => applyCreateConcept(body, actor, createdBy));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
  });

  // Bulk create from a CSV or JSON file. Expected row fields: category
  // (slug or English name -- resolved against existing categories),
  // labelEnglish (required), description (optional). Rows that fail
  // validation are skipped and reported back individually rather than
  // failing the whole batch.
  fastify.post("/admin/concepts/bulk", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const rows = await readBulkRows(request);
    const { toInsert, errors } = await buildConceptInserts(rows, 2); // +1 for 0-index, +1 for the header row
    const result: BulkResult = { created: 0, errors };
    await insertBulkInChunks(concepts, toInsert, result);
    if (result.created > 0) invalidateCategoriesCache();
    return result;
  });

  // Lighter-weight sibling of the CSV/JSON upload above: paste "label,
  // category" lines straight into a textarea instead of preparing a file --
  // parsed client-side into a structured array, so this shares the exact
  // same row-building/category-matching logic as the file-based route.
  fastify.post("/admin/concepts/bulk-text", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { items } = bulkConceptTextSchema.parse(request.body);
    const { toInsert, errors } = await buildConceptInserts(items, 1);
    const result: BulkResult = { created: 0, errors };
    await insertBulkInChunks(concepts, toInsert, result);
    if (result.created > 0) invalidateCategoriesCache();
    return result;
  });

  fastify.put("/admin/concepts/:id", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateConceptSchema.parse(request.body);

    const [existing] = await db.select().from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    const [updated] = await db.update(concepts).set({ ...body, updatedAt: new Date() }).where(eq(concepts.id, id)).returning();

    // Only the fields this PUT actually touched, so undo restores exactly
    // what changed instead of overwriting untouched columns with a stale
    // full-row snapshot.
    const beforeState = Object.fromEntries(Object.keys(body).map((k) => [k, existing[k as keyof typeof existing]]));
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_concept_update",
      resourceType: "concept",
      resourceId: id,
      beforeState,
      afterState: body,
    });

    invalidateCategoriesCache();
    return updated;
  });

  fastify.post("/admin/concepts/bulk-delete", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    const rows = await db.select({ id: concepts.id, isActive: concepts.isActive, deletedAt: concepts.deletedAt }).from(concepts).where(inArray(concepts.id, ids));
    if (rows.length === 0) return { deleted: 0 };

    await db.update(concepts).set({ isActive: false, deletedAt: new Date() }).where(inArray(concepts.id, rows.map((r) => r.id)));

    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_concept_delete",
        resourceType: "concept",
        resourceId: row.id,
        beforeState: { isActive: row.isActive, deletedAt: row.deletedAt },
        afterState: { isActive: false },
      })),
    );

    invalidateCategoriesCache();
    return { deleted: rows.length };
  });

  fastify.post("/admin/concepts/bulk-edit", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { ids, ...fields } = bulkEditConceptsSchema.parse(request.body);

    const fieldKeys = Object.keys(fields) as (keyof typeof fields)[];
    const rows = await db.select().from(concepts).where(inArray(concepts.id, ids));
    if (rows.length === 0) return { updated: 0 };

    await db.update(concepts).set({ ...fields, updatedAt: new Date() }).where(inArray(concepts.id, rows.map((r) => r.id)));

    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_concept_update",
        resourceType: "concept",
        resourceId: row.id,
        beforeState: Object.fromEntries(fieldKeys.map((k) => [k, row[k as keyof typeof row]])),
        afterState: fields,
      })),
    );

    invalidateCategoriesCache();
    return { updated: rows.length };
  });

  fastify.delete("/admin/concepts/:id", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;

    // A volunteer may only ever delete (or request deletion of) a concept
    // they added themselves -- checked here up front, for an immediate,
    // honest error, and again inside applyDeleteConcept at approval time in
    // case a different volunteer's edit landed on this row in the meantime.
    if (actor.role === "volunteer") {
      const [target] = await db.select({ createdBy: concepts.createdBy }).from(concepts).where(eq(concepts.id, id)).limit(1);
      if (!target) throw new HttpError(404, "NOT_FOUND", "Concept not found");
      if (target.createdBy !== actor.id) {
        throw new HttpError(403, "FORBIDDEN", "You can only delete concepts you added yourself");
      }
    }

    const outcome = await gateVolunteerAction(actor, "concept", "delete", { id }, () =>
      applyDeleteConcept(id, actor, actor.role === "volunteer" ? actor.id : undefined),
    );

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.send(outcome.result);
  });

  fastify.delete("/admin/concepts/:id/permanent", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return runPermanentDelete(request, "concept", id);
  });

  fastify.post("/admin/concepts/bulk-delete-permanent", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);
    return runBulkPermanentDelete(request, "concept", ids);
  });

  fastify.post("/admin/concepts/:id/media", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;

    const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!concept) {
      throw new HttpError(404, "NOT_FOUND", "Concept not found");
    }

    const { buffer, filename } = await readImageFile(request);
    const payload: MediaCreatePayload = { targetId: id, source: "upload", bufferBase64: buffer.toString("base64"), filename };
    const outcome = await gateVolunteerAction(actor, "concept_media", "create", payload, () => applyCreateConceptMedia(payload));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
  });

  // Same as above but the image is fetched server-side from a third-party
  // URL instead of uploaded as multipart -- still re-encoded and re-hosted
  // through uploadSceneImage() so it ends up on our own CDN either way.
  fastify.post("/admin/concepts/:id/media/url", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { imageUrl } = imageUrlSchema.parse(request.body);
    const actor = request.user!;

    const payload: MediaCreatePayload = { targetId: id, source: "url", imageUrl };
    const outcome = await gateVolunteerAction(actor, "concept_media", "create", payload, () => applyCreateConceptMedia(payload));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
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

  // Every image on a concept, however it got there (multipart upload, "From
  // URL", or Openverse) -- all three funnel through insertConceptMedia, so
  // one list/delete pair here covers every source.
  fastify.get("/admin/concepts/:id/media", { preHandler: requirePermission("concepts.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const items = await db.select().from(conceptMedia).where(eq(conceptMedia.conceptId, id)).orderBy(desc(conceptMedia.isPrimary), asc(conceptMedia.createdAt));
    return { items };
  });

  fastify.delete(
    "/admin/concepts/:id/media/:mediaId",
    { preHandler: requirePermission("concepts.manage") },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { mediaId } = mediaIdParamSchema.parse(request.params);

      const [media] = await db
        .select({ id: conceptMedia.id, storageKey: conceptMedia.storageKey, isPrimary: conceptMedia.isPrimary })
        .from(conceptMedia)
        .where(and(eq(conceptMedia.id, mediaId), eq(conceptMedia.conceptId, id)))
        .limit(1);
      if (!media) {
        throw new HttpError(404, "NOT_FOUND", "Image not found on this concept");
      }

      await db.delete(conceptMedia).where(eq(conceptMedia.id, mediaId));

      // The primary image just went away but others remain -- promote the
      // oldest survivor so the concept isn't left with zero primary image
      // while other, now-orphaned images still exist for it.
      if (media.isPrimary) {
        const [next] = await db
          .select({ id: conceptMedia.id })
          .from(conceptMedia)
          .where(eq(conceptMedia.conceptId, id))
          .orderBy(asc(conceptMedia.createdAt))
          .limit(1);
        if (next) {
          await db.update(conceptMedia).set({ isPrimary: true }).where(eq(conceptMedia.id, next.id));
        }
      }

      // DB row is gone either way; a storage failure here is logged, not
      // thrown -- same "delete already succeeded, an orphaned file is a
      // much smaller problem" reasoning as the permanent-delete path.
      try {
        await storageService.deleteImage(media.storageKey);
      } catch (err) {
        console.error(`[admin] concept ${id} image ${mediaId} row deleted but storage object could not be removed:`, err);
      }

      return { id: mediaId, deleted: true };
    },
  );

  // Replaces this exact image with a manually-cropped version -- the crop
  // itself happened client-side (a canvas, against either a freshly-picked
  // local file or this same image's own already-CORS-enabled Supabase
  // public URL), so the server's job is just to re-encode and swap it in,
  // not to crop again. The row's id/isPrimary/source metadata are untouched;
  // only the image itself and its storage key change.
  fastify.put(
    "/admin/concepts/:id/media/:mediaId/crop",
    { preHandler: requirePermission("concepts.manage") },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const { mediaId } = mediaIdParamSchema.parse(request.params);

      const [existing] = await db
        .select({ id: conceptMedia.id, storageKey: conceptMedia.storageKey })
        .from(conceptMedia)
        .where(and(eq(conceptMedia.id, mediaId), eq(conceptMedia.conceptId, id)))
        .limit(1);
      if (!existing) {
        throw new HttpError(404, "NOT_FOUND", "Image not found on this concept");
      }

      const { buffer, filename } = await readImageFile(request);
      const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
      const storageFilename = `concepts/${id}/${randomUUID()}.${ext}`;
      const { path, publicUrl, mimeType, fileSizeBytes } = await storageService.uploadPrecroppedConceptImage(buffer, storageFilename);

      const [updated] = await db
        .update(conceptMedia)
        .set({ storageKey: path, publicUrl, mimeType, fileSizeBytes })
        .where(eq(conceptMedia.id, mediaId))
        .returning();

      try {
        await storageService.deleteImage(existing.storageKey);
      } catch (err) {
        console.error(`[admin] concept ${id} image ${mediaId} re-cropped but old storage object could not be removed:`, err);
      }

      reply.send(updated);
    },
  );

  // Shared by both the concepts and scenes admin pages -- gated on either
  // permission since it doesn't touch either table itself, it's read-only
  // against Openverse's own catalog.
  fastify.get(
    "/admin/openverse/search",
    { preHandler: requireAnyPermission("concepts.manage", "scenes.manage") },
    async (request) => {
      const { q, page, pageSize } = openverseSearchQuerySchema.parse(request.query);
      return searchOpenverseImages(q, { page, pageSize });
    },
  );

  // Attaches one image the admin picked from the Openverse search picker --
  // re-hosted through the same fetch-and-store pipeline as "From URL", plus
  // the license/creator metadata Openverse's terms require keeping alongside
  // a redistributed image.
  fastify.post("/admin/concepts/:id/media/openverse", { preHandler: requirePermission("concepts.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { image } = addConceptOpenverseSchema.parse(request.body);
    const actor = request.user!;

    const payload: MediaCreatePayload = { targetId: id, source: "openverse", image };
    const outcome = await gateVolunteerAction(actor, "concept_media", "create", payload, () => applyCreateConceptMedia(payload));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
  });

  // Bulk auto-fill: searches Openverse using each concept's own label and
  // attaches the top result, for every concept in `ids` (or, if omitted,
  // every concept in the corpus that currently has no image at all). Each
  // concept is independent -- a search miss or a bad license on one doesn't
  // block the rest, same "one bad row doesn't fail the batch" convention as
  // the CSV/JSON bulk-create and bulk-url endpoints.
  fastify.post(
    "/admin/concepts/media/openverse-autofill",
    { preHandler: requirePermission("concepts.manage") },
    async (request) => {
      const { ids } = bulkOpenverseAutofillSchema.parse(request.body);
      const targets = await conceptsWithoutImage(ids);
      if (targets.length === 0) return { created: 0, errors: [] };

      const AUTOFILL_CONCURRENCY = 5;
      const errors: { row: number; message: string }[] = [];
      let created = 0;

      for (let i = 0; i < targets.length; i += AUTOFILL_CONCURRENCY) {
        const batch = targets.slice(i, i + AUTOFILL_CONCURRENCY);
        const outcomes = await Promise.allSettled(
          batch.map(async (concept) => {
            const { results } = await searchOpenverseImages(concept.labelEnglish, { pageSize: 1 });
            const top = results[0];
            if (!top) throw new Error(`No Openverse results for "${concept.labelEnglish}"`);
            await addConceptImageFromUrl(concept.id, top.url, attributionFromOpenverse(top));
          }),
        );
        outcomes.forEach((outcome, j) => {
          if (outcome.status === "fulfilled") created += 1;
          else errors.push({ row: i + j + 1, message: outcome.reason instanceof Error ? outcome.reason.message : "Failed" });
        });
      }

      return { created, errors };
    },
  );

  /* --------------------------------- Scenes --------------------------------- */

  fastify.post("/admin/scenes", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const body = createSceneSchema.parse(request.body);
    const actor = request.user!;
    const createdBy = actor.role === "volunteer" ? actor.id : null;

    const outcome = await gateVolunteerAction(actor, "scene", "create", body, () => applyCreateScene(body, actor, createdBy));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
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
    const toInsert: { rowNum: number; value: typeof scenes.$inferInsert }[] = [];

    // Bounded to this batch's own titles, same reasoning as the sentences
    // bulk route's existingLower check.
    const candidateLower = [...new Set(rows.map((r) => (r.title ?? "").trim().toLowerCase()).filter(Boolean))];
    const existingLowerTitles = new Set(
      candidateLower.length
        ? (
            await db
              .select({ title: scenes.title })
              .from(scenes)
              .where(and(sql`lower(${scenes.title}) in ${candidateLower}`, isNull(scenes.deletedAt)))
          ).map((s) => s.title.toLowerCase())
        : [],
    );

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
      // Silently skip a case-insensitive duplicate title -- no error, no
      // created count, same convention as concepts/sentences above.
      const lowerTitle = title.toLowerCase();
      if (existingLowerTitles.has(lowerTitle)) {
        continue;
      }
      existingLowerTitles.add(lowerTitle);

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

      toInsert.push({
        rowNum,
        value: {
          slug,
          title,
          description: row.description?.trim() || null,
          difficulty: difficultyRaw as (typeof sceneDifficulty.enumValues)[number],
          estimatedDurationSeconds,
        },
      });
    }

    await insertBulkInChunks(scenes, toInsert, result);
    return result;
  });

  // Paste-a-list sibling of the CSV/JSON upload above: one title per line,
  // no slug required -- generated from the title (deduped against existing
  // active slugs and against earlier lines in the same paste, appending
  // -2/-3/... on collision, since two "Market Day" pastes shouldn't fight
  // over the bare "market-day" slug).
  fastify.post("/admin/scenes/bulk-text", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { titles } = bulkSceneTextSchema.parse(request.body);

    const existingScenes = await db.select({ slug: scenes.slug, title: scenes.title }).from(scenes).where(isNull(scenes.deletedAt));
    const existingSlugs = new Set(existingScenes.map((r) => r.slug));
    const existingLowerTitles = new Set(existingScenes.map((r) => r.title.toLowerCase()));

    const result: BulkResult = { created: 0, errors: [] };
    const toInsert: { rowNum: number; value: typeof scenes.$inferInsert }[] = [];

    titles.forEach((rawTitle, i) => {
      const rowNum = i + 1;
      const title = rawTitle.trim();

      // Silently skip a case-insensitive duplicate title -- no error, no
      // created count, same convention as every other bulk-add route.
      const lowerTitle = title.toLowerCase();
      if (existingLowerTitles.has(lowerTitle)) {
        return;
      }
      existingLowerTitles.add(lowerTitle);

      const base = slugify(title);
      let slug = base;
      let suffix = 2;
      while (existingSlugs.has(slug)) {
        slug = `${base}-${suffix}`;
        suffix += 1;
      }
      existingSlugs.add(slug);
      toInsert.push({ rowNum, value: { slug, title } });
    });

    await insertBulkInChunks(scenes, toInsert, result);
    return result;
  });

  fastify.put("/admin/scenes/:id", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateSceneSchema.parse(request.body);

    const [existing] = await db.select().from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Scene not found");
    }

    const [updated] = await db.update(scenes).set({ ...body, updatedAt: new Date() }).where(eq(scenes.id, id)).returning();

    const beforeState = Object.fromEntries(Object.keys(body).map((k) => [k, existing[k as keyof typeof existing]]));
    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_scene_update",
      resourceType: "scene",
      resourceId: id,
      beforeState,
      afterState: body,
    });

    return updated;
  });

  fastify.post("/admin/scenes/bulk-delete", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    const rows = await db.select({ id: scenes.id, isActive: scenes.isActive, deletedAt: scenes.deletedAt }).from(scenes).where(inArray(scenes.id, ids));
    if (rows.length === 0) return { deleted: 0 };

    await db.update(scenes).set({ isActive: false, deletedAt: new Date() }).where(inArray(scenes.id, rows.map((r) => r.id)));

    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_scene_delete",
        resourceType: "scene",
        resourceId: row.id,
        beforeState: { isActive: row.isActive, deletedAt: row.deletedAt },
        afterState: { isActive: false },
      })),
    );

    return { deleted: rows.length };
  });

  fastify.post("/admin/scenes/bulk-delete-permanent", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);
    return runBulkPermanentDelete(request, "scene", ids);
  });

  fastify.post("/admin/scenes/bulk-edit", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { ids, ...fields } = bulkEditScenesSchema.parse(request.body);

    const fieldKeys = Object.keys(fields) as (keyof typeof fields)[];
    const rows = await db.select().from(scenes).where(inArray(scenes.id, ids));
    if (rows.length === 0) return { updated: 0 };

    await db.update(scenes).set({ ...fields, updatedAt: new Date() }).where(inArray(scenes.id, rows.map((r) => r.id)));

    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_scene_update",
        resourceType: "scene",
        resourceId: row.id,
        beforeState: Object.fromEntries(fieldKeys.map((k) => [k, row[k as keyof typeof row]])),
        afterState: fields,
      })),
    );

    return { updated: rows.length };
  });

  fastify.delete("/admin/scenes/:id", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;

    if (actor.role === "volunteer") {
      const [target] = await db.select({ createdBy: scenes.createdBy }).from(scenes).where(eq(scenes.id, id)).limit(1);
      if (!target) throw new HttpError(404, "NOT_FOUND", "Scene not found");
      if (target.createdBy !== actor.id) {
        throw new HttpError(403, "FORBIDDEN", "You can only delete scenes you added yourself");
      }
    }

    const outcome = await gateVolunteerAction(actor, "scene", "delete", { id }, () =>
      applyDeleteScene(id, actor, actor.role === "volunteer" ? actor.id : undefined),
    );

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.send(outcome.result);
  });

  fastify.delete("/admin/scenes/:id/permanent", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return runPermanentDelete(request, "scene", id);
  });

  fastify.post("/admin/scenes/:id/media", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;

    const [scene] = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!scene) {
      throw new HttpError(404, "NOT_FOUND", "Scene not found");
    }

    const { buffer, filename } = await readImageFile(request);
    const payload: MediaCreatePayload = { targetId: id, source: "upload", bufferBase64: buffer.toString("base64"), filename };
    const outcome = await gateVolunteerAction(actor, "scene_media", "create", payload, () => applyCreateSceneMedia(payload));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
  });

  fastify.post("/admin/scenes/:id/media/url", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { imageUrl } = imageUrlSchema.parse(request.body);
    const actor = request.user!;

    const payload: MediaCreatePayload = { targetId: id, source: "url", imageUrl };
    const outcome = await gateVolunteerAction(actor, "scene_media", "create", payload, () => applyCreateSceneMedia(payload));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
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

  fastify.post("/admin/scenes/:id/media/openverse", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { image } = addSceneOpenverseSchema.parse(request.body);
    const actor = request.user!;

    const payload: MediaCreatePayload = { targetId: id, source: "openverse", image };
    const outcome = await gateVolunteerAction(actor, "scene_media", "create", payload, () => applyCreateSceneMedia(payload));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
  });

  // Same bulk auto-fill idea as concepts, searching Openverse by scene title.
  fastify.post(
    "/admin/scenes/media/openverse-autofill",
    { preHandler: requirePermission("scenes.manage") },
    async (request) => {
      const { ids } = bulkOpenverseAutofillSchema.parse(request.body);
      const targets = await scenesWithoutImage(ids);
      if (targets.length === 0) return { created: 0, errors: [] };

      const AUTOFILL_CONCURRENCY = 5;
      const errors: { row: number; message: string }[] = [];
      let created = 0;

      for (let i = 0; i < targets.length; i += AUTOFILL_CONCURRENCY) {
        const batch = targets.slice(i, i + AUTOFILL_CONCURRENCY);
        const outcomes = await Promise.allSettled(
          batch.map(async (scene) => {
            const { results } = await searchOpenverseImages(scene.title, { pageSize: 1 });
            const top = results[0];
            if (!top) throw new Error(`No Openverse results for "${scene.title}"`);
            await addSceneImageFromUrl(scene.id, top.url, attributionFromOpenverse(top));
          }),
        );
        outcomes.forEach((outcome, j) => {
          if (outcome.status === "fulfilled") created += 1;
          else errors.push({ row: i + j + 1, message: outcome.reason instanceof Error ? outcome.reason.message : "Failed" });
        });
      }

      return { created, errors };
    },
  );

  // Same as the concepts pair above -- every scene image, however it got
  // there (upload, "From URL", or Openverse), lives in sceneMedia and is
  // covered by one list/delete pair here.
  fastify.get("/admin/scenes/:id/media", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const items = await db.select().from(sceneMedia).where(eq(sceneMedia.sceneId, id)).orderBy(desc(sceneMedia.isPrimary), asc(sceneMedia.createdAt));
    return { items };
  });

  fastify.delete("/admin/scenes/:id/media/:mediaId", { preHandler: requirePermission("scenes.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { mediaId } = mediaIdParamSchema.parse(request.params);

    const [media] = await db
      .select({ id: sceneMedia.id, storageKey: sceneMedia.storageKey, isPrimary: sceneMedia.isPrimary })
      .from(sceneMedia)
      .where(and(eq(sceneMedia.id, mediaId), eq(sceneMedia.sceneId, id)))
      .limit(1);
    if (!media) {
      throw new HttpError(404, "NOT_FOUND", "Image not found on this scene");
    }

    // scene_image_keywords cascades on the DB side (onDelete: "cascade"),
    // so no manual cleanup needed for those.
    await db.delete(sceneMedia).where(eq(sceneMedia.id, mediaId));

    if (media.isPrimary) {
      const [next] = await db
        .select({ id: sceneMedia.id })
        .from(sceneMedia)
        .where(eq(sceneMedia.sceneId, id))
        .orderBy(asc(sceneMedia.createdAt))
        .limit(1);
      if (next) {
        await db.update(sceneMedia).set({ isPrimary: true }).where(eq(sceneMedia.id, next.id));
      }
    }

    try {
      await storageService.deleteImage(media.storageKey);
    } catch (err) {
      console.error(`[admin] scene ${id} image ${mediaId} row deleted but storage object could not be removed:`, err);
    }

    return { id: mediaId, deleted: true };
  });

  // See the identical concept-image crop route above for the reasoning --
  // the crop already happened client-side, this just re-encodes and swaps
  // the file in place.
  fastify.put("/admin/scenes/:id/media/:mediaId/crop", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { mediaId } = mediaIdParamSchema.parse(request.params);

    const [existing] = await db
      .select({ id: sceneMedia.id, storageKey: sceneMedia.storageKey })
      .from(sceneMedia)
      .where(and(eq(sceneMedia.id, mediaId), eq(sceneMedia.sceneId, id)))
      .limit(1);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Image not found on this scene");
    }

    const { buffer, filename } = await readImageFile(request);
    const ext = filename.includes(".") ? filename.split(".").pop() : "jpg";
    const storageFilename = `scenes/${id}/${randomUUID()}.${ext}`;
    const { path, publicUrl, mimeType } = await storageService.uploadPrecroppedSceneImage(buffer, storageFilename);

    const [updated] = await db
      .update(sceneMedia)
      .set({ storageKey: path, publicUrl, mimeType })
      .where(eq(sceneMedia.id, mediaId))
      .returning();

    try {
      await storageService.deleteImage(existing.storageKey);
    } catch (err) {
      console.error(`[admin] scene ${id} image ${mediaId} re-cropped but old storage object could not be removed:`, err);
    }

    reply.send(updated);
  });

  /* --------------------------- Scene image keywords -------------------------- */
  // ADMIN ONLY: free-text training-data labels. Never exposed to contributors.

  // Media-scoped: attaches to the exact image just uploaded above, which
  // matters because a re-upload isn't primary (a scene can end up with
  // several sceneMedia rows) -- the scene-scoped routes below resolve to
  // whichever image is primary, which would silently tag the wrong image
  // if used right after uploading a second one.
  fastify.post("/admin/scenes/media/:mediaId/keywords", { preHandler: requirePermission("scenes.manage") }, async (request, reply) => {
    const { mediaId } = mediaIdParamSchema.parse(request.params);
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
    const { createdFrom, createdTo, mine, limit, offset } = sentencesQuerySchema.parse(request.query);

    const conditions = [isNull(sentences.deletedAt)];
    if (createdFrom) conditions.push(gte(sentences.createdAt, new Date(createdFrom)));
    if (createdTo) conditions.push(lte(sentences.createdAt, new Date(createdTo)));
    if (mine) conditions.push(eq(sentences.createdBy, request.user!.id));
    const whereClause = and(...conditions);

    const [items, [totalRow]] = await Promise.all([
      db.select().from(sentences).where(whereClause).orderBy(desc(sentences.createdAt)).limit(limit).offset(offset),
      db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(whereClause),
    ]);

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  fastify.post("/admin/sentences", { preHandler: requirePermission("sentences.manage") }, async (request, reply) => {
    const body = createSentenceSchema.parse(request.body);
    const actor = request.user!;
    const createdBy = actor.role === "volunteer" ? actor.id : null;

    const outcome = await gateVolunteerAction(actor, "sentence", "create", body, () => applyCreateSentence(body, actor, createdBy));

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.code(201).send(outcome.result);
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
    const toInsert: { rowNum: number; value: typeof sentences.$inferInsert }[] = [];

    // Bounded to this batch's own candidate texts (via the lower(english_text)
    // index added alongside this check) rather than pulling the whole
    // sentences table -- with 6000+ rows and cross-region latency, that would
    // be exactly the "never pull a large row set into Node" mistake this
    // codebase has already been burned by once (see ARCHITECTURE.md §2.7).
    const candidateLower = [...new Set(rows.map((r) => (r.englishText ?? "").trim().toLowerCase()).filter(Boolean))];
    const existingLower = new Set(
      candidateLower.length
        ? (
            await db
              .select({ englishText: sentences.englishText })
              .from(sentences)
              .where(and(sql`lower(${sentences.englishText}) in ${candidateLower}`, isNull(sentences.deletedAt)))
          ).map((s) => s.englishText.toLowerCase())
        : [],
    );

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

      // Silently skip -- no error, no created count -- same convention as
      // the concept duplicate check above.
      const lower = englishText.toLowerCase();
      if (existingLower.has(lower)) {
        continue;
      }
      existingLower.add(lower);

      toInsert.push({ rowNum, value: { englishText, categoryId } });
    }

    await insertBulkInChunks(sentences, toInsert, result);
    return result;
  });

  fastify.post("/admin/sentences/bulk-delete", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);

    const rows = await db.select({ id: sentences.id, isActive: sentences.isActive, deletedAt: sentences.deletedAt }).from(sentences).where(inArray(sentences.id, ids));
    if (rows.length === 0) return { deleted: 0 };

    await db.update(sentences).set({ isActive: false, deletedAt: new Date() }).where(inArray(sentences.id, rows.map((r) => r.id)));

    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_sentence_delete",
        resourceType: "sentence",
        resourceId: row.id,
        beforeState: { isActive: row.isActive, deletedAt: row.deletedAt },
        afterState: { isActive: false },
      })),
    );

    return { deleted: rows.length };
  });

  fastify.post("/admin/sentences/bulk-delete-permanent", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { ids } = bulkIdsSchema.parse(request.body);
    return runBulkPermanentDelete(request, "sentence", ids);
  });

  fastify.post("/admin/sentences/bulk-edit", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { ids, ...fields } = bulkEditSentencesSchema.parse(request.body);

    const fieldKeys = Object.keys(fields) as (keyof typeof fields)[];
    const rows = await db.select().from(sentences).where(inArray(sentences.id, ids));
    if (rows.length === 0) return { updated: 0 };

    await db.update(sentences).set({ ...fields, updatedAt: new Date() }).where(inArray(sentences.id, rows.map((r) => r.id)));

    await writeAuditLogs(
      rows.map((row) => ({
        actorId: request.user!.id,
        actorRole: request.user!.role,
        action: "admin_sentence_update",
        resourceType: "sentence",
        resourceId: row.id,
        beforeState: Object.fromEntries(fieldKeys.map((k) => [k, row[k as keyof typeof row]])),
        afterState: fields,
      })),
    );

    return { updated: rows.length };
  });

  fastify.delete("/admin/sentences/:id", { preHandler: requirePermission("sentences.manage") }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;

    if (actor.role === "volunteer") {
      const [target] = await db.select({ createdBy: sentences.createdBy }).from(sentences).where(eq(sentences.id, id)).limit(1);
      if (!target) throw new HttpError(404, "NOT_FOUND", "Sentence not found");
      if (target.createdBy !== actor.id) {
        throw new HttpError(403, "FORBIDDEN", "You can only delete sentences you added yourself");
      }
    }

    const outcome = await gateVolunteerAction(actor, "sentence", "delete", { id }, () =>
      applyDeleteSentence(id, actor, actor.role === "volunteer" ? actor.id : undefined),
    );

    if (outcome.pending) {
      reply.code(202).send({ pending: true, id: outcome.id, message: "Submitted for admin approval" });
      return;
    }
    reply.send(outcome.result);
  });

  fastify.delete("/admin/sentences/:id/permanent", { preHandler: requirePermission("sentences.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return runPermanentDelete(request, "sentence", id);
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

  // The crude admin Logs page's data source -- every writeAuditLog() call
  // anywhere in the backend (moderation actions, registration/login,
  // contribution submissions, permanent buffer failures) shows up here with
  // a timestamp. Joins users for a readable actor name/email instead of a
  // bare UUID, since that's the whole point of a page a human reads.
  fastify.get("/superadmin/audit-logs", { preHandler: requirePermission("audit.read") }, async (request) => {
    const { action, resource_type, search, limit, offset } = auditLogsQuerySchema.parse(request.query);

    const conditions = [];
    if (action) conditions.push(eq(auditLogs.action, action));
    if (resource_type) conditions.push(eq(auditLogs.resourceType, resource_type));
    if (search) conditions.push(or(ilike(users.displayName, `%${search}%`), ilike(users.email, `%${search}%`))!);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [totalRow]] = await Promise.all([
      db
        .select({
          id: auditLogs.id,
          actorId: auditLogs.actorId,
          actorRole: auditLogs.actorRole,
          actorDisplayName: users.displayName,
          actorEmail: users.email,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          beforeState: auditLogs.beforeState,
          afterState: auditLogs.afterState,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(whereClause),
    ]);

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  /* --------------------------- Reverse changes (undo) ------------------------- */
  // "Undo last change" for a single item, everywhere an edit/status
  // change/delete is already audit-logged: finds the most recent audit_logs
  // row for this resource and re-applies its beforeState. Deliberately
  // single-step (not a full history browser, not a whole-bulk-operation
  // undo) -- clicking it a second time re-applies the row's afterState
  // instead (an undo of an undo is a redo), since the just-written undo
  // audit entry becomes the new "latest" for this resource.
  //
  // gamification_config and feature_flags are keyed by a text key, not a
  // uuid resourceId (that column can't hold their keys), so their audit
  // rows carry the key inside beforeState/afterState instead -- undoing
  // those looks the row up by scanning recent entries for a match on that
  // key rather than by resourceId.
  const UNDO_PERMISSION_BY_RESOURCE: Record<string, string> = {
    contribution: "contributions.manage",
    concept: "concepts.manage",
    scene: "scenes.manage",
    sentence: "sentences.manage",
    gamification_config: "system.manage",
    feature_flag: "system.manage",
  };

  const undoParamSchema = z.object({ resourceType: z.string().min(1), identifier: z.string().min(1) });

  fastify.post("/admin/undo/:resourceType/:identifier", { preHandler: verifyToken }, async (request) => {
    const { resourceType, identifier } = undoParamSchema.parse(request.params);
    const role = request.user!.role;

    const isKeyed = resourceType === "gamification_config" || resourceType === "feature_flag";
    const keyField = resourceType === "gamification_config" ? "configKey" : "flagKey";

    let log: typeof auditLogs.$inferSelect | undefined;
    if (isKeyed) {
      const candidates = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resourceType, resourceType))
        .orderBy(desc(auditLogs.createdAt))
        .limit(100);
      log = candidates.find((c) => (c.beforeState as Record<string, unknown> | null)?.[keyField] === identifier);
    } else {
      if (resourceType !== "user" && !UNDO_PERMISSION_BY_RESOURCE[resourceType]) {
        throw new HttpError(400, "NOT_REVERTIBLE", `"${resourceType}" has no undo support`);
      }
      [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceType, resourceType), eq(auditLogs.resourceId, identifier)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
    }

    if (!log) {
      throw new HttpError(404, "NOT_FOUND", "No logged change found to undo for this item");
    }
    if (!log.beforeState) {
      throw new HttpError(400, "NOT_REVERTIBLE", "This change has no recorded prior state to restore");
    }

    // "user" maps to two different permissions depending on which action
    // produced this specific log row (granting admin is super_admin-only;
    // every other user action is users.manage) -- resolved only once the
    // actual log row (and its action) is known.
    const permission =
      resourceType === "user"
        ? log.action === "superadmin_grant_admin"
          ? "system.manage"
          : "users.manage"
        : UNDO_PERMISSION_BY_RESOURCE[resourceType];
    if (!permission || !(await hasPermission(role, permission))) {
      throw new HttpError(403, "FORBIDDEN", `required: ${permission ?? "unknown"}`);
    }

    const before = log.beforeState as Record<string, unknown>;

    switch (resourceType) {
      case "contribution":
        await db.update(contributions).set({ ...before, updatedAt: new Date() } as Partial<typeof contributions.$inferInsert>).where(eq(contributions.id, identifier));
        // Undoing a delete (before.deletedAt === null) must re-apply the
        // same user_stats increment the delete reversed, or the restored
        // contribution counts nowhere -- see adjustContributionStats.
        if (log.action === "admin_contribution_delete" && before.deletedAt === null) {
          const [restored] = await db
            .select({ userId: contributions.userId, moduleType: contributions.moduleType, status: contributions.status })
            .from(contributions)
            .where(eq(contributions.id, identifier))
            .limit(1);
          if (restored) {
            await adjustContributionStats(restored.userId, restored.moduleType, restored.status, 1);
          }
        }
        break;
      case "concept":
        await db.update(concepts).set({ ...before, updatedAt: new Date() } as Partial<typeof concepts.$inferInsert>).where(eq(concepts.id, identifier));
        invalidateCategoriesCache();
        break;
      case "scene":
        await db.update(scenes).set({ ...before, updatedAt: new Date() } as Partial<typeof scenes.$inferInsert>).where(eq(scenes.id, identifier));
        break;
      case "sentence":
        await db.update(sentences).set({ ...before, updatedAt: new Date() } as Partial<typeof sentences.$inferInsert>).where(eq(sentences.id, identifier));
        break;
      case "user":
        await db.update(users).set({ ...before, updatedAt: new Date() } as Partial<typeof users.$inferInsert>).where(eq(users.id, identifier));
        invalidateUserCache(identifier);
        break;
      case "gamification_config":
        await db
          .update(gamificationConfig)
          .set({ configValue: before.configValue as Record<string, unknown>, updatedBy: request.user!.id, updatedAt: new Date() })
          .where(eq(gamificationConfig.configKey, identifier));
        if (identifier.startsWith("levels.")) invalidateLevelThresholdsCache();
        break;
      case "feature_flag":
        await db
          .update(featureFlags)
          .set({ isEnabled: before.isEnabled as boolean, updatedBy: request.user!.id, updatedAt: new Date() })
          .where(eq(featureFlags.flagKey, identifier));
        break;
      default:
        throw new HttpError(400, "NOT_REVERTIBLE", `"${resourceType}" has no undo support`);
    }

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: role,
      action: `undo:${log.action}`,
      resourceType,
      resourceId: isKeyed ? null : identifier,
      beforeState: log.afterState,
      afterState: log.beforeState,
    });

    return { undone: true, revertedAction: log.action };
  });

  /* -------------------------------- Suggestions -------------------------------- */
  // User feedback submitted from the settings page (POST /users/me/suggestions);
  // reused audit.read here rather than a brand-new permission code, since
  // both existing admin roles that can see the audit log are the same
  // audience for user feedback.

  const suggestionsQuerySchema = z.object({
    isReviewed: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  fastify.get("/admin/suggestions", { preHandler: requirePermission("audit.read") }, async (request) => {
    const { isReviewed, limit, offset } = suggestionsQuerySchema.parse(request.query);
    const whereClause = isReviewed !== undefined ? eq(suggestions.isReviewed, isReviewed === "true") : undefined;

    const [items, [totalRow]] = await Promise.all([
      db
        .select({
          id: suggestions.id,
          message: suggestions.message,
          isReviewed: suggestions.isReviewed,
          reviewedAt: suggestions.reviewedAt,
          createdAt: suggestions.createdAt,
          userId: users.id,
          userDisplayName: users.displayName,
          userEmail: users.email,
        })
        .from(suggestions)
        .innerJoin(users, eq(users.id, suggestions.userId))
        .where(whereClause)
        .orderBy(desc(suggestions.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(suggestions).where(whereClause),
    ]);

    return { items, limit, offset, total: totalRow?.value ?? 0 };
  });

  fastify.put("/admin/suggestions/:id/reviewed", { preHandler: requirePermission("audit.read") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { isReviewed } = z.object({ isReviewed: z.boolean() }).parse(request.body);

    const [updated] = await db
      .update(suggestions)
      .set({
        isReviewed,
        reviewedAt: isReviewed ? new Date() : null,
        reviewedBy: isReviewed ? request.user!.id : null,
      })
      .where(eq(suggestions.id, id))
      .returning({ id: suggestions.id, isReviewed: suggestions.isReviewed, reviewedAt: suggestions.reviewedAt });

    if (!updated) {
      throw new HttpError(404, "NOT_FOUND", "Suggestion not found");
    }
    return updated;
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

  /* -------------------------------------------------------------------------- */
  /*                                  Volunteers                                */
  /* -------------------------------------------------------------------------- */
  // "volunteer" is a role, but everything about running the program (who
  // holds it, whether their work auto-applies, and reviewing what they've
  // submitted) is gated on its own permission -- volunteers.manage -- kept
  // separate from users.manage since an admin could reasonably hold one
  // without the other.

  // Toggling a contributor into/out of the volunteer role. Deliberately
  // narrower than a generic "set role" endpoint -- this can only move
  // between "contributor" and "volunteer", never touch admin/super_admin,
  // so it can't be used as a side door to self-escalate.
  fastify.post("/admin/users/:id/volunteer", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { enabled } = setVolunteerSchema.parse(request.body);

    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }
    if (target.role !== "contributor" && target.role !== "volunteer") {
      throw new HttpError(400, "INVALID_ROLE", "Only a contributor can be made a volunteer");
    }

    const newRole = enabled ? "volunteer" : "contributor";
    await db.update(users).set({ role: newRole, updatedAt: new Date() }).where(eq(users.id, id));
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: enabled ? "admin_grant_volunteer" : "admin_revoke_volunteer",
      resourceType: "user",
      resourceId: id,
      beforeState: { role: target.role },
      afterState: { role: newRole },
    });

    return { id, role: newRole };
  });

  // List of everyone currently holding the volunteer role, with a live
  // pending-approval count per volunteer -- the Volunteers panel's landing
  // list, one row expandable into that volunteer's full activity.
  fastify.get("/admin/volunteers", { preHandler: requirePermission("volunteers.manage") }, async () => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        autoApproveVolunteer: users.autoApproveVolunteer,
        createdAt: users.createdAt,
        totalPoints: userStats.totalPoints,
      })
      .from(users)
      .leftJoin(userStats, eq(userStats.userId, users.id))
      .where(and(eq(users.role, "volunteer"), isNull(users.deletedAt)))
      .orderBy(desc(users.createdAt));

    const pendingCounts = await countPendingByVolunteer(rows.map((r) => r.id));

    return {
      items: rows.map((r) => ({ ...r, pendingCount: pendingCounts.get(r.id) ?? 0 })),
    };
  });

  fastify.post("/admin/volunteers/:id/auto-approve", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { enabled } = setAutoApproveSchema.parse(request.body);

    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target || target.role !== "volunteer") {
      throw new HttpError(404, "NOT_FOUND", "Volunteer not found");
    }

    await setAutoApprove(id, enabled);
    invalidateUserCache(id);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_set_volunteer_auto_approve",
      resourceType: "user",
      resourceId: id,
      afterState: { autoApproveVolunteer: enabled },
    });

    return { id, autoApproveVolunteer: enabled };
  });

  // A human-readable label for a pending change, resolved from its payload
  // -- so the review panel can show "River (Nature)" instead of a bare
  // targetType + a JSON blob. Best-effort: a delete's payload only has an
  // id, so this looks the current row up; if that row is already gone
  // (deleted some other way in the meantime) this falls back to the id.
  async function describePendingChange(row: typeof pendingChanges.$inferSelect): Promise<string> {
    const payload = row.payload as Record<string, unknown>;
    if (row.action === "create") {
      switch (row.targetType) {
        case "category":
          return String(payload.nameEnglish ?? "(category)");
        case "concept":
          return String(payload.labelEnglish ?? "(concept)");
        case "scene":
          return String(payload.title ?? "(scene)");
        case "sentence":
          return String(payload.englishText ?? "(sentence)");
        case "concept_media":
        case "scene_media":
          return "(image)";
      }
    }
    // Delete: payload is just { id } -- look up the current label.
    const targetId = String(payload.id ?? "");
    if (row.targetType === "concept") {
      const [c] = await db.select({ labelEnglish: concepts.labelEnglish }).from(concepts).where(eq(concepts.id, targetId)).limit(1);
      return c ? `Delete: ${c.labelEnglish}` : `Delete: ${targetId}`;
    }
    if (row.targetType === "scene") {
      const [s] = await db.select({ title: scenes.title }).from(scenes).where(eq(scenes.id, targetId)).limit(1);
      return s ? `Delete: ${s.title}` : `Delete: ${targetId}`;
    }
    if (row.targetType === "sentence") {
      const [s] = await db.select({ englishText: sentences.englishText }).from(sentences).where(eq(sentences.id, targetId)).limit(1);
      return s ? `Delete: ${s.englishText}` : `Delete: ${targetId}`;
    }
    return targetId;
  }

  // Every pending change for one volunteer (or, without volunteerId, across
  // all of them) -- filterable by targetType/status so the panel can group
  // into the four categories the admin reviews separately (images, modules
  // [concepts+scenes], categories, titles [sentences]).
  fastify.get("/admin/pending-changes", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const query = pendingChangesQuerySchema.parse(request.query);
    const rows = await listPendingChanges(query);
    const items = await Promise.all(rows.map(async (row) => ({ ...row, label: await describePendingChange(row) })));
    return { items };
  });

  fastify.post("/admin/pending-changes/:id/approve", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const row = await requirePendingRow(id);

    let resultResourceId: string | null;
    try {
      resultResourceId = await applyPendingChange(row);
    } catch (err) {
      // Domain-level failure at approval time (duplicate now exists,
      // referenced category/concept/scene is gone, etc.) -- surfaced to the
      // admin as a normal error rather than silently marking it approved
      // when nothing actually happened. The row stays "pending" so the
      // admin can still reject it (or retry once the underlying issue is
      // fixed) instead of it being stuck in limbo.
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, "APPROVE_FAILED", err instanceof Error ? err.message : "Could not apply this change");
    }

    await markApproved(id, request.user!.id, resultResourceId);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_pending_change_approve",
      resourceType: "pending_change",
      resourceId: id,
      afterState: { targetType: row.targetType, action: row.action, resultResourceId },
    });

    return { id, status: "approved", resultResourceId };
  });

  fastify.post("/admin/pending-changes/:id/reject", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await requirePendingRow(id);
    const { reason } = rejectPendingChangeSchema.parse(request.body);

    await markRejected(id, request.user!.id, reason);

    await writeAuditLog({
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: "admin_pending_change_reject",
      resourceType: "pending_change",
      resourceId: id,
      afterState: { reason: reason ?? null },
    });

    return { id, status: "rejected" };
  });

  // Bulk forms: each id is independent -- one already-reviewed or
  // now-invalid item doesn't block the rest of the batch, same convention
  // as every other bulk-* admin route in this file.
  fastify.post("/admin/pending-changes/bulk-approve", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { ids } = bulkPendingIdsSchema.parse(request.body);
    const results: { id: string; status: "approved" | "error"; message?: string }[] = [];

    for (const id of ids) {
      try {
        const row = await requirePendingRow(id);
        const resultResourceId = await applyPendingChange(row);
        await markApproved(id, request.user!.id, resultResourceId);
        results.push({ id, status: "approved" });
      } catch (err) {
        results.push({ id, status: "error", message: err instanceof Error ? err.message : "Failed" });
      }
    }

    await writeAuditLogs(
      results
        .filter((r) => r.status === "approved")
        .map((r) => ({
          actorId: request.user!.id,
          actorRole: request.user!.role,
          action: "admin_pending_change_approve",
          resourceType: "pending_change",
          resourceId: r.id,
        })),
    );

    return { approved: results.filter((r) => r.status === "approved").length, errors: results.filter((r) => r.status === "error") };
  });

  fastify.post("/admin/pending-changes/bulk-reject", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { ids } = bulkPendingIdsSchema.parse(request.body);
    const { reason } = rejectPendingChangeSchema.parse(request.body);
    const results: { id: string; status: "rejected" | "error"; message?: string }[] = [];

    for (const id of ids) {
      try {
        await requirePendingRow(id);
        await markRejected(id, request.user!.id, reason);
        results.push({ id, status: "rejected" });
      } catch (err) {
        results.push({ id, status: "error", message: err instanceof Error ? err.message : "Failed" });
      }
    }

    await writeAuditLogs(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => ({
          actorId: request.user!.id,
          actorRole: request.user!.role,
          action: "admin_pending_change_reject",
          resourceType: "pending_change",
          resourceId: r.id,
          afterState: { reason: reason ?? null },
        })),
    );

    return { rejected: results.filter((r) => r.status === "rejected").length, errors: results.filter((r) => r.status === "error") };
  });

  // A volunteer's own "logs" panel data -- their full audit trail (every
  // auto-approved or already-approved action) plus their pending/rejected
  // history, for the admin's per-volunteer expanded view.
  fastify.get("/admin/volunteers/:id/activity", { preHandler: requirePermission("volunteers.manage") }, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target || target.role !== "volunteer") {
      throw new HttpError(404, "NOT_FOUND", "Volunteer not found");
    }

    const [pendingRows, auditRows] = await Promise.all([
      listPendingChanges({ volunteerId: id, limit: 500, offset: 0 }),
      db.select().from(auditLogs).where(eq(auditLogs.actorId, id)).orderBy(desc(auditLogs.createdAt)).limit(200),
    ]);

    const pendingWithLabels = await Promise.all(pendingRows.map(async (row) => ({ ...row, label: await describePendingChange(row) })));

    return { pendingChanges: pendingWithLabels, auditLog: auditRows };
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
