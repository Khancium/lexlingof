import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { probePool } from "../../services/db-health.service.js";

type HealthRoutesOptions = FastifyPluginOptions & {
  /** Overridable so the failure path can be exercised without actually breaking the database. */
  probe?: typeof probePool;
};

/**
 * Readiness check: unlike the bare `/health` liveness route in index.ts (which
 * only proves the process is running), this actually runs a query through the
 * connection pool. During the wedged-pool incident the process stayed up and
 * `/health` stayed green while every real endpoint hung -- an uptime monitor
 * pointed at the liveness route could not have seen it. Point monitors here.
 *
 * Deliberately returns no error detail: this endpoint is unauthenticated.
 */
export default async function healthRoutes(fastify: FastifyInstance, opts: HealthRoutesOptions) {
  const probe = opts.probe ?? probePool;

  fastify.get("/health", async (_request, reply) => {
    const { ok, latencyMs } = await probe(5_000);
    const timestamp = new Date();

    if (!ok) {
      return reply.code(503).send({ status: "degraded", service: "Lexlingo API", db: "unreachable", timestamp });
    }

    return { status: "ok", service: "Lexlingo API", db: "ok", dbLatencyMs: latencyMs, timestamp };
  });
}
