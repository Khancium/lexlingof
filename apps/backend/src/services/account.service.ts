import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { contributorDemographics, contributorProfiles, deviceTokens, refreshTokens, users } from "../db/schema.js";
import { invalidateUserCache } from "../middleware/auth.js";

/**
 * Soft-deletes a user's account -- NOT a hard delete. Scrubs PII (password,
 * name, avatar, bio) and marks the row deleted/inactive, but deliberately
 * keeps the users row itself alive (their contributions, word recordings,
 * translations, audio uploads, scene contributions, and reviews all
 * reference users.id, and none of those FKs cascade) so the corpus data
 * this user contributed survives intact.
 *
 * The email is deliberately NOT scrubbed/freed -- auth.service.ts's
 * register() checks for this email across ALL rows (not just non-deleted
 * ones), so keeping it on this row is what permanently blocks the same
 * email from registering a new account. This is what makes account
 * deletion a real "ban" when used by an admin, not just a self-service
 * opt-out: the person cannot simply sign back up with the same email.
 *
 * Shared by the self-service "delete my account" flow and the admin Users
 * module's "ban (delete account)" action.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  await Promise.all([
    db
      .update(users)
      .set({
        passwordHash: null,
        displayName: "Deleted User",
        avatarUrl: null,
        biography: null,
        isActive: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId)),
    db.delete(contributorDemographics).where(eq(contributorDemographics.userId, userId)),
    db.delete(contributorProfiles).where(eq(contributorProfiles.userId, userId)),
    db.delete(refreshTokens).where(eq(refreshTokens.userId, userId)),
    db.delete(deviceTokens).where(eq(deviceTokens.userId, userId)),
  ]);

  invalidateUserCache(userId);
}
