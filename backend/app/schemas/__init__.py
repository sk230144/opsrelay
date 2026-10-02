from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

Role = Literal["staff", "supervisor", "manager"]
Category = Literal["maintenance", "housekeeping", "guest_request", "safety"]
Priority = Literal["low", "medium", "high", "critical"]
Status = Literal["reported", "assigned", "in_progress", "review", "resolved"]
Shift = Literal["morning", "evening", "night"]
NotificationKind = Literal["assigned", "critical", "overdue", "review", "handover"]


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: Role
    department: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    user: UserOut
    access_token: str
    refresh_token: str


class RefreshIn(BaseModel):
    # camelCase on the wire because the mobile client sends it that way.
    refreshToken: str


class RefreshOut(BaseModel):
    accessToken: str
    refreshToken: str


class PushTokenIn(BaseModel):
    token: str


class LocationOut(BaseModel):
    id: str
    code: str
    name: str
    kind: str
    floor: str | None = None


class CommentOut(BaseModel):
    id: str
    incident_id: str
    author_id: str
    author_name: str
    body: str
    created_at: datetime


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class AttachmentOut(BaseModel):
    id: str
    incident_id: str
    url: str


class IncidentOut(BaseModel):
    id: str
    title: str
    description: str
    category: Category
    priority: Priority
    status: Status
    location_id: str | None
    location_code: str | None
    location_name: str | None
    reporter_id: str
    reporter_name: str
    assignee_id: str | None
    assignee_name: str | None
    created_at: datetime
    updated_at: datetime
    sla_due_at: datetime | None
    resolved_at: datetime | None
    escalated: bool
    version: int
    comments: list[CommentOut] = []
    attachments: list[AttachmentOut] = []


class IncidentCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    category: Category
    priority: Priority
    location_code: str | None = None
    assignee_id: str | None = None
    # Client-generated, stable across retries of the same report. An offline
    # device whose POST succeeded but whose response was lost will retry with
    # the same key; the server returns the original incident instead of
    # creating a duplicate.
    client_key: str | None = Field(default=None, max_length=64)


class IncidentUpdate(BaseModel):
    status: Status | None = None
    priority: Priority | None = None
    assignee_id: str | None = None
    # The version the client's edit was based on. Required for conflict detection.
    base_version: int


class ConflictOut(BaseModel):
    """Body of a 409 response, giving the client both sides to compare."""

    detail: str = "version_conflict"
    server_version: int
    server_state: dict


class HandoverOut(BaseModel):
    id: str
    from_user_id: str
    from_user_name: str
    to_user_id: str | None
    to_user_name: str | None
    shift: Shift
    notes: str
    incident_ids: list[str]
    created_at: datetime
    acknowledged_at: datetime | None


class HandoverCreate(BaseModel):
    shift: Shift
    notes: str = Field(default="", max_length=4000)
    incident_ids: list[str] = []


class NotificationOut(BaseModel):
    id: str
    title: str
    body: str
    incident_id: str | None
    kind: NotificationKind
    read_at: datetime | None
    created_at: datetime
