import type { ContributorLevel } from '../store/auth.store';

// Mirrors LEVEL_THRESHOLDS in apps/backend/src/services/level.service.ts --
// level is based on TOTAL contribution count (not verified count), not
// exposed via any API, so kept in sync here.
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
