import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import auth, incidents, misc
from app.core.config import get_settings
from app.core.db import Base, SessionLocal, engine
from app.services import notify
from app.services.realtime import sio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("opsrelay")

settings = get_settings()

SLA_SWEEP_SECONDS = 60


async def _sla_sweeper() -> None:
    """
    Background job that escalates incidents past their SLA.

    A real deployment would move this to Celery or an external scheduler; an
    asyncio task keeps the demo to a single process.
    """
    while True:
        try:
            await asyncio.sleep(SLA_SWEEP_SECONDS)
            db = SessionLocal()
            try:
                count = await notify.escalate_overdue(db)
                if count:
                    logger.info("Escalated %d overdue incident(s)", count)
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception:
            # One failed sweep must not kill the loop for the process lifetime.
            logger.exception("SLA sweep failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    if settings.debug:
        # Seeding on boot keeps the demo one command to start.
        from app.seed import seed

        seed()
        logger.info("Demo data seeded")
    elif settings.secret_key == "dev-only-insecure-change-me":
        raise RuntimeError("SECRET_KEY must be set when DEBUG is disabled")

    task = asyncio.create_task(_sla_sweeper())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="OpsRelay API",
    version="1.0.0",
    description="Real-time hotel operations and incident management.",
    lifespan=lifespan,
)

# The mobile client is not a browser origin, so this is permissive by design.
# Restrict it if a web dashboard is added.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(misc.router, prefix="/api")
app.include_router(misc.handovers, prefix="/api")
app.include_router(misc.notifications, prefix="/api")

# Incident photos are served straight from disk; swap for S3/Supabase in production.
app.mount("/uploads", StaticFiles(directory=str(settings.upload_dir)), name="uploads")


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


# Socket.IO is mounted around the FastAPI app, so HTTP and WebSocket share a port.
# `socket_app` is what uvicorn must serve - not `app`.
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="/ws")
