import { useState } from 'react';
import {
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
import * as ImagePicker from 'expo-image-picker';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { colors, font, priorityColor, radius, spacing } from '../../theme';
import { Button, Label, Row } from '../../components/ui';
import { CATEGORY_LABEL, PRIORITY_LABEL, slaWindowLabel } from '../../lib/format';
import { slaDueFor, useRefreshIncidents } from '../../hooks/useIncidents';
import { queueCreateIncident } from '../../lib/sync';
import { useOnline } from '../../hooks/useSync';
import { useAuth } from '../../stores/auth';
import type { IncidentCategory, IncidentPriority } from '../../types';

const CATEGORIES: IncidentCategory[] = [
  'maintenance',
  'housekeeping',
  'guest_request',
  'safety',
];
const PRIORITIES: IncidentPriority[] = ['low', 'medium', 'high', 'critical'];

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(4, 'Give the issue a short, clear title')
    .max(120, 'Keep the title under 120 characters'),
  description: z.string().trim().max(1000, 'Description is too long'),
  category: z.enum(['maintenance', 'housekeeping', 'guest_request', 'safety']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  locationCode: z.string().trim().max(40).nullable(),
});

type FormValues = z.infer<typeof schema>;

export default function CreateIncidentScreen() {
  // A code arrives here when the user reached this screen from the QR scanner.
  const params = useLocalSearchParams<{ code?: string }>();
  const user = useAuth((s) => s.user);
  const online = useOnline();
  const refresh = useRefreshIncidents();
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      category: 'maintenance',
      priority: 'medium',
      locationCode: params.code ?? null,
    },
    mode: 'onBlur',
  });

  const priority = watch('priority');

  const addPhoto = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.6,
          mediaTypes: ['images'],
        });

    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri].slice(0, 4));
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSubmitting(true);
    try {
      // Queued locally first, so this works identically with no network.
      const created = await queueCreateIncident(
        {
          title: values.title.trim(),
          description: values.description.trim(),
          category: values.category,
          priority: values.priority,
          locationCode: values.locationCode?.trim().toUpperCase() || null,
          assigneeId: null,
          photoUris: photos,
        },
        user,
        slaDueFor(values.priority)
      );
      await refresh();
      // Replace so the back button returns to the list, not this form.
      router.replace(`/incident/${created.id}`);
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
        {!online ? (
          <View style={styles.offlineNote}>
            <MaterialIcons name="cloud-off" size={15} color={colors.offline} />
            <Text style={styles.offlineNoteText}>
              You are offline. This report is saved on the device and syncs automatically.
            </Text>
          </View>
        ) : null}

        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <View style={styles.field}>
              <Label>What is the problem?</Label>
              <TextInput
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="e.g. AC not cooling in Room 402"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, fieldState.error ? styles.inputError : null]}
                autoFocus
              />
              {fieldState.error ? (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              ) : null}
            </View>
          )}
        />

        <Controller
          control={control}
          name="locationCode"
          render={({ field }) => (
            <View style={styles.field}>
              <Label>Location code</Label>
              <Row gap={8}>
                <TextInput
                  value={field.value ?? ''}
                  onChangeText={(t) => field.onChange(t || null)}
                  placeholder="ROOM-402"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="characters"
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable
                  onPress={() => router.push('/scan')}
                  style={styles.scanInline}
                  accessibilityLabel="Scan QR code"
                >
                  <MaterialIcons name="qr-code-scanner" size={20} color={colors.primary} />
                </Pressable>
              </Row>
            </View>
          )}
        />

        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <View style={styles.field}>
              <Label>Category</Label>
              <View style={styles.optionGrid}>
                {CATEGORIES.map((c) => {
                  const active = field.value === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => field.onChange(c)}
                      style={[styles.option, active ? styles.optionActive : null]}
                    >
                      <Text style={[styles.optionText, active ? styles.optionTextActive : null]}>
                        {CATEGORY_LABEL[c]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />

        <Controller
          control={control}
          name="priority"
          render={({ field }) => (
            <View style={styles.field}>
              <Label>Priority</Label>
              <View style={styles.optionGrid}>
                {PRIORITIES.map((p) => {
                  const active = field.value === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => field.onChange(p)}
                      style={[
                        styles.option,
                        active
                          ? {
                              backgroundColor: `${priorityColor[p]}24`,
                              borderColor: priorityColor[p],
                            }
                          : null,
                      ]}
                    >
                      <View style={[styles.dot, { backgroundColor: priorityColor[p] }]} />
                      <Text
                        style={[
                          styles.optionText,
                          active ? { color: priorityColor[p], fontWeight: '700' } : null,
                        ]}
                      >
                        {PRIORITY_LABEL[p]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.slaHint}>
                Must be resolved within {slaWindowLabel(priority)} of reporting.
              </Text>
            </View>
          )}
        />

        <Controller
          control={control}
          name="description"
          render={({ field, fieldState }) => (
            <View style={styles.field}>
              <Label>Details (optional)</Label>
              <TextInput
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="Anything the technician should know before arriving…"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.textarea]}
                multiline
                textAlignVertical="top"
              />
              {fieldState.error ? (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              ) : null}
            </View>
          )}
        />

        <View style={styles.field}>
          <Label>Photos {photos.length ? `(${photos.length}/4)` : ''}</Label>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {photos.map((uri) => (
              <View key={uri}>
                <Image source={{ uri }} style={styles.photo} />
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((p) => p !== uri))}
                  style={styles.photoRemove}
                  hitSlop={6}
                  accessibilityLabel="Remove photo"
                >
                  <MaterialIcons name="close" size={12} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            {photos.length < 4 ? (
              <>
                <Pressable onPress={() => void addPhoto(true)} style={styles.photoAdd}>
                  <MaterialIcons name="photo-camera" size={20} color={colors.textMuted} />
                </Pressable>
                <Pressable onPress={() => void addPhoto(false)} style={styles.photoAdd}>
                  <MaterialIcons name="photo-library" size={20} color={colors.textMuted} />
                </Pressable>
              </>
            ) : null}
          </Row>
        </View>

        <Button
          title="Submit report"
          onPress={handleSubmit(onSubmit)}
          loading={submitting}
          icon="send"
          style={{ marginTop: spacing(3) }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing(4), paddingBottom: spacing(12) },
  offlineNote: {
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
  offlineNoteText: { ...font.small, color: colors.offline, flex: 1 },
  field: { marginBottom: spacing(5) },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
    color: colors.text,
    fontSize: 15,
    minHeight: 48,
  },
  inputError: { borderColor: colors.danger },
  textarea: { minHeight: 100, paddingTop: spacing(3.5) },
  error: { ...font.small, color: colors.danger, marginTop: spacing(1.5) },
  scanInline: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: `${colors.primary}1F`,
    borderWidth: 1,
    borderColor: `${colors.primary}4D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2.5),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { backgroundColor: `${colors.primary}24`, borderColor: colors.primary },
  optionText: { ...font.small, color: colors.textMuted, fontWeight: '600' },
  optionTextActive: { color: colors.primary, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  slaHint: { ...font.small, color: colors.textFaint, marginTop: spacing(2.5) },
  photo: { width: 72, height: 72, borderRadius: radius.sm },
  photoRemove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
