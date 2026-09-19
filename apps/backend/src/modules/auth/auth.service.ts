import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcrypt";
import { and, eq, gt, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";

import { db } from "../../db/index.js";
import { contributorProfiles, passwordResetTokens, refreshTokens, streaks, userStats, users } from "../../db/schema.js";
import { writeAuditLog } from "../../services/audit-log.service.js";
import { sendPasswordResetEmail } from "../../services/mailer.service.js";
import { HttpError } from "../../utils/http-error.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;
const PASSWORD_SALT_ROUNDS = 12;

type AuthUser = { id: string; email: string; displayName: string; role: string };
type TokenPair = { accessToken: string; refreshToken: string };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

class AuthService {
  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<{ user: AuthUser } & TokenPair> {
    // Deliberately NOT scoped to isNull(deletedAt) -- a deleted account's row
    // keeps its original email (see users.routes.ts DELETE /me, which no
    // longer scrubs it) specifically so that email can never be used to
    // register again, active or not.
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    if (existing) {
      throw new HttpError(409, "EMAIL_TAKEN", "Account on this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          displayName,
          role: "contributor",
          emailVerified: false,
        })
        .returning({ id: users.id, email: users.email, displayName: users.displayName, role: users.role });

      if (!created) {
        throw new HttpError(500, "REGISTRATION_FAILED", "Failed to create user");
      }

      await tx.insert(contributorProfiles).values({ userId: created.id });
      await tx.insert(userStats).values({ userId: created.id });
      await tx.insert(streaks).values({ userId: created.id });

      return created;
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await writeAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: "user_register",
      resourceType: "user",
      resourceId: user.id,
      afterState: { email: user.email },
    });

    return { user, ...tokens };
  }

  async login(email: string, password: string): Promise<{ user: AuthUser } & TokenPair> {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        passwordHash: users.passwordHash,
        isSuspended: users.isSuspended,
        suspendedReason: users.suspendedReason,
        suspendedUntil: users.suspendedUntil,
      })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email/password");
    }

    // A cool-off ban whose expiry has passed lifts right here instead of
    // needing a cron job -- the very next login attempt after it lapses just
    // works, same auto-lift verifyToken does for an already-active session.
    if (user.isSuspended && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      await db
        .update(users)
        .set({ isSuspended: false, suspendedUntil: null, suspendedReason: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      user.isSuspended = false;
    }

    if (user.isSuspended) {
      throw new HttpError(403, "ACCOUNT_SUSPENDED", undefined, {
        reason: user.suspendedReason,
        until: user.suspendedUntil,
      });
    }

    const passwordMatches = user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!passwordMatches) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email/password");
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await writeAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: "user_login",
      resourceType: "user",
      resourceId: user.id,
    });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      ...tokens,
    };
  }

  async refreshTokens(token: string): Promise<TokenPair> {
    const tokenHash = sha256(token);

    // Validating and revoking in one statement -- the WHERE clause *is* the
    // validity check and the UPDATE is the rotation -- closes a replay window:
    // as a separate SELECT then UPDATE, two requests carrying the same refresh
    // token could both pass the check before either revoked it, and both walk
    // away with a fresh token pair. It also drops a round trip off every
    // session restore, which at cross-region latency is the single slowest
    // step of app boot.
    const [row] = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: refreshTokens.userId });

    if (!row) {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN");
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);

    if (!user) {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN");
    }

    return this.generateTokens(user.id, user.email, user.role);
  }

  async logout(token: string): Promise<void> {
    const tokenHash = sha256(token);
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    const matches = user.passwordHash ? await bcrypt.compare(currentPassword, user.passwordHash) : false;
    if (!matches) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));

    // Every session's refresh token is revoked on a password change,
    // including the one making this request -- its short-lived access
    // token keeps working until it naturally expires, then re-login is
    // required everywhere, same as any other device.
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /**
   * Admin-initiated credential change -- unlike changePassword() above, there's
   * no current-password check (the admin already had to clear a permission
   * gate to call this at all). A password change still revokes every one of
   * the target's active sessions, same as a self-service change, so a
   * compromised account doesn't stay logged in elsewhere after the reset.
   */
  async adminUpdateCredentials(
    userId: string,
    updates: { email?: string; password?: string; displayName?: string },
  ): Promise<{ id: string; email: string; displayName: string }> {
    const setValues: { updatedAt: Date; email?: string; displayName?: string; passwordHash?: string } = { updatedAt: new Date() };
    if (updates.email !== undefined) setValues.email = updates.email;
    if (updates.displayName !== undefined) setValues.displayName = updates.displayName;
    if (updates.password !== undefined) setValues.passwordHash = await bcrypt.hash(updates.password, PASSWORD_SALT_ROUNDS);

    const [updated] = await db
      .update(users)
      .set(setValues)
      .where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email, displayName: users.displayName });

    if (!updated) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    if (updates.password !== undefined) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }

    return updated;
  }

  /**
   * Always resolves the same way whether or not the email matches an
   * account -- the route response and timing must not let a caller
   * distinguish "sent" from "no such account", or this becomes an email
   * enumeration oracle. If it does match, an unused token is minted and
   * emailed; nothing else about the response reveals which branch ran.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return;
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MS);

    await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = sha256(token);

    // Same validate-and-consume-in-one-statement shape as refreshTokens
    // above, for the same reason -- closes the replay window where two
    // requests carrying the same token could both pass a separate SELECT
    // check before either marked it used.
    const [row] = await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .returning({ userId: passwordResetTokens.userId });

    if (!row) {
      throw new HttpError(400, "INVALID_TOKEN", "This reset link is invalid or has expired");
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));

    // Same as a self-service password change -- every existing session is
    // signed out, including whatever device the reset link was opened on.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));

    await writeAuditLog({
      actorId: row.userId,
      actorRole: null,
      action: "user_password_reset",
      resourceType: "user",
      resourceId: row.userId,
    });
  }

  private async generateTokens(userId: string, email: string, role: string): Promise<TokenPair> {
    const accessToken = jwt.sign({ sub: userId, email, role }, process.env.JWT_SECRET!, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    const refreshToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

    await db.insert(refreshTokens).values({ userId, tokenHash, expiresAt });

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
