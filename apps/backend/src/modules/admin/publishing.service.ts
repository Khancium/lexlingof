import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "../../db/index.js";
import {
  audioFiles,
  categories,
  concepts,
  contributions,
  contributorDemographics,
  contributorProfiles,
  dialects,
  educationLevelEnum,
  genderEnum,
  languages,
  publishedTranslations,
  publishedWordRecordings,
  sentences,
  translations,
  tribes,
  users,
  villages,
  wordRecordings,
} from "../../db/schema.js";
import { storageService } from "../../services/storage.service.js";
import { HttpError } from "../../utils/http-error.js";

/**
 * The same contributor-attribute filter set the Contributions admin page
 * offers (admin.routes.ts's contributionsQuerySchema) -- applied here to
 * narrow which CONCEPTS/SENTENCES appear (via an exists-against-their-
 * contributions subquery), not to list contributions directly. Every field
 * is optional; with none set, the only requirement is "has at least one
 * non-deleted contribution of any status" -- i.e. has been contributed for
 * at all.
 */
export type PublishingFilters = {
  search?: string;
  categoryId?: string;
  status?: (typeof contributions.status.enumValues)[number][];
  languageId?: string[];
  dialectId?: string[];
  userId?: string;
  tribeId?: string[];
  subTribeId?: string[];
  country?: string;
  city?: string;
  villageId?: string[];
  quarterId?: string[];
  gender?: (typeof genderEnum.enumValues)[number][];
  educationLevel?: (typeof educationLevelEnum.enumValues)[number][];
  profession?: string;
  limit: number;
  offset: number;
};

/** Same conditions for both the word-recordings and translations paths -- only the "which user" column differs, since both tables denormalize userId directly (see schema.ts comments on wordRecordings.userId/translations.userId). */
function buildContributionConditions(q: PublishingFilters, recordingUserId: PgColumn): SQL[] {
  const conditions: SQL[] = [];
  if (q.status?.length) conditions.push(inArray(contributions.status, q.status));
  if (q.languageId?.length) conditions.push(inArray(contributions.languageId, q.languageId));
  if (q.dialectId?.length) conditions.push(inArray(contributions.dialectId, q.dialectId));
  if (q.userId) conditions.push(eq(recordingUserId, q.userId));
  if (q.tribeId?.length) conditions.push(inArray(contributorDemographics.tribeId, q.tribeId));
  if (q.subTribeId?.length) conditions.push(inArray(contributorDemographics.subTribeId, q.subTribeId));
  if (q.country) conditions.push(eq(contributorDemographics.country, q.country));
  if (q.city) conditions.push(eq(contributorDemographics.city, q.city));
  if (q.villageId?.length) conditions.push(inArray(contributorDemographics.villageId, q.villageId));
  if (q.quarterId?.length) conditions.push(inArray(contributorDemographics.quarterId, q.quarterId));
  if (q.gender?.length) conditions.push(inArray(contributorDemographics.gender, q.gender));
  if (q.educationLevel?.length) conditions.push(inArray(contributorDemographics.educationLevel, q.educationLevel));
  if (q.profession) conditions.push(ilike(contributorDemographics.profession, `%${q.profession}%`));
  return conditions;
}

/** Concept ids with at least one non-deleted word recording matching the given filters -- the base "has been contributed for" case when no filters are set. */
function conceptIdsMatchingFilters(q: PublishingFilters) {
  const conditions = [sql`${wordRecordings.deletedAt} is null`, ...buildContributionConditions(q, wordRecordings.userId)];
  return db
    .selectDistinct({ conceptId: wordRecordings.conceptId })
    .from(wordRecordings)
    .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, wordRecordings.userId))
    .where(and(...conditions));
}

/** Same idea as conceptIdsMatchingFilters, for sentences/translations. */
function sentenceIdsMatchingFilters(q: PublishingFilters) {
  const conditions = [sql`${translations.deletedAt} is null`, ...buildContributionConditions(q, translations.userId)];
  return db
    .selectDistinct({ sentenceId: translations.sentenceId })
    .from(translations)
    .innerJoin(contributions, eq(contributions.id, translations.contributionId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, translations.userId))
    .where(and(...conditions));
}

/**
 * One contributor's recording of a concept/sentence, with everything the
 * curation UI (and, once published, the public API) needs to show: the
 * audio itself, the language/dialect it was recorded in (from the
 * contribution row -- the authoritative "what language was THIS recording
 * made in", not just the contributor's general mother tongue), and the
 * contributor's city/tribe/village IF they opted in to showing their
 * location (contributorProfiles.showLocation) -- otherwise those three
 * fields come back null even though the admin-only fields above are always
 * populated, since the admin needs full context to curate but the public
 * feed must respect that opt-out.
 */
export type PublishableRecording = {
  id: string;
  nativeText: string | null;
  romanization: string | null;
  ipa: string | null;
  audioUrl: string;
  durationMs: number | null;
  contributorName: string;
  language: string | null;
  dialect: string | null;
  status: (typeof contributions.status.enumValues)[number];
  city: string | null;
  tribe: string | null;
  village: string | null;
  locationShared: boolean;
  isPublished: boolean;
  publicationId: string | null;
  sortOrder: number;
};

const CONTRIBUTOR_SELECT = {
  contributorName: users.displayName,
  language: languages.nameEnglish,
  dialect: dialects.nameEnglish,
  city: contributorDemographics.city,
  tribeName: tribes.name,
  villageName: villages.name,
  showLocation: contributorProfiles.showLocation,
} as const;

/** contributorProfiles.showLocation defaults false and the row itself is optional (created only once a contributor visits profile settings) -- both cases mean "no explicit opt-in", so location fields are withheld. */
function applyLocationPrivacy<T extends { city: string | null; tribeName: string | null; villageName: string | null; showLocation: boolean | null }>(
  row: T,
): { city: string | null; tribe: string | null; village: string | null; locationShared: boolean } {
  const shared = row.showLocation === true;
  return {
    city: shared ? row.city : null,
    tribe: shared ? row.tribeName : null,
    village: shared ? row.villageName : null,
    locationShared: shared,
  };
}

/* ---------------------------------- Concepts / words --------------------------------- */

export async function listConceptsForPublishing(params: PublishingFilters) {
  const conditions = [sql`${concepts.deletedAt} is null`, inArray(concepts.id, conceptIdsMatchingFilters(params))];
  if (params.search) conditions.push(ilike(concepts.labelEnglish, `%${params.search}%`));
  if (params.categoryId) conditions.push(eq(concepts.categoryId, params.categoryId));
  const whereClause = and(...conditions);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: concepts.id,
        labelEnglish: concepts.labelEnglish,
        categoryName: categories.nameEnglish,
        grammaticalGender: concepts.grammaticalGender,
        partOfSpeech: concepts.partOfSpeech,
        grammaticalNumber: concepts.grammaticalNumber,
      })
      .from(concepts)
      .innerJoin(categories, eq(categories.id, concepts.categoryId))
      .where(whereClause)
      .orderBy(asc(concepts.labelEnglish))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(concepts).where(whereClause),
  ]);

  const conceptIds = rows.map((r) => r.id);
  const [eligibleCounts, publishedCounts] = await Promise.all([
    conceptIds.length
      ? db
          .select({ conceptId: wordRecordings.conceptId, value: sql<number>`count(*)`.mapWith(Number) })
          .from(wordRecordings)
          .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
          .where(and(inArray(wordRecordings.conceptId, conceptIds), eq(wordRecordings.isCurrent, true)))
          .groupBy(wordRecordings.conceptId)
      : [],
    conceptIds.length
      ? db
          .select({ conceptId: publishedWordRecordings.conceptId, value: sql<number>`count(*)`.mapWith(Number) })
          .from(publishedWordRecordings)
          .where(inArray(publishedWordRecordings.conceptId, conceptIds))
          .groupBy(publishedWordRecordings.conceptId)
      : [],
  ]);
  const eligibleByConcept = new Map(eligibleCounts.map((r) => [r.conceptId, r.value]));
  const publishedByConcept = new Map(publishedCounts.map((r) => [r.conceptId, r.value]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      labelEnglish: r.labelEnglish,
      categoryName: r.categoryName,
      grammaticalGender: r.grammaticalGender,
      partOfSpeech: r.partOfSpeech,
      grammaticalNumber: r.grammaticalNumber,
      eligibleCount: eligibleByConcept.get(r.id) ?? 0,
      publishedCount: publishedByConcept.get(r.id) ?? 0,
    })),
    total: totalRow?.value ?? 0,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function getConceptRecordings(conceptId: string): Promise<PublishableRecording[]> {
  const rows = await db
    .select({
      id: wordRecordings.id,
      nativeText: wordRecordings.nativeWord,
      romanization: wordRecordings.romanization,
      ipa: wordRecordings.ipa,
      audioStorageKey: audioFiles.storageKey,
      durationMs: wordRecordings.durationMs,
      status: contributions.status,
      publicationId: publishedWordRecordings.id,
      sortOrder: publishedWordRecordings.sortOrder,
      ...CONTRIBUTOR_SELECT,
    })
    .from(wordRecordings)
    .innerJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
    .innerJoin(users, eq(users.id, wordRecordings.userId))
    .innerJoin(audioFiles, eq(audioFiles.id, wordRecordings.audioFileId))
    .leftJoin(languages, eq(languages.id, contributions.languageId))
    .leftJoin(dialects, eq(dialects.id, contributions.dialectId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, wordRecordings.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, wordRecordings.userId))
    .leftJoin(publishedWordRecordings, eq(publishedWordRecordings.wordRecordingId, wordRecordings.id))
    .where(and(eq(wordRecordings.conceptId, conceptId), eq(wordRecordings.isCurrent, true)))
    .orderBy(desc(wordRecordings.createdAt));

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      nativeText: r.nativeText,
      romanization: r.romanization,
      ipa: r.ipa,
      audioUrl: await storageService.generateAudioPlayUrl(r.audioStorageKey),
      durationMs: r.durationMs,
      contributorName: r.contributorName,
      language: r.language,
      dialect: r.dialect,
      status: r.status,
      isPublished: r.publicationId !== null,
      publicationId: r.publicationId,
      sortOrder: r.sortOrder ?? 0,
      ...applyLocationPrivacy(r),
    })),
  );
}

export async function publishWordRecording(conceptId: string, wordRecordingId: string, adminUserId: string): Promise<void> {
  const [recording] = await db
    .select({ id: wordRecordings.id })
    .from(wordRecordings)
    .where(and(eq(wordRecordings.id, wordRecordingId), eq(wordRecordings.conceptId, conceptId)))
    .limit(1);
  if (!recording) throw new HttpError(404, "NOT_FOUND", "Recording not found for this concept");

  await db
    .insert(publishedWordRecordings)
    .values({ conceptId, wordRecordingId, publishedBy: adminUserId })
    .onConflictDoNothing({ target: publishedWordRecordings.wordRecordingId });
}

export async function unpublishWordRecording(wordRecordingId: string): Promise<void> {
  await db.delete(publishedWordRecordings).where(eq(publishedWordRecordings.wordRecordingId, wordRecordingId));
}

/** Withdraws every currently-published recording for a concept at once -- the whole word disappears from the public API immediately, not just one recording. */
export async function unpublishAllRecordingsForConcept(conceptId: string): Promise<void> {
  await db.delete(publishedWordRecordings).where(eq(publishedWordRecordings.conceptId, conceptId));
}

export type ConceptGrammar = {
  grammaticalGender: (typeof concepts.grammaticalGender.enumValues)[number] | null;
  partOfSpeech: (typeof concepts.partOfSpeech.enumValues)[number] | null;
  grammaticalNumber: (typeof concepts.grammaticalNumber.enumValues)[number] | null;
};

/** Hand-entered grammatical metadata for a concept, set in the Publishing module post-processing -- null fields mean "not set yet". Passing null for a field clears it. */
export async function setConceptGrammar(conceptId: string, grammar: Partial<ConceptGrammar>): Promise<void> {
  const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  if (!concept) throw new HttpError(404, "NOT_FOUND", "Concept not found");

  await db
    .update(concepts)
    .set({ ...grammar, updatedAt: new Date() })
    .where(eq(concepts.id, conceptId));
}

/* --------------------------------- Sentences / translations --------------------------- */

export async function listSentencesForPublishing(params: PublishingFilters) {
  const conditions = [sql`${sentences.deletedAt} is null`, inArray(sentences.id, sentenceIdsMatchingFilters(params))];
  if (params.search) conditions.push(ilike(sentences.englishText, `%${params.search}%`));
  if (params.categoryId) conditions.push(eq(sentences.categoryId, params.categoryId));
  const whereClause = and(...conditions);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: sentences.id,
        englishText: sentences.englishText,
        categoryName: categories.nameEnglish,
      })
      .from(sentences)
      .leftJoin(categories, eq(categories.id, sentences.categoryId))
      .where(whereClause)
      .orderBy(asc(sentences.englishText))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(whereClause),
  ]);

  const sentenceIds = rows.map((r) => r.id);
  const [eligibleCounts, publishedCounts] = await Promise.all([
    sentenceIds.length
      ? db
          .select({ sentenceId: translations.sentenceId, value: sql<number>`count(*)`.mapWith(Number) })
          .from(translations)
          .innerJoin(contributions, eq(contributions.id, translations.contributionId))
          .where(and(inArray(translations.sentenceId, sentenceIds), eq(translations.isCurrent, true)))
          .groupBy(translations.sentenceId)
      : [],
    sentenceIds.length
      ? db
          .select({ sentenceId: publishedTranslations.sentenceId, value: sql<number>`count(*)`.mapWith(Number) })
          .from(publishedTranslations)
          .where(inArray(publishedTranslations.sentenceId, sentenceIds))
          .groupBy(publishedTranslations.sentenceId)
      : [],
  ]);
  const eligibleBySentence = new Map(eligibleCounts.map((r) => [r.sentenceId, r.value]));
  const publishedBySentence = new Map(publishedCounts.map((r) => [r.sentenceId, r.value]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      englishText: r.englishText,
      categoryName: r.categoryName,
      eligibleCount: eligibleBySentence.get(r.id) ?? 0,
      publishedCount: publishedBySentence.get(r.id) ?? 0,
    })),
    total: totalRow?.value ?? 0,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function getSentenceTranslations(sentenceId: string): Promise<PublishableRecording[]> {
  const rows = await db
    .select({
      id: translations.id,
      nativeText: translations.nativeText,
      romanization: translations.romanization,
      ipa: translations.ipa,
      audioStorageKey: audioFiles.storageKey,
      durationMs: audioFiles.durationMs,
      status: contributions.status,
      publicationId: publishedTranslations.id,
      sortOrder: publishedTranslations.sortOrder,
      ...CONTRIBUTOR_SELECT,
    })
    .from(translations)
    .innerJoin(contributions, eq(contributions.id, translations.contributionId))
    .innerJoin(users, eq(users.id, translations.userId))
    .leftJoin(audioFiles, eq(audioFiles.id, translations.audioFileId))
    .leftJoin(languages, eq(languages.id, contributions.languageId))
    .leftJoin(dialects, eq(dialects.id, contributions.dialectId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, translations.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, translations.userId))
    .leftJoin(publishedTranslations, eq(publishedTranslations.translationId, translations.id))
    .where(and(eq(translations.sentenceId, sentenceId), eq(translations.isCurrent, true)))
    .orderBy(desc(translations.createdAt));

  const withAudio = rows.filter((r): r is typeof r & { audioStorageKey: string } => r.audioStorageKey !== null);

  return Promise.all(
    withAudio.map(async (r) => ({
      id: r.id,
      nativeText: r.nativeText,
      romanization: r.romanization,
      ipa: r.ipa,
      audioUrl: await storageService.generateAudioPlayUrl(r.audioStorageKey),
      durationMs: r.durationMs,
      contributorName: r.contributorName,
      language: r.language,
      dialect: r.dialect,
      status: r.status,
      isPublished: r.publicationId !== null,
      publicationId: r.publicationId,
      sortOrder: r.sortOrder ?? 0,
      ...applyLocationPrivacy(r),
    })),
  );
}

export async function publishTranslation(sentenceId: string, translationId: string, adminUserId: string): Promise<void> {
  const [translation] = await db
    .select({ id: translations.id })
    .from(translations)
    .where(and(eq(translations.id, translationId), eq(translations.sentenceId, sentenceId)))
    .limit(1);
  if (!translation) throw new HttpError(404, "NOT_FOUND", "Translation not found for this sentence");

  await db
    .insert(publishedTranslations)
    .values({ sentenceId, translationId, publishedBy: adminUserId })
    .onConflictDoNothing({ target: publishedTranslations.translationId });
}

export async function unpublishTranslation(translationId: string): Promise<void> {
  await db.delete(publishedTranslations).where(eq(publishedTranslations.translationId, translationId));
}

/** Withdraws every currently-published translation for a sentence at once -- the whole sentence disappears from the public API immediately, not just one translation. */
export async function unpublishAllTranslationsForSentence(sentenceId: string): Promise<void> {
  await db.delete(publishedTranslations).where(eq(publishedTranslations.sentenceId, sentenceId));
}
