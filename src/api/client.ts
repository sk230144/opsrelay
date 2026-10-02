import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * HTTP client with JWT access/refresh handling.
 *
 * Tokens live in SecureStore (Keychain / Android Keystore), never AsyncStorage:
 * they are credentials. A single refresh promise is shared by all callers so a
 * burst of 401s triggers one refresh, not one per request.
 */

const ACCESS_KEY = 'opsrelay.access';
const REFRESH_KEY = 'opsrelay.refresh';

/**
 * Android emulators cannot reach the host via "localhost" - 10.0.2.2 is the
 * host loopback. On a physical device, set apiUrl in app.json to your LAN IP.
 */
function resolveBaseUrl(): string {
  const configured = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  const fallback = 'http://localhost:8000';
  const url = configured ?? fallback;
  if (Platform.OS === 'android') {
    return url.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
  }
  return url;
}

export const BASE_URL = resolveBaseUrl();

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/** Called when refresh fails, so the app can route back to sign-in. */
let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: () => void): void {
  onAuthFailure = fn;
}

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Shared so concurrent 401s collapse into a single refresh round-trip. */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  try {
    // Bare axios, not `api`: avoids the interceptor recursing on itself.
    const res = await axios.post<{ accessToken: string; refreshToken: string }>(
      `${BASE_URL}/api/auth/refresh`,
      { refreshToken: refresh },
      { timeout: 10_000 }
    );
    await saveTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken;
  } catch {
    await clearTokens();
    onAuthFailure?.();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const status = error.response?.status;

    // Only retry once, and never for the refresh call itself.
    if (
      status === 401 &&
      config &&
      !config._retried &&
      !config.url?.includes('/auth/refresh')
    ) {
      config._retried = true;
      refreshInFlight = refreshInFlight ?? refreshAccessToken();
      const token = await refreshInFlight;
      refreshInFlight = null;
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
        return api.request(config);
      }
    }
    return Promise.reject(error);
  }
);

/** True for errors caused by no/poor network rather than a server rejection. */
export function isOffline(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  return !error.response || error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK';
}

/** Extracts a human-readable message from a FastAPI error body. */
export function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    if (isOffline(error)) return 'No connection. Saved locally and queued.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
