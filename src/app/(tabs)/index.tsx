import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from '../../theme';
import { Card, EmptyState, Row, SectionTitle } from '../../components/ui';
import { IncidentCard } from '../../components/IncidentCard';
import { SyncBanner } from '../../components/SyncBanner';
import {
  useDashboardStats,
  useFilteredIncidents,
  useTicker,
} from '../../hooks/useIncidents';
import { useManualSync } from '../../hooks/useSync';
import { useAuth } from '../../stores/auth';
import { greeting } from '../../lib/format';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const stats = useDashboardStats();
  const { data: open, isLoading } = useFilteredIncidents('open');
  const syncNow = useManualSync();
  const [refreshing, setRefreshing] = useState(false);
  // Single ticker drives every countdown on this screen.
  const now = useTicker();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }, [syncNow]);

  // Needing attention first: criticals, then whatever is closest to breaching.
  const attention = open
    .filter((i) => i.priority === 'critical' || i.priority === 'high')
    .slice(0, 4);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + spacing(4), paddingBottom: spacing(8) },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Row style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.name}>{user?.fullName ?? 'there'}</Text>
        </View>
        <Pressable
          onPress={() => router.push('/scan')}
          style={styles.scanButton}
          accessibilityLabel="Scan a room QR code"
        >
          <MaterialIcons name="qr-code-scanner" size={22} color={colors.primary} />
        </Pressable>
      </Row>

      <SyncBanner />

      <SectionTitle>Today&apos;s Operations</SectionTitle>
      <View style={styles.statGrid}>
        <StatTile
          label="Critical"
          value={stats.critical}
          color={colors.critical}
          onPress={() => router.push('/incidents?filter=critical')}
        />
        <StatTile
          label="Open"
          value={stats.open}
          color={colors.primary}
          onPress={() => router.push('/incidents?filter=open')}
        />
        <StatTile
          label="Assigned to me"
          value={stats.assignedToMe}
          color={colors.warning}
          onPress={() => router.push('/incidents?filter=mine')}
        />
        <StatTile label="Resolved today" value={stats.resolvedToday} color={colors.success} />
      </View>

      <Pressable style={styles.reportCta} onPress={() => router.push('/incident/create')}>
        <MaterialIcons name="add-circle-outline" size={20} color="#FFFFFF" />
        <Text style={styles.reportCtaText}>Report an incident</Text>
      </Pressable>

      <View style={{ marginTop: spacing(7) }}>
        <SectionTitle
          action={
            <Pressable onPress={() => router.push('/incidents?filter=open')}>
              <Text style={styles.link}>View all</Text>
            </Pressable>
          }
        >
          Needs attention
        </SectionTitle>

        {isLoading ? null : attention.length === 0 ? (
          <Card>
            <EmptyState
              icon="check-circle"
              title="Nothing critical right now"
              subtitle="High and critical incidents will appear here as they are reported."
            />
          </Card>
        ) : (
          attention.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              now={now}
              onPress={() => router.push(`/incident/${incident.id}`)}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function StatTile({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value: number;
  color: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.statTile, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: spacing(4) },
  header: { marginBottom: spacing(5) },
  greeting: { ...font.body, color: colors.textMuted },
  name: { ...font.h1, color: colors.text, marginTop: spacing(0.5) },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: `${colors.primary}1F`,
    borderWidth: 1,
    borderColor: `${colors.primary}4D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2.5) },
  statTile: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(4),
  },
  statValue: { fontSize: 30, fontWeight: '700' },
  statLabel: { ...font.small, color: colors.textMuted, marginTop: spacing(1) },
  reportCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing(4),
    marginTop: spacing(4),
  },
  reportCtaText: { ...font.h3, color: '#FFFFFF' },
  link: { ...font.small, color: colors.primary, fontWeight: '600' },
});
