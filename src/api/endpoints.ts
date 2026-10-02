import { api } from './client';
import type {
  Comment,
  CreateIncidentInput,
  Handover,
  Incident,
  Location,
  Notification,
  Role,
  UpdateIncidentInput,
  User,
} from '../types';

/**
 * Wire format from FastAPI (snake_case) and the mappers into domain types.
 * Keeping the translation in one place means the rest of the app never sees
 * snake_case, and a backend rename touches only this file.
 */

interface WireUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  department: string | null;
}

interface WireComment {
  id: string;
  incident_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

interface WireAttachment {
  id: string;
  incident_id: string;
  url: string;
}

interface WireIncident {
  id: string;
  title: string;
  description: string;
  category: Incident['category'];
  priority: Incident['priority'];
  status: Incident['status'];
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  reporter_id: string;
  reporter_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  sla_due_at: string | null;
  resolved_at: string | null;
  escalated: boolean;
  version: number;
  comments?: WireComment[];
  attachments?: WireAttachment[];
}

interface WireHandover {
  id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string | null;
  to_user_name: string | null;
  shift: Handover['shift'];
  notes: string;
  incident_ids: string[];
  created_at: string;
  acknowledged_at: string | null;
}

interface WireNotification {
  id: string;
  title: string;
  body: string;
  incident_id: string | null;
  kind: Notification['kind'];
  read_at: string | null;
  created_at: string;
}

export function mapUser(w: WireUser): User {
  return {
    id: w.id,
    email: w.email,
    fullName: w.full_name,
    role: w.role,
    department: w.department,
  };
}

function mapComment(w: WireComment): Comment {
  return {
    id: w.id,
    incidentId: w.incident_id,
    authorId: w.author_id,
    authorName: w.author_name,
    body: w.body,
    createdAt: w.created_at,
    synced: true,
  };
}

export function mapIncident(w: WireIncident): Incident {
  return {
    id: w.id,
    title: w.title,
    description: w.description,
    category: w.category,
    priority: w.priority,
    status: w.status,
    locationId: w.location_id,
    locationCode: w.location_code,
    locationName: w.location_name,
    reporterId: w.reporter_id,
    reporterName: w.reporter_name,
    assigneeId: w.assignee_id,
    assigneeName: w.assignee_name,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    slaDueAt: w.sla_due_at,
    resolvedAt: w.resolved_at,
    escalated: w.escalated,
    version: w.version,
    pending: false,
    dirty: false,
    comments: w.comments?.map(mapComment),
    attachments: w.attachments?.map((a) => ({
      id: a.id,
      incidentId: a.incident_id,
      uri: a.url,
      uploaded: true,
    })),
  };
}

function mapHandover(w: WireHandover): Handover {
  return {
    id: w.id,
    fromUserId: w.from_user_id,
    fromUserName: w.from_user_name,
    toUserId: w.to_user_id,
    toUserName: w.to_user_name,
    shift: w.shift,
    notes: w.notes,
    incidentIds: w.incident_ids,
    createdAt: w.created_at,
    acknowledgedAt: w.acknowledged_at,
  };
}

function mapNotification(w: WireNotification): Notification {
  return {
    id: w.id,
    title: w.title,
    body: w.body,
    incidentId: w.incident_id,
    kind: w.kind,
    readAt: w.read_at,
    createdAt: w.created_at,
  };
}

// ---------------- auth ----------------

export interface LoginResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await api.post<{
    user: WireUser;
    access_token: string;
    refresh_token: string;
  }>('/auth/login', { email, password });
  return {
    user: mapUser(res.data.user),
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
  };
}

export async function fetchMe(): Promise<User> {
  const res = await api.get<WireUser>('/auth/me');
  return mapUser(res.data);
}

export async function registerPushToken(token: string): Promise<void> {
  await api.post('/auth/push-token', { token });
}

// ---------------- incidents ----------------

export async function fetchIncidents(): Promise<Incident[]> {
  const res = await api.get<WireIncident[]>('/incidents');
  return res.data.map(mapIncident);
}

export async function fetchIncident(id: string): Promise<Incident> {
  const res = await api.get<WireIncident>(`/incidents/${id}`);
  return mapIncident(res.data);
}

export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
  const res = await api.post<WireIncident>('/incidents', {
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    location_code: input.locationCode,
    assignee_id: input.assigneeId,
    client_key: input.clientKey,
  });
  return mapIncident(res.data);
}

/**
 * Sends a conditional update. The server compares `base_version` and responds
 * 409 with both sides' values when another write landed first.
 */
export async function updateIncident(
  id: string,
  input: UpdateIncidentInput
): Promise<Incident> {
  const res = await api.patch<WireIncident>(`/incidents/${id}`, {
    status: input.status,
    priority: input.priority,
    assignee_id: input.assigneeId,
    base_version: input.baseVersion,
  });
  return mapIncident(res.data);
}

export async function addComment(incidentId: string, body: string): Promise<Comment> {
  const res = await api.post<WireComment>(`/incidents/${incidentId}/comments`, { body });
  return mapComment(res.data);
}

/** Multipart upload of a local photo captured on-device. */
export async function uploadAttachment(
  incidentId: string,
  uri: string
): Promise<{ id: string; url: string }> {
  const form = new FormData();
  const name = uri.split('/').pop() ?? 'photo.jpg';
  const ext = name.split('.').pop()?.toLowerCase();
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  // React Native's FormData takes this {uri,name,type} shape, not a Blob.
  form.append('file', { uri, name, type } as unknown as Blob);
  const res = await api.post<WireAttachment>(`/incidents/${incidentId}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30_000,
  });
  return { id: res.data.id, url: res.data.url };
}

// ---------------- reference data ----------------

export async function fetchLocations(): Promise<Location[]> {
  const res = await api.get<
    { id: string; code: string; name: string; kind: Location['kind']; floor: string | null }[]
  >('/locations');
  return res.data;
}

export async function fetchStaff(): Promise<User[]> {
  const res = await api.get<WireUser[]>('/users');
  return res.data.map(mapUser);
}

// ---------------- handovers ----------------

export async function fetchHandovers(): Promise<Handover[]> {
  const res = await api.get<WireHandover[]>('/handovers');
  return res.data.map(mapHandover);
}

export async function createHandover(input: {
  shift: Handover['shift'];
  notes: string;
  incidentIds: string[];
}): Promise<Handover> {
  const res = await api.post<WireHandover>('/handovers', {
    shift: input.shift,
    notes: input.notes,
    incident_ids: input.incidentIds,
  });
  return mapHandover(res.data);
}

export async function acknowledgeHandover(id: string): Promise<Handover> {
  const res = await api.post<WireHandover>(`/handovers/${id}/acknowledge`, {});
  return mapHandover(res.data);
}

// ---------------- notifications ----------------

export async function fetchNotifications(): Promise<Notification[]> {
  const res = await api.get<WireNotification[]>('/notifications');
  return res.data.map(mapNotification);
}

export async function markNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all', {});
}
