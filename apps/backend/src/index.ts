import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

server.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
