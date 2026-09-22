import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { hasPermission, verifyToken } from "../../../middleware/auth.js";
import { getDailyScene, getRandomScene, getSceneById, getScenes, submitSceneContribution } from "./scene.service.js";

const listQuerySchema = z.object({
  search: z.string().min(1).optional(),
  // Admin-only in practice -- see the identical note in concepts.routes.ts.
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  // Scenes have no direct category column -- this matches scenes that have
  // at least one scene_concepts coverage annotation in the given category
  // (scene_concepts carries its own categoryId for exactly this kind of
  // lookup). Admin-only in practice, same as the date filters above.
  categoryId: z.string().uuid().optional(),
  hasImage: z.enum(["yes", "no"]).optional(),
  // Volunteer's "my own additions" filter -- true restricts the list to
  // scenes this caller themselves created (scenes.createdBy).
  mine: z.coerce.boolean().optional(),
  // Admin-only: include hidden (isActive false, not deleted) scenes too --
  // silently ignored for anyone without scenes.manage, same as concepts.
  includeHidden: z.coerce.boolean().optional(),
  // 1000 (not 200) so admin pages can fetch the full scene list in one
  // request for client-side matching (bulk-add-images-by-URL) without
  // paginating just to build a lookup map.
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const randomQuerySchema = z.object({ exclude: z.string().uuid().optional() });
const idParamSchema = z.object({ id: z.string().uuid() });

const submitSchema = z.object({
  audioFileId: z.string().uuid(),
  durationMs: z.number().int().min(1), // NO max -- Module 4 has no duration limit
  languageId: z.string().uuid(),
  dialectId: z.string().uuid().optional(),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  clientType: z.string().optional(),
});

export default async function sceneRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: verifyToken }, async (request) => {
    const { search, createdFrom, createdTo, categoryId, hasImage, mine, includeHidden, limit, offset } = listQuerySchema.parse(
      request.query,
    );
    const canManage = await hasPermission(request.user!.role, "scenes.manage");
    return getScenes(limit, offset, request.user!.id, {
      search,
      createdFrom,
      createdTo,
      categoryId,
      // A scene with no image is never shown to a plain contributor,
      // regardless of what hasImage they asked for -- only an admin/
      // volunteer with scenes.manage can browse imageless scenes (to find
      // and fix them), via their own explicit hasImage filter.
      hasImage: canManage ? hasImage : "yes",
      mine: mine ? request.user!.id : undefined,
      includeHidden: includeHidden && canManage,
    });
  });

  fastify.get("/daily", { preHandler: verifyToken }, async () => getDailyScene());

  fastify.get("/random", { preHandler: verifyToken }, async (request) => {
    const { exclude } = randomQuerySchema.parse(request.query);
    return getRandomScene(exclude);
  });

  fastify.get("/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return getSceneById(id);
  });

  fastify.post("/:id/contributions", { preHandler: verifyToken }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = submitSchema.parse(request.body);
    const result = await submitSceneContribution(request.user!.id, id, body);
    reply.code(201).send(result);
  });
}
