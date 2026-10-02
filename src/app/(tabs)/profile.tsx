import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, spacing } from '../../theme';
import { Avatar, Badge, Button, Card, Divider, Row } from '../../components/ui';
import { initials, relativeTime } from '../../lib/format';
import { useOnline, useSyncStatus } from '../../hooks/useSync';
import { useAuth } from '../../stores/auth';
import { BASE_URL } from '../../api/client';
import { socketConnected } from '../../lib/socket';
import {
  notificationsAvailable,
  pushRequiresDevBuild,
} from '../../lib/notifications';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const status = useSyncStatus();
  const online = useOnline();

  const confirmSignOut = () => {
    // Warn before discarding work that has not reached the server yet.
    const warning =
      status.pending > 0 || status.conflicts > 0
        ? `You have ${status.pending + status.conflicts} unsynced ${
            status.pending + status.conflicts === 1 ? 'change' : 'changes'
          }. Signing out will discard them.`
        : 'You will need to sign in again to see operations data.';

    Alert.alert('Sign out?', warning, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + spacing(3), paddingBottom: spacing(10) },
      ]}
    >
      <Text style={styles.title}>Profile</Text>

      <Card style={styles.identity}>
        <Row gap={14}>
          <Avatar initials={initials(user?.fullName ?? '?')} size={54} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.fullName ?? 'Unknown'}</Text>
            <Text style={styles.email}>{user?.email ?? ''}</Text>
            <Row gap={6} style={{ marginTop: spacing(2) }}>
              <Badge label={(user?.role ?? 'staff').toUpperCase()} color={colors.primary} />
              {user?.department ? (
                <Badge label={user.department} color={colors.textMuted} />
              ) : null}
            </Row>
          </View>
        </Row>
      </Card>

      <Card style={{ marginBottom: spacing(4) }}>
        <Text style={styles.sectionHead}>Connection</Text>
        <Divider />

        <StatusLine
          label="Network"
          value={online ? 'Online' : 'Offline'}
          color={online ? colors.success : colors.offline}
          icon={online ? 'wifi' : 'wifi-off'}
        />
        <StatusLine
          label="Real-time channel"
          value={socketConnected() ? 'Connected' : 'Disconnected'}
          color={socketConnected() ? colors.success : colors.textFaint}
          icon="bolt"
        />
        <StatusLine
          label="Notifications"
          value={
            notificationsAvailable()
              ? 'Available'
              : pushRequiresDevBuild()
                ? 'Needs dev build'
                : 'Unavailable'
          }
          color={notificationsAvailable() ? colors.success : colors.textFaint}
          icon="notifications-active"
        />
        <StatusLine
          label="Queued changes"
          value={String(status.pending)}
          color={status.pending > 0 ? colors.warning : colors.textMuted}
          icon="cloud-upload"
        />
        <StatusLine
          label="Conflicts"
          value={String(status.conflicts)}
          color={status.conflicts > 0 ? colors.critical : colors.textMuted}
          icon="merge-type"
          onPress={status.conflicts > 0 ? () => router.push('/conflicts') : undefined}
        />
        <StatusLine
          label="Last synced"
          value={status.lastSyncedAt ? relativeTime(status.lastSyncedAt) : 'never'}
          color={colors.textMuted}
          icon="history"
        />
        <StatusLine label="API" value={BASE_URL} color={colors.textFaint} icon="dns" />
      </Card>

      <Button title="Sign out" variant="danger" icon="logout" onPress={confirmSignOut} />
    </ScrollView>
  );
}

function StatusLine({
  label,
  value,
  color,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  color: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.statusLine, pressed && onPress ? { opacity: 0.6 } : null]}
    >
      <MaterialIcons name={icon} size={16} color={colors.textFaint} />
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={[styles.statusValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      {onPress ? (
        <MaterialIcons name="chevron-right" size={16} color={colors.textFaint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: spacing(4) },
  title: { ...font.h1, color: colors.text, marginBottom: spacing(4) },
  identity: { marginBottom: spacing(4) },
  name: { ...font.h2, color: colors.text },
  email: { ...font.small, color: colors.textMuted, marginTop: spacing(0.5) },
  sectionHead: {
    ...font.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2.5),
    paddingVertical: spacing(2.5),
  },
  statusLabel: { ...font.small, color: colors.textMuted, flex: 1 },
  statusValue: { ...font.small, fontWeight: '600', maxWidth: 170, textAlign: 'right' },
});
