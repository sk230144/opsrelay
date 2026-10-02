"""
Seeds demo data: three users across the role hierarchy, a set of locations whose
codes match printable QR stickers, and a spread of incidents including one
already past its SLA so escalation is visible immediately.

Idempotent - running it twice does not duplicate anything.
"""

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.core.db import Base, SessionLocal, engine
from app.core.security import hash_password
from app.services.notify import sla_due_for

DEMO_PASSWORD = "opsrelay123"

USERS = [
    ("maya@opsrelay.dev", "Maya Fernandes", "manager", "Operations"),
    ("sam@opsrelay.dev", "Sam Okonkwo", "supervisor", "Maintenance"),
    ("raj@opsrelay.dev", "Raj Mehta", "staff", "Housekeeping"),
    ("lena@opsrelay.dev", "Lena Hofer", "staff", "Front Desk"),
]

LOCATIONS = [
    ("ROOM-402", "Room 402", "room", "4"),
    ("ROOM-311", "Room 311", "room", "3"),
    ("ROOM-208", "Room 208", "room", "2"),
    ("AREA-LOBBY", "Main Lobby", "area", "G"),
    ("AREA-KITCHEN", "Main Kitchen", "area", "G"),
    ("EQUIP-FREEZER-1", "Walk-in Freezer 1", "equipment", "B"),
    ("EQUIP-LIFT-2", "Service Lift 2", "equipment", None),
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        _seed_users(db)
        _seed_locations(db)
        _seed_incidents(db)
    finally:
        db.close()


def _seed_users(db: Session) -> None:
    for email, name, role, dept in USERS:
        if db.scalar(select(models.User).where(models.User.email == email)):
            continue
        db.add(
            models.User(
                email=email,
                full_name=name,
                role=role,
                department=dept,
                hashed_password=hash_password(DEMO_PASSWORD),
            )
        )
    db.commit()


def _seed_locations(db: Session) -> None:
    for code, name, kind, floor in LOCATIONS:
        if db.scalar(select(models.Location).where(models.Location.code == code)):
            continue
        db.add(models.Location(code=code, name=name, kind=kind, floor=floor))
    db.commit()


def _seed_incidents(db: Session) -> None:
    # Only seed incidents on a genuinely empty database.
    if db.scalar(select(models.Incident).limit(1)):
        return

    users = {u.email: u for u in db.scalars(select(models.User)).all()}
    locations = {location.code: location for location in db.scalars(select(models.Location)).all()}

    maya = users["maya@opsrelay.dev"]
    sam = users["sam@opsrelay.dev"]
    raj = users["raj@opsrelay.dev"]
    lena = users["lena@opsrelay.dev"]

    now = datetime.now(timezone.utc)

    seeds = [
        # Already overdue, so SLA escalation is visible on first launch.
        {
            "title": "AC not cooling, guest has complained twice",
            "description": "Room is at 28C. Guest requested an update before 9 PM.",
            "category": "maintenance",
            "priority": "critical",
            "status": "in_progress",
            "location": "ROOM-402",
            "reporter": lena,
            "assignee": sam,
            "created": now - timedelta(minutes=55),
        },
        {
            "title": "Walk-in freezer reading -8C instead of -18C",
            "description": "Kitchen flagged it during the morning temperature check.",
            "category": "safety",
            "priority": "critical",
            "status": "assigned",
            "location": "EQUIP-FREEZER-1",
            "reporter": raj,
            "assignee": sam,
            "created": now - timedelta(minutes=12),
        },
        {
            "title": "Lobby spotlight flickering",
            "description": "Third fitting from the entrance.",
            "category": "maintenance",
            "priority": "low",
            "status": "reported",
            "location": "AREA-LOBBY",
            "reporter": lena,
            "assignee": None,
            "created": now - timedelta(hours=3),
        },
        {
            "title": "Extra towels and pillows requested",
            "description": "Family of four, checking out tomorrow.",
            "category": "guest_request",
            "priority": "medium",
            "status": "resolved",
            "location": "ROOM-311",
            "reporter": lena,
            "assignee": raj,
            "created": now - timedelta(hours=6),
        },
        {
            "title": "Service lift making grinding noise",
            "description": "Noticeable between floors 2 and 3 when loaded.",
            "category": "maintenance",
            "priority": "high",
            "status": "review",
            "location": "EQUIP-LIFT-2",
            "reporter": raj,
            "assignee": sam,
            "created": now - timedelta(hours=1, minutes=20),
        },
        {
            "title": "Bathroom drain draining slowly",
            "description": "Standing water after a shower.",
            "category": "housekeeping",
            "priority": "medium",
            "status": "reported",
            "location": "ROOM-208",
            "reporter": raj,
            "assignee": None,
            "created": now - timedelta(minutes=40),
        },
    ]

    created: list[models.Incident] = []
    for s in seeds:
        location = locations.get(s["location"])
        incident = models.Incident(
            title=s["title"],
            description=s["description"],
            category=s["category"],
            priority=s["priority"],
            status=s["status"],
            location_id=location.id if location else None,
            reporter_id=s["reporter"].id,
            assignee_id=s["assignee"].id if s["assignee"] else None,
            created_at=s["created"],
            updated_at=s["created"],
            sla_due_at=sla_due_for(s["priority"], s["created"]),
            resolved_at=now - timedelta(hours=4) if s["status"] == "resolved" else None,
            version=1,
        )
        db.add(incident)
        created.append(incident)
    db.commit()

    for incident in created:
        db.refresh(incident)

    db.add_all(
        [
            models.Comment(
                incident_id=created[0].id,
                author_id=sam.id,
                body="Compressor looks faulty. Ordering a replacement part now.",
                created_at=now - timedelta(minutes=30),
            ),
            models.Comment(
                incident_id=created[0].id,
                author_id=maya.id,
                body="Offer the guest a room change if this is not fixed by 8 PM.",
                created_at=now - timedelta(minutes=18),
            ),
            models.Comment(
                incident_id=created[4].id,
                author_id=sam.id,
                body="Tightened the guide rails. Needs a load test before sign-off.",
                created_at=now - timedelta(minutes=25),
            ),
        ]
    )

    db.add(
        models.Handover(
            from_user_id=lena.id,
            shift="morning",
            notes=(
                "Guest in Room 402 requested an update before 9 PM. "
                "Freezer engineer is booked for 14:00."
            ),
            incident_ids=json.dumps([created[0].id, created[1].id, created[2].id]),
            created_at=now - timedelta(hours=2),
        )
    )

    db.add_all(
        [
            models.Notification(
                user_id=sam.id,
                title="CRITICAL — ROOM-402",
                body="AC not cooling, guest has complained twice",
                kind="critical",
                incident_id=created[0].id,
                created_at=now - timedelta(minutes=54),
            ),
            models.Notification(
                user_id=sam.id,
                title="EQUIP-FREEZER-1 assigned to you",
                body="Walk-in freezer reading -8C instead of -18C",
                kind="assigned",
                incident_id=created[1].id,
                created_at=now - timedelta(minutes=11),
            ),
        ]
    )
    db.commit()


if __name__ == "__main__":
    seed()
    print("Seeded. Demo accounts (password: opsrelay123):")
    for email, name, role, _ in USERS:
        print(f"  {role:<11} {email:<22} {name}")
