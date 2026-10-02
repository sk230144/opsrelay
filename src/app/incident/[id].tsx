import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { colors, font, priorityColor, radius, spacing, statusColor } from '../../theme';
import { Avatar, Badge, Button, Card, Divider, Label, Row } from '../../components/ui';
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  countdown,
  initials,
  relativeTime,
  slaRemaining,
  slaWindowLabel,
} from '../../lib/format';
import { useIncident, useRefreshIncidents, useTicker } from '../../hooks/useIncidents';
import { queueComment, queueUpdateIncident } from '../../lib/sync';
import { useAuth } from '../../stores/auth';
import { fetchStaff } from '../../api/endpoints';
import { STATUS_FLOW, type IncidentStatus, type User } from '../../types';

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: incident, isLoading } = useIncident(id);
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const refresh = useRefreshIncidents();
  // Re-renders once a second so the SLA countdown below advances. The value
  // itself is unused: slaRemaining/countdown read the clock directly.
  useTicker();
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Staff list is only needed when the user can actually assign.
  const { data: staff = [] } = useQuery({
    queryKey: ['staff'],
    queryFn: fetchStaff,
    enabled: can('assign_incident'),
    staleTime: 300_000,
  });

  if (isLoading) {
    return <View style={styles.flex} />;
  }

  if (!incident) {
    return (
      <View style={[styles.flex, styles.center]}>
        <Text style={styles.missing}>This incident is no longer available.</Text>
        <Button title="Go back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const sla = slaRemaining(incident.slaDueAt);
  const isResolved = incident.status === 'resolved';
  const currentStep = STATUS_FLOW.indexOf(incident.status);
  const nextStatus: IncidentStatus | null =
    currentStep >= 0 && currentStep < STATUS_FLOW.length - 1
      ? STATUS_FLOW[currentStep + 1]
      : null;

  /** Resolving is gated by role; earlier transitions are open to all staff. */
  const canAdvance =
    nextStatus !== null && (nextStatus !== 'resolved' || can('resolve_incident'));

  const advance = async () => {
    if (!nextStatus || !incident) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await queueUpdateIncident(incident.id, { status: nextStatus }, incident.version);
    await refresh();
  };

  const assign = async (assignee: User) => {
    if (!incident) return;
    setAssigning(false);
    await queueUpdateIncident(
      incident.id,
      {
        assigneeId: assignee.id,
        // Moving straight to "assigned" matches what staff expect on assignment.
        ...(incident.status === 'reported' ? { status: 'assigned' as const } : {}),
      },
      incident.version,
      assignee.fullName
    );
    await refresh();
  };

  const postComment = async () => {
    const body = comment.trim();
    if (!body || !user || !incident) return;
    setPosting(true);
    try {
      await queueComment(incident.id, body, user);
      setComment('');
      await refresh();
    } finally {
      setPosting(false);
    }
  };

  const confirmAssign = () => {
    if (!staff.length) {
      Alert.alert('No staff available', 'Staff could not be loaded while offline.');
      return;
    }
    setAssigning(true);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {incident.pending || incident.dirty ? (
          <View style={styles.pendingNote}>
            <MaterialIcons name="cloud-off" size={15} color={colors.offline} />
            <Text style={styles.pendingNoteText}>
              {incident.pending
                ? 'This incident exists only on this device until it syncs.'
                : 'An edit is queued and will sync when you are back online.'}
            </Text>
          </View>
        ) : null}

        <Row gap={6} style={{ marginBottom: spacing(2) }}>
          <Badge
            label={PRIORITY_LABEL[incident.priority]}
            color={priorityColor[incident.priority]}
            filled={incident.priority === 'critical'}
          />
          <Badge label={STATUS_LABEL[incident.status]} color={statusColor[incident.status]} />
          {incident.escalated ? (
            <Badge label="ESCALATED" color={colors.critical} icon="trending-up" />
          ) : null}
        </Row>

        <Text style={styles.title}>{incident.title}</Text>

        <Pressable
          onPress={() =>
            incident.locationCode ? router.push(`/location/${incident.locationCode}`) : undefined
          }
          disabled={!incident.locationCode}
        >
          <Row gap={5} style={styles.locationRow}>
            <MaterialIcons name="place" size={15} color={colors.textMuted} />
            <Text style={styles.location}>
              {incident.locationName ?? incident.locationCode ?? 'No location'}
            </Text>
            {incident.locationCode ? (
              <MaterialIcons name="chevron-right" size={16} color={colors.textFaint} />
            ) : null}
          </Row>
        </Pressable>

        {/* SLA timer */}
        {!isResolved && incident.slaDueAt ? (
          <Card
            style={[
              styles.slaCard,
              sla?.overdue ? { borderColor: `${colors.critical}80` } : null,
            ]}
          >
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.slaLabel}>
                  {sla?.overdue ? 'Overdue by' : 'Remaining'}
                </Text>
                <Text
                  style={[
                    styles.slaTime,
                    sla?.overdue ? { color: colors.critical } : null,
                  ]}
                >
                  {countdown(incident.slaDueAt)}
                </Text>
              </View>
              <View style={styles.slaTarget}>
                <Text style={styles.slaTargetLabel}>Target</Text>
                <Text style={styles.slaTargetValue}>
                  {slaWindowLabel(incident.priority)}
                </Text>
              </View>
            </Row>
            {sla?.overdue && !incident.escalated ? (
              <Text style={styles.slaWarn}>
                Past its SLA — this escalates to the supervisor automatically.
              </Text>
            ) : null}
          </Card>
        ) : null}

        <Card style={{ marginTop: spacing(3) }}>
          <Label>Description</Label>
          <Text style={styles.description}>
            {incident.description || 'No description provided.'}
          </Text>

          <Divider />

          <Row style={styles.metaRow}>
            <View style={{ flex: 1 }}>
              <Label>Category</Label>
              <Text style={styles.metaValue}>{CATEGORY_LABEL[incident.category]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Label>Reported</Label>
              <Text style={styles.metaValue}>{relativeTime(incident.createdAt)}</Text>
            </View>
          </Row>

          <Row style={styles.metaRow}>
            <View style={{ flex: 1 }}>
              <Label>Reported by</Label>
              <Text style={styles.metaValue}>{incident.reporterName}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Label>Assigned to</Label>
              <Text style={styles.metaValue}>
                {incident.assigneeName ?? 'Unassigned'}
              </Text>
            </View>
          </Row>
        </Card>

        {incident.attachments?.length ? (
          <View style={{ marginTop: spacing(3) }}>
            <Label>Photos</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Row gap={8}>
                {incident.attachments.map((a) => (
                  <View key={a.id}>
                    <Image source={{ uri: a.uri }} style={styles.photo} />
                    {!a.uploaded ? (
                      <View style={styles.photoPending}>
                        <MaterialIcons name="cloud-off" size={11} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                ))}
              </Row>
            </ScrollView>
          </View>
        ) : null}

        {/* Status flow */}
        <View style={{ marginTop: spacing(5) }}>
          <Label>Status flow</Label>
          <Row gap={0} style={styles.flow}>
            {STATUS_FLOW.map((s, idx) => {
              const done = idx <= currentStep;
              return (
                <View key={s} style={styles.flowItem}>
                  <View
                    style={[
                      styles.flowDot,
                      done ? { backgroundColor: statusColor[s] } : null,
                    ]}
                  />
                  {idx < STATUS_FLOW.length - 1 ? (
                    <View
                      style={[
                        styles.flowLine,
                        idx < currentStep ? { backgroundColor: statusColor[s] } : null,
                      ]}
                    />
                  ) : null}
                  <Text style={[styles.flowLabel, done ? { color: colors.text } : null]}>
                    {STATUS_LABEL[s]}
                  </Text>
                </View>
              );
            })}
          </Row>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {canAdvance && nextStatus ? (
            <Button
              title={`Move to ${STATUS_LABEL[nextStatus]}`}
              onPress={advance}
              icon="arrow-forward"
            />
          ) : null}
          {can('assign_incident') && !isResolved ? (
            <Button
              title={incident.assigneeName ? 'Reassign' : 'Assign to staff'}
              variant="secondary"
              icon="person-add"
              onPress={confirmAssign}
            />
          ) : null}
        </View>

        {assigning ? (
          <Card style={{ marginTop: spacing(3) }}>
            <Label>Assign to</Label>
            {staff.map((s) => (
              <Pressable key={s.id} onPress={() => void assign(s)} style={styles.staffRow}>
                <Avatar initials={initials(s.fullName)} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.staffName}>{s.fullName}</Text>
                  <Text style={styles.staffRole}>
                    {s.role}
                    {s.department ? ` · ${s.department}` : ''}
                  </Text>
                </View>
                {incident.assigneeId === s.id ? (
                  <MaterialIcons name="check" size={18} color={colors.success} />
                ) : null}
              </Pressable>
            ))}
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setAssigning(false)}
              style={{ marginTop: spacing(1) }}
            />
          </Card>
        ) : null}

        {/* Comments */}
        <View style={{ marginTop: spacing(6) }}>
          <Label>
            Notes {incident.comments?.length ? `(${incident.comments.length})` : ''}
          </Label>

          {incident.comments?.length ? (
            incident.comments.map((c) => (
              <View key={c.id} style={styles.comment}>
                <Avatar initials={initials(c.authorName)} size={30} />
                <View style={{ flex: 1 }}>
                  <Row gap={6}>
                    <Text style={styles.commentAuthor}>{c.authorName}</Text>
                    <Text style={styles.commentTime}>{relativeTime(c.createdAt)}</Text>
                    {c.synced === false ? (
                      <MaterialIcons name="cloud-off" size={11} color={colors.offline} />
                    ) : null}
                  </Row>
                  <Text style={styles.commentBody}>{c.body}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noComments}>No notes yet.</Text>
          )}

          <Row gap={8} style={styles.commentInputRow}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Add a note…"
              placeholderTextColor={colors.textFaint}
              style={styles.commentInput}
              multiline
            />
            <Pressable
              onPress={() => void postComment()}
              disabled={!comment.trim() || posting}
              style={[
                styles.sendButton,
                !comment.trim() || posting ? { opacity: 0.4 } : null,
              ]}
              accessibilityLabel="Post note"
            >
              <MaterialIcons name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </Row>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing(4) },
  missing: { ...font.body, color: colors.textMuted },
  container: { padding: spacing(4), paddingBottom: spacing(10) },
  pendingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: `${colors.offline}14`,
    borderWidth: 1,
    borderColor: `${colors.offline}4D`,
    borderRadius: radius.sm,
    padding: spacing(3),
    marginBottom: spacing(4),
  },
  pendingNoteText: { ...font.small, color: colors.offline, flex: 1 },
  title: { ...font.h1, color: colors.text, lineHeight: 34, marginBottom: spacing(2) },
  locationRow: { marginBottom: spacing(4) },
  location: { ...font.small, color: colors.textMuted, fontWeight: '600' },
  slaCard: { backgroundColor: colors.surfaceAlt },
  slaLabel: {
    ...font.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  slaTime: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginTop: spacing(1),
  },
  slaTarget: { alignItems: 'flex-end' },
  slaTargetLabel: { ...font.tiny, color: colors.textFaint, textTransform: 'uppercase' },
  slaTargetValue: { ...font.h3, color: colors.textMuted, marginTop: spacing(1) },
  slaWarn: { ...font.small, color: colors.critical, marginTop: spacing(3) },
  description: { ...font.body, color: colors.text, lineHeight: 22 },
  metaRow: { marginBottom: spacing(3), gap: spacing(3) },
  metaValue: { ...font.body, color: colors.text, fontWeight: '600' },
  photo: { width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  photoPending: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: colors.offline,
    borderRadius: 9,
    padding: 3,
  },
  flow: { marginTop: spacing(2) },
  flowItem: { flex: 1, alignItems: 'flex-start' },
  flowDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  flowLine: {
    position: 'absolute',
    left: 11,
    top: 5,
    right: 0,
    height: 2,
    backgroundColor: colors.border,
  },
  flowLabel: {
    ...font.tiny,
    color: colors.textFaint,
    marginTop: spacing(2),
    fontWeight: '600',
  },
  actions: { gap: spacing(2.5), marginTop: spacing(6) },
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingVertical: spacing(2.5),
  },
  staffName: { ...font.body, color: colors.text, fontWeight: '600' },
  staffRole: { ...font.small, color: colors.textFaint, textTransform: 'capitalize' },
  comment: {
    flexDirection: 'row',
    gap: spacing(3),
    marginTop: spacing(3),
  },
  commentAuthor: { ...font.small, color: colors.text, fontWeight: '700' },
  commentTime: { ...font.tiny, color: colors.textFaint, fontWeight: '400' },
  commentBody: { ...font.body, color: colors.textMuted, marginTop: spacing(1), lineHeight: 21 },
  noComments: { ...font.small, color: colors.textFaint, marginTop: spacing(2) },
  commentInputRow: { marginTop: spacing(4), alignItems: 'flex-end' },
  commentInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(3),
    color: colors.text,
    fontSize: 15,
    maxHeight: 110,
    minHeight: 46,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
