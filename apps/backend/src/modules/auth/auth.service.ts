import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcrypt";
import { and, eq, gt, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";

import { db } from "../../db/index.js";
import { contributorProfiles, refreshTokens, streaks, userStats, users } from "../../db/schema.js";
import { HttpError } from "../../utils/http-error.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
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
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

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
      })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email/password");
    }

    if (user.isSuspended) {
      throw new HttpError(403, "ACCOUNT_SUSPENDED", undefined, { reason: user.suspendedReason });
    }

    const passwordMatches = user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!passwordMatches) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email/password");
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      ...tokens,
    };
  }

  async refreshTokens(token: string): Promise<TokenPair> {
    const tokenHash = sha256(token);

    const [row] = await db
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

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

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));

    return this.generateTokens(user.id, user.email, user.role);
  }

  async logout(token: string): Promise<void> {
    const tokenHash = sha256(token);
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));
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
