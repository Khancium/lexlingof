import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  audioFiles,
  categories,
  concepts,
  conceptMedia,
  contributions,
  contributorDemographics,
  contributorProfiles,
  dialects,
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

export type PublicRecording = {
  id: string;
  nativeText: string | null;
  romanization: string | null;
  ipa: string | null;
  audioUrl: string;
  language: string | null;
  dialect: string | null;
  city: string | null;
  tribe: string | null;
  village: string | null;
};

export type PublicRelatedWord = { id: string; word: string };

/** tribe/city/village are plain display-name strings here (as disclosed to the public), not internal uuids -- a visitor picks from the values getPublicDictionaryFilterOptions() returns, which are the same strings. */
export type LocationFilter = { tribe?: string; city?: string; village?: string };

function hasLocationFilter(f: LocationFilter): boolean {
  return Boolean(f.tribe || f.city || f.village);
}

const CONTRIBUTOR_SELECT = {
  language: languages.nameEnglish,
  dialect: dialects.nameEnglish,
  city: contributorDemographics.city,
  tribeName: tribes.name,
  villageName: villages.name,
  showLocation: contributorProfiles.showLocation,
} as const;

/** Same opt-in gate as the admin curation service -- only disclose city/tribe/village when the contributor explicitly turned on contributorProfiles.showLocation. */
function privacyFields(row: { city: string | null; tribeName: string | null; villageName: string | null; showLocation: boolean | null }) {
  const shared = row.showLocation === true;
  return { city: shared ? row.city : null, tribe: shared ? row.tribeName : null, village: shared ? row.villageName : null };
}

/**
 * The same showLocation-gated tribe/city/village equality checks, reused by
 * every query that needs to filter recordings down to a specific tribe/
 * city/village -- a visitor can only filter on what a contributor agreed to
 * disclose, so "filter by tribe X" and "disclose tribe X" share one gate.
 */
function locationConditions(f: LocationFilter) {
  const conditions = [];
  if (f.tribe) conditions.push(and(eq(contributorProfiles.showLocation, true), eq(tribes.name, f.tribe))!);
  if (f.city) conditions.push(and(eq(contributorProfiles.showLocation, true), eq(contributorDemographics.city, f.city))!);
  if (f.village) conditions.push(and(eq(contributorProfiles.showLocation, true), eq(villages.name, f.village))!);
  return conditions;
}

export type PublicDictionaryEntry = {
  id: string;
  word: string;
  category: string;
  imageUrl: string | null;
  recordings: PublicRecording[];
  relatedWords: PublicRelatedWord[];
};

export async function getPublicDictionary(params: { search?: string; categoryId?: string; limit: number; offset: number } & LocationFilter) {
  const conditions = [sql`${concepts.deletedAt} is null`, eq(concepts.isActive, true)];
  if (params.search) conditions.push(ilike(concepts.labelEnglish, `%${params.search}%`));
  if (params.categoryId) conditions.push(eq(concepts.categoryId, params.categoryId));
  // Only concepts with at least one published recording -- matching the
  // tribe/city/village filter too, when one is set, so a word with published
  // recordings that all fail the filter doesn't appear with an empty list.
  conditions.push(inArray(concepts.id, conceptIdsWithPublishedRecording(params)));
  const whereClause = and(...conditions);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: concepts.id,
        word: concepts.labelEnglish,
        categoryId: concepts.categoryId,
        category: categories.nameEnglish,
        imageUrl: conceptMedia.publicUrl,
      })
      .from(concepts)
      .innerJoin(categories, eq(categories.id, concepts.categoryId))
      .leftJoin(conceptMedia, and(eq(conceptMedia.conceptId, concepts.id), eq(conceptMedia.isPrimary, true)))
      .where(whereClause)
      .orderBy(asc(concepts.labelEnglish))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(concepts).where(whereClause),
  ]);

  const conceptIds = rows.map((r) => r.id);
  const [recordingsByConcept, relatedByConcept] = await Promise.all([
    getPublishedRecordingsByConcepts(conceptIds, params),
    relatedWordsByCategory(new Map(rows.map((r) => [r.id, r.categoryId]))),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      word: r.word,
      category: r.category,
      imageUrl: r.imageUrl,
      recordings: recordingsByConcept.get(r.id) ?? [],
      relatedWords: relatedByConcept.get(r.id) ?? [],
    })),
    total: totalRow?.value ?? 0,
    limit: params.limit,
    offset: params.offset,
  };
}

/** Concept ids with >=1 published recording -- narrowed to recordings matching the location filter, when one is given. */
function conceptIdsWithPublishedRecording(locationFilter: LocationFilter) {
  if (!hasLocationFilter(locationFilter)) {
    return db.selectDistinct({ conceptId: publishedWordRecordings.conceptId }).from(publishedWordRecordings);
  }
  return db
    .selectDistinct({ conceptId: publishedWordRecordings.conceptId })
    .from(publishedWordRecordings)
    .innerJoin(wordRecordings, eq(wordRecordings.id, publishedWordRecordings.wordRecordingId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, wordRecordings.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, wordRecordings.userId))
    .where(and(...locationConditions(locationFilter)));
}

async function getPublishedRecordingsByConcepts(conceptIds: string[], locationFilter: LocationFilter): Promise<Map<string, PublicRecording[]>> {
  if (conceptIds.length === 0) return new Map();

  const conditions = [inArray(publishedWordRecordings.conceptId, conceptIds), ...locationConditions(locationFilter)];

  const rows = await db
    .select({
      conceptId: publishedWordRecordings.conceptId,
      id: wordRecordings.id,
      nativeText: wordRecordings.nativeWord,
      romanization: wordRecordings.romanization,
      ipa: wordRecordings.ipa,
      audioStorageKey: audioFiles.storageKey,
      sortOrder: publishedWordRecordings.sortOrder,
      ...CONTRIBUTOR_SELECT,
    })
    .from(publishedWordRecordings)
    .innerJoin(wordRecordings, eq(wordRecordings.id, publishedWordRecordings.wordRecordingId))
    .innerJoin(audioFiles, eq(audioFiles.id, wordRecordings.audioFileId))
    .leftJoin(contributions, eq(contributions.id, wordRecordings.contributionId))
    .leftJoin(languages, eq(languages.id, contributions.languageId))
    .leftJoin(dialects, eq(dialects.id, contributions.dialectId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, wordRecordings.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, wordRecordings.userId))
    .leftJoin(users, eq(users.id, wordRecordings.userId))
    .where(and(...conditions))
    .orderBy(asc(publishedWordRecordings.sortOrder), desc(publishedWordRecordings.publishedAt));

  // Promise.all preserves input order in its RETURN array regardless of
  // resolution timing -- resolving to a flat array first (rather than
  // pushing into the map from inside each concurrent callback, which would
  // order by completion time instead of the query's own sortOrder) is what
  // keeps each concept's recordings in the admin-chosen order.
  const resolved = await Promise.all(
    rows.map(async (r) => ({
      conceptId: r.conceptId,
      recording: {
        id: r.id,
        nativeText: r.nativeText,
        romanization: r.romanization,
        ipa: r.ipa,
        audioUrl: await storageService.generateAudioPlayUrl(r.audioStorageKey),
        language: r.language,
        dialect: r.dialect,
        ...privacyFields(r),
      } satisfies PublicRecording,
    })),
  );

  const byConcept = new Map<string, PublicRecording[]>();
  for (const { conceptId, recording } of resolved) {
    const list = byConcept.get(conceptId) ?? [];
    list.push(recording);
    byConcept.set(conceptId, list);
  }
  return byConcept;
}

/**
 * For every concept in the current page, a handful of other PUBLISHED
 * concepts sharing the same category -- "other words like this one", used
 * for the dictionary's "related words" suggestions. Scoped to published
 * concepts only, since suggesting a word with no audio to play would be a
 * dead end.
 */
async function relatedWordsByCategory(categoryByConceptId: Map<string, string>, limitPerConcept = 6): Promise<Map<string, PublicRelatedWord[]>> {
  const categoryIds = [...new Set(categoryByConceptId.values())];
  if (categoryIds.length === 0) return new Map();

  const publishedConceptIds = db.selectDistinct({ conceptId: publishedWordRecordings.conceptId }).from(publishedWordRecordings);
  const rows = await db
    .select({ id: concepts.id, word: concepts.labelEnglish, categoryId: concepts.categoryId })
    .from(concepts)
    .where(
      and(
        inArray(concepts.categoryId, categoryIds),
        eq(concepts.isActive, true),
        sql`${concepts.deletedAt} is null`,
        inArray(concepts.id, publishedConceptIds),
      ),
    )
    .orderBy(asc(concepts.labelEnglish));

  const byCategory = new Map<string, PublicRelatedWord[]>();
  for (const r of rows) {
    const list = byCategory.get(r.categoryId) ?? [];
    list.push({ id: r.id, word: r.word });
    byCategory.set(r.categoryId, list);
  }

  const relatedByConceptId = new Map<string, PublicRelatedWord[]>();
  for (const [conceptId, categoryId] of categoryByConceptId) {
    const candidates = (byCategory.get(categoryId) ?? []).filter((c) => c.id !== conceptId);
    relatedByConceptId.set(conceptId, candidates.slice(0, limitPerConcept));
  }
  return relatedByConceptId;
}

/** Distinct tribe/city/village values a dictionary visitor can actually filter by -- only ones disclosed (showLocation) on a published recording. Populates the filter dropdowns. */
export async function getPublicDictionaryFilterOptions(): Promise<{ tribes: string[]; cities: string[]; villages: string[] }> {
  const rows = await db
    .selectDistinct({ tribe: tribes.name, city: contributorDemographics.city, village: villages.name })
    .from(publishedWordRecordings)
    .innerJoin(wordRecordings, eq(wordRecordings.id, publishedWordRecordings.wordRecordingId))
    .innerJoin(contributorProfiles, eq(contributorProfiles.userId, wordRecordings.userId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, wordRecordings.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .where(eq(contributorProfiles.showLocation, true));
  return collectLocationOptions(rows);
}

function collectLocationOptions(rows: { tribe: string | null; city: string | null; village: string | null }[]) {
  const tribeSet = new Set<string>();
  const citySet = new Set<string>();
  const villageSet = new Set<string>();
  for (const r of rows) {
    if (r.tribe) tribeSet.add(r.tribe);
    if (r.city) citySet.add(r.city);
    if (r.village) villageSet.add(r.village);
  }
  return { tribes: [...tribeSet].sort(), cities: [...citySet].sort(), villages: [...villageSet].sort() };
}

export type PublicSentenceEntry = {
  id: string;
  sentence: string;
  category: string | null;
  translations: PublicRecording[];
};

export async function getPublicLanguageLearning(
  params: { search?: string; categoryId?: string; limit: number; offset: number } & LocationFilter,
) {
  const conditions = [sql`${sentences.deletedAt} is null`, eq(sentences.isActive, true)];
  if (params.search) conditions.push(ilike(sentences.englishText, `%${params.search}%`));
  if (params.categoryId) conditions.push(eq(sentences.categoryId, params.categoryId));
  conditions.push(inArray(sentences.id, sentenceIdsWithPublishedTranslation(params)));
  const whereClause = and(...conditions);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({ id: sentences.id, sentence: sentences.englishText, category: categories.nameEnglish })
      .from(sentences)
      .leftJoin(categories, eq(categories.id, sentences.categoryId))
      .where(whereClause)
      .orderBy(asc(sentences.englishText))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(sentences).where(whereClause),
  ]);

  const sentenceIds = rows.map((r) => r.id);
  const translationsBySentence = await getPublishedTranslationsBySentences(sentenceIds, params);

  return {
    items: rows.map((r) => ({ id: r.id, sentence: r.sentence, category: r.category, translations: translationsBySentence.get(r.id) ?? [] })),
    total: totalRow?.value ?? 0,
    limit: params.limit,
    offset: params.offset,
  };
}

function sentenceIdsWithPublishedTranslation(locationFilter: LocationFilter) {
  if (!hasLocationFilter(locationFilter)) {
    return db.selectDistinct({ sentenceId: publishedTranslations.sentenceId }).from(publishedTranslations);
  }
  return db
    .selectDistinct({ sentenceId: publishedTranslations.sentenceId })
    .from(publishedTranslations)
    .innerJoin(translations, eq(translations.id, publishedTranslations.translationId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, translations.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, translations.userId))
    .where(and(...locationConditions(locationFilter)));
}

async function getPublishedTranslationsBySentences(
  sentenceIds: string[],
  locationFilter: LocationFilter,
): Promise<Map<string, PublicRecording[]>> {
  if (sentenceIds.length === 0) return new Map();

  const conditions = [inArray(publishedTranslations.sentenceId, sentenceIds), ...locationConditions(locationFilter)];

  const rows = await db
    .select({
      sentenceId: publishedTranslations.sentenceId,
      id: translations.id,
      nativeText: translations.nativeText,
      romanization: translations.romanization,
      ipa: translations.ipa,
      audioStorageKey: audioFiles.storageKey,
      sortOrder: publishedTranslations.sortOrder,
      ...CONTRIBUTOR_SELECT,
    })
    .from(publishedTranslations)
    .innerJoin(translations, eq(translations.id, publishedTranslations.translationId))
    .leftJoin(audioFiles, eq(audioFiles.id, translations.audioFileId))
    .leftJoin(contributions, eq(contributions.id, translations.contributionId))
    .leftJoin(languages, eq(languages.id, contributions.languageId))
    .leftJoin(dialects, eq(dialects.id, contributions.dialectId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, translations.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, translations.userId))
    .leftJoin(users, eq(users.id, translations.userId))
    .where(and(...conditions))
    .orderBy(asc(publishedTranslations.sortOrder), desc(publishedTranslations.publishedAt));

  const resolved = await Promise.all(
    rows.map(async (r) => ({
      sentenceId: r.sentenceId,
      translation: {
        id: r.id,
        nativeText: r.nativeText,
        romanization: r.romanization,
        ipa: r.ipa,
        audioUrl: r.audioStorageKey ? await storageService.generateAudioPlayUrl(r.audioStorageKey) : "",
        language: r.language,
        dialect: r.dialect,
        ...privacyFields(r),
      } satisfies PublicRecording,
    })),
  );

  const bySentence = new Map<string, PublicRecording[]>();
  for (const { sentenceId, translation } of resolved) {
    const list = bySentence.get(sentenceId) ?? [];
    list.push(translation);
    bySentence.set(sentenceId, list);
  }
  return bySentence;
}

/** Same idea as getPublicDictionaryFilterOptions, scoped to published translations. */
export async function getPublicLanguageLearningFilterOptions(): Promise<{ tribes: string[]; cities: string[]; villages: string[] }> {
  const rows = await db
    .selectDistinct({ tribe: tribes.name, city: contributorDemographics.city, village: villages.name })
    .from(publishedTranslations)
    .innerJoin(translations, eq(translations.id, publishedTranslations.translationId))
    .innerJoin(contributorProfiles, eq(contributorProfiles.userId, translations.userId))
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, translations.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .where(eq(contributorProfiles.showLocation, true));
  return collectLocationOptions(rows);
}
