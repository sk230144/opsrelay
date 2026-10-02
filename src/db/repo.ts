import { getDb, withWriteLock } from './schema';
import type {
  Attachment,
  Comment,
  ConflictPayload,
  Handover,
  Incident,
  Location,
  Notification,
  QueuedOp,
} from '../types';

/**
 * Runs `work` in a transaction, serialized against every other writer.
 *
 * Always use this instead of calling `db.withTransactionAsync` directly:
 * expo-sqlite's transactions are non-exclusive, so concurrent writers on the
 * shared connection interleave their BEGIN/COMMIT and crash with
 * "cannot rollback - no transaction is active". See withWriteLock in schema.ts.
 */
async function transact(work: () => Promise<void>): Promise<void> {
  const db = await getDb();
  await withWriteLock(() => db.withTransactionAsync(work));
}

/** Raw row shapes as SQLite returns them (snake_case, integers for booleans). */
interface IncidentRow {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  reporter_id: string;
  reporter_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  sla_due_at: string | null;
  resolved_at: string | null;
  escalated: number;
  version: number;
  pending: number;
  dirty: number;
}

function toIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category as Incident['category'],
    priority: r.priority as Incident['priority'],
    status: r.status as Incident['status'],
    locationId: r.location_id,
    locationCode: r.location_code,
    locationName: r.location_name,
    reporterId: r.reporter_id,
    reporterName: r.reporter_name,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    slaDueAt: r.sla_due_at,
    resolvedAt: r.resolved_at,
    escalated: !!r.escalated,
    version: r.version,
    pending: !!r.pending,
    dirty: !!r.dirty,
  };
}

export async function upsertIncidents(list: Incident[]): Promise<void> {
  if (!list.length) return;
  const db = await getDb();
  await transact(async () => {
    for (const i of list) {
      await db.runAsync(
        `INSERT INTO incidents (
           id, title, description, category, priority, status,
           location_id, location_code, location_name,
           reporter_id, reporter_name, assignee_id, assignee_name,
           created_at, updated_at, sla_due_at, resolved_at, escalated, version,
           pending, dirty
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title,
           description=excluded.description,
           category=excluded.category,
           priority=excluded.priority,
           status=excluded.status,
           location_id=excluded.location_id,
           location_code=excluded.location_code,
           location_name=excluded.location_name,
           assignee_id=excluded.assignee_id,
           assignee_name=excluded.assignee_name,
           updated_at=excluded.updated_at,
           sla_due_at=excluded.sla_due_at,
           resolved_at=excluded.resolved_at,
           escalated=excluded.escalated,
           version=excluded.version,
           pending=excluded.pending,
           dirty=CASE WHEN incidents.dirty=1 THEN 1 ELSE excluded.dirty END`,
        [
          i.id, i.title, i.description, i.category, i.priority, i.status,
          i.locationId, i.locationCode, i.locationName,
          i.reporterId, i.reporterName, i.assigneeId, i.assigneeName,
          i.createdAt, i.updatedAt, i.slaDueAt, i.resolvedAt,
          i.escalated ? 1 : 0, i.version, i.pending ? 1 : 0, i.dirty ? 1 : 0,
        ]
      );
    }
  });
}

export async function listIncidents(): Promise<Incident[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<IncidentRow>(
    `SELECT * FROM incidents
     ORDER BY CASE priority
                WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                WHEN 'medium' THEN 2 ELSE 3 END,
              datetime(created_at) DESC`
  );
  return rows.map(toIncident);
}

export async function getIncident(id: string): Promise<Incident | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<IncidentRow>(
    'SELECT * FROM incidents WHERE id = ?',
    id
  );
  if (!row) return null;
  const incident = toIncident(row);
  incident.comments = await listComments(id);
  incident.attachments = await listAttachments(id);
  return incident;
}

/** Applies a local edit immediately (optimistic UI) and marks the row dirty. */
export async function patchIncidentLocal(
  id: string,
  patch: Partial<
    Pick<Incident, 'status' | 'priority' | 'assigneeId' | 'assigneeName' | 'resolvedAt'>
  >
): Promise<void> {
  const db = await getDb();
  const map: Record<string, string> = {
    status: 'status',
    priority: 'priority',
    assigneeId: 'assignee_id',
    assigneeName: 'assignee_name',
    resolvedAt: 'resolved_at',
  };
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    args.push(v as string | null);
  }
  if (!sets.length) return;
  sets.push('dirty = 1', 'updated_at = ?');
  args.push(new Date().toISOString(), id);
  await db.runAsync(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function deleteIncident(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM incidents WHERE id = ?', id);
}

/**
 * Rewrites a local temp id to the server id once a queued create succeeds,
 * carrying child rows and any still-queued ops with it.
 */
export async function replaceLocalId(localId: string, serverId: string): Promise<void> {
  const db = await getDb();
  await transact(async () => {
    await db.runAsync(
      'UPDATE incidents SET id = ?, pending = 0, dirty = 0 WHERE id = ?',
      [serverId, localId]
    );
    await db.runAsync('UPDATE comments SET incident_id = ? WHERE incident_id = ?', [
      serverId, localId,
    ]);
    await db.runAsync('UPDATE attachments SET incident_id = ? WHERE incident_id = ?', [
      serverId, localId,
    ]);
    await db.runAsync('UPDATE outbox SET local_ref = ? WHERE local_ref = ?', [
      serverId, localId,
    ]);
  });
}

export async function clearDirty(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE incidents SET dirty = 0 WHERE id = ?', id);
}

// ---------------- comments ----------------

interface CommentRow {
  id: string;
  incident_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  synced: number;
}

export async function listComments(incidentId: string): Promise<Comment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CommentRow>(
    'SELECT * FROM comments WHERE incident_id = ? ORDER BY datetime(created_at) ASC',
    incidentId
  );
  return rows.map((r) => ({
    id: r.id,
    incidentId: r.incident_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at,
    synced: !!r.synced,
  }));
}

export async function upsertComments(list: Comment[]): Promise<void> {
  if (!list.length) return;
  const db = await getDb();
  await transact(async () => {
    for (const c of list) {
      await db.runAsync(
        `INSERT INTO comments (id, incident_id, author_id, author_name, body, created_at, synced)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET body=excluded.body, synced=excluded.synced`,
        [
          c.id, c.incidentId, c.authorId, c.authorName, c.body, c.createdAt,
          c.synced === false ? 0 : 1,
        ]
      );
    }
  });
}

export async function markCommentsSynced(incidentId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE comments SET synced = 1 WHERE incident_id = ?', incidentId);
}

// ---------------- attachments ----------------

interface AttachmentRow {
  id: string;
  incident_id: string;
  uri: string;
  uploaded: number;
}

export async function listAttachments(incidentId: string): Promise<Attachment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AttachmentRow>(
    'SELECT * FROM attachments WHERE incident_id = ?',
    incidentId
  );
  return rows.map((r) => ({
    id: r.id,
    incidentId: r.incident_id,
    uri: r.uri,
    uploaded: !!r.uploaded,
  }));
}

export async function addAttachments(incidentId: string, uris: string[]): Promise<void> {
  if (!uris.length) return;
  const db = await getDb();
  await transact(async () => {
    for (const uri of uris) {
      await db.runAsync(
        'INSERT OR REPLACE INTO attachments (id, incident_id, uri, uploaded) VALUES (?,?,?,?)',
        [`att_${Math.random().toString(36).slice(2, 10)}`, incidentId, uri, 0]
      );
    }
  });
}

// ---------------- locations ----------------

export async function upsertLocations(list: Location[]): Promise<void> {
  if (!list.length) return;
  const db = await getDb();
  await transact(async () => {
    for (const l of list) {
      await db.runAsync(
        `INSERT INTO locations (id, code, name, kind, floor) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name,
           kind=excluded.kind, floor=excluded.floor`,
        [l.id, l.code, l.name, l.kind, l.floor]
      );
    }
  });
}

export async function findLocationByCode(code: string): Promise<Location | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Location>(
    'SELECT id, code, name, kind, floor FROM locations WHERE code = ?',
    code.toUpperCase()
  );
  return row ?? null;
}

export async function incidentsForLocation(code: string): Promise<Incident[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<IncidentRow>(
    'SELECT * FROM incidents WHERE location_code = ? ORDER BY datetime(created_at) DESC',
    code.toUpperCase()
  );
  return rows.map(toIncident);
}

export async function listLocations(): Promise<Location[]> {
  const db = await getDb();
  return db.getAllAsync<Location>(
    'SELECT id, code, name, kind, floor FROM locations ORDER BY code ASC'
  );
}

// ---------------- handovers ----------------

interface HandoverRow {
  id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string | null;
  to_user_name: string | null;
  shift: string;
  notes: string;
  incident_ids: string;
  created_at: string;
  acknowledged_at: string | null;
}

export async function upsertHandovers(list: Handover[]): Promise<void> {
  if (!list.length) return;
  const db = await getDb();
  await transact(async () => {
    for (const h of list) {
      await db.runAsync(
        `INSERT INTO handovers (id, from_user_id, from_user_name, to_user_id, to_user_name,
           shift, notes, incident_ids, created_at, acknowledged_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET notes=excluded.notes,
           incident_ids=excluded.incident_ids, acknowledged_at=excluded.acknowledged_at`,
        [
          h.id, h.fromUserId, h.fromUserName, h.toUserId, h.toUserName, h.shift,
          h.notes, JSON.stringify(h.incidentIds), h.createdAt, h.acknowledgedAt,
        ]
      );
    }
  });
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function listHandovers(): Promise<Handover[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<HandoverRow>(
    'SELECT * FROM handovers ORDER BY datetime(created_at) DESC'
  );
  return rows.map((r) => ({
    id: r.id,
    fromUserId: r.from_user_id,
    fromUserName: r.from_user_name,
    toUserId: r.to_user_id,
    toUserName: r.to_user_name,
    shift: r.shift as Handover['shift'],
    notes: r.notes,
    incidentIds: safeParseArray(r.incident_ids),
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at,
  }));
}

export async function acknowledgeHandoverLocal(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE handovers SET acknowledged_at = ? WHERE id = ?', [
    new Date().toISOString(), id,
  ]);
}

// ---------------- notifications ----------------

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  incident_id: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
}

export async function upsertNotifications(list: Notification[]): Promise<void> {
  if (!list.length) return;
  const db = await getDb();
  await transact(async () => {
    for (const n of list) {
      await db.runAsync(
        `INSERT INTO notifications (id, title, body, incident_id, kind, read_at, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET read_at=excluded.read_at`,
        [n.id, n.title, n.body, n.incidentId, n.kind, n.readAt, n.createdAt]
      );
    }
  });
}

export async function listNotifications(): Promise<Notification[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NotificationRow>(
    'SELECT * FROM notifications ORDER BY datetime(created_at) DESC LIMIT 100'
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    incidentId: r.incident_id,
    kind: r.kind as Notification['kind'],
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

export async function markAllNotificationsRead(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE notifications SET read_at = ? WHERE read_at IS NULL',
    new Date().toISOString()
  );
}

// ---------------- outbox ----------------

export interface OutboxRow {
  id: number;
  kind: QueuedOp['kind'];
  payload: string;
  local_ref: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  conflict: string | null;
}

export async function enqueue(op: QueuedOp, localRef?: string): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO outbox (kind, payload, local_ref, created_at) VALUES (?,?,?,?)',
    [op.kind, JSON.stringify(op.payload), localRef ?? null, new Date().toISOString()]
  );
  return res.lastInsertRowId;
}

/** Ops ready to send, oldest first. Conflicted rows are held back. */
export async function pendingOps(): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE conflict IS NULL ORDER BY id ASC'
  );
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM outbox WHERE conflict IS NULL'
  );
  return row?.n ?? 0;
}

export async function dequeue(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE id = ?', id);
}

export async function recordFailure(id: number, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    [error, id]
  );
}

/** Parks an op as conflicted until the user picks a resolution. */
export async function markConflict(id: number, payload: ConflictPayload): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE outbox SET conflict = ? WHERE id = ?', [
    JSON.stringify(payload), id,
  ]);
}

export async function listConflicts(): Promise<
  { row: OutboxRow; conflict: ConflictPayload }[]
> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE conflict IS NOT NULL ORDER BY id ASC'
  );
  const out: { row: OutboxRow; conflict: ConflictPayload }[] = [];
  for (const row of rows) {
    if (!row.conflict) continue;
    try {
      out.push({ row, conflict: JSON.parse(row.conflict) as ConflictPayload });
    } catch {
      // Unparseable conflict blob - drop it so it cannot wedge the queue.
      await dequeue(row.id);
    }
  }
  return out;
}

export async function conflictCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM outbox WHERE conflict IS NOT NULL'
  );
  return row?.n ?? 0;
}

/** Re-arms a conflicted op against the newer server version ("use my version"). */
export async function clearConflict(id: number, newBaseVersion: number): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE id = ?', id);
  if (!row) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    await dequeue(id);
    return;
  }
  payload.baseVersion = newBaseVersion;
  await db.runAsync(
    'UPDATE outbox SET conflict = NULL, payload = ?, attempts = 0, last_error = NULL WHERE id = ?',
    [JSON.stringify(payload), id]
  );
}
