from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.core.config import get_settings
from app.services import realtime, serialize


def sla_due_for(priority: str, start: datetime | None = None) -> datetime:
    """Deadline for a given priority. Mirrors SLA_MINUTES on the mobile client."""
    settings = get_settings()
    minutes = settings.sla_minutes.get(priority, 480)
    return (start or datetime.now(timezone.utc)) + timedelta(minutes=minutes)


async def create_notification(
    db: Session,
    *,
    user_id: str,
    title: str,
    body: str,
    kind: str,
    incident_id: str | None = None,
) -> models.Notification:
    """Stores a notification and pushes it to that user's live sockets."""
    n = models.Notification(
        user_id=user_id, title=title, body=body, kind=kind, incident_id=incident_id
    )
    db.add(n)
    db.commit()
    db.refresh(n)

    await realtime.push_notification(
        user_id,
        {
            "id": n.id,
            "title": n.title,
            "body": n.body,
            "incident_id": n.incident_id,
            "kind": n.kind,
            "created_at": n.created_at.isoformat(),
        },
    )
    return n


async def notify_assignment(db: Session, incident: models.Incident) -> None:
    if not incident.assignee_id:
        return
    location = incident.location.code if incident.location else "General"
    await create_notification(
        db,
        user_id=incident.assignee_id,
        title=f"{location} assigned to you",
        body=incident.title,
        kind="assigned",
        incident_id=incident.id,
    )


async def notify_critical(db: Session, incident: models.Incident) -> None:
    """Alerts every supervisor and manager about a new critical incident."""
    recipients = db.scalars(
        select(models.User).where(models.User.role.in_(["supervisor", "manager"]))
    ).all()
    location = incident.location.code if incident.location else "General"
    for user in recipients:
        await create_notification(
            db,
            user_id=user.id,
            title=f"CRITICAL — {location}",
            body=incident.title,
            kind="critical",
            incident_id=incident.id,
        )


async def escalate_overdue(db: Session) -> int:
    """
    Escalates incidents past their SLA.

    Runs on a timer from the app lifespan. Returns how many were escalated so
    the caller can log it.
    """
    now = datetime.now(timezone.utc)
    overdue = db.scalars(
        select(models.Incident).where(
            models.Incident.status != "resolved",
            models.Incident.escalated.is_(False),
            models.Incident.sla_due_at.is_not(None),
            models.Incident.sla_due_at < now,
        )
    ).all()

    if not overdue:
        return 0

    supervisors = db.scalars(
        select(models.User).where(models.User.role.in_(["supervisor", "manager"]))
    ).all()

    for incident in overdue:
        incident.escalated = True
        # Bump the version so clients holding a stale copy re-sync rather than
        # writing over the escalation.
        incident.version += 1
        db.add(incident)
        db.commit()
        db.refresh(incident)

        location = incident.location.code if incident.location else "General"
        for user in supervisors:
            await create_notification(
                db,
                user_id=user.id,
                title=f"Overdue — {location}",
                body=f"{incident.title} has passed its SLA and was escalated.",
                kind="overdue",
                incident_id=incident.id,
            )

        await realtime.broadcast_incident(
            "incident:updated", serialize.incident_out(incident).model_dump(mode="json")
        )

    return len(overdue)
