// 1. Load dotenv at the very top.
import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";

import audioRoutes from "./modules/audio/audio.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import categoriesModule from "./modules/categories/index.js";
import languagesRoutes from "./modules/languages/languages.routes.js";
import deviceRoutes from "./modules/notifications/device.routes.js";
import notificationsRoutes from "./modules/notifications/notifications.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import audioUploadRoutes from "./modules/contributions/audio/audio-upload.routes.js";
import sceneRoutes from "./modules/contributions/scene/scene.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import gamificationRoutes from "./modules/gamification/gamification.routes.js";
import reviewsRoutes from "./modules/reviews/reviews.routes.js";
import translationRoutes from "./modules/contributions/translation/translation.routes.js";
import wordRoutes from "./modules/contributions/word/word.routes.js";
import { HttpError } from "./utils/http-error.js";

// 2. Create the Fastify instance.
const server = Fastify({ logger: true });

// 3. CORS.
server.register(cors, {
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

// 4. Multipart, registered once at the top level so every route (admin
// concept/scene image uploads included) shares this same configuration.
server.register(multipart, { limits: { fileSize: 110 * 1024 * 1024 } });

// 5. Every request gets its id echoed back so a client can correlate a
// response (or a support request) with the corresponding server log line.
server.addHook("onSend", async (request, reply, payload) => {
  reply.header("x-request-id", request.id);
  return payload;
});

server.setErrorHandler((err, request, reply) => {
  const isProduction = process.env.NODE_ENV === "production";
  const timestamp = new Date().toISOString();
  // NEVER expose error.stack in production.
  const stack = !isProduction && err instanceof Error && err.stack ? { stack: err.stack } : {};

  request.log.error({ err, reqId: request.id }, err instanceof Error ? err.message : "Unhandled error");

  if (err instanceof HttpError) {
    reply
      .code(err.statusCode)
      .send({ code: err.code, message: err.message, ...err.details, requestId: request.id, timestamp, ...stack });
    return;
  }

  if (err instanceof ZodError) {
    reply
      .code(400)
      .send({ code: "VALIDATION_ERROR", message: "Validation failed", issues: err.issues, requestId: request.id, timestamp, ...stack });
    return;
  }

  // Any other error (Fastify's own body-parsing/payload errors included)
  // uses its own statusCode when present, else 500.
  const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const statusCode = typeof errObj.statusCode === "number" ? errObj.statusCode : 500;
  const code = typeof errObj.code === "string" ? errObj.code : statusCode === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
  const message = err instanceof Error ? err.message : "Something went wrong";

  reply.code(statusCode).send({ code, message, requestId: request.id, timestamp, ...stack });
});

// Route modules are namespaced under /api/v1. Most are mounted at the bare
// /api/v1 root because their own internal paths already self-namespace
// (e.g. word.routes.ts defines "/contributions/word", gamification.routes.ts
// defines "/leaderboard"). auth, users, the raw audio-file module, the
// Module 2 audio-upload module, scenes, reviews, and notifications were
// each built assuming their own sub-prefix (e.g. audio-upload.routes.ts
// defines bare "/" and "/:id" for its own resource) -- mounting every
// module at bare /api/v1 would collide those bare "/:id"-style paths
// against each other and break the API, so those six keep their prefix.
await server.register(authRoutes, { prefix: "/api/v1/auth" });
await server.register(deviceRoutes, { prefix: "/api/v1" });
await server.register(usersRoutes, { prefix: "/api/v1/users" });
await server.register(languagesRoutes, { prefix: "/api/v1" });
await server.register(categoriesModule, { prefix: "/api/v1" });
await server.register(audioRoutes, { prefix: "/api/v1/audio" });
await server.register(wordRoutes, { prefix: "/api/v1" });
await server.register(audioUploadRoutes, { prefix: "/api/v1/contributions/audio" });
await server.register(translationRoutes, { prefix: "/api/v1" });
await server.register(sceneRoutes, { prefix: "/api/v1/scenes" });
await server.register(reviewsRoutes, { prefix: "/api/v1/reviews" });
await server.register(gamificationRoutes, { prefix: "/api/v1" });
await server.register(notificationsRoutes, { prefix: "/api/v1/notifications" });
// adminRoutes already covers both /api/v1/admin/* and /api/v1/superadmin/*
// internally (there is no separate superAdminRoutes module).
await server.register(adminRoutes, { prefix: "/api/v1" });

// Health checks. The versioned one is what was asked for; the bare one is
// kept too since it's what infra (load balancers, Railway, etc.) commonly
// probes by default and nothing asked to remove it.
server.get("/health", async () => ({ status: "ok" }));
server.get("/api/v1/health", async () => ({ status: "ok", service: "Lexlingo API", timestamp: new Date() }));

// 6. Start the server -- host 0.0.0.0 is required for Railway deployment.
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
  server.log.info(`Lexlingo API running on port ${port}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
