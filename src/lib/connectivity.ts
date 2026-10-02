import NetInfo from '@react-native-community/netinfo';
import { drain, pullAll } from './sync';

/**
 * Watches the network and drains the outbox the moment connectivity returns.
 * This is what makes the demo work: turn Wi-Fi off, create incidents, turn it
 * back on, and the queue flushes without the user doing anything.
 */

let online = true;
const listeners = new Set<(online: boolean) => void>();
let unsubscribe: (() => void) | null = null;

export function isOnline(): boolean {
  return online;
}

export function subscribeConnectivity(fn: (online: boolean) => void): () => void {
  listeners.add(fn);
  fn(online);
  return () => listeners.delete(fn);
}

export function startConnectivityWatch(): () => void {
  if (unsubscribe) return unsubscribe;

  unsubscribe = NetInfo.addEventListener((state) => {
    // `isInternetReachable` is null while NetInfo is still probing; treating
    // null as "reachable" avoids a false offline flash on launch.
    const reachable =
      state.isConnected === true && state.isInternetReachable !== false;
    const was = online;
    online = reachable;

    if (was !== reachable) {
      for (const fn of listeners) fn(reachable);
    }
    // Only act on the transition into connectivity, not every NetInfo event.
    if (!was && reachable) {
      void drain().then(() => pullAll());
    }
  });

  return unsubscribe;
}

export function stopConnectivityWatch(): void {
  unsubscribe?.();
  unsubscribe = null;
}
