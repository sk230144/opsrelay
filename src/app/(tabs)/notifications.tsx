import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from '../../theme';
import { EmptyState, Row } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { listNotifications, markAllNotificationsRead } from '../../db/repo';
import { markNotificationsRead } from '../../api/endpoints';
import { onNotificationPush } from '../../lib/socket';
import { useManualSync } from '../../hooks/useSync';
import type { Notification } from '../../types';

const ICON: Record<Notification['kind'], keyof typeof MaterialIcons.glyphMap> = {
  assigned: 'assignment-ind',
  critical: 'priority-high',
  overdue: 'schedule',
  review: 'rate-review',
  handover: 'swap-horiz',
};

const TINT: Record<Notification['kind'], string> = {
  assigned: colors.primary,
  critical: colors.critical,
  overdue: colors.warning,
  review: colors.offline,
  handover: colors.success,
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const syncNow = useManualSync();
  const [refreshing, setRefreshing] = useState(false);

  const { data = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
  });

  // A live push should appear without the user pulling to refresh.
  useEffect(() => {
    return onNotificationPush(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [queryClient]);

  const unread = data.filter((n) => !n.readAt).length;

  const markRead = useCallback(async () => {
    await markAllNotificationsRead();
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    try {
      await markNotificationsRead();
    } catch {
      // Local read state is enough; the server catches up on the next sync.
    }
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }, [syncNow]);

  return (
    <View style={[styles.flex, { paddingTop: insets.top + spacing(3) }]}>
      <Row style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        {unread > 0 ? (
          <Pressable onPress={() => void markRead()} hitSlop={8}>
            <Text style={styles.markRead}>Mark all read</Text>
          </Pressable>
        ) : null}
      </Row>

      <FlatList
        data={data}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              item.incidentId ? router.push(`/incident/${item.incidentId}`) : undefined
            }
            style={({ pressed }) => [
              styles.row,
              !item.readAt ? styles.rowUnread : null,
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <View style={[styles.icon, { backgroundColor: `${TINT[item.kind]}24` }]}>
              <MaterialIcons name={ICON[item.kind]} size={17} color={TINT[item.kind]} />
            </View>
            <View style={{ flex: 1 }}>
              <Row gap={6}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {!item.readAt ? <View style={styles.unreadDot} /> : null}
              </Row>
              <Text style={styles.rowBody} numberOfLines={2}>
                {item.body}
              </Text>
              <Text style={styles.rowTime}>{relativeTime(item.createdAt)}</Text>
            </View>
            {item.incidentId ? (
              <MaterialIcons name="chevron-right" size={18} color={colors.textFaint} />
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-none"
            title="No alerts"
            subtitle="Assignments, critical reports and SLA breaches show up here."
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing(4), marginBottom: spacing(4) },
  title: { ...font.h1, color: colors.text, flex: 1 },
  markRead: { ...font.small, color: colors.primary, fontWeight: '600' },
  list: { paddingHorizontal: spacing(4), paddingBottom: spacing(8) },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3.5),
    marginBottom: spacing(2.5),
  },
  rowUnread: { borderColor: `${colors.primary}4D`, backgroundColor: `${colors.primary}0A` },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { ...font.body, color: colors.text, fontWeight: '700', flexShrink: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  rowBody: { ...font.small, color: colors.textMuted, marginTop: spacing(1), lineHeight: 19 },
  rowTime: { ...font.tiny, color: colors.textFaint, fontWeight: '400', marginTop: spacing(1.5) },
});
