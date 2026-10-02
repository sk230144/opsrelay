import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app import models, schemas
from app.core.deps import CurrentUser, DbSession
from app.services import serialize

router = APIRouter()


# ---------------- locations & users ----------------


@router.get("/locations", response_model=list[schemas.LocationOut], tags=["reference"])
def list_locations(user: CurrentUser, db: DbSession) -> list[schemas.LocationOut]:
    locations = db.scalars(select(models.Location).order_by(models.Location.code)).all()
    return [
        schemas.LocationOut(
            id=location.id,
            code=location.code,
            name=location.name,
            kind=location.kind,
            floor=location.floor,
        )
        for location in locations
    ]


@router.get("/users", response_model=list[schemas.UserOut], tags=["reference"])
def list_users(user: CurrentUser, db: DbSession) -> list[schemas.UserOut]:
    """Assignable staff. Used by the assignment picker."""
    users = db.scalars(select(models.User).order_by(models.User.full_name)).all()
    return [serialize.user_out(u) for u in users]


# ---------------- handovers ----------------

handovers = APIRouter(prefix="/handovers", tags=["handovers"])


@handovers.get("", response_model=list[schemas.HandoverOut])
def list_handovers(user: CurrentUser, db: DbSession) -> list[schemas.HandoverOut]:
    rows = db.scalars(
        select(models.Handover).order_by(models.Handover.created_at.desc()).limit(50)
    ).all()
    return [serialize.handover_out(h) for h in rows]


@handovers.post("", response_model=schemas.HandoverOut, status_code=status.HTTP_201_CREATED)
def create_handover(
    payload: schemas.HandoverCreate, user: CurrentUser, db: DbSession
) -> schemas.HandoverOut:
    handover = models.Handover(
        from_user_id=user.id,
        shift=payload.shift,
        notes=payload.notes.strip(),
        incident_ids=json.dumps(payload.incident_ids),
    )
    db.add(handover)
    db.commit()
    db.refresh(handover)
    return serialize.handover_out(handover)


@handovers.post("/{handover_id}/acknowledge", response_model=schemas.HandoverOut)
def acknowledge_handover(
    handover_id: str, user: CurrentUser, db: DbSession
) -> schemas.HandoverOut:
    handover = db.get(models.Handover, handover_id)
    if handover is None:
        raise HTTPException(status_code=404, detail="Handover not found")

    # Acknowledging is idempotent: a queued duplicate from the offline client
    # must not overwrite who actually picked it up first.
    if handover.acknowledged_at is None:
        handover.acknowledged_at = datetime.now(timezone.utc)
        handover.to_user_id = user.id
        db.add(handover)
        db.commit()
        db.refresh(handover)

    return serialize.handover_out(handover)


# ---------------- notifications ----------------

notifications = APIRouter(prefix="/notifications", tags=["notifications"])


@notifications.get("", response_model=list[schemas.NotificationOut])
def list_notifications(user: CurrentUser, db: DbSession) -> list[schemas.NotificationOut]:
    rows = db.scalars(
        select(models.Notification)
        .where(models.Notification.user_id == user.id)
        .order_by(models.Notification.created_at.desc())
        .limit(100)
    ).all()
    return [serialize.notification_out(n) for n in rows]


@notifications.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(user: CurrentUser, db: DbSession) -> None:
    now = datetime.now(timezone.utc)
    unread = db.scalars(
        select(models.Notification).where(
            models.Notification.user_id == user.id,
            models.Notification.read_at.is_(None),
        )
    ).all()
    for n in unread:
        n.read_at = now
        db.add(n)
    db.commit()
