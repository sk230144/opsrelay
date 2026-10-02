# OpsRelay: Interview Guide

Plain-language explanation of what the app is, why it exists, and exactly how each
feature is built in code. Written so you can explain it without reading from notes.

---

## 1. The 30-second pitch

> OpsRelay is a mobile app for hotels and restaurants. Staff report problems like a broken
> AC or a warm freezer, supervisors assign them, technicians fix them, and managers watch it
> all live. I built it **offline-first**, because the places where problems happen, like
> basements and kitchens, often have no signal. Everything works without internet and syncs
> by itself when the connection returns. I spent most of my effort on failure handling:
> lost responses, duplicate requests, and two people editing the same incident.

**Stack:** React Native + Expo + TypeScript on the phone. FastAPI + SQLAlchemy + Socket.IO
on the server. SQLite on the phone for local storage.

---

## 2. The problem

Hotels run on phone calls, WhatsApp and paper. That causes:

1. **Lost issues.** Nobody knows who owns what.
2. **Lost context between shifts.** The next team doesn't know what is still open.
3. **Dead zones.** A normal app breaks exactly where staff are working.

---

## 3. Feature by feature: the problem and the code approach

For each feature: **the problem**, **the idea**, **where in the code**, and **what to say**.

### 3.1 Offline-first (the headline feature)

**Problem:** Staff lose signal and a normal app would lose their work.

**Idea:** The app never sends a change straight to the network. Every change is written to
the phone's local database first, and also added to a queue table called the **outbox**. A
background process empties the queue when internet is available. The screens only ever read
from the local database, so the app looks and behaves identically online or offline.

**Where:**
- Local tables, including `outbox`: [src/db/schema.ts](src/db/schema.ts)
- Queue and cache functions: [src/db/repo.ts](src/db/repo.ts)
- Writing and draining the queue: [src/lib/sync.ts](src/lib/sync.ts)
  (`queueCreateIncident`, `queueUpdateIncident`, `drain`)
- Detecting that the internet is back: [src/lib/connectivity.ts](src/lib/connectivity.ts)
  (watches the network and calls `drain()` the moment it goes from offline to online)

**Details worth mentioning:**
- The queue is **FIFO** (first in, first out). A comment on an incident must not be sent
  before the incident itself exists.
- If a send fails because the network is down, the loop **stops** instead of skipping ahead,
  so the order is never broken.
- A new incident gets a temporary id like `inc_local_abc`. When the server replies, the app
  swaps it for the real id (`replaceLocalId`) and updates the photos, comments and queued
  operations that referenced the old id.
- The queue lives on disk, so it survives the app being closed or the phone restarting.

**What to say:** "Writes go to SQLite and an outbox table first. A drain loop sends them in
order when the network returns. The UI reads only from local storage, so there is one code
path whether you're online or not."

---

### 3.2 "3 changes waiting to sync" banner

**Problem:** Staff shouldn't have to wonder whether their work was saved.

**Idea:** The sync engine publishes its state (pending count, conflicts, online/offline) and
the banner subscribes to it.

**Where:** [src/components/SyncBanner.tsx](src/components/SyncBanner.tsx),
[src/hooks/useSync.ts](src/hooks/useSync.ts), `subscribeSync` and `refreshCounts` in
[src/lib/sync.ts](src/lib/sync.ts).

Conflicts take priority over the pending count in the banner, because a conflict needs the
user to act, while a pending item just needs patience.

---

### 3.3 No duplicate reports (idempotency)

**Problem:** On a weak network, a request can reach the server and be saved, but the reply
gets lost. The app thinks it failed and sends it again. One report becomes three or four.
**This really happened during testing.** One report became 3 rows and another became 5.

**Idea:** Every queued create carries a unique **`client_key`**, created once and stored with
the queued item, so it is identical on every retry. The server checks: "have I already seen
this key?" If yes, it returns the original incident instead of creating a new one.

**Where:**
- Key created when queuing: [src/lib/sync.ts](src/lib/sync.ts) (`queueCreateIncident` uses
  the local id as the key)
- Server check and unique column: [backend/app/api/incidents.py](backend/app/api/incidents.py)
  (`create_incident`) and [backend/app/models/__init__.py](backend/app/models/__init__.py)
  (`client_key`, unique index)

**Extra detail:** If two retries arrive at the same instant, both might pass the "have I
seen this?" check. The **unique index** is the real guarantee. The second insert fails with
`IntegrityError`, which the server catches and answers with the winner's row.

**Proof from testing:** 5 sequential retries gave 1 incident. 6 simultaneous retries gave
1 incident. Two different reports still gave 2 incidents.

**What to say:** "A lost response looks identical to a failed request, so retries are
unavoidable. I made the create idempotent with a client-generated key and a unique database
index."

---

### 3.4 Conflict resolution

**Problem:** Two people change the same incident. One of them is offline. Whoever syncs last
would silently overwrite the other.

**Idea: optimistic concurrency.** Every incident has a `version` number that goes up on every
write. When the phone edits something, it sends the version it started from (`base_version`).
If the server's version has moved on, the server refuses with **HTTP 409** and sends back its
current values. The app doesn't guess a winner. It shows both and lets the user choose.

**Where:**
- Server compares versions: [backend/app/api/incidents.py](backend/app/api/incidents.py)
  (`update_incident`)
- App recognises the 409 and parks that item: `asConflict` and `markConflict` in
  [src/lib/sync.ts](src/lib/sync.ts), [src/db/repo.ts](src/db/repo.ts)
- The screen: [src/app/conflicts.tsx](src/app/conflicts.tsx)

**The two buttons:**
- **Keep Server Version:** delete my queued edit and take the server's data
  (`resolveKeepServer`).
- **Use My Version:** re-arm my edit against the newer version (`resolveUseMine`, which
  updates `baseVersion` via `clearConflict`) and send it again.

**Key design point:** A conflicted item is **parked**, not retried, and the queue keeps
draining everything else. A conflict needs a human, but it must not block unrelated work.

**What to say:** "I chose to detect and ask rather than auto-merge, because either side can
contain real work that would be lost."

---

### 3.5 Concurrent database writes (a bug I found and fixed)

**Problem:** The app crashed with *"cannot rollback - no transaction is active"*.

**Cause:** Expo's SQLite `withTransactionAsync` is documented as **non-exclusive**. On launch,
the sync drain, a data refresh writing four tables, and UI writes all hit one connection at
once. Their BEGIN and COMMIT calls interleaved, so one path rolled back a transaction another
had already finished.

**Fix:** One write queue, `withWriteLock`, so writes run one at a time. All 7 transactions go
through a single helper, `transact`.

**Where:** [src/db/schema.ts](src/db/schema.ts) (`withWriteLock`),
[src/db/repo.ts](src/db/repo.ts) (`transact`). Also `pullAll` in
[src/lib/sync.ts](src/lib/sync.ts) shares one in-flight promise so launch can't trigger two
refreshes.

**Proof:** I tested the same workload with and without the lock. Without it: 5 overlapping
transactions and 4 collisions (each one is the crash). With it: 1 at a time and 0 collisions.

**Why a lock instead of exclusive transactions:** Exclusive transactions swap this crash for
`database is locked` errors on the loser, which would need retry code anyway.

---

### 3.6 QR scanning

**Problem:** Typing room numbers is slow and error-prone.

**Idea:** Every room or piece of equipment has a sticker such as `ROOM-402`. Scanning it opens
that location with its open issues and history, and a one-tap "Report an issue here".

**Where:** [src/app/scan.tsx](src/app/scan.tsx) (camera and scan handling),
[src/app/location/[code].tsx](src/app/location/[code].tsx) (the location screen),
[src/db/repo.ts](src/db/repo.ts) (`findLocationByCode`, `incidentsForLocation`).

**Details worth mentioning:**
- The camera fires the scan callback many times per second while a code is in view. I use a
  `useRef` latch so it acts **once** per scan. State alone would let several navigations
  queue before the first re-render.
- An unknown but correctly formatted code (for example `ROOM-999`) is **auto-registered** by
  the server on the first report, so what the user scanned is never lost. A badly formatted
  code is rejected.
- The location screen reads from local SQLite, so it works offline.

---

### 3.7 Real-time updates

**Problem:** Staff shouldn't have to pull to refresh to see new assignments.

**Idea:** A Socket.IO connection. The server pushes events like `incident:updated`. The phone
writes the pushed data into SQLite first, then tells the screens to re-read. That is the same
path as a normal refresh, so there is one source of truth.

**Where:** [src/lib/socket.ts](src/lib/socket.ts) (phone),
[backend/app/services/realtime.py](backend/app/services/realtime.py) (server).

**Details worth mentioning:**
- The socket handshake is **authenticated** with the JWT. A bad token is refused. I tested
  this.
- Each user joins a private room (`user:<id>`) for their own notifications, plus a shared
  `ops` room for incident broadcasts.
- A pushed update does **not** overwrite a local edit that is still queued (a `dirty` guard in
  the upsert), so live updates can't erase unsynced work.
- The server app is wrapped in a Socket.IO ASGI app, so you must serve `app.main:socket_app`,
  not `app.main:app`, or WebSockets silently stop working.

---

### 3.8 SLA timer and automatic escalation

**Problem:** Critical issues get ignored.

**Idea:** Each priority has a time limit (Critical 30 minutes, High 2 hours, Medium 8 hours,
Low 24 hours). The deadline is stored when the incident is created. The phone shows a
countdown. The server escalates anything overdue.

**Where:**
- Countdown formatting: [src/lib/format.ts](src/lib/format.ts) (`slaRemaining`, `countdown`)
- One shared ticker for all cards: `useTicker` in
  [src/hooks/useIncidents.ts](src/hooks/useIncidents.ts)
- Server limits and escalation: [backend/app/services/notify.py](backend/app/services/notify.py)
  (`sla_due_for`, `escalate_overdue`)
- The 60-second background job: [backend/app/main.py](backend/app/main.py) (`_sla_sweeper`)

**Details worth mentioning:**
- There is **one** timer for the whole screen, not one per card, so a list of 50 incidents
  stays cheap.
- Escalation bumps the incident `version` so a phone holding an old copy re-syncs rather than
  overwriting the escalation.
- The seeded "AC not cooling" incident is already overdue, so you can watch escalation happen
  within a minute of starting the server.
- In production this job would move to Celery or a scheduler instead of living inside the web
  process. I'd say that out loud, because it shows you know the trade-off.

**A bug I caught here:** SQLite drops timezone info, so the server sent times like
`12:59:45` with no `Z`. JavaScript reads that as the phone's **local** time, which would put
every countdown off by hours. Fix: tag times as UTC when sending ([backend/app/services/serialize.py](backend/app/services/serialize.py),
`as_utc`). The responses now end in `Z`.

---

### 3.8b Shift handover

**Problem:** The next shift doesn't know what is still open.

**Idea:** At the end of a shift, create a handover: pick the unresolved incidents and add
notes. The next person acknowledges it.

**Where:** [src/app/(tabs)/handover.tsx](src/app/(tabs)/handover.tsx),
[src/app/handover/create.tsx](src/app/handover/create.tsx),
[backend/app/api/misc.py](backend/app/api/misc.py).

**Details worth mentioning:**
- **Acknowledge is idempotent.** If the offline queue sends it twice, the second call does not
  overwrite who picked it up first. I tested this: both calls returned the same timestamp.
- Creating a handover **requires a connection** on purpose. A handover is a point-in-time
  summary, and a stale queued one would mislead the next shift.

---

### 3.9 Roles and permissions

**Problem:** Not everyone should be able to close or reassign everything.

**Idea:** Three roles: staff, supervisor, manager. The check exists in **two** places.

- **On the server (the real security):** [backend/app/api/incidents.py](backend/app/api/incidents.py).
  Staff trying to resolve or change priority get **403**. Illegal status jumps (for example
  `in_progress` straight to `resolved`) get **422**. Staff only see incidents they reported or
  are assigned to.
- **On the phone (the convenience):** [src/stores/auth.ts](src/stores/auth.ts) (`can(...)`)
  hides buttons staff can't use.

**What to say:** "The app hides buttons for convenience, but the server enforces the rules.
Never trust the client."

---

### 3.10 Authentication

**Idea:** Short-lived **access token** plus long-lived **refresh token**, both stored in
`SecureStore` (Keychain / Android Keystore), not plain storage.

**Where:** [src/api/client.ts](src/api/client.ts), [src/stores/auth.ts](src/stores/auth.ts),
[backend/app/core/security.py](backend/app/core/security.py).

**Details worth mentioning:**
- A request that gets 401 triggers **one** refresh. Many simultaneous 401s share a single
  refresh promise instead of each starting their own.
- The server checks the token **type**. A refresh token is rejected when used as an access
  token. Without that, the long-lived token would defeat the short expiry. I tested this.
- Refresh **rotates** both tokens.
- Login gives the same message for a wrong email and a wrong password, so it can't be used to
  discover valid accounts.
- Signing out wipes the local database so the next user can't read the previous user's data.

---

### 3.11 Notifications and Expo Go (another bug I fixed)

**Problem:** The app crashed on startup in Expo Go with a confusing "missing default export"
error.

**Cause:** `expo-notifications` **throws the moment it is imported** in Expo Go on Android
(remote push was removed in SDK 53). My code imported it at the top of a file, which broke the
root layout and with it the whole route tree.

**Fix:** Load the module lazily inside `try/catch` and make every notification function a
safe no-op when unavailable.

**Where:** [src/lib/notifications.ts](src/lib/notifications.ts).

**Honest note:** Real push needs a development build. Everything else works in Expo Go.

---

## 4. Likely interview questions and answers

**Q: Why offline-first?**
Hotel staff work in basements, kitchens and lifts with bad signal. If the app only works with
internet, it fails exactly where it's needed. Local-first means the app always responds
instantly, and sync happens in the background.

**Q: What happens if the phone loses connection halfway through a request?**
The request may or may not have reached the server. The app can't tell, so it retries. To make
retrying safe, every create carries a client-generated key, and the server returns the original
row for a repeated key.

**Q: Two people edit the same incident. What happens?**
Each incident has a version. An edit sends the version it was based on. If the server has moved
on, it returns 409 with its current values, and the app shows both versions for the user to
choose from. I didn't auto-merge, because either side may contain real work.

**Q: Why not just let the last write win?**
It's simple, but it silently destroys someone's work. In an operations tool that could mean a
critical fix being overwritten by an old status.

**Q: Why FIFO and why stop on a network error?**
Order matters. A comment can't be sent before its incident exists. Skipping a failed item
would reorder things, so on a network error the drain stops and tries again later.

**Q: How do you stop one bad item blocking the whole queue?**
Two ways. A conflict is parked and the rest keep draining. An item that fails five times with a
real server error is dropped with a message, instead of blocking the queue forever.

**Q: What was the hardest bug?**
Two tied. The SQLite "cannot rollback" crash, where overlapping writers interleaved
transactions, which I proved with a with/without-lock test (4 collisions vs 0). And the
duplicate reports, which only showed up on a real device on real Wi-Fi.

**Q: How did you test it?**
I ran the backend and exercised each endpoint directly: login, role gates, 409 conflicts,
retries, simultaneous retries, the SLA sweeper and authenticated WebSockets. I'll be upfront
that there is no automated test suite yet.

**Q: What would you do next?**
Add automated tests around the sync engine. Move photos to S3 or Supabase Storage. Move the SLA
sweeper to a proper job runner. Add pagination and delta sync instead of re-pulling everything.
Restrict CORS if a web dashboard is added.

---

## 5. Be honest about these (they will notice)

- **Push notifications** need a development build, not Expo Go.
- **Photos** are saved on the server's local disk, not cloud storage.
- **No automated tests.** Verification was manual and by scripts.
- **Known gap:** an edit made to an incident that was *created offline* is queued with base
  version 0. After the create syncs, the server's version is 1, so that edit can come back as a
  false conflict. The fix is to re-base queued edits onto the server version once the create
  succeeds.
- **Sync pulls everything** each time instead of only what changed.
- **CORS is wide open** and the SLA job runs inside the web process. Both are fine for a demo
  and not for production.

Saying these before being asked reads as maturity, not weakness.

---

## 6. A 2-minute live demo script

1. Log in as the supervisor (`sam@opsrelay.dev`). Show the dashboard.
2. **Turn on airplane mode.** Point out the purple Offline banner.
3. Report two incidents. Each is saved instantly and tagged *Not yet synced*.
4. Show the banner: "2 changes waiting to sync".
5. **Turn airplane mode off.** Watch the queue drain and the tags clear.
6. Say: "Each report arrived once, even on a flaky connection, because of idempotency keys."
7. Open an incident and show the SLA countdown.
8. Scan or type a `ROOM-` code to show the location history.
9. Optional: trigger a conflict with the `curl` command in the README and show the side-by-side
   screen.
