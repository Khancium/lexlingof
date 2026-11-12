/**
 * Validation for edits to `gamification_config` (PUT /superadmin/gamification/:key).
 *
 * The route only checked "is it a number", so a super_admin could save a negative or
 * fractional point value (the `points_transactions.points` column is an integer, so the
 * next submission to read it would fail), or set the level thresholds out of order
 * (silver above gold), which makes the level logic nonsensical.
 *
 * Returns a message when the value is unacceptable, or null when it's fine.
 */
export type LevelThresholds = { SILVER: number; GOLD: number; PLATINUM: number };

const LEVEL_KEY_TO_LEVEL = {
  "levels.silver.min": "SILVER",
  "levels.gold.min": "GOLD",
  "levels.platinum.min": "PLATINUM",
} as const;

const MAX_CONFIG_VALUE = 2_000_000_000; // fits a Postgres integer; also covers modules.audio.max_file_bytes (100 MB)

export function validateConfigValue(key: string, value: number, currentLevels?: LevelThresholds): string | null {
  if (!Number.isFinite(value)) return "The value must be a finite number";

  // Points, level thresholds and module limits are all whole, non-negative numbers.
  if (key.startsWith("points.") || key.startsWith("levels.") || key.startsWith("modules.")) {
    if (!Number.isInteger(value)) return "The value must be a whole number";
    if (value < 0) return "The value can't be negative";
    if (value > MAX_CONFIG_VALUE) return `The value can't exceed ${MAX_CONFIG_VALUE}`;
  }

  // Level thresholds must stay strictly increasing: silver < gold < platinum.
  const level = LEVEL_KEY_TO_LEVEL[key as keyof typeof LEVEL_KEY_TO_LEVEL];
  if (level && currentLevels) {
    const next: LevelThresholds = { ...currentLevels, [level]: value };
    if (!(next.SILVER > 0)) return "The SILVER threshold must be greater than 0";
    if (!(next.SILVER < next.GOLD)) return "The SILVER threshold must be lower than the GOLD threshold";
    if (!(next.GOLD < next.PLATINUM)) return "The GOLD threshold must be lower than the PLATINUM threshold";
  }

  return null;
}
