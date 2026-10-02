import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  clearTokens,
  getAccessToken,
  saveTokens,
  setAuthFailureHandler,
} from '../api/client';
import { fetchMe, login as loginRequest } from '../api/endpoints';
import { resetDb } from '../db/schema';
import type { Role, User } from '../types';

const USER_KEY = 'opsrelay.user';

interface AuthState {
  user: User | null;
  /** True until the stored session has been checked on launch. */
  bootstrapping: boolean;
  signingIn: boolean;
  error: string | null;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  can: (action: Permission) => boolean;
}

/** Actions gated by role. Keeps permission logic out of the screens. */
export type Permission =
  | 'assign_incident'
  | 'change_priority'
  | 'resolve_incident'
  | 'create_handover'
  | 'view_all_incidents';

const PERMISSIONS: Record<Role, Permission[]> = {
  staff: ['create_handover'],
  supervisor: [
    'assign_incident',
    'change_priority',
    'resolve_incident',
    'create_handover',
    'view_all_incidents',
  ],
  manager: [
    'assign_incident',
    'change_priority',
    'resolve_incident',
    'create_handover',
    'view_all_incidents',
  ],
};

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  bootstrapping: true,
  signingIn: false,
  error: null,

  /**
   * Restores a session on cold start. The cached user renders the UI straight
   * away; the server is then asked to confirm the token is still good.
   */
  restore: async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        set({ user: null, bootstrapping: false });
        return;
      }
      const cached = await SecureStore.getItemAsync(USER_KEY);
      if (cached) {
        try {
          set({ user: JSON.parse(cached) as User });
        } catch {
          // Corrupt cache is not fatal; the fetch below is the source of truth.
        }
      }
      try {
        const fresh = await fetchMe();
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(fresh));
        set({ user: fresh });
      } catch {
        // Offline with a cached user: stay signed in and work from the cache.
      }
    } finally {
      set({ bootstrapping: false });
    }
  },

  signIn: async (email, password) => {
    set({ signingIn: true, error: null });
    try {
      const { user, accessToken, refreshToken } = await loginRequest(email, password);
      await saveTokens(accessToken, refreshToken);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
      set({ user, signingIn: false });
      return true;
    } catch (error) {
      const { errorMessage } = await import('../api/client');
      set({ error: errorMessage(error), signingIn: false });
      return false;
    }
  },

  signOut: async () => {
    await clearTokens();
    await SecureStore.deleteItemAsync(USER_KEY);
    // Clear cached data so the next user cannot read the previous one's work.
    await resetDb();
    set({ user: null });
  },

  can: (action) => {
    const role = get().user?.role;
    if (!role) return false;
    return PERMISSIONS[role].includes(action);
  },
}));

/** Signs the user out when a token refresh fails irrecoverably. */
setAuthFailureHandler(() => {
  void useAuth.getState().signOut();
});
