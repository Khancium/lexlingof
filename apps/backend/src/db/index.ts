import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

// prepare: false is required against Supabase's port-6543 pooler (Supavisor,
// transaction-pooling mode): each statement in a multi-statement transaction
// can land on a different physical backend connection, so a server-side
// prepared statement from one round trip may silently miss on the next --
// postgres.js's default (prepare: true) hit exactly this, causing
// multi-statement transactions to occasionally report success while a
// later statement in the same transaction never actually persisted.
const queryClient = postgres(process.env.DATABASE_URL!, { max: 10, prepare: false });

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
