// Shared light "Strava-like" theme palette. Import this instead of
// hardcoding hex color strings in component/screen styles.
export const colors = {
  // Brand red -- primary actions, active tab, brand accents.
  brand: '#EF1E4B',
  brandDark: '#C8123A',
  brandLight: '#FBD5DE',

  // Secondary violet accent -- decorative/illustrative use only.
  accent: '#A78BFA',
  accentLight: '#EDE9FE',

  // Backgrounds.
  surface: '#F7F7F8',
  surfaceMuted: '#F3F4F6',
  surfaceCard: '#FFFFFF',

  // Borders.
  border: '#E5E7EB',

  // Text.
  ink: '#111827',
  inkMuted: '#6B7280',
  inkInverted: '#FFFFFF',

  // Placeholder text.
  placeholder: '#9CA3AF',

  // Status colors.
  danger: '#DC2626',
  success: '#059669',
  warning: '#CA8A04',
} as const;

export type Colors = typeof colors;
