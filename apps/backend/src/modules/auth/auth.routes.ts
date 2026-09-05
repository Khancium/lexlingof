import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { verifyToken } from "../../middleware/auth.js";
import { authService } from "./auth.service.js";

const registerSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    // The signup form only collects email/password -- the real name is
    // collected right after, on the onboarding form (fullName), which also
    // updates this. Default to the email's local part so there's always a
    // sane display name in the meantime.
    const displayName = body.email.split("@")[0]!;
    const result = await authService.register(body.email, body.password, displayName);
    reply.code(201).send(result);
  });

  fastify.post("/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login(body.email, body.password);
    reply.code(200).send(result);
  });

  fastify.post("/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const result = await authService.refreshTokens(body.refreshToken);
    reply.code(200).send(result);
  });

  fastify.post("/logout", { preHandler: verifyToken }, async (request, reply) => {
    const body = logoutSchema.parse(request.body);
    await authService.logout(body.refreshToken);
    reply.code(200).send({ success: true });
  });

  fastify.post("/change-password", { preHandler: verifyToken }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    await authService.changePassword(request.user!.id, body.currentPassword, body.newPassword);
    reply.code(200).send({ success: true });
  });
}
