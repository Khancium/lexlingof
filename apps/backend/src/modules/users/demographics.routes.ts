import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  contributorDemographics,
  contributorProfiles,
  languages,
  quarters,
  subTribes,
  tribes,
  users,
  villages,
} from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";
import { EDUCATION_LEVEL_OPTIONS, GENDER_OPTIONS, MOTHER_TONGUE_LANGUAGES } from "./demographics.constants.js";

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

async function getOrCreateTribe(name: string): Promise<string> {
  const [existing] = await db.select({ id: tribes.id }).from(tribes).where(eq(tribes.name, name)).limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(tribes)
    .values({ name })
    .onConflictDoNothing({ target: tribes.name })
    .returning({ id: tribes.id });
  if (created) return created.id;

  const [row] = await db.select({ id: tribes.id }).from(tribes).where(eq(tribes.name, name)).limit(1);
  if (!row) throw new HttpError(500, "TRIBE_LOOKUP_FAILED", "Failed to resolve tribe");
  return row.id;
}

async function getOrCreateSubTribe(tribeId: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: subTribes.id })
    .from(subTribes)
    .where(and(eq(subTribes.tribeId, tribeId), eq(subTribes.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(subTribes)
    .values({ tribeId, name })
    .onConflictDoNothing({ target: [subTribes.tribeId, subTribes.name] })
    .returning({ id: subTribes.id });
  if (created) return created.id;

  const [row] = await db
    .select({ id: subTribes.id })
    .from(subTribes)
    .where(and(eq(subTribes.tribeId, tribeId), eq(subTribes.name, name)))
    .limit(1);
  if (!row) throw new HttpError(500, "SUB_TRIBE_LOOKUP_FAILED", "Failed to resolve sub-tribe");
  return row.id;
}

async function getOrCreateVillage(country: string, city: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: villages.id })
    .from(villages)
    .where(and(eq(villages.country, country), eq(villages.city, city), eq(villages.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(villages)
    .values({ country, city, name })
    .onConflictDoNothing({ target: [villages.country, villages.city, villages.name] })
    .returning({ id: villages.id });
  if (created) return created.id;

  const [row] = await db
    .select({ id: villages.id })
    .from(villages)
    .where(and(eq(villages.country, country), eq(villages.city, city), eq(villages.name, name)))
    .limit(1);
  if (!row) throw new HttpError(500, "VILLAGE_LOOKUP_FAILED", "Failed to resolve village");
  return row.id;
}

async function getOrCreateQuarter(villageId: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: quarters.id })
    .from(quarters)
    .where(and(eq(quarters.villageId, villageId), eq(quarters.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(quarters)
    .values({ villageId, name })
    .onConflictDoNothing({ target: [quarters.villageId, quarters.name] })
    .returning({ id: quarters.id });
  if (created) return created.id;

  const [row] = await db
    .select({ id: quarters.id })
    .from(quarters)
    .where(and(eq(quarters.villageId, villageId), eq(quarters.name, name)))
    .limit(1);
  if (!row) throw new HttpError(500, "QUARTER_LOOKUP_FAILED", "Failed to resolve quarter");
  return row.id;
}

/** Age in whole years as of today, from a YYYY-MM-DD date of birth. */
function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function slugifyLanguageCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * The onboarding form's mother-tongue list (MOTHER_TONGUE_LANGUAGES) is
 * mostly minority languages with no existing row in `languages` -- that
 * table only had Pashto/English seeded for contribution content. Creating
 * one here (rather than requiring it pre-seeded) is what lets a
 * contributor's onboarding language selection immediately become their
 * primary contribution language.
 */
async function getOrCreateLanguageByName(name: string): Promise<string> {
  const [existing] = await db
    .select({ id: languages.id })
    .from(languages)
    .where(eq(languages.nameEnglish, name))
    .limit(1);
  if (existing) return existing.id;

  const code = slugifyLanguageCode(name);
  const [created] = await db
    .insert(languages)
    .values({ code, nameEnglish: name, nameNative: name })
    .onConflictDoNothing({ target: languages.code })
    .returning({ id: languages.id });
  if (created) return created.id;

  const [row] = await db.select({ id: languages.id }).from(languages).where(eq(languages.code, code)).limit(1);
  if (!row) throw new HttpError(500, "LANGUAGE_LOOKUP_FAILED", "Failed to resolve language");
  return row.id;
}

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const villagesQuerySchema = z.object({
  country: z.string().min(1),
  city: z.string().min(1),
});

const tribeIdParamSchema = z.object({ tribeId: z.string().uuid() });
const villageIdParamSchema = z.object({ villageId: z.string().uuid() });

const submitDemographicsSchema = z.object({
  fullName: z.string().trim().min(1),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date of birth")
    .refine((v) => calculateAge(v) >= 1 && calculateAge(v) <= 120, "Age must be between 1 and 120"),
  gender: z.enum(GENDER_OPTIONS),
  motherTongue: z.enum(MOTHER_TONGUE_LANGUAGES),
  tribe: z.string().trim().min(1),
  subTribe: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1),
  city: z.string().trim().min(1),
  village: z.string().trim().min(1),
  quarter: z.string().trim().min(1).optional(),
  dialect: z.string().trim().min(1).optional(),
  educationLevel: z.enum(EDUCATION_LEVEL_OPTIONS).optional(),
  profession: z.string().trim().min(1).optional(),
});

/* -------------------------------------------------------------------------- */
/*                                    Routes                                  */
/* -------------------------------------------------------------------------- */

export default async function demographicsRoutes(fastify: FastifyInstance) {
  fastify.get("/mother-tongues", async () => ({ items: MOTHER_TONGUE_LANGUAGES }));

  fastify.get("/tribes", async () => {
    const rows = await db.select({ id: tribes.id, name: tribes.name }).from(tribes).orderBy(asc(tribes.name));
    return { items: rows };
  });

  fastify.get("/tribes/:tribeId/sub-tribes", async (request) => {
    const { tribeId } = tribeIdParamSchema.parse(request.params);
    const rows = await db
      .select({ id: subTribes.id, name: subTribes.name })
      .from(subTribes)
      .where(eq(subTribes.tribeId, tribeId))
      .orderBy(asc(subTribes.name));
    return { items: rows };
  });

  fastify.get("/villages", async (request) => {
    const { country, city } = villagesQuerySchema.parse(request.query);
    const rows = await db
      .select({ id: villages.id, name: villages.name })
      .from(villages)
      .where(and(eq(villages.country, country), eq(villages.city, city)))
      .orderBy(asc(villages.name));
    return { items: rows };
  });

  fastify.get("/villages/:villageId/quarters", async (request) => {
    const { villageId } = villageIdParamSchema.parse(request.params);
    const rows = await db
      .select({ id: quarters.id, name: quarters.name })
      .from(quarters)
      .where(eq(quarters.villageId, villageId))
      .orderBy(asc(quarters.name));
    return { items: rows };
  });

  fastify.get("/me/demographics", { preHandler: verifyToken }, async (request) => {
    const [row] = await db
      .select({
        fullName: contributorDemographics.fullName,
        age: contributorDemographics.age,
        dateOfBirth: contributorDemographics.dateOfBirth,
        gender: contributorDemographics.gender,
        motherTongue: contributorDemographics.motherTongue,
        country: contributorDemographics.country,
        city: contributorDemographics.city,
        dialect: contributorDemographics.dialect,
        educationLevel: contributorDemographics.educationLevel,
        profession: contributorDemographics.profession,
        tribeName: tribes.name,
        subTribeName: subTribes.name,
        villageName: villages.name,
        quarterName: quarters.name,
      })
      .from(contributorDemographics)
      .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
      .leftJoin(subTribes, eq(subTribes.id, contributorDemographics.subTribeId))
      .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
      .leftJoin(quarters, eq(quarters.id, contributorDemographics.quarterId))
      .where(eq(contributorDemographics.userId, request.user!.id))
      .limit(1);
    return row ?? null;
  });

  fastify.post("/me/demographics", { preHandler: verifyToken }, async (request) => {
    const body = submitDemographicsSchema.parse(request.body);
    const userId = request.user!.id;

    // tribe->subTribe and village->quarter are the only real dependency
    // chains here (subTribe needs tribeId, quarter needs villageId) -- tribe,
    // village, and language are otherwise independent of each other, so the
    // whole get-or-create graph runs as two parallel batches instead of up
    // to 5 sequential top-level awaits (each itself 1-3 round trips).
    const [tribeId, villageId, languageId] = await Promise.all([
      getOrCreateTribe(body.tribe),
      getOrCreateVillage(body.country, body.city, body.village),
      getOrCreateLanguageByName(body.motherTongue),
    ]);
    const [subTribeId, quarterId] = await Promise.all([
      body.subTribe ? getOrCreateSubTribe(tribeId, body.subTribe) : Promise.resolve(null),
      body.quarter ? getOrCreateQuarter(villageId, body.quarter) : Promise.resolve(null),
    ]);

    const values = {
      userId,
      fullName: body.fullName,
      age: calculateAge(body.dateOfBirth),
      dateOfBirth: body.dateOfBirth,
      gender: body.gender,
      motherTongue: body.motherTongue,
      tribeId,
      subTribeId,
      country: body.country,
      city: body.city,
      villageId,
      quarterId,
      dialect: body.dialect ?? null,
      educationLevel: body.educationLevel ?? null,
      profession: body.profession ?? null,
      updatedAt: new Date(),
    };

    // The demographics upsert, the display-name update, and the
    // contributor-profile upsert (the language picked here becomes the
    // contributor's primary contribution language -- every module
    // submission requires one, and asking for it again separately on a
    // profile screen would be redundant with what was just chosen on this
    // form) are independent of each other -- run concurrently instead of as
    // three sequential round trips. .returning() on the demographics upsert
    // also avoids a trailing SELECT of the row just written.
    const [[demographicsRow]] = await Promise.all([
      db
        .insert(contributorDemographics)
        .values(values)
        .onConflictDoUpdate({ target: contributorDemographics.userId, set: values })
        .returning(),
      // The signup form no longer collects a name -- this is the first real
      // name the user provides, so it becomes their display name too.
      db.update(users).set({ displayName: body.fullName, updatedAt: new Date() }).where(eq(users.id, userId)),
      db
        .insert(contributorProfiles)
        .values({ userId, primaryLanguageId: languageId })
        .onConflictDoUpdate({
          target: contributorProfiles.userId,
          set: { primaryLanguageId: languageId, updatedAt: new Date() },
        }),
    ]);

    return demographicsRow;
  });
}
