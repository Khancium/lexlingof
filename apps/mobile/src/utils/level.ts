import type { ContributorLevel } from '../store/auth.store';

// Mirrors levelForVerifiedCount() in apps/backend/src/modules/reviews/reviews.service.ts --
// not exposed via any API, so kept in sync here.
export const LEVEL_THRESHOLDS: Record<ContributorLevel, number> = {
  BRONZE: 0,
  SILVER: 100,
  GOLD: 500,
  PLATINUM: 1000,
};

export const NEXT_LEVEL: Record<ContributorLevel, ContributorLevel | null> = {
  BRONZE: 'SILVER',
  SILVER: 'GOLD',
  GOLD: 'PLATINUM',
  PLATINUM: null,
};

export const LEVEL_GRADIENT: Record<ContributorLevel, [string, string]> = {
  BRONZE: ['#92400E', '#451A03'],
  SILVER: ['#9CA3AF', '#4B5563'],
  GOLD: ['#FBBF24', '#B45309'],
  PLATINUM: ['#C4B5FD', '#6D28D9'],
};
