import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { HttpError } from "./http-error.js";

/**
 * The API's single error handler (registered in index.ts). Lives here, rather
 * than inline in index.ts, so it can be exercised without starting the server.
 */
export function handleError(err: unknown, request: FastifyRequest, reply: FastifyReply): void {
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

  // Anything that reaches here with a 5xx is an unexpected failure whose
  // message came from a library or the database driver -- SQL text and
  // parameters, hostnames, connection errors. That's logged above in full; the
  // client only gets a generic answer in production. (4xx messages -- Fastify's
  // own body/payload errors and the like -- are meant for the caller and stay.)
  const hideDetail = isProduction && statusCode >= 500;
  const code = hideDetail
    ? "INTERNAL_ERROR"
    : typeof errObj.code === "string"
      ? errObj.code
      : statusCode === 500
        ? "INTERNAL_ERROR"
        : "BAD_REQUEST";
  const message = hideDetail ? "Something went wrong" : err instanceof Error ? err.message : "Something went wrong";

  reply.code(statusCode).send({ code, message, requestId: request.id, timestamp, ...stack });
}
