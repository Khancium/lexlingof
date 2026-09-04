import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { contributionModule } from "../../db/schema.js";
import { requireReviewerEligibility, verifyToken } from "../../middleware/auth.js";
import { getQueue, submitReview } from "./reviews.service.js";

const queueQuerySchema = z.object({ moduleType: z.enum(contributionModule.enumValues).optional() });

const submitReviewSchema = z.object({
  contributionId: z.string().uuid(),
  decision: z.enum(["valid", "needs_correction", "invalid"]),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

export default async function reviewsRoutes(fastify: FastifyInstance) {
  const reviewerOnly = [verifyToken, requireReviewerEligibility()];

  fastify.get("/queue", { preHandler: reviewerOnly }, async (request) => {
    const { moduleType } = queueQuerySchema.parse(request.query);
    return getQueue(request.user!.id, moduleType);
  });

  fastify.post("/", { preHandler: reviewerOnly }, async (request, reply) => {
    const body = submitReviewSchema.parse(request.body);
    const result = await submitReview(request.user!.id, body);
    reply.code(201).send(result);
  });
}
