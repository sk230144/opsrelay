import { io, type Socket } from 'socket.io-client';
import { BASE_URL, getAccessToken } from '../api/client';
import * as repo from '../db/repo';
import { mapIncident } from '../api/endpoints';
import type { Incident, Notification } from '../types';

/**
 * Real-time channel.
 *
 * Server pushes land in SQLite first, then notify subscribers - the same path
 * as a REST pull, so there is one source of truth for the UI. A push for an
 * incident with a local unsynced edit is cached but does not clobber the edit
 * (see the dirty guard in repo.upsertIncidents).
 */

type IncidentEvent = { incident: Parameters<typeof mapIncident>[0] };
type NotificationEvent = {
  id: string;
  title: string;
  body: string;
  incident_id: string | null;
  kind: Notification['kind'];
  created_at: string;
};

let socket: Socket | null = null;
const incidentListeners = new Set<(incident: Incident) => void>();
const notificationListeners = new Set<(n: Notification) => void>();

export function onIncidentPush(fn: (incident: Incident) => void): () => void {
  incidentListeners.add(fn);
  return () => incidentListeners.delete(fn);
}

export function onNotificationPush(fn: (n: Notification) => void): () => void {
  notificationListeners.add(fn);
  return () => notificationListeners.delete(fn);
}

export async function connectSocket(): Promise<void> {
  if (socket?.connected) return;
  const token = await getAccessToken();
  if (!token) return;

  socket = io(BASE_URL, {
    path: '/ws',
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 8_000,
  });

  socket.on('incident:updated', async (payload: IncidentEvent) => {
    try {
      const incident = mapIncident(payload.incident);
      await repo.upsertIncidents([incident]);
      for (const fn of incidentListeners) fn(incident);
    } catch {
      // A malformed push must never crash the socket handler.
    }
  });

  socket.on('incident:created', async (payload: IncidentEvent) => {
    try {
      const incident = mapIncident(payload.incident);
      await repo.upsertIncidents([incident]);
      for (const fn of incidentListeners) fn(incident);
    } catch {
      /* ignore malformed push */
    }
  });

  socket.on('notification', async (payload: NotificationEvent) => {
    try {
      const n: Notification = {
        id: payload.id,
        title: payload.title,
        body: payload.body,
        incidentId: payload.incident_id,
        kind: payload.kind,
        readAt: null,
        createdAt: payload.created_at,
      };
      await repo.upsertNotifications([n]);
      for (const fn of notificationListeners) fn(n);
    } catch {
      /* ignore malformed push */
    }
  });
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function socketConnected(): boolean {
  return socket?.connected ?? false;
}
