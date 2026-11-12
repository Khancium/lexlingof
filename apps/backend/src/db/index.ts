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
//
// The timeouts below are seconds (postgres.js units). Without them a pool whose
// connections died silently -- e.g. after a pooler restart -- never recovers:
// postgres.js defaults to keeping idle connections forever and waiting up to
// 30s per connect attempt, which is exactly the client's own 30s timeout, so
// callers just saw "timeout of 30000ms exceeded" with no server-side error.
//   connect_timeout 10  -- fail a connect attempt fast, with a real error.
//   idle_timeout    60  -- close connections idle for a minute. Idle ones are
//                          the ones that go stale; recycling them means the
//                          next query opens a fresh connection instead of
//                          reusing a dead one. Kept well above a few seconds
//                          on purpose: this deployment is cross-region, so
//                          every reconnect costs ~1-2s of latency.
//   max_lifetime  1200  -- retire any connection after 20 minutes regardless.
// A pool that is wedged anyway is detected and restarted by
// services/db-watchdog.service.ts.
const queryClient = postgres(process.env.DATABASE_URL!, {
  max: 10,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 60,
  max_lifetime: 60 * 20,
});

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
