import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';
import { useManualSync, useOnline, useSyncStatus } from '../hooks/useSync';

/**
 * The "3 changes waiting to sync" indicator.
 *
 * Deliberately always visible when there is anything to say - the whole point
 * of the offline design is that the user is never guessing whether their work
 * has actually left the device. Conflicts take priority over queue depth,
 * because those need action rather than patience.
 */
export function SyncBanner() {
  const status = useSyncStatus();
  const online = useOnline();
  const syncNow = useManualSync();

  if (status.conflicts > 0) {
    return (
      <Pressable
        onPress={() => router.push('/conflicts')}
        style={[styles.banner, styles.conflict]}
      >
        <MaterialIcons name="merge-type" size={16} color={colors.critical} />
        <Text style={[styles.text, { color: colors.critical }]}>
          {status.conflicts === 1
            ? '1 conflict needs your decision'
            : `${status.conflicts} conflicts need your decision`}
        </Text>
        <MaterialIcons name="chevron-right" size={18} color={colors.critical} />
      </Pressable>
    );
  }

  if (!online) {
    return (
      <View style={[styles.banner, styles.offline]}>
        <MaterialIcons name="cloud-off" size={16} color={colors.offline} />
        <Text style={[styles.text, { color: colors.offline }]}>
          Offline
          {status.pending > 0
            ? ` — ${status.pending} ${status.pending === 1 ? 'change' : 'changes'} queued`
            : ' — work is saved on this device'}
        </Text>
      </View>
    );
  }

  if (status.state === 'syncing' && status.pending > 0) {
    return (
      <View style={[styles.banner, styles.syncing]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.text, { color: colors.primary }]}>
          Syncing {status.pending} {status.pending === 1 ? 'change' : 'changes'}…
        </Text>
      </View>
    );
  }

  if (status.pending > 0) {
    return (
      <Pressable onPress={() => void syncNow()} style={[styles.banner, styles.syncing]}>
        <MaterialIcons name="sync" size={16} color={colors.primary} />
        <Text style={[styles.text, { color: colors.primary }]}>
          {status.pending} {status.pending === 1 ? 'change' : 'changes'} waiting to sync
        </Text>
        <Text style={styles.action}>Sync now</Text>
      </Pressable>
    );
  }

  if (status.state === 'error' && status.lastError) {
    return (
      <Pressable onPress={() => void syncNow()} style={[styles.banner, styles.conflict]}>
        <MaterialIcons name="error-outline" size={16} color={colors.warning} />
        <Text style={[styles.text, { color: colors.warning }]} numberOfLines={1}>
          {status.lastError}
        </Text>
        <Text style={[styles.action, { color: colors.warning }]}>Retry</Text>
      </Pressable>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2.5),
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing(3),
  },
  offline: { backgroundColor: `${colors.offline}14`, borderColor: `${colors.offline}4D` },
  syncing: { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}4D` },
  conflict: { backgroundColor: `${colors.critical}14`, borderColor: `${colors.critical}4D` },
  text: { ...font.small, fontWeight: '600', flex: 1 },
  action: { ...font.small, color: colors.primary, fontWeight: '700' },
});
