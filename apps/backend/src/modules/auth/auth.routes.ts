import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";
import { authService } from "./auth.service.js";

const registerSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(8),
  // Fetched from GET /terms immediately before this call -- see auth.service.ts
  // for why the server re-validates this against the current version rather
  // than trusting the client's checkbox alone.
  termsVersion: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

// Tighter than the global per-IP rate limit (index.ts) -- these are the
// brute-force/credential-stuffing/account-enumeration surface, so each gets
// its own much lower ceiling regardless of the global one.
const authAttemptLimit = { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } };

// The refresh token lives in an httpOnly cookie, never in a response body or
// anywhere JS on the frontend can read it -- the one thing an XSS in the
// frontend can no longer do is exfiltrate a long-lived session token. Scoped
// to this route's own prefix since nothing outside auth.routes.ts ever needs
// to read it, so it isn't sent as header bloat on every other API call.
const REFRESH_COOKIE_NAME = "lexlingo_refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";
const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // kept in sync with REFRESH_TOKEN_EXPIRY_MS in auth.service.ts
const isProduction = process.env.NODE_ENV === "production";

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    // Secure+SameSite=None is required for the cookie to survive a
    // cross-origin request (the web app and this API are on different
    // domains in production) -- but a Secure cookie is rejected outright by
    // browsers over plain http, which local dev always is, so this falls
    // back to Lax (still sent on the same-site localhost:3000 -> :3001 case)
    // without Secure there instead of silently never setting the cookie.
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/register", authAttemptLimit, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    // The signup form only collects email/password -- the real name is
    // collected right after, on the onboarding form (fullName), which also
    // updates this. Default to the email's local part so there's always a
    // sane display name in the meantime.
    const displayName = body.email.split("@")[0]!;
    const { refreshToken, ...result } = await authService.register(body.email, body.password, displayName, body.termsVersion);
    setRefreshCookie(reply, refreshToken);
    reply.code(201).send(result);
  });

  fastify.post("/login", authAttemptLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const { refreshToken, ...result } = await authService.login(body.email, body.password);
    setRefreshCookie(reply, refreshToken);
    reply.code(200).send(result);
  });

  fastify.post("/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN");
    }
    const { refreshToken, ...result } = await authService.refreshTokens(token);
    setRefreshCookie(reply, refreshToken);
    reply.code(200).send(result);
  });

  fastify.post("/logout", { preHandler: verifyToken }, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (token) {
      await authService.logout(token);
    }
    clearRefreshCookie(reply);
    reply.code(200).send({ success: true });
  });

  fastify.post("/change-password", { preHandler: verifyToken }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    await authService.changePassword(request.user!.id, body.currentPassword, body.newPassword);
    reply.code(200).send({ success: true });
  });

  // Always the same response whether or not the email matches an account --
  // see the service-level comment on requestPasswordReset for why.
  fastify.post("/forgot-password", authAttemptLimit, async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    await authService.requestPasswordReset(body.email);
    reply.code(200).send({ success: true, message: "If an account exists for this email, a reset link has been sent." });
  });

  fastify.post("/reset-password", authAttemptLimit, async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    await authService.resetPassword(body.token, body.newPassword);
    reply.code(200).send({ success: true });
  });
}
