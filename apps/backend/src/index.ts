import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";

import authRoutes from "./modules/auth/auth.routes.js";
import deviceRoutes from "./modules/notifications/device.routes.js";
import { HttpError } from "./utils/http-error.js";

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

server.setErrorHandler((err, _request, reply) => {
  if (err instanceof HttpError) {
    reply.code(err.statusCode).send({ code: err.code, message: err.message, ...err.details });
    return;
  }

  if (err instanceof ZodError) {
    reply.code(400).send({ code: "VALIDATION_ERROR", issues: err.issues });
    return;
  }

  server.log.error(err);
  reply.code(500).send({ code: "INTERNAL_ERROR", message: "Something went wrong" });
});

await server.register(authRoutes, { prefix: "/api/v1/auth" });
await server.register(deviceRoutes, { prefix: "/api/v1" });

server.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
