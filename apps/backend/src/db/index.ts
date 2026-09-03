import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

const queryClient = postgres(process.env.DATABASE_URL!, { max: 10 });

export const db = drizzle(queryClient, { schema });

export type Db = typeof db;

export {
  sql,
  eq,
  and,
  or,
  desc,
  asc,
  isNull,
  isNotNull,
  gt,
  lt,
  gte,
  lte,
  ne,
  inArray,
  notInArray,
  count,
  sum,
  avg,
} from "drizzle-orm";

export * from "./schema.js";
