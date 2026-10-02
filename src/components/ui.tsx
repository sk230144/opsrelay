import { MaterialIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, font, radius, spacing } from '../theme';

/** Shared primitives. Kept in one file so spacing and radii stay consistent. */

export function Card({
  children,
  style,
  onPress,
  accent,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Left edge stripe, used to carry priority colour on incident cards. */
  accent?: string;
}) {
  const body = (
    <View style={[styles.card, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {body}
    </Pressable>
  );
}

export function Badge({
  label,
  color = colors.primary,
  filled = false,
  icon,
}: {
  label: string;
  color?: string;
  filled?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
}) {
  return (
    <View
      style={[
        styles.badge,
        filled
          ? { backgroundColor: color }
          : { backgroundColor: `${color}1F`, borderColor: `${color}66`, borderWidth: 1 },
      ]}
    >
      {icon ? (
        <MaterialIcons
          name={icon}
          size={11}
          color={filled ? '#07101F' : color}
          style={{ marginRight: 3 }}
        />
      ) : null}
      <Text
        style={[
          styles.badgeText,
          { color: filled ? '#07101F' : color },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const palette: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: '#FFFFFF' },
    secondary: { bg: colors.surfaceAlt, fg: colors.text, border: colors.border },
    danger: { bg: colors.danger, fg: '#FFFFFF' },
    ghost: { bg: 'transparent', fg: colors.textMuted },
  };
  const p = palette[variant];
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      disabled={inert}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.bg },
        p.border ? { borderWidth: 1, borderColor: p.border } : null,
        inert ? { opacity: 0.5 } : null,
        pressed && !inert ? { opacity: 0.85 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : (
        <>
          {icon ? (
            <MaterialIcons name={icon} size={17} color={p.fg} style={{ marginRight: 6 }} />
          ) : null}
          <Text style={[styles.buttonText, { color: p.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Pill({
  label,
  active,
  onPress,
  color = colors.primary,
  count,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
  count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active
          ? { backgroundColor: color, borderColor: color }
          : { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.pillText,
          { color: active ? '#FFFFFF' : colors.textMuted },
        ]}
      >
        {label}
        {count !== undefined ? ` ${count}` : ''}
      </Text>
    </Pressable>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  subtitle,
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MaterialIcons name={icon} size={28} color={colors.textFaint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Avatar({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

export function Row({
  children,
  gap = 8,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function PressableRow({
  children,
  ...props
}: PressableProps & { children: ReactNode }) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [styles.pressableRow, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(3.5),
  },
  pressed: { opacity: 0.7 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing(3.5),
    paddingHorizontal: spacing(4),
    borderRadius: radius.md,
    minHeight: 48,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  pill: {
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2),
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(2.5),
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  empty: { alignItems: 'center', paddingVertical: spacing(12), paddingHorizontal: spacing(6) },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(3),
  },
  emptyTitle: { ...font.h3, color: colors.text, textAlign: 'center' },
  emptySubtitle: {
    ...font.small,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing(1.5),
    lineHeight: 19,
  },
  avatar: {
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing(3) },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing(1.5),
  },
  pressableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(3),
  },
});
