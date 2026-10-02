import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { colors, font, radius, spacing } from '../theme';
import { Button, Card, EmptyState, Row } from '../components/ui';
import { PRIORITY_LABEL, STATUS_LABEL } from '../lib/format';
import { useConflicts, type ConflictEntry } from '../hooks/useSync';
import type { IncidentPriority, IncidentStatus } from '../types';

/**
 * Conflict resolution.
 *
 * Reached when a queued edit was built on a version the server has since moved
 * past. Both sides are shown field by field, and the user chooses - the app
 * never silently picks a winner, because either choice can lose real work.
 */
export default function ConflictsScreen() {
  const { entries, loading, keepServer, applyMine } = useConflicts();

  if (loading) {
    return <View style={styles.flex} />;
  }

  if (entries.length === 0) {
    return (
      <View style={styles.flex}>
        <EmptyState
          icon="check-circle"
          title="No conflicts"
          subtitle="Every change you made has synced cleanly."
        />
        <View style={{ paddingHorizontal: spacing(4) }}>
          <Button title="Done" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <View style={styles.intro}>
        <MaterialIcons name="merge-type" size={20} color={colors.critical} />
        <Text style={styles.introText}>
          Someone else changed{' '}
          {entries.length === 1 ? 'this incident' : 'these incidents'} while your edit was
          waiting to sync. Choose which version to keep.
        </Text>
      </View>

      {entries.map((entry) => (
        <ConflictCard
          key={entry.outboxId}
          entry={entry}
          onKeepServer={() => void keepServer(entry)}
          onUseMine={() => void applyMine(entry)}
        />
      ))}
    </ScrollView>
  );
}

function ConflictCard({
  entry,
  onKeepServer,
  onUseMine,
}: {
  entry: ConflictEntry;
  onKeepServer: () => void;
  onUseMine: () => void;
}) {
  const { conflict, incidentTitle } = entry;
  const fields = Object.keys(conflict.localChange);

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{incidentTitle}</Text>
      <Row gap={6} style={{ marginBottom: spacing(4) }}>
        <Text style={styles.version}>Your base v{conflict.localVersion}</Text>
        <MaterialIcons name="arrow-forward" size={13} color={colors.textFaint} />
        <Text style={[styles.version, { color: colors.critical }]}>
          Server v{conflict.serverVersion}
        </Text>
      </Row>

      <View style={styles.compare}>
        <View style={[styles.side, styles.serverSide]}>
          <Row gap={5} style={{ marginBottom: spacing(2.5) }}>
            <MaterialIcons name="cloud" size={13} color={colors.textMuted} />
            <Text style={styles.sideLabel}>Server</Text>
          </Row>
          {fields.map((f) => (
            <View key={f} style={styles.fieldRow}>
              <Text style={styles.fieldName}>{fieldLabel(f)}</Text>
              <Text style={styles.fieldValue}>{formatValue(f, conflict.serverChange[f])}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.side, styles.mineSide]}>
          <Row gap={5} style={{ marginBottom: spacing(2.5) }}>
            <MaterialIcons name="smartphone" size={13} color={colors.primary} />
            <Text style={[styles.sideLabel, { color: colors.primary }]}>Your change</Text>
          </Row>
          {fields.map((f) => (
            <View key={f} style={styles.fieldRow}>
              <Text style={styles.fieldName}>{fieldLabel(f)}</Text>
              <Text style={[styles.fieldValue, { color: colors.primary }]}>
                {formatValue(f, conflict.localChange[f])}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title="Keep Server Version"
          variant="secondary"
          onPress={onKeepServer}
          style={{ flex: 1 }}
        />
        <Button title="Use My Version" onPress={onUseMine} style={{ flex: 1 }} />
      </View>
      <Text style={styles.note}>
        Keeping the server version discards your queued edit. Using yours re-applies it on top
        of v{conflict.serverVersion}.
      </Text>
    </Card>
  );
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'status':
      return 'Status';
    case 'priority':
      return 'Priority';
    case 'assigneeId':
      return 'Assigned';
    default:
      return field;
  }
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value);
  if (field === 'status') {
    return STATUS_LABEL[raw as IncidentStatus] ?? raw;
  }
  if (field === 'priority') {
    return PRIORITY_LABEL[raw as IncidentPriority] ?? raw;
  }
  return raw;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing(4), paddingBottom: spacing(10) },
  intro: {
    flexDirection: 'row',
    gap: spacing(2.5),
    backgroundColor: `${colors.critical}14`,
    borderWidth: 1,
    borderColor: `${colors.critical}4D`,
    borderRadius: radius.sm,
    padding: spacing(3.5),
    marginBottom: spacing(5),
  },
  introText: { ...font.small, color: colors.text, flex: 1, lineHeight: 19 },
  card: { marginBottom: spacing(4) },
  title: { ...font.h3, color: colors.text, marginBottom: spacing(2) },
  version: { ...font.tiny, color: colors.textMuted, letterSpacing: 0.4 },
  compare: { flexDirection: 'row', gap: spacing(2.5) },
  side: {
    flex: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing(3),
  },
  serverSide: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  mineSide: { backgroundColor: `${colors.primary}0F`, borderColor: `${colors.primary}4D` },
  sideLabel: {
    ...font.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  fieldRow: { marginBottom: spacing(2) },
  fieldName: { ...font.tiny, color: colors.textFaint, fontWeight: '400' },
  fieldValue: { ...font.body, color: colors.text, fontWeight: '600', marginTop: spacing(0.5) },
  actions: { flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(4) },
  note: {
    ...font.tiny,
    color: colors.textFaint,
    fontWeight: '400',
    marginTop: spacing(3),
    lineHeight: 16,
  },
});
