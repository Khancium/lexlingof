import type { FastifyReply, FastifyRequest } from "fastify";

import { db } from "../db/index.js";
import { featureFlags } from "../db/schema.js";

/**
 * Feature flags live in the `feature_flags` table and an admin can switch them in the admin UI, but
 * until now nothing in the backend read them -- flipping one did nothing at all. These are the ones
 * that are now enforced.
 *
 * Deliberately NOT enforced: `push_notifications_enabled` (seeded OFF although push notifications
 * work, so honouring it would silently switch off something that is running today),
 * `data_exports_enabled` (the export feature isn't built), and `offline_mode_enabled` (a client-side
 * setting). `rollout_percent` is not used either -- a flag is on or off for everyone.
 */
export type FeatureFlagKey =
  | "module_1_enabled"
  | "module_2_enabled"
  | "module_3_enabled"
  | "module_4_enabled"
  | "community_review_enabled"
  | "leaderboard_enabled"
  | "public_profiles_enabled";

const LABELS: Record<FeatureFlagKey, string> = {
  module_1_enabled: "Word recording",
  module_2_enabled: "Audio upload",
  module_3_enabled: "Sentence translation",
  module_4_enabled: "Scene description",
  community_review_enabled: "Community review",
  leaderboard_enabled: "The leaderboard",
  public_profiles_enabled: "Public profiles",
};

// Short, so a switch made in the admin UI takes effect quickly even if the instance that served the
// toggle isn't the one answering the request; the toggle routes also clear it immediately.
const CACHE_TTL_MS = 30_000;

let cache: { flags: Map<string, boolean>; expiresAt: number } | null = null;
let inflight: Promise<Map<string, boolean>> | null = null;

async function loadFlags(): Promise<Map<string, boolean>> {
  if (cache && cache.expiresAt > Date.now()) return cache.flags;
  // One query at a time even if many requests arrive while the cache is cold.
  if (!inflight) {
    inflight = db
      .select({ flagKey: featureFlags.flagKey, isEnabled: featureFlags.isEnabled })
      .from(featureFlags)
      .then((rows) => {
        const flags = new Map(rows.map((r) => [r.flagKey, r.isEnabled]));
        cache = { flags, expiresAt: Date.now() + CACHE_TTL_MS };
        return flags;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Whether a feature is on. A flag with no row counts as ON, and so does any failure to read the
 * table (the last known value is used if there is one): a hiccup reading a flag must never be what
 * switches a feature off, and must not add a new way for requests to fail.
 */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  try {
    const flags = await loadFlags();
    return flags.get(key) ?? true;
  } catch (err) {
    console.error(`[feature-flags] could not read flags, treating ${key} as ${cache?.flags.get(key) ?? true}:`, err);
    return cache?.flags.get(key) ?? true;
  }
}

/** Call after a flag is changed so the next request sees it instead of waiting out the TTL. */
export function invalidateFeatureFlagCache(): void {
  cache = null;
}

/** A route preHandler: 403 FEATURE_DISABLED while the flag is off. */
export function requireFeature(key: FeatureFlagKey) {
  return async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (await isFeatureEnabled(key)) return;
    reply.code(403).send({ code: "FEATURE_DISABLED", feature: key, message: `${LABELS[key] ?? key} is switched off at the moment.` });
  };
}

/** Shorthand for the four contribution modules. */
export const requireModule = (n: 1 | 2 | 3 | 4) => requireFeature(`module_${n}_enabled`);
