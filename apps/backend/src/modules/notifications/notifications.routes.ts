import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function notificationsRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: verifyToken }, async (request) => {
    const { limit, offset } = listQuerySchema.parse(request.query);
    const userId = request.user!.id;

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const sentIds = rows.filter((n) => n.status === "sent").map((n) => n.id);
    if (sentIds.length > 0) {
      await db.update(notifications).set({ status: "delivered" }).where(inArray(notifications.id, sentIds));
    }

    return rows.map((n) => (n.status === "sent" ? { ...n, status: "delivered" as const } : n));
  });

  fastify.post("/:id/read", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = request.user!.id;

    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });

    if (updated.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "Notification not found");
    }

    return { id, readAt: new Date() };
  });
}
