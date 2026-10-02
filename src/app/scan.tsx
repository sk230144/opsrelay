import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, font, radius, spacing } from '../theme';
import { Button } from '../components/ui';
import { findLocationByCode } from '../db/repo';

/**
 * Scans room/equipment QR codes.
 *
 * The camera fires onBarcodeScanned continuously while a code is in frame, so a
 * ref latch is used to act exactly once per scan - state alone would let several
 * navigations queue up before the first re-render lands.
 */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const onScanned = useCallback(async (result: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;

    const code = result.data.trim().toUpperCase();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const known = await findLocationByCode(code);
    if (known) {
      router.replace(`/location/${encodeURIComponent(known.code)}`);
      return;
    }

    // Unknown codes still let the user file a report against that code.
    if (/^(ROOM|AREA|EQUIP)-[A-Z0-9-]+$/.test(code)) {
      router.replace(`/incident/create?code=${encodeURIComponent(code)}`);
      return;
    }

    setError(`"${result.data}" is not an OpsRelay location code.`);
    // Re-arm so the user can try another sticker without leaving the screen.
    setTimeout(() => {
      handled.current = false;
    }, 1_500);
  }, []);

  if (!permission) {
    return <View style={styles.flex} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.flex, styles.center]}>
        <MaterialIcons name="photo-camera" size={40} color={colors.textFaint} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>
          OpsRelay uses the camera to scan the QR codes on rooms and equipment.
        </Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
        <Button title="Go back" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.reticle}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>

        <Text style={styles.hint}>Point at a room or equipment QR code</Text>

        {error ? (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={15} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={10}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000000' },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(3),
    padding: spacing(8),
    backgroundColor: colors.bg,
  },
  permTitle: { ...font.h2, color: colors.text, marginTop: spacing(2) },
  permBody: {
    ...font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing(4),
    lineHeight: 21,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: { width: 230, height: 230 },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: colors.primary,
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 10,
  },
  hint: {
    ...font.body,
    color: '#FFFFFF',
    marginTop: spacing(8),
    textAlign: 'center',
    paddingHorizontal: spacing(8),
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2.5),
    marginTop: spacing(4),
    marginHorizontal: spacing(6),
  },
  errorText: { ...font.small, color: colors.warning, flex: 1 },
  close: {
    position: 'absolute',
    top: spacing(12),
    right: spacing(5),
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
