import json
from datetime import datetime, timezone

from app.core.config import get_settings
from app import models
from app import schemas


def as_utc(value: datetime | None) -> datetime | None:
    """
    Tags a naive datetime as UTC.

    SQLite does not preserve tzinfo even on DateTime(timezone=True) columns, so
    values come back naive. Everything is stored in UTC, and the mobile client
    parses these with `new Date(...)` - which treats an offset-less string as
    *local* time. Without this the SLA countdowns would be wrong by the device's
    UTC offset.
    """
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def attachment_url(filename: str) -> str:
    settings = get_settings()
    return f"{settings.public_base_url}/uploads/{filename}"


def comment_out(c: models.Comment) -> schemas.CommentOut:
    return schemas.CommentOut(
        id=c.id,
        incident_id=c.incident_id,
        author_id=c.author_id,
        author_name=c.author.full_name if c.author else "Unknown",
        body=c.body,
        created_at=as_utc(c.created_at),
    )


def incident_out(i: models.Incident, *, include_children: bool = True) -> schemas.IncidentOut:
    return schemas.IncidentOut(
        id=i.id,
        title=i.title,
        description=i.description,
        category=i.category,  # type: ignore[arg-type]
        priority=i.priority,  # type: ignore[arg-type]
        status=i.status,  # type: ignore[arg-type]
        location_id=i.location_id,
        location_code=i.location.code if i.location else None,
        location_name=i.location.name if i.location else None,
        reporter_id=i.reporter_id,
        reporter_name=i.reporter.full_name if i.reporter else "Unknown",
        assignee_id=i.assignee_id,
        assignee_name=i.assignee.full_name if i.assignee else None,
        created_at=as_utc(i.created_at),
        updated_at=as_utc(i.updated_at),
        sla_due_at=as_utc(i.sla_due_at),
        resolved_at=as_utc(i.resolved_at),
        escalated=i.escalated,
        version=i.version,
        comments=[comment_out(c) for c in i.comments] if include_children else [],
        attachments=(
            [
                schemas.AttachmentOut(
                    id=a.id, incident_id=a.incident_id, url=attachment_url(a.filename)
                )
                for a in i.attachments
            ]
            if include_children
            else []
        ),
    )


def handover_out(h: models.Handover) -> schemas.HandoverOut:
    try:
        ids = json.loads(h.incident_ids)
        if not isinstance(ids, list):
            ids = []
    except (ValueError, TypeError):
        ids = []

    return schemas.HandoverOut(
        id=h.id,
        from_user_id=h.from_user_id,
        from_user_name=h.from_user.full_name if h.from_user else "Unknown",
        to_user_id=h.to_user_id,
        to_user_name=h.to_user.full_name if h.to_user else None,
        shift=h.shift,  # type: ignore[arg-type]
        notes=h.notes,
        incident_ids=[str(x) for x in ids],
        created_at=as_utc(h.created_at),
        acknowledged_at=as_utc(h.acknowledged_at),
    )


def notification_out(n: models.Notification) -> schemas.NotificationOut:
    return schemas.NotificationOut(
        id=n.id,
        title=n.title,
        body=n.body,
        incident_id=n.incident_id,
        kind=n.kind,  # type: ignore[arg-type]
        read_at=as_utc(n.read_at),
        created_at=as_utc(n.created_at),
    )


def user_out(u: models.User) -> schemas.UserOut:
    return schemas.UserOut(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        role=u.role,  # type: ignore[arg-type]
        department=u.department,
    )
