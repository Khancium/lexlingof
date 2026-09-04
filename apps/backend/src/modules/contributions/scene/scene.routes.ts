import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { verifyToken } from "../../../middleware/auth.js";
import { getDailyScene, getRandomScene, getSceneById, getScenes, submitSceneContribution } from "./scene.service.js";

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
  fastify.get("/", async () => getScenes());

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
