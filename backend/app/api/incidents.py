import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import models, schemas
from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.services import notify, realtime, serialize

router = APIRouter(prefix="/incidents", tags=["incidents"])

# Only these transitions are legal, mirroring STATUS_FLOW on the client.
ALLOWED_NEXT: dict[str, set[str]] = {
    "reported": {"assigned", "in_progress"},
    "assigned": {"in_progress", "reported"},
    "in_progress": {"review", "assigned"},
    "review": {"resolved", "in_progress"},
    "resolved": set(),
}

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

# Shape of a valid QR sticker code, e.g. ROOM-402, EQUIP-FREEZER-1.
# Kept in sync with the client-side check in src/app/scan.tsx.
LOCATION_CODE_RE = re.compile(r"^(ROOM|AREA|EQUIP)-[A-Z0-9-]{1,30}$")


@router.get("", response_model=list[schemas.IncidentOut])
def list_incidents(user: CurrentUser, db: DbSession) -> list[schemas.IncidentOut]:
    """
    Staff see what they reported or are assigned; supervisors and managers see
    everything.
    """
    query = select(models.Incident).order_by(models.Incident.created_at.desc())
    if user.role == "staff":
        query = query.where(
            (models.Incident.reporter_id == user.id)
            | (models.Incident.assignee_id == user.id)
        )

    incidents = db.scalars(query).unique().all()
    return [serialize.incident_out(i) for i in incidents]


@router.get("/{incident_id}", response_model=schemas.IncidentOut)
def get_incident(incident_id: str, user: CurrentUser, db: DbSession) -> schemas.IncidentOut:
    incident = db.get(models.Incident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return serialize.incident_out(incident)


@router.post("", response_model=schemas.IncidentOut, status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: schemas.IncidentCreate, user: CurrentUser, db: DbSession
) -> schemas.IncidentOut:
    # Idempotent replay: a client retrying a create whose response it never saw
    # must get the original row back, not a second incident.
    if payload.client_key:
        existing = db.scalar(
            select(models.Incident).where(models.Incident.client_key == payload.client_key)
        )
        if existing is not None:
            return serialize.incident_out(existing)

    location = None
    if payload.location_code:
        code = payload.location_code.strip().upper()
        location = db.scalar(select(models.Location).where(models.Location.code == code))
        if location is None and LOCATION_CODE_RE.match(code):
            # A well-formed code for a location we have not registered yet gets
            # created on the spot. Dropping it would lose what the staff member
            # actually scanned, and the location then accumulates history like
            # any other.
            kind = {"ROOM": "room", "AREA": "area", "EQUIP": "equipment"}[
                code.split("-", 1)[0]
            ]
            location = models.Location(
                code=code, name=code.replace("-", " ").title(), kind=kind
            )
            db.add(location)
            db.flush()

    incident = models.Incident(
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category,
        priority=payload.priority,
        status="assigned" if payload.assignee_id else "reported",
        location_id=location.id if location else None,
        reporter_id=user.id,
        assignee_id=payload.assignee_id,
        sla_due_at=notify.sla_due_for(payload.priority),
        version=1,
        client_key=payload.client_key,
    )
    db.add(incident)
    try:
        db.commit()
    except IntegrityError:
        # Two retries raced past the check above; the unique index on client_key
        # is the real guarantee. Return whichever one won.
        db.rollback()
        if payload.client_key:
            winner = db.scalar(
                select(models.Incident).where(
                    models.Incident.client_key == payload.client_key
                )
            )
            if winner is not None:
                return serialize.incident_out(winner)
        raise
    db.refresh(incident)

    out = serialize.incident_out(incident)
    await realtime.broadcast_incident("incident:created", out.model_dump(mode="json"))

    if payload.assignee_id:
        await notify.notify_assignment(db, incident)
    if payload.priority == "critical":
        await notify.notify_critical(db, incident)

    return out


@router.patch("/{incident_id}")
async def update_incident(
    incident_id: str, payload: schemas.IncidentUpdate, user: CurrentUser, db: DbSession
):
    """
    Conditional update guarded by `base_version`.

    When the stored version has moved past what the client based its edit on,
    responds 409 with the server's current values so the client can show both
    sides and let a human choose.
    """
    incident = db.get(models.Incident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    if incident.version != payload.base_version:
        conflict = schemas.ConflictOut(
            server_version=incident.version,
            server_state={
                "status": incident.status,
                "priority": incident.priority,
                "assignee_id": incident.assignee_id,
                "assignee_name": incident.assignee.full_name if incident.assignee else None,
            },
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT, content=conflict.model_dump(mode="json")
        )

    # Role gates: only supervisors and managers may reassign, reprioritise or
    # close an incident.
    privileged = user.role in ("supervisor", "manager")
    if payload.assignee_id is not None and not privileged:
        raise HTTPException(status_code=403, detail="Only supervisors can assign work")
    if payload.priority is not None and not privileged:
        raise HTTPException(status_code=403, detail="Only supervisors can change priority")
    if payload.status == "resolved" and not privileged:
        raise HTTPException(status_code=403, detail="Only supervisors can resolve incidents")

    assignee_changed = False

    if payload.status is not None and payload.status != incident.status:
        if payload.status not in ALLOWED_NEXT.get(incident.status, set()):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot move an incident from {incident.status} to {payload.status}",
            )
        incident.status = payload.status
        incident.resolved_at = (
            datetime.now(timezone.utc) if payload.status == "resolved" else None
        )

    if payload.priority is not None and payload.priority != incident.priority:
        incident.priority = payload.priority
        # Re-base the SLA on the new priority, measured from when it was reported.
        incident.sla_due_at = notify.sla_due_for(payload.priority, incident.created_at)

    if payload.assignee_id is not None and payload.assignee_id != incident.assignee_id:
        if db.get(models.User, payload.assignee_id) is None:
            raise HTTPException(status_code=422, detail="Assignee does not exist")
        incident.assignee_id = payload.assignee_id
        assignee_changed = True

    incident.version += 1
    db.add(incident)
    db.commit()
    db.refresh(incident)

    out = serialize.incident_out(incident)
    await realtime.broadcast_incident("incident:updated", out.model_dump(mode="json"))

    if assignee_changed:
        await notify.notify_assignment(db, incident)

    return out


@router.post(
    "/{incident_id}/comments",
    response_model=schemas.CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    incident_id: str, payload: schemas.CommentIn, user: CurrentUser, db: DbSession
) -> schemas.CommentOut:
    incident = db.get(models.Incident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    comment = models.Comment(
        incident_id=incident.id, author_id=user.id, body=payload.body.strip()
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    db.refresh(incident)

    await realtime.broadcast_incident(
        "incident:updated", serialize.incident_out(incident).model_dump(mode="json")
    )
    return serialize.comment_out(comment)


@router.post(
    "/{incident_id}/attachments",
    response_model=schemas.AttachmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    incident_id: str, user: CurrentUser, db: DbSession, file: UploadFile = File(...)
) -> schemas.AttachmentOut:
    incident = db.get(models.Incident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG and WebP are accepted")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 8 MB or smaller")

    settings = get_settings()
    # Never trust the client filename; derive a safe one from the media type.
    suffix = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }[file.content_type]
    filename = f"{uuid.uuid4().hex}{suffix}"
    (Path(settings.upload_dir) / filename).write_bytes(contents)

    attachment = models.Attachment(incident_id=incident.id, filename=filename)
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    return schemas.AttachmentOut(
        id=attachment.id,
        incident_id=attachment.incident_id,
        url=serialize.attachment_url(filename),
    )
