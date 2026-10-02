import socketio

from app.core.security import decode_token

# ASGI Socket.IO server. CORS is open because the mobile client is not a browser
# origin; tighten this if a web dashboard is ever added.
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

# sid -> user_id, so a disconnect can clean up without a database lookup.
_sessions: dict[str, str] = {}


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None) -> None:
    """
    Authenticates the socket from the JWT the client passes in `auth`.

    Raising ConnectionRefusedError is how python-socketio rejects a handshake;
    returning False would also work but gives the client no reason.
    """
    token = (auth or {}).get("token")
    user_id = decode_token(token, "access") if isinstance(token, str) else None
    if user_id is None:
        raise socketio.exceptions.ConnectionRefusedError("authentication failed")

    _sessions[sid] = user_id
    # Per-user room for targeted notifications, plus a shared ops room.
    await sio.enter_room(sid, f"user:{user_id}")
    await sio.enter_room(sid, "ops")


@sio.event
async def disconnect(sid: str) -> None:
    _sessions.pop(sid, None)


async def broadcast_incident(event: str, payload: dict) -> None:
    """Tells every connected client an incident changed."""
    await sio.emit(event, {"incident": payload}, room="ops")


async def push_notification(user_id: str, payload: dict) -> None:
    """Sends a notification to one user's devices only."""
    await sio.emit("notification", payload, room=f"user:{user_id}")
