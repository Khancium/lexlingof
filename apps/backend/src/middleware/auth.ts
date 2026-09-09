import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db/index.js";
import { permissions, rolePermissions, userRole, userStats, users } from "../db/schema.js";

type Role = (typeof userRole.enumValues)[number];

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; email: string; role: Role; isRestricted: boolean };
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
/*                       verifyToken user cache (30 sec)                      */
/* -------------------------------------------------------------------------- */

// verifyToken runs on nearly every request, so this DB round trip is the
// single biggest multiplier on perceived latency across the whole app (the
// backend and its DB are in different regions -- every round trip costs
// real wall-clock time). A short cache accepts up to 30s of staleness on
// suspend/deactivate in exchange for skipping that round trip on every
// other request for the same user -- the same tradeoff already made for
// role permissions below, just with a much shorter TTL since account
// status needs to propagate faster than permission changes do.
const USER_CACHE_TTL_MS = 30 * 1000;

type CachedUserRow = {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  isSuspended: boolean;
  suspendedUntil: Date | null;
  isRestricted: boolean;
};

const userCache = new Map<string, { row: CachedUserRow; expiresAt: number }>();

async function getUserForToken(userId: string): Promise<CachedUserRow | null> {
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.row;
  }

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      isSuspended: users.isSuspended,
      suspendedUntil: users.suspendedUntil,
      isRestricted: users.isRestricted,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!row) return null;

  // A cool-off ban that has expired auto-lifts here rather than needing a
  // cron job -- the next request after suspendedUntil passes just works,
  // and the lifted state is what gets cached (and returned) below.
  if (row.isSuspended && row.suspendedUntil && row.suspendedUntil <= new Date()) {
    await db
      .update(users)
      .set({ isSuspended: false, suspendedUntil: null, suspendedReason: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    row.isSuspended = false;
    row.suspendedUntil = null;
  }

  userCache.set(userId, { row, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return row;
}

/** Called wherever a user's role/status changes so the cache can't serve a stale row past that point. */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
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

  const row = await getUserForToken(userId);

  if (!row || !row.isActive || row.isSuspended) {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or missing token" });
    return;
  }

  request.user = { id: row.id, email: row.email, role: row.role, isRestricted: row.isRestricted };
}

/**
 * Lighter than a suspension: blocks new contribution submissions but leaves
 * everything else (login, browsing, past contributions) untouched. Apply
 * only to the submission-buffer POST routes, after verifyToken.
 */
export async function blockIfRestricted(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.user?.isRestricted) {
    reply.code(403).send({
      code: "ACCOUNT_RESTRICTED",
      message: "Your account is restricted from submitting new contributions. Contact support if you think this is a mistake.",
    });
  }
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

    // Peer review unlocks at SILVER -- this used to require GOLD, which
    // silently contradicted the frontend's canReview() gate and copy (both
    // already said SILVER), so a SILVER contributor got "Unlock Review
    // Access" showing 100%/threshold met and then a 403 the moment they
    // actually tried to load the queue.
    if (level === "BRONZE") {
      reply.code(403).send({ code: "INSUFFICIENT_LEVEL", currentLevel: level, required: "SILVER" });
      return;
    }
  };
}
