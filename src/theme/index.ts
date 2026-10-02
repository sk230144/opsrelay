/** Design tokens. Dark-first, because ops staff use this on dim floors at night. */

export const colors = {
  bg: '#0B1220',
  surface: '#141C2E',
  surfaceAlt: '#1C2639',
  border: '#27334A',
  text: '#F2F5FA',
  textMuted: '#93A1BA',
  textFaint: '#64748B',

  primary: '#3B82F6',
  primaryDim: '#1D4ED8',

  critical: '#F43F5E',
  high: '#FB923C',
  medium: '#FACC15',
  low: '#34D399',

  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  offline: '#A855F7',
} as const;

export const priorityColor = {
  critical: colors.critical,
  high: colors.high,
  medium: colors.medium,
  low: colors.low,
} as const;

export const statusColor = {
  reported: colors.textMuted,
  assigned: colors.primary,
  in_progress: colors.warning,
  review: colors.offline,
  resolved: colors.success,
} as const;

export const spacing = (n: number) => n * 4;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  h1: { fontSize: 28, fontWeight: '700' },
  h2: { fontSize: 22, fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  small: { fontSize: 13, fontWeight: '400' },
  tiny: { fontSize: 11, fontWeight: '600' },
} as const;
