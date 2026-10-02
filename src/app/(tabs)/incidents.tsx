import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from '../../theme';
import { EmptyState, Pill, Row } from '../../components/ui';
import { IncidentCard } from '../../components/IncidentCard';
import { SyncBanner } from '../../components/SyncBanner';
import {
  useDashboardStats,
  useFilteredIncidents,
  useTicker,
  type IncidentFilter,
} from '../../hooks/useIncidents';
import { useManualSync } from '../../hooks/useSync';

const FILTERS: { key: IncidentFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'critical', label: 'Critical' },
];

/** Narrows an untrusted route param to a known filter. */
function asFilter(value: string | undefined): IncidentFilter | null {
  return value === 'open' || value === 'mine' || value === 'critical' ? value : null;
}

export default function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();
  const fromParam = asFilter(params.filter);
  /**
   * The filter is derived rather than synced in an effect (which would setState
   * on every navigation and cascade a render). A tap stores an override keyed to
   * the param it was made against, so arriving fresh from a dashboard tile
   * supersedes the previous tap instead of being ignored.
   */
  const [override, setOverride] = useState<{
    key: string | undefined;
    value: IncidentFilter;
  } | null>(null);
  const filter =
    override && override.key === params.filter ? override.value : (fromParam ?? 'open');
  const { data, isLoading } = useFilteredIncidents(filter);
  const stats = useDashboardStats();
  const syncNow = useManualSync();
  const [refreshing, setRefreshing] = useState(false);
  const now = useTicker();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }, [syncNow]);

  const countFor = (key: IncidentFilter) =>
    key === 'open' ? stats.open : key === 'mine' ? stats.assignedToMe : stats.critical;

  return (
    <View style={[styles.flex, { paddingTop: insets.top + spacing(3) }]}>
      <Row style={styles.header}>
        <Text style={styles.title}>Incidents</Text>
        <Pressable
          onPress={() => router.push('/incident/create')}
          style={styles.addButton}
          accessibilityLabel="Report an incident"
        >
          <MaterialIcons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </Row>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pill
            key={f.key}
            label={f.label}
            count={countFor(f.key)}
            active={filter === f.key}
            onPress={() => setOverride({ key: params.filter, value: f.key })}
            color={f.key === 'critical' ? colors.critical : colors.primary}
          />
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<SyncBanner />}
        renderItem={({ item }) => (
          <IncidentCard
            incident={item}
            now={now}
            onPress={() => router.push(`/incident/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon={filter === 'critical' ? 'check-circle' : 'inbox'}
              title={
                filter === 'mine'
                  ? 'Nothing assigned to you'
                  : filter === 'critical'
                    ? 'No critical incidents'
                    : 'No open incidents'
              }
              subtitle="Pull down to refresh, or report a new incident."
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        // Keeps long lists smooth on low-end Android devices.
        removeClippedSubviews
        initialNumToRender={8}
        windowSize={11}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing(4),
    marginBottom: spacing(4),
  },
  title: { ...font.h1, color: colors.text, flex: 1 },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing(2),
    paddingHorizontal: spacing(4),
    marginBottom: spacing(4),
    flexWrap: 'wrap',
  },
  list: { paddingHorizontal: spacing(4), paddingBottom: spacing(8) },
});
