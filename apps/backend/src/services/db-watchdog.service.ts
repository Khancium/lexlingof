import { probeFreshConnection, probePool } from "./db-health.service.js";

/**
 * Self-heal for a wedged database connection pool.
 *
 * What it guards against (seen in production): the process stays up and
 * answers /health, but every query hangs forever -- the pool's connections
 * died silently (e.g. after a pooler restart) and new queries just queue
 * behind them. Nothing recovers that on its own; it took a manual restart.
 *
 * Each tick probes the pool. After `failureThreshold` consecutive failures it
 * tries a brand-new connection to tell the two failure modes apart:
 *
 *   - fresh connection works  -> the database is fine, our pool is wedged.
 *                                Exit; Railway restarts the process, which
 *                                builds a new pool.
 *   - fresh connection fails  -> the database itself is unreachable. Do NOT
 *                                exit: a restart can't fix that, and exiting
 *                                repeatedly would burn through Railway's
 *                                restart retries and leave the service
 *                                crashed even after the database comes back.
 *
 * Restarting is safe for in-flight submissions: the submission-buffer worker
 * resets rows stuck in "processing" back to "pending" at every startup.
 */

export type WatchdogOutcome = "ok" | "failing" | "db-down" | "wedged";

export type WatchdogDeps = {
  probePool: () => Promise<boolean>;
  probeFresh: () => Promise<boolean>;
  onWedged: () => void;
  warn?: (message: string) => void;
  failureThreshold?: number;
};

export function createDbWatchdog(deps: WatchdogDeps) {
  const threshold = deps.failureThreshold ?? 3;
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let consecutiveFailures = 0;

  return {
    async tick(): Promise<WatchdogOutcome> {
      if (await deps.probePool()) {
        if (consecutiveFailures > 0) warn(`[db-watchdog] pool recovered after ${consecutiveFailures} failed probe(s)`);
        consecutiveFailures = 0;
        return "ok";
      }

      consecutiveFailures += 1;
      if (consecutiveFailures < threshold) {
        warn(`[db-watchdog] pool probe failed (${consecutiveFailures}/${threshold})`);
        return "failing";
      }

      if (await deps.probeFresh()) {
        deps.onWedged();
        return "wedged";
      }

      warn("[db-watchdog] pool probe failing and a fresh connection also fails -- database unreachable, not restarting");
      return "db-down";
    },
  };
}

const PROBE_INTERVAL_MS = 30_000;
const POOL_PROBE_TIMEOUT_MS = 10_000;

/** Starts the production watchdog. Call once, after the server is listening. */
export function startDbWatchdog(): void {
  const watchdog = createDbWatchdog({
    probePool: async () => (await probePool(POOL_PROBE_TIMEOUT_MS)).ok,
    probeFresh: () => probeFreshConnection(),
    onWedged: () => {
      console.error("[db-watchdog] connection pool is wedged (database reachable, pooled queries hang) -- exiting so the platform restarts the process");
      process.exit(1);
    },
  });

  // Never let two ticks overlap: a slow probe must not stack more probes
  // behind it, which would itself add load to an already struggling pool.
  let running = false;
  // This project's tsconfig types setInterval's return as a bare number (DOM
  // lib), but at runtime it's a Node Timeout; unref() so the watchdog alone
  // never keeps the process alive.
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    watchdog
      .tick()
      .catch((err) => console.error("[db-watchdog] tick failed", err))
      .finally(() => {
        running = false;
      });
  }, PROBE_INTERVAL_MS) as unknown as { unref?: () => void };
  timer.unref?.();
}
