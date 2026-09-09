import { create } from "zustand";
import { api, type ContributorLevel } from "./api";

// Level is based on TOTAL contribution count (not verified count). These are
// fallback defaults only, used until the store below finishes loading the
// real values from GET /levels/thresholds, which reads gamification_config
// (levels.silver.min etc.) -- so an admin editing those actually changes
// what's shown here instead of it being a second hardcoded copy a config
// change can never reach.
const DEFAULT_LEVEL_THRESHOLDS: Record<ContributorLevel, number> = {
  BRONZE: 0,
  SILVER: 100,
  GOLD: 500,
  PLATINUM: 1000,
};

type LevelThresholdsState = {
  thresholds: Record<ContributorLevel, number>;
  load: () => Promise<void>;
};

// A store (not a mutated plain object) so components using the hook below
// re-render once the real thresholds arrive, instead of staying stuck on
// whatever was already on screen at first paint.
export const useLevelThresholdsStore = create<LevelThresholdsState>((set) => ({
  thresholds: DEFAULT_LEVEL_THRESHOLDS,
  load: async () => {
    try {
      const thresholds = await api.levels.getThresholds();
      set({ thresholds });
    } catch {
      // Keep the defaults above -- a failed fetch shouldn't break level display.
    }
  },
}));

/** Reactive hook -- use this in components so they re-render when the real thresholds load. */
export function useLevelThresholds(): Record<ContributorLevel, number> {
  return useLevelThresholdsStore((state) => state.thresholds);
}

/** Call once on app load (see (app)/layout.tsx). */
export function loadLevelThresholds(): Promise<void> {
  return useLevelThresholdsStore.getState().load();
}

export const NEXT_LEVEL: Record<ContributorLevel, ContributorLevel | null> = {
  BRONZE: "SILVER",
  SILVER: "GOLD",
  GOLD: "PLATINUM",
  PLATINUM: null,
};

export const LEVEL_COLOR: Record<ContributorLevel, string> = {
  BRONZE: "bg-amber-800",
  SILVER: "bg-slate-400",
  GOLD: "bg-yellow-500",
  PLATINUM: "bg-purple-500",
};

export function canReview(level: ContributorLevel | undefined): boolean {
  return level === "SILVER" || level === "GOLD" || level === "PLATINUM";
}
