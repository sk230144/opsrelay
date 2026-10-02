import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, priorityColor, radius, spacing } from '../../theme';
import { Badge, Button, Card, EmptyState, Row, SectionTitle } from '../../components/ui';
import { SyncBanner } from '../../components/SyncBanner';
import { relativeTime } from '../../lib/format';
import { listHandovers, listIncidents } from '../../db/repo';
import { queueAcknowledgeHandover } from '../../lib/sync';
import { useManualSync } from '../../hooks/useSync';
import { useAuth } from '../../stores/auth';
import type { Handover, Incident } from '../../types';

export default function HandoverScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();
  const syncNow = useManualSync();
  const [refreshing, setRefreshing] = useState(false);

  const { data: handovers = [] } = useQuery({
    queryKey: ['handovers'],
    queryFn: listHandovers,
  });
  const { data: incidents = [] } = useQuery({
    queryKey: ['incidents'],
    queryFn: listIncidents,
  });

  const unresolved = incidents.filter((i) => i.status !== 'resolved');
  const latest = handovers[0];
  // Only the receiving shift acknowledges, and only once.
  const needsAck = latest && !latest.acknowledgedAt && latest.fromUserId !== user?.id;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }, [syncNow]);

  const acknowledge = async (id: string) => {
    await queueAcknowledgeHandover(id);
    await queryClient.invalidateQueries({ queryKey: ['handovers'] });
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + spacing(3), paddingBottom: spacing(10) },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Row style={{ marginBottom: spacing(4) }}>
        <Text style={styles.title}>Shift Handover</Text>
        <Pressable
          onPress={() => router.push('/handover/create')}
          style={styles.addButton}
          accessibilityLabel="Create handover"
        >
          <MaterialIcons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </Row>

      <SyncBanner />

      {/* What would be handed over right now */}
      <Card style={styles.summary}>
        <Text style={styles.summaryHead}>Open at this moment</Text>
        <Text style={styles.summaryCount}>
          {unresolved.length} unresolved {unresolved.length === 1 ? 'issue' : 'issues'}
        </Text>

        {unresolved.slice(0, 5).map((i) => (
          <HandoverLine key={i.id} incident={i} />
        ))}

        {unresolved.length > 5 ? (
          <Text style={styles.more}>+{unresolved.length - 5} more</Text>
        ) : null}

        <Button
          title="Create handover"
          icon="swap-horiz"
          onPress={() => router.push('/handover/create')}
          style={{ marginTop: spacing(4) }}
        />
      </Card>

      {needsAck && latest ? (
        <Card style={styles.ackCard}>
          <Row gap={6} style={{ marginBottom: spacing(2) }}>
            <MaterialIcons name="priority-high" size={16} color={colors.warning} />
            <Text style={styles.ackTitle}>Handover waiting for you</Text>
          </Row>
          <Text style={styles.ackBody}>
            {latest.fromUserName} handed over the {latest.shift} shift{' '}
            {relativeTime(latest.createdAt)}.
          </Text>
          <Button
            title="Acknowledge handover"
            onPress={() => void acknowledge(latest.id)}
            style={{ marginTop: spacing(3) }}
          />
        </Card>
      ) : null}

      <SectionTitle>History</SectionTitle>
      {handovers.length === 0 ? (
        <Card>
          <EmptyState
            icon="swap-horiz"
            title="No handovers yet"
            subtitle="Create one at the end of your shift to pass open work to the next team."
          />
        </Card>
      ) : (
        handovers.map((h) => <HandoverCard key={h.id} handover={h} />)
      )}
    </ScrollView>
  );
}

function HandoverLine({ incident }: { incident: Incident }) {
  return (
    <Row gap={8} style={styles.line}>
      <View style={[styles.dot, { backgroundColor: priorityColor[incident.priority] }]} />
      <Text style={styles.lineText} numberOfLines={1}>
        <Text style={styles.lineLocation}>
          {incident.locationCode ?? incident.locationName ?? 'General'}
        </Text>
        {'  '}
        {incident.title}
      </Text>
    </Row>
  );
}

function HandoverCard({ handover }: { handover: Handover }) {
  return (
    <Card style={{ marginBottom: spacing(2.5) }}>
      <Row style={{ marginBottom: spacing(2) }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shift}>{handover.shift} shift</Text>
          <Text style={styles.from}>
            {handover.fromUserName}
            {handover.toUserName ? ` → ${handover.toUserName}` : ''}
          </Text>
        </View>
        <Badge
          label={handover.acknowledgedAt ? 'Acknowledged' : 'Pending'}
          color={handover.acknowledgedAt ? colors.success : colors.warning}
        />
      </Row>

      <Row gap={6} style={{ marginBottom: handover.notes ? spacing(2.5) : 0 }}>
        <MaterialIcons name="assignment" size={13} color={colors.textFaint} />
        <Text style={styles.meta}>
          {handover.incidentIds.length}{' '}
          {handover.incidentIds.length === 1 ? 'incident' : 'incidents'} ·{' '}
          {relativeTime(handover.createdAt)}
        </Text>
      </Row>

      {handover.notes ? <Text style={styles.notes}>{handover.notes}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: spacing(4) },
  title: { ...font.h1, color: colors.text, flex: 1 },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { marginBottom: spacing(4) },
  summaryHead: {
    ...font.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryCount: { ...font.h2, color: colors.text, marginTop: spacing(1.5), marginBottom: spacing(3) },
  line: { marginBottom: spacing(2) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lineText: { ...font.small, color: colors.textMuted, flex: 1 },
  lineLocation: { color: colors.text, fontWeight: '700' },
  more: { ...font.small, color: colors.textFaint, marginTop: spacing(1) },
  ackCard: {
    marginBottom: spacing(5),
    backgroundColor: `${colors.warning}0F`,
    borderColor: `${colors.warning}4D`,
  },
  ackTitle: { ...font.h3, color: colors.text },
  ackBody: { ...font.body, color: colors.textMuted, lineHeight: 21 },
  shift: {
    ...font.h3,
    color: colors.text,
    textTransform: 'capitalize',
  },
  from: { ...font.small, color: colors.textMuted, marginTop: spacing(0.5) },
  meta: { ...font.small, color: colors.textFaint },
  notes: {
    ...font.small,
    color: colors.textMuted,
    lineHeight: 19,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing(3),
  },
});
