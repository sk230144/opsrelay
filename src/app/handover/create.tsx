import { useState } from 'react';
import {
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
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { colors, font, priorityColor, radius, spacing } from '../../theme';
import { Button, Label, Row } from '../../components/ui';
import { PRIORITY_LABEL } from '../../lib/format';
import { listIncidents, upsertHandovers } from '../../db/repo';
import { createHandover } from '../../api/endpoints';
import { isOffline } from '../../api/client';
import { useAuth } from '../../stores/auth';
import type { Handover } from '../../types';

const SHIFTS: Handover['shift'][] = ['morning', 'evening', 'night'];

/** Picks the shift that matches the current time, as a sensible default. */
function currentShift(): Handover['shift'] {
  const h = new Date().getHours();
  if (h < 14) return 'morning';
  if (h < 22) return 'evening';
  return 'night';
}

export default function CreateHandoverScreen() {
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();
  const [shift, setShift] = useState<Handover['shift']>(currentShift);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: incidents = [] } = useQuery({
    queryKey: ['incidents'],
    queryFn: listIncidents,
  });

  const unresolved = incidents.filter((i) => i.status !== 'resolved');
  // Everything open is included by default; the user can trim the list.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(unresolved.map((i) => i.id))
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    const incidentIds = [...selected];
    try {
      const created = await createHandover({ shift, notes: notes.trim(), incidentIds });
      await upsertHandovers([created]);
      await queryClient.invalidateQueries({ queryKey: ['handovers'] });
      router.back();
    } catch (err) {
      if (isOffline(err)) {
        // A handover is a point-in-time summary, so queuing a stale one would
        // mislead the next shift. Ask the user to retry when connected.
        setError('You need a connection to publish a handover. Your notes are kept here.');
      } else {
        setError('Could not publish the handover. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Label>Shift ending</Label>
          <Row gap={8}>
            {SHIFTS.map((s) => {
              const active = shift === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setShift(s)}
                  style={[styles.option, active ? styles.optionActive : null]}
                >
                  <Text style={[styles.optionText, active ? styles.optionTextActive : null]}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </View>

        <View style={styles.field}>
          <Label>
            Open issues to hand over ({selected.size}/{unresolved.length})
          </Label>
          {unresolved.length === 0 ? (
            <Text style={styles.none}>Nothing is open — a clean shift.</Text>
          ) : (
            unresolved.map((i) => {
              const on = selected.has(i.id);
              return (
                <Pressable key={i.id} onPress={() => toggle(i.id)} style={styles.incidentRow}>
                  <MaterialIcons
                    name={on ? 'check-box' : 'check-box-outline-blank'}
                    size={20}
                    color={on ? colors.primary : colors.textFaint}
                  />
                  <View style={[styles.dot, { backgroundColor: priorityColor[i.priority] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.incidentTitle} numberOfLines={1}>
                      {i.title}
                    </Text>
                    <Text style={styles.incidentMeta}>
                      {i.locationCode ?? 'General'} · {PRIORITY_LABEL[i.priority]}
                      {i.assigneeName ? ` · ${i.assigneeName}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.field}>
          <Label>Notes for the next shift</Label>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. Guest in Room 402 requested an update before 9 PM."
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.textarea]}
            multiline
            textAlignVertical="top"
          />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={15} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button
          title="Publish handover"
          onPress={() => void submit()}
          loading={submitting}
          icon="swap-horiz"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing(4), paddingBottom: spacing(12) },
  field: { marginBottom: spacing(5) },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { backgroundColor: `${colors.primary}24`, borderColor: colors.primary },
  optionText: { ...font.small, color: colors.textMuted, fontWeight: '600' },
  optionTextActive: { color: colors.primary, fontWeight: '700' },
  none: { ...font.small, color: colors.textFaint },
  incidentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2.5),
    paddingVertical: spacing(2.5),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  incidentTitle: { ...font.body, color: colors.text, fontWeight: '600' },
  incidentMeta: { ...font.tiny, color: colors.textFaint, fontWeight: '400', marginTop: spacing(0.5) },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
    color: colors.text,
    fontSize: 15,
  },
  textarea: { minHeight: 110, paddingTop: spacing(3.5) },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: `${colors.warning}14`,
    borderWidth: 1,
    borderColor: `${colors.warning}4D`,
    borderRadius: radius.sm,
    padding: spacing(3),
    marginBottom: spacing(3),
  },
  errorText: { ...font.small, color: colors.warning, flex: 1 },
});
