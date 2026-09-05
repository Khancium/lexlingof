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
import { GENDER_OPTIONS, MOTHER_TONGUE_LANGUAGES } from "./demographics.constants.js";

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
  age: z.coerce.number().int().min(1).max(120),
  gender: z.enum(GENDER_OPTIONS),
  motherTongue: z.enum(MOTHER_TONGUE_LANGUAGES),
  tribe: z.string().trim().min(1),
  subTribe: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1),
  city: z.string().trim().min(1),
  village: z.string().trim().min(1),
  quarter: z.string().trim().min(1).optional(),
  dialect: z.string().trim().min(1).optional(),
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
        gender: contributorDemographics.gender,
        motherTongue: contributorDemographics.motherTongue,
        country: contributorDemographics.country,
        city: contributorDemographics.city,
        dialect: contributorDemographics.dialect,
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

    const tribeId = await getOrCreateTribe(body.tribe);
    const subTribeId = body.subTribe ? await getOrCreateSubTribe(tribeId, body.subTribe) : null;
    const villageId = await getOrCreateVillage(body.country, body.city, body.village);
    const quarterId = body.quarter ? await getOrCreateQuarter(villageId, body.quarter) : null;

    const values = {
      userId,
      fullName: body.fullName,
      age: body.age,
      gender: body.gender,
      motherTongue: body.motherTongue,
      tribeId,
      subTribeId,
      country: body.country,
      city: body.city,
      villageId,
      quarterId,
      dialect: body.dialect ?? null,
      updatedAt: new Date(),
    };

    await db
      .insert(contributorDemographics)
      .values(values)
      .onConflictDoUpdate({ target: contributorDemographics.userId, set: values });

    // The signup form no longer collects a name -- this is the first real
    // name the user provides, so it becomes their display name too.
    await db.update(users).set({ displayName: body.fullName, updatedAt: new Date() }).where(eq(users.id, userId));

    // The language picked here becomes the contributor's primary
    // contribution language -- every module submission requires one, and
    // asking for it again separately on a profile screen would be
    // redundant with what was just chosen on this form.
    const languageId = await getOrCreateLanguageByName(body.motherTongue);
    await db
      .insert(contributorProfiles)
      .values({ userId, primaryLanguageId: languageId })
      .onConflictDoUpdate({
        target: contributorProfiles.userId,
        set: { primaryLanguageId: languageId, updatedAt: new Date() },
      });

    const [row] = await db
      .select()
      .from(contributorDemographics)
      .where(eq(contributorDemographics.userId, userId))
      .limit(1);
    return row;
  });
}
