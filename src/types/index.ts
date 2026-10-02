/**
 * Core domain model for OpsRelay.
 *
 * These types mirror the FastAPI schemas in backend/app/schemas. The `version`
 * field on Incident is what makes offline conflict detection possible: every
 * mutation carries the version it was based on, and the server rejects writes
 * built on a stale version.
 */

export type Role = 'staff' | 'supervisor' | 'manager';

export type IncidentCategory =
  | 'maintenance'
  | 'housekeeping'
  | 'guest_request'
  | 'safety';

export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'reported'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'resolved';

/** Status flow is strictly ordered; used to validate transitions client-side. */
export const STATUS_FLOW: IncidentStatus[] = [
  'reported',
  'assigned',
  'in_progress',
  'review',
  'resolved',
];

/** Minutes allowed to resolve, by priority. Mirrors backend SLA_MINUTES. */
export const SLA_MINUTES: Record<IncidentPriority, number> = {
  critical: 30,
  high: 120,
  medium: 480,
  low: 1440,
};

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  department: string | null;
}

export interface Location {
  id: string;
  /** The value encoded in the physical QR sticker, e.g. "ROOM-402". */
  code: string;
  name: string;
  kind: 'room' | 'area' | 'equipment';
  floor: string | null;
}

export interface Comment {
  id: string;
  incidentId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** False while the comment is still only in the local sync queue. */
  synced?: boolean;
}

export interface Attachment {
  id: string;
  incidentId: string;
  /** Remote URL once uploaded, or a local file:// URI while pending. */
  uri: string;
  uploaded: boolean;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  category: IncidentCategory;
  priority: IncidentPriority;
  status: IncidentStatus;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  reporterId: string;
  reporterName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Deadline derived from priority at creation time. */
  slaDueAt: string | null;
  resolvedAt: string | null;
  escalated: boolean;
  /** Monotonic server version, incremented on every write. */
  version: number;
  comments?: Comment[];
  attachments?: Attachment[];

  // ---- Local-only fields (never sent to the server) ----
  /** True when this row exists only locally and has no server id yet. */
  pending?: boolean;
  /** True when a local edit is queued on top of server state. */
  dirty?: boolean;
}

export interface Handover {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string | null;
  toUserName: string | null;
  shift: 'morning' | 'evening' | 'night';
  notes: string;
  incidentIds: string[];
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  incidentId: string | null;
  kind: 'assigned' | 'critical' | 'overdue' | 'review' | 'handover';
  readAt: string | null;
  createdAt: string;
}

export interface DashboardStats {
  critical: number;
  open: number;
  assignedToMe: number;
  resolvedToday: number;
}

/** A write waiting in the offline queue. */
export type QueuedOp =
  | { kind: 'create_incident'; payload: CreateIncidentInput }
  | { kind: 'update_incident'; payload: UpdateIncidentInput }
  | { kind: 'add_comment'; payload: { incidentId: string; body: string } }
  | { kind: 'acknowledge_handover'; payload: { handoverId: string } };

export interface CreateIncidentInput {
  title: string;
  description: string;
  category: IncidentCategory;
  priority: IncidentPriority;
  locationCode: string | null;
  assigneeId: string | null;
  photoUris: string[];
  /**
   * Idempotency key, generated once when the report is queued and persisted
   * with it. Retrying a create whose response was lost returns the original
   * incident instead of creating a duplicate.
   */
  clientKey?: string;
}

export interface UpdateIncidentInput {
  status?: IncidentStatus;
  priority?: IncidentPriority;
  assigneeId?: string | null;
  /** Version this edit was based on, for conflict detection. */
  baseVersion: number;
}

/** Raised when the server state has moved on past our base version. */
export interface ConflictPayload {
  incidentId: string;
  localVersion: number;
  serverVersion: number;
  /** The fields we tried to write. */
  localChange: Record<string, unknown>;
  /** The server's current values for those same fields. */
  serverChange: Record<string, unknown>;
}
