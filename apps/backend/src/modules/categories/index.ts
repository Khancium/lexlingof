import type { FastifyInstance } from "fastify";

import categoriesRoutes from "./categories.routes.js";
import conceptsRoutes from "./concepts.routes.js";

export default async function categoriesModule(fastify: FastifyInstance) {
  await fastify.register(categoriesRoutes);
  await fastify.register(conceptsRoutes);
}
