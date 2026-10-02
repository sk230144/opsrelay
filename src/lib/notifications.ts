import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken } from '../api/endpoints';

/**
 * Push + local notifications.
 *
 * `expo-notifications` THROWS ON IMPORT in Expo Go on Android: SDK 53 removed
 * remote push from the Go client, and the module raises as soon as it is
 * evaluated. A top-level `import` here would therefore take down every module
 * that transitively imports this one - including the root `_layout.tsx`, which
 * then looks to Expo Router like a route with no default export.
 *
 * So the module is loaded lazily, inside try/catch, and every export degrades
 * to a no-op when it is unavailable. The app runs fully in Expo Go; push simply
 * does nothing until it is run as a development build.
 */

type NotificationsModule = typeof import('expo-notifications');

/** Expo Go cannot do remote push, but a dev client (same enum value) can. */
const IS_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient &&
  Constants.appOwnership === 'expo';

let cached: NotificationsModule | null | undefined;

/** Returns the native module, or null when it cannot be used here. */
function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;

  // Importing at all is what throws on Android/Expo Go, so skip it entirely.
  if (IS_EXPO_GO && Platform.OS === 'android') {
    cached = null;
    return cached;
  }

  try {
    // Deliberately require() rather than a static import: this must be able to
    // fail at runtime without breaking the module graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** True when notifications can actually be delivered on this build. */
export function notificationsAvailable(): boolean {
  return getNotifications() !== null;
}

/** True when remote push is impossible regardless of permissions. */
export function pushRequiresDevBuild(): boolean {
  return IS_EXPO_GO && Platform.OS === 'android';
}

let handlerSet = false;

/**
 * Installs the foreground presentation handler.
 *
 * Called from the app's effects rather than at import time, so a failure here
 * cannot take the module graph with it.
 */
export function configureNotifications(): void {
  if (handlerSet) return;
  const N = getNotifications();
  if (!N) return;
  handlerSet = true;

  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        // shouldShowAlert is deprecated in SDK 57; banner + list replace it.
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch {
    cached = null;
  }
}

/** Android needs an explicit high-importance channel for critical alerts. */
async function ensureAndroidChannels(N: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync('critical', {
    name: 'Critical incidents',
    importance: N.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#F43F5E',
  });
  await N.setNotificationChannelAsync('default', {
    name: 'Operations',
    importance: N.AndroidImportance.DEFAULT,
  });
}

/**
 * Asks for permission and registers the device's push token with the backend.
 * Returns the token, or null when unavailable (Expo Go, simulator, denied).
 */
export async function registerForPush(): Promise<string | null> {
  const N = getNotifications();
  if (!N) return null;

  try {
    await ensureAndroidChannels(N);

    // Simulators and emulators cannot receive remote push.
    if (!Device.isDevice) return null;

    const existing = await N.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await N.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    // Without an EAS project id Expo's push service cannot issue a token.
    if (!projectId) return null;

    const token = await N.getExpoPushTokenAsync({ projectId });
    try {
      await registerPushToken(token.data);
    } catch {
      // Offline or backend down - the token registers on the next launch.
    }
    return token.data;
  } catch {
    return null;
  }
}

/**
 * Fires a local notification immediately. Used for SLA breaches detected
 * on-device. Silently does nothing where notifications are unavailable.
 */
export async function notifyLocally(
  title: string,
  body: string,
  critical = false
): Promise<void> {
  const N = getNotifications();
  if (!N) return;

  try {
    configureNotifications();
    await N.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        ...(Platform.OS === 'android'
          ? { channelId: critical ? 'critical' : 'default' }
          : {}),
      },
      // null trigger means deliver now.
      trigger: null,
    });
  } catch {
    // Never let a notification failure interrupt the user's task.
  }
}

/** Subscribes to notification taps. Returns a no-op unsubscribe when unavailable. */
export function addNotificationTapListener(
  fn: (incidentId: string | null) => void
): () => void {
  const N = getNotifications();
  if (!N) return () => {};

  try {
    const sub = N.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { incidentId?: string }
        | undefined;
      fn(data?.incidentId ?? null);
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
