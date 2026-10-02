import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, priorityColor, spacing, statusColor } from '../theme';
import {
  CATEGORY_ICON,
  PRIORITY_LABEL,
  STATUS_LABEL,
  relativeTime,
  slaRemaining,
} from '../lib/format';
import type { Incident } from '../types';
import { Badge, Card, Row } from './ui';

/**
 * One incident in a list. Shows the SLA countdown, and marks rows that exist
 * only locally or carry an unsynced edit so staff can tell what the server has
 * actually seen.
 */
export function IncidentCard({
  incident,
  onPress,
}: {
  incident: Incident;
  onPress: () => void;
  /**
   * Changes once a second from the parent's single `useTicker`, which is what
   * re-renders this card so the SLA label below advances. It is intentionally
   * not read: slaRemaining() reads the clock itself.
   */
  now?: number;
}) {
  const sla = slaRemaining(incident.slaDueAt);
  const unsynced = incident.pending || incident.dirty;
  const isResolved = incident.status === 'resolved';

  return (
    <Card onPress={onPress} accent={priorityColor[incident.priority]} style={styles.card}>
      <Row style={styles.header}>
        <Row gap={6} style={{ flex: 1 }}>
          <MaterialIcons
            name={CATEGORY_ICON[incident.category] as keyof typeof MaterialIcons.glyphMap}
            size={14}
            color={colors.textFaint}
          />
          <Text style={styles.location} numberOfLines={1}>
            {incident.locationName ?? incident.locationCode ?? 'Unassigned location'}
          </Text>
        </Row>
        <Badge
          label={PRIORITY_LABEL[incident.priority]}
          color={priorityColor[incident.priority]}
          filled={incident.priority === 'critical'}
        />
      </Row>

      <Text style={styles.title} numberOfLines={2}>
        {incident.title}
      </Text>

      <Row style={styles.footer} gap={6}>
        <Badge label={STATUS_LABEL[incident.status]} color={statusColor[incident.status]} />

        {incident.assigneeName ? (
          <Row gap={3}>
            <MaterialIcons name="person" size={12} color={colors.textFaint} />
            <Text style={styles.meta} numberOfLines={1}>
              {incident.assigneeName}
            </Text>
          </Row>
        ) : null}

        <View style={{ flex: 1 }} />

        {!isResolved && sla ? (
          <Row gap={3}>
            <MaterialIcons
              name={sla.overdue ? 'warning' : 'schedule'}
              size={12}
              color={sla.overdue ? colors.critical : colors.textFaint}
            />
            <Text style={[styles.meta, sla.overdue ? styles.overdue : null]}>{sla.label}</Text>
          </Row>
        ) : (
          <Text style={styles.meta}>{relativeTime(incident.createdAt)}</Text>
        )}
      </Row>

      {(unsynced || incident.escalated) && (
        <Row gap={6} style={styles.flags}>
          {incident.pending ? (
            <Badge label="NOT YET SYNCED" color={colors.offline} icon="cloud-off" />
          ) : incident.dirty ? (
            <Badge label="EDIT QUEUED" color={colors.offline} icon="sync" />
          ) : null}
          {incident.escalated ? (
            <Badge label="ESCALATED" color={colors.critical} icon="trending-up" />
          ) : null}
        </Row>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing(2.5) },
  header: { marginBottom: spacing(2) },
  location: {
    ...font.tiny,
    color: colors.textFaint,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  title: { ...font.h3, color: colors.text, marginBottom: spacing(2.5), lineHeight: 22 },
  footer: {},
  meta: { ...font.small, color: colors.textFaint, maxWidth: 110 },
  overdue: { color: colors.critical, fontWeight: '700' },
  flags: {
    marginTop: spacing(2.5),
    paddingTop: spacing(2.5),
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
