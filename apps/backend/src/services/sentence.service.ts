import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.js";
import { sentenceCategories, sentences } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";

/**
 * A sentence is one meaning written in three languages -- English, Urdu and Persian -- that are
 * stored on the SAME row, so a sentence can never exist without its equivalents and a recording of
 * it applies whichever language the contributor read it in. See the `sentences` table in schema.ts.
 */
export const SENTENCE_LANGUAGES = ["english", "urdu", "persian"] as const;
export type SentenceLanguage = (typeof SENTENCE_LANGUAGES)[number];

export const SENTENCE_TEXT_MAX = 1000;

const requiredText = z.string().trim().min(1).max(SENTENCE_TEXT_MAX);

/** The three required texts, as the admin create/update and import all spell them. */
export const sentenceTextFields = {
  englishText: requiredText,
  urduText: requiredText,
  persianText: requiredText,
};

export const LANGUAGE_LABEL: Record<SentenceLanguage, string> = { english: "English", urdu: "Urdu", persian: "Persian" };

export function slugifyCategoryName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** `base`, or `base-2`, `base-3`... -- the first slug no sentence category already uses. */
export async function uniqueSentenceCategorySlug(base: string): Promise<string> {
  const root = base || "category";
  const rows = await db
    .select({ slug: sentenceCategories.slug })
    .from(sentenceCategories)
    .where(sql`${sentenceCategories.slug} = ${root} or ${sentenceCategories.slug} like ${`${root}-%`}`);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
  }
}

export async function findSentenceCategoryByName(name: string) {
  const [row] = await db
    .select()
    .from(sentenceCategories)
    .where(sql`lower(${sentenceCategories.nameEnglish}) = lower(${name.trim()})`)
    .limit(1);
  return row ?? null;
}

/**
 * Creates a category named `name` unless one with that name (any case) already exists, in which case
 * that one is returned -- the same silent-duplicate convention every add path in this app uses.
 */
export async function createSentenceCategory(name: string, sortOrder?: number) {
  const trimmed = name.trim();
  if (!trimmed) throw new HttpError(400, "VALIDATION_ERROR", "A category needs a name");

  const existing = await findSentenceCategoryByName(trimmed);
  if (existing) return { category: existing, created: false };

  let order = sortOrder;
  if (order === undefined) {
    const [max] = await db.select({ value: sql<number>`coalesce(max(${sentenceCategories.sortOrder}), -1)`.mapWith(Number) }).from(sentenceCategories);
    order = (max?.value ?? -1) + 1;
  }

  const slug = await uniqueSentenceCategorySlug(slugifyCategoryName(trimmed));
  const [category] = await db.insert(sentenceCategories).values({ slug, nameEnglish: trimmed, sortOrder: order }).returning();
  return { category: category!, created: true };
}

/** The next free position in a category (0 for an empty one). Ties are harmless -- reads also order by created_at, id. */
export async function nextSentenceSortOrder(categoryId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(max(${sentences.sortOrder}), -1)`.mapWith(Number) })
    .from(sentences)
    .where(and(eq(sentences.sentenceCategoryId, categoryId), isNull(sentences.deletedAt)));
  return (row?.value ?? -1) + 1;
}

export async function requireActiveSentenceCategory(categoryId: string) {
  const [category] = await db.select().from(sentenceCategories).where(eq(sentenceCategories.id, categoryId)).limit(1);
  if (!category) throw new HttpError(404, "NOT_FOUND", "Sentence category not found");
  return category;
}

/* -------------------------------------------------------------------------- */
/*                                   Import                                   */
/* -------------------------------------------------------------------------- */

export type SentenceImportRow = { category?: string; english?: string; urdu?: string; persian?: string };

export type PlannedSentence = {
  rowNum: number;
  value: typeof sentences.$inferInsert;
};

/**
 * Turns import rows (one row = one sentence with all three languages) into inserts, without writing
 * the sentences themselves. A row is refused -- reported with its row number -- unless it names a
 * category and carries ALL THREE texts, so an import can never leave a sentence without an
 * equivalent. Unknown categories are an error unless `createCategories` is set, in which case they
 * are created (case-insensitively de-duplicated) -- but only for rows that are otherwise valid.
 * Sentences whose English text already exists (any case) are skipped silently, as everywhere else.
 */
export async function planSentenceImport(
  rows: SentenceImportRow[],
  opts: { createCategories: boolean; rowNumOffset: number; createdBy: string | null },
): Promise<{ toInsert: PlannedSentence[]; errors: { row: number; message: string }[]; categoriesCreated: number }> {
  const errors: { row: number; message: string }[] = [];

  type Valid = { rowNum: number; categoryName: string; englishText: string; urduText: string; persianText: string };
  const valid: Valid[] = [];

  rows.forEach((raw, i) => {
    const rowNum = i + opts.rowNumOffset;
    const categoryName = (raw.category ?? "").trim();
    const englishText = (raw.english ?? "").trim();
    const urduText = (raw.urdu ?? "").trim();
    const persianText = (raw.persian ?? "").trim();

    const missing: string[] = [];
    if (!categoryName) missing.push("category");
    if (!englishText) missing.push(LANGUAGE_LABEL.english);
    if (!urduText) missing.push(LANGUAGE_LABEL.urdu);
    if (!persianText) missing.push(LANGUAGE_LABEL.persian);
    if (missing.length > 0) {
      errors.push({ row: rowNum, message: `Missing ${missing.join(", ")} -- every sentence needs a category and all three languages` });
      return;
    }
    const tooLong = [englishText, urduText, persianText].some((t) => t.length > SENTENCE_TEXT_MAX);
    if (tooLong) {
      errors.push({ row: rowNum, message: `A sentence can be at most ${SENTENCE_TEXT_MAX} characters in each language` });
      return;
    }
    valid.push({ rowNum, categoryName, englishText, urduText, persianText });
  });

  // Categories, matched by name or slug in any case.
  const existingCategories = await db.select().from(sentenceCategories);
  const categoryByKey = new Map<string, (typeof existingCategories)[number]>();
  for (const c of existingCategories) {
    categoryByKey.set(c.slug.toLowerCase(), c);
    categoryByKey.set(c.nameEnglish.toLowerCase(), c);
  }

  let categoriesCreated = 0;
  const unknownNames = new Map<string, string>(); // lower -> first spelling seen
  for (const v of valid) {
    const key = v.categoryName.toLowerCase();
    if (!categoryByKey.has(key) && !unknownNames.has(key)) unknownNames.set(key, v.categoryName);
  }
  if (opts.createCategories) {
    for (const [key, name] of unknownNames) {
      const { category, created } = await createSentenceCategory(name);
      categoryByKey.set(key, category);
      if (created) categoriesCreated++;
    }
  }

  // Existing English texts among this batch's candidates -- bounded by the lower(english_text) index
  // rather than reading the whole table (the "never pull a large row set into Node" rule, ARCHITECTURE.md §2.7).
  const candidateLower = [...new Set(valid.map((v) => v.englishText.toLowerCase()))];
  const existingLower = new Set<string>();
  for (let i = 0; i < candidateLower.length; i += 1000) {
    const chunk = candidateLower.slice(i, i + 1000);
    const found = await db
      .select({ englishText: sentences.englishText })
      .from(sentences)
      .where(and(sql`lower(${sentences.englishText}) in ${chunk}`, isNull(sentences.deletedAt)));
    for (const f of found) existingLower.add(f.englishText.toLowerCase());
  }

  const nextOrder = new Map<string, number>();
  const toInsert: PlannedSentence[] = [];

  for (const v of valid) {
    const category = categoryByKey.get(v.categoryName.toLowerCase());
    if (!category) {
      errors.push({ row: v.rowNum, message: `Unknown category "${v.categoryName}" -- create it first, or tick "Create categories that don't exist yet"` });
      continue;
    }
    const lower = v.englishText.toLowerCase();
    if (existingLower.has(lower)) continue; // silent duplicate
    existingLower.add(lower);

    let order = nextOrder.get(category.id);
    if (order === undefined) order = await nextSentenceSortOrder(category.id);
    nextOrder.set(category.id, order + 1);

    toInsert.push({
      rowNum: v.rowNum,
      value: {
        englishText: v.englishText,
        urduText: v.urduText,
        persianText: v.persianText,
        sentenceCategoryId: category.id,
        sortOrder: order,
        createdBy: opts.createdBy,
      },
    });
  }

  return { toInsert, errors, categoriesCreated };
}

/** Which of these category ids exist -- for validating a move/bulk edit in one query. */
export async function existingSentenceCategoryIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: sentenceCategories.id }).from(sentenceCategories).where(inArray(sentenceCategories.id, ids));
  return new Set(rows.map((r) => r.id));
}

export async function listAllSentenceCategories() {
  return db.select().from(sentenceCategories).orderBy(asc(sentenceCategories.sortOrder), asc(sentenceCategories.nameEnglish));
}
