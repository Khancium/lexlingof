import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./database/migrations",
  dbCredentials: {
    // Migrations need a direct connection; the pooled URL cannot run DDL.
    url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
