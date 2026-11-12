import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { deviceTokens } from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";

const registerDeviceSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

const unregisterDeviceSchema = z.object({
  token: z.string().min(1),
});

export default async function deviceRoutes(fastify: FastifyInstance) {
  fastify.post("/devices/register", { preHandler: verifyToken }, async (request, reply) => {
    const body = registerDeviceSchema.parse(request.body);

    await db
      .insert(deviceTokens)
      .values({
        userId: request.user!.id,
        token: body.token,
        platform: body.platform,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: {
          userId: request.user!.id,
          platform: body.platform,
          isActive: true,
          updatedAt: new Date(),
        },
      });

    reply.code(200).send({ success: true });
  });

  fastify.delete("/devices/unregister", { preHandler: verifyToken }, async (request, reply) => {
    const body = unregisterDeviceSchema.parse(request.body);

    // Scoped to the caller's own tokens. It used to match on the token alone, so anyone who
    // had (or guessed) another device's push token could silently switch that user's
    // notifications off.
    await db
      .update(deviceTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(deviceTokens.token, body.token), eq(deviceTokens.userId, request.user!.id)));

    reply.code(200).send({ success: true });
  });
}
