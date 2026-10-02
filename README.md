# OpsRelay

A mobile app for hotels and restaurants where staff report problems, fix them together,
and hand work over between shifts. It keeps working even when the phone has no internet.

Built with **React Native (Expo) + TypeScript** on the phone and **FastAPI (Python)** on the server.

---

## 1. What is this app?

Think of a hotel. A guest says "the AC in room 402 is broken". Someone has to:

1. Write the problem down.
2. Tell the right person (a technician).
3. Track whether it is being fixed.
4. Tell the next shift if it is still not fixed.

OpsRelay does all of that on a phone. A staff member reports the problem, a supervisor
assigns it, a technician updates the status, and a manager sees everything live.

An incident moves through these steps:

`Reported → Assigned → In Progress → Review → Resolved`

([src/app/incident/[id].tsx](src/app/incident/[id].tsx) is the screen where this happens.)

---

## 2. What problem does it solve?

Many hotels run on phone calls, WhatsApp and paper. That causes three problems:

| Problem | What happens | How OpsRelay fixes it |
| --- | --- | --- |
| Issues get lost | Nobody knows who owns what | One list of incidents, each with a status and an owner |
| Shifts don't talk to each other | The night team doesn't know what the day team left open | Shift handover with an "acknowledge" button |
| Bad signal | Basements, kitchens and lifts have no internet, so a normal app stops working | The app works fully offline and syncs later |

---

## 3. How it works, in simple words

### 3.1 It works without internet (the main idea)

A normal app sends your change to the server straight away. If there is no internet, the
change is lost.

OpsRelay does it differently:

1. When you save something, it is **first saved on the phone**.
2. It is also put in a **waiting list** (we call it the "outbox").
3. When the internet comes back, the app sends the waiting list to the server **one by one,
   in order**.
4. The screens always read from the phone's own storage, so the app looks the same online
   or offline.

You will see a banner like "3 changes waiting to sync" so you always know your work is safe.

Where to look in the code:

- Phone storage and the outbox table: [src/db/schema.ts](src/db/schema.ts)
- Functions that read and write that storage: [src/db/repo.ts](src/db/repo.ts)
- The logic that sends the waiting list: [src/lib/sync.ts](src/lib/sync.ts)
- Noticing that the internet is back: [src/lib/connectivity.ts](src/lib/connectivity.ts)
- The "waiting to sync" banner: [src/components/SyncBanner.tsx](src/components/SyncBanner.tsx)

A new incident made offline gets a temporary id. When the server accepts it, the temporary
id is swapped for the real one.

### 3.2 It never creates the same report twice

On a weak network, a message can reach the server but the reply gets lost. The app thinks it
failed and tries again. Without protection, one report becomes three or four.

The fix: every new report carries a unique **key** made on the phone. If the server sees the
same key again, it returns the report it already saved instead of making a new one.

- Key is created in [src/lib/sync.ts](src/lib/sync.ts)
- Server checks it in [backend/app/api/incidents.py](backend/app/api/incidents.py)
  (the key column is in [backend/app/models/__init__.py](backend/app/models/__init__.py))

### 3.3 Two people edit the same incident

Say you are offline and change an incident's status. Meanwhile your colleague changes the
same incident. When you reconnect, whose change should win?

OpsRelay does not guess. Each incident has a **version number** that goes up on every change.
Your edit says "I was based on version 4". If the server is already on version 5, it says
"conflict". The app then shows both versions side by side and you choose:

- **Keep Server Version**: throw away my change.
- **Use My Version**: send my change again on top of the new version.

The conflict waits for you, but the rest of the waiting list keeps sending.

- Server compares versions: [backend/app/api/incidents.py](backend/app/api/incidents.py)
- Conflict screen: [src/app/conflicts.tsx](src/app/conflicts.tsx)
- App detects and parks the conflict: [src/lib/sync.ts](src/lib/sync.ts)

### 3.4 Scan a QR code on a room

Rooms and equipment have stickers like `ROOM-402`. Scan one and the app opens that place with
its open issues, past issues, and a "Report an issue here" button. No typing room numbers.

- Camera screen: [src/app/scan.tsx](src/app/scan.tsx)
- Location screen: [src/app/location/[code].tsx](src/app/location/[code].tsx)

If you scan a correctly formatted code the system doesn't know yet (for example `ROOM-999`),
it is registered the first time you report something there.

### 3.5 Live updates

When a colleague changes an incident, your screen updates by itself. No pull-to-refresh.
This uses **Socket.IO** (a permanent connection between phone and server). The server is the
one pushing the news.

- Phone side: [src/lib/socket.ts](src/lib/socket.ts)
- Server side: [backend/app/services/realtime.py](backend/app/services/realtime.py)

The connection is checked with the user's login token, so strangers can't listen in. A live
update will not overwrite a change you made that has not synced yet.

### 3.6 Deadline timers (SLA) and automatic escalation

Every incident has a time limit based on priority:

| Priority | Time to fix |
| --- | --- |
| Critical | 30 minutes |
| High | 2 hours |
| Medium | 8 hours |
| Low | 24 hours |

The phone shows a countdown. The server checks every 60 seconds, and if something is overdue
it is **escalated** automatically (moved up so a supervisor sees it).

- Countdown on the phone: [src/lib/format.ts](src/lib/format.ts)
- One shared timer for all cards: `useTicker` in [src/hooks/useIncidents.ts](src/hooks/useIncidents.ts)
- Limits and escalation on the server: [backend/app/services/notify.py](backend/app/services/notify.py)
- The 60 second check: [backend/app/main.py](backend/app/main.py)

### 3.7 Shift handover

At the end of a shift you pick the unresolved incidents, add notes ("Guest in 402 wants an
update before 9 PM"), and send it. The next shift opens it and taps **Acknowledge**. Tapping it
twice does no harm; the first person who acknowledged is kept.

- Handover list: [src/app/(tabs)/handover.tsx](src/app/(tabs)/handover.tsx)
- Create a handover: [src/app/handover/create.tsx](src/app/handover/create.tsx)
- Server: [backend/app/api/misc.py](backend/app/api/misc.py)

Creating a handover needs internet on purpose, because an old queued summary could mislead the
next shift.

### 3.8 Photos

You can attach a photo to an incident (for example a photo of the broken AC).

- [src/app/incident/create.tsx](src/app/incident/create.tsx)

### 3.9 Roles: who can do what

| Role | Can do |
| --- | --- |
| Staff | Report problems, comment, move an incident to review |
| Supervisor | Everything staff can, plus assign, change priority, resolve |
| Manager | Everything |

The rules are checked **on the server** (the real protection). The phone also hides buttons
you can't use, but that is only for convenience.

- Server rules: [backend/app/api/incidents.py](backend/app/api/incidents.py)
- Hiding buttons on the phone: [src/stores/auth.ts](src/stores/auth.ts)

### 3.10 Login and security

- You log in and get a short-lived **access token** and a long-lived **refresh token**.
- Both are stored in the phone's secure storage, not in plain files.
- When the access token expires, the app quietly gets a new one.
- Signing out clears the local data so the next person can't see it.

- Phone: [src/api/client.ts](src/api/client.ts), [src/stores/auth.ts](src/stores/auth.ts)
- Server: [backend/app/api/auth.py](backend/app/api/auth.py), [backend/app/core/security.py](backend/app/core/security.py)

### 3.11 Notifications

The app can show alerts (for example "task assigned to you"). Real push notifications need a
development build, not Expo Go. In Expo Go the app simply skips them instead of crashing.

- [src/lib/notifications.ts](src/lib/notifications.ts)

---

## 4. How the project is organised

```text
Phone (React Native)                         Server (FastAPI)
────────────────────                         ────────────────
src/app/        screens                      backend/app/api/       endpoints
src/components/ reusable pieces              backend/app/core/      config, db, login security
src/db/         phone storage (SQLite)       backend/app/models/    database tables
src/lib/        sync, socket, notifications  backend/app/services/  realtime, SLA, serialising
src/hooks/      shared logic for screens     backend/app/seed.py    demo data
src/stores/     login state
src/api/        talks to the server
```

Flow in one picture:

```text
You tap "Save"
   → saved in phone storage (SQLite) + added to the outbox
   → screen updates immediately
   → when online, outbox is sent to the server (in order)
   → server saves it and tells other phones through Socket.IO
```

Main tools used: Expo Router (navigation), Zustand (small app state), React Hook Form + Zod
(forms and checks), SQLite (phone storage), SQLAlchemy (server database), JWT (login).

---

## 5. Run it

You need two terminals: backend first, then the app.

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

.venv/Scripts/python.exe -m uvicorn app.main:socket_app --host 0.0.0.0 --port 8000 --reload
```

Use `app.main:socket_app`, **not** `app.main:app`. The second one silently turns off live
updates.

The first start creates the database and adds demo data. Check <http://localhost:8000/health>
and <http://localhost:8000/docs>. It uses a local SQLite file by default, so you don't need to
install Postgres.

### Mobile app

```bash
npm install
npx expo start
```

Press `a` for an Android emulator, or scan the QR code with Expo Go.

On a **real phone**, `localhost` means the phone itself. Put your computer's IP address in:

- `app.json` → `expo.extra.apiUrl` → `http://192.168.x.x:8000`
- `backend/.env` → `PUBLIC_BASE_URL=http://192.168.x.x:8000` (so photos load)

### Demo accounts

Password for all: `opsrelay123`

| Role | Email |
| --- | --- |
| Manager | `maya@opsrelay.dev` |
| Supervisor | `sam@opsrelay.dev` |
| Staff | `raj@opsrelay.dev` |

QR codes to try (make them with any QR generator):
`ROOM-402`, `ROOM-311`, `ROOM-208`, `AREA-LOBBY`, `AREA-KITCHEN`, `EQUIP-FREEZER-1`, `EQUIP-LIFT-2`

---

## 6. Try the offline feature

1. Log in and let the dashboard load.
2. Turn on airplane mode. A purple **Offline** banner appears.
3. Report two or three incidents. Each is saved instantly with a "not yet synced" tag.
4. The banner says "3 changes waiting to sync".
5. Turn the internet back on. The list sends by itself and the tags disappear.

**To see a conflict:** change an incident while offline, then change the same incident from
another place (for example with `curl` against the API), then reconnect. The conflict screen
appears.

---

## 7. Honest limits

- Real push notifications need a development build (not Expo Go).
- Photos are saved on the server's disk. A real product should use cloud storage like S3.
- There are no automated tests yet. Things were checked by running the app and calling the
  endpoints directly.
- Sync downloads everything each time instead of only what changed.
- An edit made to an incident that was created offline can show up as a false conflict after
  that incident syncs.
- The deadline check runs inside the web server. A real deployment would use a separate job
  runner.
- Camera and push need a physical phone.

For a deeper, interview-style explanation, see [INTERVIEW.md](INTERVIEW.md).
