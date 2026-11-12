import type { userRole } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";

type Role = (typeof userRole.enumValues)[number];
type Person = { id: string; role: Role };

/**
 * Who may moderate whom (restrict, cool off, suspend, ban, lift any of those).
 *
 * Holding `users.manage` used to be enough to do any of these to *anyone*, so an
 * ordinary admin could suspend or ban a super_admin (a suspended/deleted account
 * is rejected by verifyToken, so that locks them out) or another admin. The
 * credentials route already protected admins and super_admins; the moderation
 * routes did not. Rules:
 *
 *   - Nobody moderates their own account from the admin panel (self-service
 *     deletion lives at DELETE /users/me; lifting your own restriction or
 *     suspension would defeat it).
 *   - A super_admin can only be moderated by another super_admin.
 *   - An admin can only be moderated by a super_admin.
 *   - Everyone else (volunteer, contributor) can be moderated by an admin.
 *
 * Returns a reason when denied, or null when allowed.
 */
export function moderationDenial(actor: Person, target: Person): string | null {
  if (actor.id === target.id) {
    return "You can't do this to your own account from the admin panel";
  }
  if (target.role === "super_admin" && actor.role !== "super_admin") {
    return "Only a super_admin can moderate a super_admin account";
  }
  if (target.role === "admin" && actor.role !== "super_admin") {
    return "Only a super_admin can moderate an admin account";
  }
  return null;
}

/**
 * POST /superadmin/admins only ever sets role = "admin". Pointed at a
 * super_admin it would silently DEMOTE them (and could lock out the only one),
 * and a deleted/missing account can't be promoted at all.
 */
export function assertCanGrantAdminTo<T extends { role: Role; deletedAt: Date | null }>(target: T | undefined): asserts target is T {
  if (!target || target.deletedAt) {
    throw new HttpError(404, "NOT_FOUND", "User not found");
  }
  if (target.role === "super_admin") {
    throw new HttpError(409, "CANNOT_CHANGE_SUPER_ADMIN", "A super_admin's role can't be changed from this route");
  }
}

export function assertCanModerateUser(actor: Person, target: Person): void {
  const denial = moderationDenial(actor, target);
  if (denial) throw new HttpError(403, "FORBIDDEN", denial);
}

/**
 * Bulk form. The whole request is refused if any selected account is protected,
 * rather than quietly skipping it: a partial result on a mixed selection would
 * leave the admin believing everyone they ticked was actioned.
 */
export function assertCanModerateAll(actor: Person, targets: Person[]): void {
  const denied = targets.filter((t) => moderationDenial(actor, t) !== null);
  if (denied.length === 0) return;
  const selfIncluded = denied.some((t) => t.id === actor.id);
  throw new HttpError(
    403,
    "FORBIDDEN",
    selfIncluded
      ? "The selection includes your own account, which you can't do this to from the admin panel"
      : `The selection includes ${denied.length} account${denied.length === 1 ? "" : "s"} you aren't allowed to moderate (admin and super_admin accounts need a super_admin)`,
  );
}
