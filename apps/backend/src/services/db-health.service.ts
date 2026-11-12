import { sql } from "drizzle-orm";
import postgres from "postgres";

import { db } from "../db/index.js";

/**
 * Rejects after `ms` if `work` hasn't settled. The losing promise is given a
 * no-op catch so that, if it later rejects, Node doesn't report an unhandled
 * rejection for a result nobody is waiting on any more.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Runs `select 1` through the app's normal connection pool -- the same path
 * every real request takes. This is what tells you whether the API can
 * actually serve requests, as opposed to whether the process is merely up.
 *
 * If the pool is wedged (connections that died silently, so every query queues
 * behind them forever), this is exactly the call that hangs, which is why it
 * carries its own timeout instead of trusting the driver to ever give up.
 */
export async function probePool(timeoutMs = 5_000): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await withTimeout(db.execute(sql`select 1`), timeoutMs);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

/**
 * Opens a brand-new, single connection (bypassing the shared pool entirely),
 * runs `select 1`, and closes it. Succeeding here while probePool() fails is
 * the signature of a wedged pool -- the database is fine, our pooled
 * connections to it are not -- as opposed to the database itself being down.
 */
export async function probeFreshConnection(timeoutMs = 10_000): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  const client = postgres(url, { max: 1, prepare: false, connect_timeout: Math.ceil(timeoutMs / 1000), idle_timeout: 1 });
  try {
    await withTimeout(client`select 1`, timeoutMs);
    return true;
  } catch {
    return false;
  } finally {
    // Don't let a hung close keep us waiting: give it a second, then drop it.
    await client.end({ timeout: 1 }).catch(() => {});
  }
}
