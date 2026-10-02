import { isAxiosError } from 'axios';
import * as repo from '../db/repo';
import * as apiEndpoints from '../api/endpoints';
import { isOffline } from '../api/client';
import type {
  ConflictPayload,
  CreateIncidentInput,
  Incident,
  UpdateIncidentInput,
} from '../types';

/**
 * The offline sync engine.
 *
 * Design rules that matter:
 *  1. Writes never go straight to the network. They land in SQLite first, then
 *     drain from the outbox. The UI therefore behaves identically on and off
 *     the network.
 *  2. The queue drains strictly in order (FIFO by rowid). A comment on an
 *     incident that is itself still queued must not be sent first.
 *  3. A single op failing for network reasons stops the whole drain - retrying
 *     later ops would reorder them.
 *  4. A 409 conflict parks that op and keeps draining the rest, because a
 *     conflict needs a human and must not block unrelated work.
 */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncStatus {
  state: SyncState;
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

type Listener = (status: SyncStatus) => void;

const MAX_ATTEMPTS = 5;

let status: SyncStatus = {
  state: 'idle',
  pending: 0,
  conflicts: 0,
  lastSyncedAt: null,
  lastError: null,
};

const listeners = new Set<Listener>();
/** Guards against two drains running concurrently and double-sending ops. */
let draining = false;
/** Set when a drain is requested while one is already running. */
let rerunRequested = false;

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function emit(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

/** Recounts the queue and publishes it, so badges stay accurate. */
export async function refreshCounts(): Promise<void> {
  const [pending, conflicts] = await Promise.all([
    repo.pendingCount(),
    repo.conflictCount(),
  ]);
  emit({ pending, conflicts });
}

function localId(): string {
  return `inc_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------- queueing writes ----------------

/**
 * Writes an incident locally and queues the create. Returns the local row so
 * the UI can navigate to it immediately.
 */
export async function queueCreateIncident(
  input: CreateIncidentInput,
  author: { id: string; fullName: string },
  slaDueAt: string | null
): Promise<Incident> {
  const now = new Date().toISOString();
  const id = localId();
  const incident: Incident = {
    id,
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    status: 'reported',
    locationId: null,
    locationCode: input.locationCode,
    locationName: input.locationCode,
    reporterId: author.id,
    reporterName: author.fullName,
    assigneeId: input.assigneeId,
    assigneeName: null,
    createdAt: now,
    updatedAt: now,
    slaDueAt,
    resolvedAt: null,
    escalated: false,
    version: 0,
    pending: true,
    dirty: false,
  };
  await repo.upsertIncidents([incident]);
  if (input.photoUris.length) {
    await repo.addAttachments(id, input.photoUris);
  }
  // The local id is already unique and is persisted with the op, so it doubles
  // as the idempotency key - stable across every retry of this one report.
  await repo.enqueue(
    { kind: 'create_incident', payload: { ...input, clientKey: id } },
    id
  );
  await refreshCounts();
  void drain();
  return incident;
}

/** Applies a status/priority/assignee change optimistically, then queues it. */
export async function queueUpdateIncident(
  id: string,
  patch: Omit<UpdateIncidentInput, 'baseVersion'>,
  baseVersion: number,
  assigneeName?: string | null
): Promise<void> {
  await repo.patchIncidentLocal(id, {
    ...patch,
    ...(assigneeName !== undefined ? { assigneeName } : {}),
    ...(patch.status === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}),
  });
  await repo.enqueue(
    { kind: 'update_incident', payload: { ...patch, baseVersion } },
    id
  );
  await refreshCounts();
  void drain();
}

export async function queueComment(
  incidentId: string,
  body: string,
  author: { id: string; fullName: string }
): Promise<void> {
  await repo.upsertComments([
    {
      id: `cmt_local_${Date.now().toString(36)}`,
      incidentId,
      authorId: author.id,
      authorName: author.fullName,
      body,
      createdAt: new Date().toISOString(),
      synced: false,
    },
  ]);
  await repo.enqueue({ kind: 'add_comment', payload: { incidentId, body } }, incidentId);
  await refreshCounts();
  void drain();
}

export async function queueAcknowledgeHandover(handoverId: string): Promise<void> {
  await repo.acknowledgeHandoverLocal(handoverId);
  await repo.enqueue({ kind: 'acknowledge_handover', payload: { handoverId } });
  await refreshCounts();
  void drain();
}

// ---------------- draining the queue ----------------

/**
 * Sends every queued op in order. Safe to call often - concurrent calls
 * collapse into one drain, with a re-run if work arrived mid-flight.
 */
export async function drain(): Promise<void> {
  if (draining) {
    rerunRequested = true;
    return;
  }
  draining = true;
  emit({ state: 'syncing' });

  try {
    const ops = await repo.pendingOps();
    for (const op of ops) {
      try {
        await sendOp(op);
        await repo.dequeue(op.id);
      } catch (error) {
        if (isOffline(error)) {
          // No network: stop here and keep order intact for the next attempt.
          await repo.recordFailure(op.id, 'offline');
          emit({ state: 'offline', lastError: null });
          return;
        }

        const conflict = await asConflict(op, error);
        if (conflict) {
          await repo.markConflict(op.id, conflict);
          continue; // A human must resolve it; keep draining the rest.
        }

        await repo.recordFailure(op.id, describe(error));
        // Give up on an op the server keeps rejecting, rather than wedging
        // the queue behind it forever.
        if (op.attempts + 1 >= MAX_ATTEMPTS) {
          await repo.dequeue(op.id);
          emit({ lastError: `Dropped a change after ${MAX_ATTEMPTS} failed attempts.` });
        } else {
          emit({ state: 'error', lastError: describe(error) });
          return;
        }
      }
    }
    emit({ state: 'idle', lastSyncedAt: new Date().toISOString(), lastError: null });
  } finally {
    draining = false;
    await refreshCounts();
    if (rerunRequested) {
      rerunRequested = false;
      void drain();
    }
  }
}

async function sendOp(op: repo.OutboxRow): Promise<void> {
  const payload = JSON.parse(op.payload) as Record<string, unknown>;

  switch (op.kind) {
    case 'create_incident': {
      const input = payload as unknown as CreateIncidentInput;
      const created = await apiEndpoints.createIncident(input);
      if (op.local_ref) {
        // A retry may land on a server id we already cached (the idempotent
        // replay path). Dropping that row first keeps replaceLocalId's id
        // rewrite from colliding with it and leaving an orphaned `pending`
        // row behind - which is what kept the "only on this device" badge on.
        if (created.id !== op.local_ref) {
          await repo.deleteIncident(created.id);
        }
        // Swap the temp id for the real one before anything else references it.
        await repo.replaceLocalId(op.local_ref, created.id);
        const localPhotos = await repo.listAttachments(created.id);
        for (const photo of localPhotos.filter((p) => !p.uploaded)) {
          try {
            await apiEndpoints.uploadAttachment(created.id, photo.uri);
          } catch {
            // A failed photo must not fail the incident; it stays pending.
          }
        }
        await repo.markCommentsSynced(created.id);
      }
      await repo.upsertIncidents([created]);
      return;
    }

    case 'update_incident': {
      const target = op.local_ref;
      if (!target) return;
      // An update queued behind a create whose id has not resolved yet cannot
      // be sent; surfacing it as offline keeps it queued in order.
      if (target.startsWith('inc_local_')) {
        throw new Error('awaiting-server-id');
      }
      const input = payload as unknown as UpdateIncidentInput;
      const updated = await apiEndpoints.updateIncident(target, input);
      await repo.upsertIncidents([updated]);
      await repo.clearDirty(updated.id);
      return;
    }

    case 'add_comment': {
      const { incidentId, body } = payload as { incidentId: string; body: string };
      const target = op.local_ref ?? incidentId;
      if (target.startsWith('inc_local_')) {
        throw new Error('awaiting-server-id');
      }
      await apiEndpoints.addComment(target, body);
      const fresh = await apiEndpoints.fetchIncident(target);
      await repo.upsertIncidents([fresh]);
      if (fresh.comments) await repo.upsertComments(fresh.comments);
      return;
    }

    case 'acknowledge_handover': {
      const { handoverId } = payload as { handoverId: string };
      const updated = await apiEndpoints.acknowledgeHandover(handoverId);
      await repo.upsertHandovers([updated]);
      return;
    }
  }
}

/**
 * Turns a 409 response into a ConflictPayload the UI can render side by side.
 * The server sends its current values; we pair them with what we tried to write.
 */
async function asConflict(
  op: repo.OutboxRow,
  error: unknown
): Promise<ConflictPayload | null> {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  if (op.kind !== 'update_incident' || !op.local_ref) return null;

  const body = error.response.data as {
    server_version?: number;
    server_state?: Record<string, unknown>;
  };
  const local = JSON.parse(op.payload) as UpdateIncidentInput & Record<string, unknown>;

  const localChange: Record<string, unknown> = {};
  for (const key of ['status', 'priority', 'assigneeId'] as const) {
    if (local[key] !== undefined) localChange[key] = local[key];
  }

  const serverState = body.server_state ?? {};
  const serverChange: Record<string, unknown> = {};
  for (const key of Object.keys(localChange)) {
    const wireKey = key === 'assigneeId' ? 'assignee_id' : key;
    serverChange[key] = serverState[wireKey] ?? serverState[key] ?? null;
  }

  return {
    incidentId: op.local_ref,
    localVersion: local.baseVersion,
    serverVersion: body.server_version ?? local.baseVersion + 1,
    localChange,
    serverChange,
  };
}

function describe(error: unknown): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    return `HTTP ${error.response?.status ?? '?'}`;
  }
  return error instanceof Error ? error.message : 'unknown error';
}

// ---------------- conflict resolution ----------------

/** "Keep Server Version": drop our queued edit and take the server's state. */
export async function resolveKeepServer(outboxId: number, incidentId: string): Promise<void> {
  await repo.dequeue(outboxId);
  try {
    const fresh = await apiEndpoints.fetchIncident(incidentId);
    await repo.upsertIncidents([fresh]);
    await repo.clearDirty(incidentId);
  } catch {
    // Offline: the next pull will reconcile it.
  }
  await refreshCounts();
}

/** "Use My Version": re-arm our edit against the newer server version. */
export async function resolveUseMine(
  outboxId: number,
  serverVersion: number
): Promise<void> {
  await repo.clearConflict(outboxId, serverVersion);
  await refreshCounts();
  void drain();
}

// ---------------- pulling server state ----------------

/** Refreshes the local cache from the server. Silent when offline. */
let pullInFlight: Promise<void> | null = null;

export async function pullAll(): Promise<void> {
  // The root layout and useIncidents both trigger a pull on launch. Sharing one
  // in-flight promise avoids two concurrent write streams into SQLite (and two
  // redundant round trips).
  if (pullInFlight) return pullInFlight;
  pullInFlight = doPull().finally(() => {
    pullInFlight = null;
  });
  return pullInFlight;
}

async function doPull(): Promise<void> {
  try {
    const [incidents, handovers, notifications, locations] = await Promise.all([
      apiEndpoints.fetchIncidents(),
      apiEndpoints.fetchHandovers(),
      apiEndpoints.fetchNotifications(),
      apiEndpoints.fetchLocations(),
    ]);
    await repo.upsertIncidents(incidents);
    await repo.upsertHandovers(handovers);
    await repo.upsertNotifications(notifications);
    await repo.upsertLocations(locations);
    emit({ state: 'idle', lastSyncedAt: new Date().toISOString() });
  } catch (error) {
    if (isOffline(error)) {
      emit({ state: 'offline' });
      return;
    }
    emit({ state: 'error', lastError: describe(error) });
  }
}
