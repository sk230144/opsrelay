You need two terminals — backend first, then the app.

## Terminal 1 — backend

```bash
cd c:/Users/PC-8/Desktop/App/opsrelay/backend
.venv/Scripts/python.exe -m uvicorn app.main:socket_app --host 0.0.0.0 --port 8000 --reload
```

The venv and dependencies are already installed from the build, so there's no setup step. Two things that matter here:

- Serve **`app.main:socket_app`**, not `app.main:app` — the Socket.IO server wraps the FastAPI app, and serving `app` alone silently kills WebSockets with no error.
- Use `--host 0.0.0.0` (not `127.0.0.1`) so a phone or emulator on your network can reach it.

It creates the schema and seeds demo data on first boot. Check it's alive at <http://localhost:8000/health>, and browse the API at <http://localhost:8000/docs>.

## Terminal 2 — mobile app

```bash
cd c:/Users/PC-8/Desktop/App/opsrelay
npx expo start
```

Then press `a` for an Android emulator, or scan the QR code with Expo Go on your phone.

## Sign in

Password for all accounts is `opsrelay123`:

| Role | Email |
| --- | --- |
| Manager | `maya@opsrelay.dev` |
| Supervisor | `sam@opsrelay.dev` |
| Staff | `raj@opsrelay.dev` |

The login screen has tap-to-fill chips for these, so you don't need to type them.

## If the app shows no data

That's almost always the API URL. `localhost` on a phone means the phone itself, not your PC.

- **Android emulator** — works as-is; the client rewrites `localhost` to `10.0.2.2` automatically.
- **Physical device or iOS simulator** — find your LAN IP (`ipconfig`, look for IPv4 under your Wi-Fi adapter) and set it in **both** places:
  - [app.json](opsrelay/app.json) → `expo.extra.apiUrl` → `http://192.168.x.x:8000`
  - `backend/.env` → `PUBLIC_BASE_URL=http://192.168.x.x:8000`

Both are needed: the first is where the app sends requests, the second is how the backend builds photo URLs. Setting only the first gives you working data but broken images. Restart `expo start` after editing `app.json`.

Two notes on hardware: the QR scanner and camera need a real device — a simulator can't scan. And Postgres is optional; it's on SQLite by default, so there's nothing to install unless you want it (`docker compose up -d` in `backend/`, then set `DATABASE_URL`).

The README also has the airplane-mode walkthrough for demoing the offline queue and a curl recipe to force a sync conflict.