import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "../../../db/index.js";
import {
  contributions,
  gamificationConfig,
  pointsTransactions,
  sceneContributions,
  sceneMedia,
  scenes,
  userStats,
} from "../../../db/schema.js";
import { updateStreakOnContribution } from "../../../services/streak.service.js";
import { HttpError } from "../../../utils/http-error.js";

// scene_concepts is admin-only annotation data (which concepts are visible in
// a scene image) and must never be queried, joined, or returned from this
// file -- contributors and the daily/random/list endpoints never see it.

// Module 4 scene descriptions carry NO 3-second limit anywhere in this file.
// Descriptions can run to 5 minutes (300000ms) or longer.

export type SubmitSceneContributionInput = {
  audioFileId: string;
  durationMs: number;
  languageId: string;
  dialectId?: string | null;
  deviceId?: string | null;
  appVersion?: string | null;
  clientType?: string | null;
};

const LONG_DESCRIPTION_THRESHOLD_MS = 60_000;

async function readConfigValue(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], configKey: string): Promise<number> {
  const [config] = await tx
    .select({ configValue: gamificationConfig.configValue })
    .from(gamificationConfig)
    .where(and(eq(gamificationConfig.configKey, configKey), eq(gamificationConfig.isActive, true)))
    .limit(1);

  if (!config) {
    throw new HttpError(500, "CONFIG_MISSING", `${configKey} is not configured`);
  }

  return (config.configValue as { value: number }).value;
}

function sceneSelection() {
  return {
    id: scenes.id,
    slug: scenes.slug,
    title: scenes.title,
    description: scenes.description,
    difficulty: scenes.difficulty,
    estimatedDurationSeconds: scenes.estimatedDurationSeconds,
    isDaily: scenes.isDaily,
    imageUrl: sceneMedia.publicUrl,
  };
}

export async function getScenes() {
  return db
    .select(sceneSelection())
    .from(scenes)
    .leftJoin(sceneMedia, and(eq(sceneMedia.sceneId, scenes.id), eq(sceneMedia.isPrimary, true)))
    .where(and(eq(scenes.isActive, true), isNull(scenes.deletedAt)))
    .orderBy(scenes.difficulty);
}

export async function getDailyScene() {
  // scenes.dailyDate exists for scheduling a specific day's scene, but is
  // unpopulated in current data (the seeded daily scene has no dailyDate
  // set), so this deliberately follows the literal spec and filters on
  // isDaily/isActive only -- filtering by dailyDate = current_date would
  // return nothing until that column is actually populated.
  const [scene] = await db
    .select(sceneSelection())
    .from(scenes)
    .leftJoin(sceneMedia, and(eq(sceneMedia.sceneId, scenes.id), eq(sceneMedia.isPrimary, true)))
    .where(and(eq(scenes.isDaily, true), eq(scenes.isActive, true), isNull(scenes.deletedAt)))
    .limit(1);

  if (scene) {
    return scene;
  }

  return getRandomScene();
}

export async function getRandomScene(excludeId?: string) {
  const conditions = [eq(scenes.isActive, true), isNull(scenes.deletedAt)];
  if (excludeId) {
    conditions.push(ne(scenes.id, excludeId));
  }

  const [scene] = await db
    .select(sceneSelection())
    .from(scenes)
    .leftJoin(sceneMedia, and(eq(sceneMedia.sceneId, scenes.id), eq(sceneMedia.isPrimary, true)))
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(1);

  if (!scene) {
    throw new HttpError(404, "NO_SCENES_AVAILABLE", "No active scenes are available");
  }

  return scene;
}

export async function getSceneById(sceneId: string) {
  const [scene] = await db
    .select(sceneSelection())
    .from(scenes)
    .leftJoin(sceneMedia, and(eq(sceneMedia.sceneId, scenes.id), eq(sceneMedia.isPrimary, true)))
    .where(and(eq(scenes.id, sceneId), isNull(scenes.deletedAt)))
    .limit(1);

  if (!scene) {
    throw new HttpError(404, "NOT_FOUND", "Scene not found");
  }

  return scene;
}

export async function submitSceneContribution(userId: string, sceneId: string, data: SubmitSceneContributionInput) {
  // 1. Verify the scene exists and is active.
  const [scene] = await db
    .select({ id: scenes.id, isDaily: scenes.isDaily, difficulty: scenes.difficulty })
    .from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.isActive, true), isNull(scenes.deletedAt)))
    .limit(1);

  if (!scene) {
    throw new HttpError(404, "NOT_FOUND", "Scene not found or not active");
  }

  return db.transaction(async (tx) => {
    // a. Insert scene_contributions (no duration check).
    const [sceneContribution] = await tx
      .insert(sceneContributions)
      .values({ sceneId, audioFileId: data.audioFileId })
      .returning({ id: sceneContributions.id });

    if (!sceneContribution) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create scene contribution");
    }

    // b. Insert contributions.
    const [contribution] = await tx
      .insert(contributions)
      .values({
        userId,
        moduleType: "SCENE",
        languageId: data.languageId,
        dialectId: data.dialectId ?? null,
        status: "pending",
        sceneContributionId: sceneContribution.id,
        deviceId: data.deviceId ?? null,
        appVersion: data.appVersion ?? null,
        clientType: data.clientType ?? null,
      })
      .returning({ id: contributions.id });

    if (!contribution) {
      throw new HttpError(500, "INSERT_FAILED", "Failed to create contribution");
    }

    // c. Point scene_contributions back at its contribution.
    await tx
      .update(sceneContributions)
      .set({ contributionId: contribution.id, updatedAt: new Date() })
      .where(eq(sceneContributions.id, sceneContribution.id));

    // d. Points.
    const base = await readConfigValue(tx, "points.scene.base");
    const longBonus = data.durationMs > LONG_DESCRIPTION_THRESHOLD_MS ? await readConfigValue(tx, "points.scene.long_bonus") : 0;
    const dailyBonus = scene.isDaily ? await readConfigValue(tx, "points.scene.daily_bonus") : 0;
    const expertBonus = scene.difficulty === "expert" ? await readConfigValue(tx, "points.scene.expert_bonus") : 0;

    const bonusBreakdown = { base, longBonus, dailyBonus, expertBonus };
    const pointsAwarded = base + longBonus + dailyBonus + expertBonus;

    // e. Points ledger, idempotent by construction.
    await tx
      .insert(pointsTransactions)
      .values({
        userId,
        contributionId: contribution.id,
        points: pointsAwarded,
        reason: "SCENE_SUBMITTED",
        moduleType: "SCENE",
        idempotencyKey: `${contribution.id}:SCENE_SUBMITTED`,
      })
      .onConflictDoNothing();

    // f. user_stats counters.
    await tx
      .update(userStats)
      .set({
        totalContributions: sql`${userStats.totalContributions} + 1`,
        sceneContributionsCount: sql`${userStats.sceneContributionsCount} + 1`,
        pendingContributions: sql`${userStats.pendingContributions} + 1`,
        lastContributionAt: new Date(),
        lastContributionModule: "SCENE",
        updatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId));

    // g. Streak bookkeeping.
    await updateStreakOnContribution(tx, userId);

    // 3.
    return {
      contributionId: contribution.id,
      sceneContributionId: sceneContribution.id,
      pointsAwarded,
      bonusBreakdown,
    };
  });
}
