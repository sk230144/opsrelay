import * as SQLite from 'expo-sqlite';

/**
 * Local cache + durable outbox.
 *
 * Two distinct jobs live here:
 *  - `incidents`/`handovers`/`notifications` mirror server state so the app
 *    renders instantly and works with no network at all.
 *  - `outbox` is the durable write queue. It survives app restarts, which is
 *    the whole point: a report written in a basement with no signal must still
 *    reach the server tomorrow morning.
 */

const DB_NAME = 'opsrelay.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  // WAL keeps reads fast while the sync engine writes in the background.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS incidents (
      id            TEXT PRIMARY KEY NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      category      TEXT NOT NULL,
      priority      TEXT NOT NULL,
      status        TEXT NOT NULL,
      location_id   TEXT,
      location_code TEXT,
      location_name TEXT,
      reporter_id   TEXT NOT NULL,
      reporter_name TEXT NOT NULL,
      assignee_id   TEXT,
      assignee_name TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      sla_due_at    TEXT,
      resolved_at   TEXT,
      escalated     INTEGER NOT NULL DEFAULT 0,
      version       INTEGER NOT NULL DEFAULT 1,
      pending       INTEGER NOT NULL DEFAULT 0,
      dirty         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_assignee ON incidents(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents(priority);

    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY NOT NULL,
      incident_id TEXT NOT NULL,
      author_id   TEXT NOT NULL,
      author_name TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      synced      INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_comments_incident ON comments(incident_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id          TEXT PRIMARY KEY NOT NULL,
      incident_id TEXT NOT NULL,
      uri         TEXT NOT NULL,
      uploaded    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_incident ON attachments(incident_id);

    CREATE TABLE IF NOT EXISTS handovers (
      id              TEXT PRIMARY KEY NOT NULL,
      from_user_id    TEXT NOT NULL,
      from_user_name  TEXT NOT NULL,
      to_user_id      TEXT,
      to_user_name    TEXT,
      shift           TEXT NOT NULL,
      notes           TEXT NOT NULL DEFAULT '',
      incident_ids    TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL,
      acknowledged_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      incident_id TEXT,
      kind        TEXT NOT NULL,
      read_at     TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id    TEXT PRIMARY KEY NOT NULL,
      code  TEXT NOT NULL UNIQUE,
      name  TEXT NOT NULL,
      kind  TEXT NOT NULL,
      floor TEXT
    );

    -- The durable write queue.
    CREATE TABLE IF NOT EXISTS outbox (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      -- Local temp id (inc_local_*) this op refers to, so we can rewrite it
      -- to the real server id once a create succeeds.
      local_ref   TEXT,
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT,
      created_at  TEXT NOT NULL,
      -- Set when the server rejected this op as a version conflict; the row is
      -- parked here until the user resolves it.
      conflict    TEXT
    );
  `);
}

/** Wipes cached + queued data. Used on sign-out so the next user starts clean. */
/**
 * Serializes write transactions.
 *
 * expo-sqlite's `withTransactionAsync` is explicitly NOT exclusive - the docs
 * warn it "can be interrupted by other async queries". This app has several
 * independent writers (the sync drain, a pullAll refreshing four tables, and
 * optimistic UI writes) all sharing one connection, so their BEGIN/COMMIT pairs
 * interleave and one path ends up rolling back a transaction another already
 * committed: "cannot rollback - no transaction is active".
 *
 * Every write therefore queues through this chain. `withExclusiveTransactionAsync`
 * was the alternative, but it trades this crash for `database is locked` errors
 * on the losing writer, which would need retry logic anyway - and it is
 * unavailable on web.
 */
let writeChain: Promise<unknown> = Promise.resolve();

export function withWriteLock<T>(work: () => Promise<T>): Promise<T> {
  // Chain onto the tail regardless of whether the previous write succeeded, so
  // one failure cannot wedge the queue permanently.
  const result = writeChain.then(work, work);
  writeChain = result.catch(() => {});
  return result;
}

export async function resetDb(): Promise<void> {
  const db = await getDb();
  await withWriteLock(() =>
    db.execAsync(`
      DELETE FROM incidents;
      DELETE FROM comments;
      DELETE FROM attachments;
      DELETE FROM handovers;
      DELETE FROM notifications;
      DELETE FROM locations;
      DELETE FROM outbox;
    `)
  );
}
