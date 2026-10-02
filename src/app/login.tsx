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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { colors, font, radius, spacing } from '../theme';
import { Button } from '../components/ui';
import { useAuth } from '../stores/auth';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type FormValues = z.infer<typeof schema>;

/** Seeded accounts, so the app can be demoed without typing credentials. */
const DEMO_ACCOUNTS = [
  { label: 'Manager', email: 'maya@opsrelay.dev' },
  { label: 'Supervisor', email: 'sam@opsrelay.dev' },
  { label: 'Staff', email: 'raj@opsrelay.dev' },
] as const;

const DEMO_PASSWORD = 'opsrelay123';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useAuth((s) => s.signIn);
  const signingIn = useAuth((s) => s.signingIn);
  const error = useAuth((s) => s.error);
  const [showPassword, setShowPassword] = useState(false);

  const { control, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const onSubmit = async (values: FormValues) => {
    await signIn(values.email.trim().toLowerCase(), values.password);
    // Navigation is handled by AuthGate once `user` is set.
  };

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', DEMO_PASSWORD, { shouldValidate: true });
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + spacing(14), paddingBottom: insets.bottom + spacing(8) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo}>
          <MaterialIcons name="bolt" size={30} color={colors.primary} />
        </View>
        <Text style={styles.title}>OpsRelay</Text>
        <Text style={styles.subtitle}>
          Real-time hotel operations and incident management
        </Text>

        <View style={styles.form}>
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="you@hotel.com"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  style={[styles.input, fieldState.error ? styles.inputError : null]}
                />
                {fieldState.error ? (
                  <Text style={styles.error}>{fieldState.error.message}</Text>
                ) : null}
              </View>
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <View style={styles.field}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textFaint}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete="current-password"
                    style={[
                      styles.input,
                      styles.passwordInput,
                      fieldState.error ? styles.inputError : null,
                    ]}
                    onSubmitEditing={handleSubmit(onSubmit)}
                    returnKeyType="go"
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eye}
                    hitSlop={8}
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialIcons
                      name={showPassword ? 'visibility-off' : 'visibility'}
                      size={19}
                      color={colors.textFaint}
                    />
                  </Pressable>
                </View>
                {fieldState.error ? (
                  <Text style={styles.error}>{fieldState.error.message}</Text>
                ) : null}
              </View>
            )}
          />

          {error ? (
            <View style={styles.serverError}>
              <MaterialIcons name="error-outline" size={15} color={colors.danger} />
              <Text style={styles.serverErrorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            title="Sign In"
            onPress={handleSubmit(onSubmit)}
            loading={signingIn}
            disabled={!formState.isValid && formState.isSubmitted}
            style={{ marginTop: spacing(2) }}
          />
        </View>

        <View style={styles.demo}>
          <Text style={styles.demoLabel}>Demo accounts — tap to fill</Text>
          <View style={styles.demoRow}>
            {DEMO_ACCOUNTS.map((a) => (
              <Pressable key={a.email} onPress={() => fillDemo(a.email)} style={styles.demoChip}>
                <Text style={styles.demoChipText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: spacing(6), flexGrow: 1 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: `${colors.primary}1F`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(5),
  },
  title: { ...font.h1, color: colors.text, marginBottom: spacing(2) },
  subtitle: { ...font.body, color: colors.textMuted, marginBottom: spacing(9), lineHeight: 21 },
  form: { gap: spacing(1) },
  field: { marginBottom: spacing(4) },
  label: {
    ...font.small,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: spacing(2),
  },
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
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: spacing(12) },
  eye: { position: 'absolute', right: spacing(4) },
  error: { ...font.small, color: colors.danger, marginTop: spacing(1.5) },
  serverError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: `${colors.danger}14`,
    borderWidth: 1,
    borderColor: `${colors.danger}4D`,
    borderRadius: radius.sm,
    padding: spacing(3),
    marginBottom: spacing(2),
  },
  serverErrorText: { ...font.small, color: colors.danger, flex: 1 },
  demo: { marginTop: 'auto', paddingTop: spacing(10) },
  demoLabel: {
    ...font.small,
    color: colors.textFaint,
    textAlign: 'center',
    marginBottom: spacing(3),
  },
  demoRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing(2) },
  demoChip: {
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  demoChipText: { ...font.small, color: colors.textMuted, fontWeight: '600' },
});
