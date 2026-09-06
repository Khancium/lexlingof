// Duolingo-inspired light theme -- signature green primary, sky-blue
// secondary, gold streak/points accent, violet accent. Key names are kept
// identical to the previous (red) theme so most `colors.brand` / `colors.ink`
// usages keep working unchanged; only the values moved.
export const colors = {
  // Brand green -- primary actions, active tab, brand accents.
  brand: '#58CC02',
  brandDark: '#46A302', // bottom-shadow shade for the 3D press button + hover
  brandLight: '#D7FFB8',

  // Sky blue -- selected states, secondary CTAs, links.
  secondary: '#1CB0F6',
  secondaryDark: '#1899D6',
  secondaryLight: '#DDF4FF',

  // Gold -- streak flame / XP / points.
  gold: '#FFC800',
  goldDark: '#E0AC00',

  // Violet accent -- decorative/illustrative use only.
  accent: '#CE82FF',
  accentLight: '#F3E3FF',

  // Backgrounds.
  surface: '#F7F7F7',
  surfaceMuted: '#F0F0F0',
  surfaceCard: '#FFFFFF',

  // Borders.
  border: '#E5E5E5',

  // Text.
  ink: '#3C3C3C',
  inkMuted: '#777777',
  inkInverted: '#FFFFFF',

  // Placeholder text.
  placeholder: '#AFAFAF',

  // Status colors.
  danger: '#FF4B4B',
  dangerDark: '#E63E3E',
  success: '#58CC02',
  warning: '#FFC800',
} as const;

export type Colors = typeof colors;
