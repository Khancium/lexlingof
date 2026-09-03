import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db/index.js";
import { permissions, rolePermissions, userRole, userStats, users } from "../db/schema.js";

type Role = (typeof userRole.enumValues)[number];

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; email: string; role: string };
    requireOwnershipCheck?: boolean;
  }
}

/* -------------------------------------------------------------------------- */
/*                          Role permission cache (5 min)                     */
/* -------------------------------------------------------------------------- */

const ROLE_PERMISSIONS_CACHE_TTL_MS = 5 * 60 * 1000;

const rolePermissionsCache = new Map<Role, { codes: Set<string>; expiresAt: number }>();

async function getRolePermissionCodes(role: Role): Promise<Set<string>> {
  const cached = rolePermissionsCache.get(role);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.codes;
  }

  const rows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.role, role));

  const codes = new Set(rows.map((r) => r.code));
  rolePermissionsCache.set(role, { codes, expiresAt: Date.now() + ROLE_PERMISSIONS_CACHE_TTL_MS });
  return codes;
}

/* -------------------------------------------------------------------------- */
/*                                verifyToken                                 */
/* -------------------------------------------------------------------------- */

export async function verifyToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
  } catch {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
    return;
  }

  const userId = payload.sub;
  if (!userId) {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
    return;
  }

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      isSuspended: users.isSuspended,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!row || !row.isActive || row.isSuspended) {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
    return;
  }

  request.user = { id: row.id, email: row.email, role: row.role };
}

/* -------------------------------------------------------------------------- */
/*                               requirePermission                            */
/* -------------------------------------------------------------------------- */

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
      return;
    }

    if (request.user.role === "super_admin") {
      return;
    }

    const codes = await getRolePermissionCodes(request.user.role as Role);
    if (!codes.has(permission)) {
      reply.code(403).send({ code: "FORBIDDEN", required: permission });
      return;
    }

    if (permission.endsWith(".own")) {
      request.requireOwnershipCheck = true;
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                           requireReviewerEligibility                       */
/* -------------------------------------------------------------------------- */

export function requireReviewerEligibility() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
      return;
    }

    if (request.user.role !== "contributor") {
      return;
    }

    const [stats] = await db
      .select({ level: userStats.level })
      .from(userStats)
      .where(eq(userStats.userId, request.user.id))
      .limit(1);

    const level = stats?.level ?? "BRONZE";

    if (level === "BRONZE" || level === "SILVER") {
      reply.code(403).send({ code: "INSUFFICIENT_LEVEL", currentLevel: level, required: "GOLD" });
      return;
    }
  };
}
