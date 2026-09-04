import type { ContributorLevel } from "./api";

// Mirrors levelForVerifiedCount() in apps/backend/src/modules/reviews/reviews.service.ts --
// not exposed via any API, so kept in sync here (same values used in the mobile app).
export const LEVEL_THRESHOLDS: Record<ContributorLevel, number> = {
  BRONZE: 0,
  SILVER: 100,
  GOLD: 500,
  PLATINUM: 1000,
};

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
  return level === "GOLD" || level === "PLATINUM";
}
