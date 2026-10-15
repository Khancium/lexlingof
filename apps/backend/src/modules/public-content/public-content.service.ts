import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  audioFiles,
  categories,
  concepts,
  conceptMedia,
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

export type PublicDictionaryEntry = {
  id: string;
  word: string;
  category: string;
  imageUrl: string | null;
  recordings: PublicRecording[];
};

export async function getPublicDictionary(params: { search?: string; categoryId?: string; limit: number; offset: number }) {
  const conditions = [sql`${concepts.deletedAt} is null`, eq(concepts.isActive, true)];
  if (params.search) conditions.push(ilike(concepts.labelEnglish, `%${params.search}%`));
  if (params.categoryId) conditions.push(eq(concepts.categoryId, params.categoryId));
  // Only concepts an admin has actually published at least one recording for.
  const publishedConceptIds = db.selectDistinct({ conceptId: publishedWordRecordings.conceptId }).from(publishedWordRecordings);
  conditions.push(inArray(concepts.id, publishedConceptIds));
  const whereClause = and(...conditions);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: concepts.id,
        word: concepts.labelEnglish,
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
  const recordingsByConcept = await getPublishedRecordingsByConcepts(conceptIds);

  return {
    items: rows.map((r) => ({ id: r.id, word: r.word, category: r.category, imageUrl: r.imageUrl, recordings: recordingsByConcept.get(r.id) ?? [] })),
    total: totalRow?.value ?? 0,
    limit: params.limit,
    offset: params.offset,
  };
}

async function getPublishedRecordingsByConcepts(conceptIds: string[]): Promise<Map<string, PublicRecording[]>> {
  if (conceptIds.length === 0) return new Map();

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
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, wordRecordings.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, wordRecordings.userId))
    .leftJoin(users, eq(users.id, wordRecordings.userId))
    .where(inArray(publishedWordRecordings.conceptId, conceptIds))
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

export type PublicSentenceEntry = {
  id: string;
  sentence: string;
  category: string | null;
  translations: PublicRecording[];
};

export async function getPublicLanguageLearning(params: { search?: string; categoryId?: string; limit: number; offset: number }) {
  const conditions = [sql`${sentences.deletedAt} is null`, eq(sentences.isActive, true)];
  if (params.search) conditions.push(ilike(sentences.englishText, `%${params.search}%`));
  if (params.categoryId) conditions.push(eq(sentences.categoryId, params.categoryId));
  const publishedSentenceIds = db.selectDistinct({ sentenceId: publishedTranslations.sentenceId }).from(publishedTranslations);
  conditions.push(inArray(sentences.id, publishedSentenceIds));
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
  const translationsBySentence = await getPublishedTranslationsBySentences(sentenceIds);

  return {
    items: rows.map((r) => ({ id: r.id, sentence: r.sentence, category: r.category, translations: translationsBySentence.get(r.id) ?? [] })),
    total: totalRow?.value ?? 0,
    limit: params.limit,
    offset: params.offset,
  };
}

async function getPublishedTranslationsBySentences(sentenceIds: string[]): Promise<Map<string, PublicRecording[]>> {
  if (sentenceIds.length === 0) return new Map();

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
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, translations.userId))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(contributorProfiles, eq(contributorProfiles.userId, translations.userId))
    .leftJoin(users, eq(users.id, translations.userId))
    .where(inArray(publishedTranslations.sentenceId, sentenceIds))
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
