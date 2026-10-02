# OpsRelay

Real-time hotel operations and incident management. React Native (Expo) + FastAPI.

Staff report operational problems, hand unresolved work between shifts, and coordinate
maintenance in real time — from phones that frequently have no signal. The app is
offline-first: every write lands in SQLite first and drains from a durable queue, so it
behaves the same in a basement as it does on Wi-Fi.

## What is built

| Feature | Where |
| --- | --- |
| Role-based auth (staff / supervisor / manager), JWT + refresh, SecureStore | [src/stores/auth.ts](src/stores/auth.ts), [backend/app/api/auth.py](backend/app/api/auth.py) |
| Offline write queue + optimistic UI | [src/lib/sync.ts](src/lib/sync.ts), [src/db/schema.ts](src/db/schema.ts) |
| Version-conflict detection and resolution | [src/app/conflicts.tsx](src/app/conflicts.tsx), [backend/app/api/incidents.py](backend/app/api/incidents.py) |
| Incident lifecycle `reported → assigned → in_progress → review → resolved` | [src/app/incident/[id].tsx](src/app/incident/[id].tsx) |
| QR scanning of room/equipment codes | [src/app/scan.tsx](src/app/scan.tsx), [src/app/location/[code].tsx](src/app/location/[code].tsx) |
| Photo capture + multipart upload | [src/app/incident/create.tsx](src/app/incident/create.tsx) |
| Real-time updates over Socket.IO | [src/lib/socket.ts](src/lib/socket.ts), [backend/app/services/realtime.py](backend/app/services/realtime.py) |
| SLA countdowns + automatic escalation | [src/lib/format.ts](src/lib/format.ts), [backend/app/services/notify.py](backend/app/services/notify.py) |
| Shift handover with acknowledgement | [src/app/(tabs)/handover.tsx](src/app/(tabs)/handover.tsx) |
| Push + local notifications | [src/lib/notifications.ts](src/lib/notifications.ts) |

## Running it

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

.venv/Scripts/python.exe -m uvicorn app.main:socket_app --host 0.0.0.0 --port 8000 --reload
```

Serve `app.main:socket_app`, **not** `app.main:app` — the Socket.IO server wraps the
FastAPI app, and serving `app` alone silently disables WebSockets.

On first boot with `DEBUG=true` it creates the schema and seeds demo data. Check
<http://localhost:8000/docs> for the API, and `/health` for a liveness probe.

Postgres is optional — it defaults to a local SQLite file so there is nothing to install:

```bash
cd backend && docker compose up -d
# then in .env:
# DATABASE_URL=postgresql+psycopg://opsrelay:opsrelay@localhost:5432/opsrelay
```

### 2. Mobile app

```bash
npm install
npx expo start
```

**Pointing the app at your backend.** `localhost` on a phone means the phone itself.
The client rewrites `localhost` to `10.0.2.2` automatically for the Android emulator, but
for a **physical device** set your machine's LAN IP in two places:

- `app.json` → `expo.extra.apiUrl` → `http://192.168.x.x:8000`
- `backend/.env` → `PUBLIC_BASE_URL=http://192.168.x.x:8000` (so photo URLs resolve)

### Demo accounts

Password for all three: `opsrelay123`

| Role | Email | Can |
| --- | --- | --- |
| Manager | `maya@opsrelay.dev` | everything |
| Supervisor | `sam@opsrelay.dev` | assign, reprioritise, resolve |
| Staff | `raj@opsrelay.dev` | report, comment, advance to review |

## Demonstrating the offline queue

This is the part worth showing live:

1. Sign in and let the dashboard load.
2. Turn off Wi-Fi / enable airplane mode. A purple **Offline** banner appears.
3. Report two or three incidents. Each saves instantly and is tagged `NOT YET SYNCED`.
4. Change a status. The card shows `EDIT QUEUED`.
5. The banner reads **"3 changes waiting to sync"**.
6. Turn the network back on. The queue drains by itself, temporary ids are replaced with
   server ids, and the badges clear.

### Demonstrating conflict resolution

1. Offline, change an incident's status on the device.
2. While still offline, change the *same* incident from another client:
   ```bash
   curl -X PATCH http://localhost:8000/api/incidents/<id> \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"status":"in_progress","base_version":1}'
   ```
3. Bring the device back online. The queued edit is now based on a stale version, the
   server answers `409`, and the app shows both versions side by side with
   **Keep Server Version** / **Use My Version**.

### QR codes

Seeded location codes — generate QR images for these at any QR generator:

`ROOM-402` · `ROOM-311` · `ROOM-208` · `AREA-LOBBY` · `AREA-KITCHEN` ·
`EQUIP-FREEZER-1` · `EQUIP-LIFT-2`

Scanning a code opens that location with its open issues and history. A well-formed but
unregistered code (e.g. `ROOM-999`) registers itself on first report rather than being
discarded.

## Architecture notes

**Why writes never go straight to the network.** Every mutation is written to SQLite and
appended to an `outbox` table, then drained in FIFO order. The UI reads only from SQLite,
so there is one render path regardless of connectivity. Ordering matters: a comment on an
incident that is itself still queued must not be sent first, so a create that has not yet
earned a server id blocks ops that depend on it rather than failing them.

**Creates are idempotent.** A queued create carries a `client_key` (the local temp id,
persisted with the op and stable across retries). If a POST reaches the server but the
response is lost — a flaky-network hallmark — the retry returns the original incident
rather than filing a second one. A unique index on `client_key` plus an `IntegrityError`
catch covers the case where two retries race past the lookup. Without this, one report
filed on a weak connection became three or four rows, and the stale local copy kept its
*"only on this device"* badge forever because the op never cleared the queue.

**Conflict detection.** Every incident carries a monotonic `version`. A `PATCH` sends the
`base_version` it was built on; if the stored version has moved past it the server returns
`409` with its current values. The client parks that op and keeps draining the rest — a
conflict needs a human but must not block unrelated work. Neither side is auto-merged,
because either choice can discard real work.

**All SQLite writes are serialized.** `expo-sqlite`'s `withTransactionAsync` is
explicitly non-exclusive — the docs warn it "can be interrupted by other async
queries". With several independent writers on one connection (the sync drain, a
`pullAll` refreshing four tables, optimistic UI writes), their `BEGIN`/`COMMIT` pairs
interleave and one path rolls back a transaction another already committed, crashing with
*"cannot rollback - no transaction is active"*. Every write therefore goes through
`withWriteLock` in [src/db/schema.ts](src/db/schema.ts) via the `transact` helper in
[src/db/repo.ts](src/db/repo.ts). `withExclusiveTransactionAsync` was the alternative, but
it trades this crash for `database is locked` on the losing writer and is unavailable on
web. `pullAll` additionally shares one in-flight promise so launch cannot start two pulls.

**Timestamps.** SQLite does not preserve `tzinfo`, so datetimes are tagged UTC at
serialization ([backend/app/services/serialize.py](backend/app/services/serialize.py)).
Without this, `new Date(...)` on the client parses them as local time and every SLA
countdown is wrong by the device's UTC offset.

**SLA escalation** runs as an asyncio sweep every 60s in the app lifespan. A production
deployment would move this to Celery or an external scheduler rather than coupling it to
a web process.

## Verified

- `npx tsc --noEmit` — clean
- `npx expo lint` — 0 errors
- `npx expo export` — bundles for both iOS and Android
- Backend: login, token-type enforcement (a refresh token is rejected as an access token),
  refresh rotation, role gates (403), illegal status transitions (422), row-level scoping
  for staff, 409 conflict payloads, SLA auto-escalation, idempotent handover
  acknowledgement, and authenticated Socket.IO broadcast.

## Known limitations

- **Notifications need a development build on Android.** Expo Go dropped Android remote
  push in SDK 53, and `expo-notifications` throws *on import* there — not just on use. So
  [src/lib/notifications.ts](src/lib/notifications.ts) loads the module lazily inside
  try/catch and every export degrades to a no-op; a static import would crash the root
  layout and take the whole route tree with it. Profile → Notifications shows the current
  state. Run `eas build --profile development` for real push (`getExpoPushTokenAsync`
  also needs an EAS `projectId`). Everything else works normally in Expo Go.
- **Attachments are served from local disk** via `/uploads`. Swap for S3 or Supabase
  Storage before any real deployment.
- **CORS is wide open** because the mobile client is not a browser origin. Restrict it if
  a web dashboard is added.
- **No automated test suite.** The backend was verified by exercising the endpoints
  directly; the flows above are the reproduction steps.
- `npm audit` reports advisories in Expo's own build tooling (`@expo/config`,
  `prebuild-config`). They are build-time only, and `audit fix --force` downgrades Expo
  itself, so they are left as-is.
- Camera and push need a physical device; the simulator cannot scan or receive push.
