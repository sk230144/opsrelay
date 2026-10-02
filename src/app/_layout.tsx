import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, router, useRootNavigationState, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'react-native-gesture-handler';

import { colors } from '../theme';
import { useAuth } from '../stores/auth';
import { getDb } from '../db/schema';
import { startConnectivityWatch, stopConnectivityWatch } from '../lib/connectivity';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { drain, pullAll, refreshCounts } from '../lib/sync';
import {
  addNotificationTapListener,
  configureNotifications,
  registerForPush,
} from '../lib/notifications';

/**
 * Cached reads come from SQLite, so retries and window-focus refetching add
 * nothing here - the sync engine owns talking to the network.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const restore = useAuth((s) => s.restore);

  // Open + migrate the database before anything tries to read it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDb();
        await refreshCounts();
      } finally {
        if (!cancelled) setDbReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (dbReady) void restore();
  }, [dbReady, restore]);

  useEffect(() => {
    startConnectivityWatch();
    return () => stopConnectivityWatch();
  }, []);

  if (!dbReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthGate />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen
            name="incident/[id]"
            options={{ title: 'Incident', headerBackTitle: 'Back' }}
          />
          <Stack.Screen
            name="incident/create"
            options={{ title: 'Report Incident', presentation: 'modal' }}
          />
          <Stack.Screen
            name="scan"
            options={{ title: 'Scan QR Code', presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="location/[code]"
            options={{ title: 'Location', headerBackTitle: 'Back' }}
          />
          <Stack.Screen
            name="conflicts"
            options={{ title: 'Resolve Conflicts', presentation: 'modal' }}
          />
          <Stack.Screen
            name="handover/create"
            options={{ title: 'New Handover', presentation: 'modal' }}
          />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * Redirects between the app and the sign-in screen as auth state changes.
 *
 * Navigation is deferred until the router has mounted, otherwise the first
 * redirect on a cold start is dropped.
 */
function AuthGate() {
  const user = useAuth((s) => s.user);
  const bootstrapping = useAuth((s) => s.bootstrapping);
  const segments = useSegments();
  const navState = useRootNavigationState();
  const bootstrapped = useRef(false);

  const inAuthGroup = segments[0] === 'login';

  useEffect(() => {
    if (!navState?.key || bootstrapping) return;

    if (!user && !inAuthGroup) {
      router.replace('/login');
    } else if (user && inAuthGroup) {
      router.replace('/');
    }
  }, [user, bootstrapping, inAuthGroup, navState?.key]);

  // Start the realtime + sync machinery once, after sign-in.
  useEffect(() => {
    if (!user || bootstrapped.current) return;
    bootstrapped.current = true;

    void connectSocket();
    // Installed here, not at import time: see the note in lib/notifications.
    configureNotifications();
    void registerForPush();
    void drain().then(() => pullAll());

    return () => {
      bootstrapped.current = false;
      disconnectSocket();
    };
  }, [user]);

  // Tapping a push notification jumps to the incident it refers to.
  useEffect(() => {
    if (!user) return;
    return addNotificationTapListener((incidentId) => {
      if (incidentId) router.push(`/incident/${incidentId}`);
    });
  }, [user]);

  return null;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
