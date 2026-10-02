import { SLA_MINUTES, type IncidentCategory, type IncidentPriority, type IncidentStatus } from '../types';

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  maintenance: 'Maintenance',
  housekeeping: 'Housekeeping',
  guest_request: 'Guest Request',
  safety: 'Safety',
};

export const PRIORITY_LABEL: Record<IncidentPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  reported: 'Reported',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  resolved: 'Resolved',
};



export const CATEGORY_ICON: Record<IncidentCategory, string> = {
  maintenance: 'build',
  housekeeping: 'cleaning-services',
  guest_request: 'room-service',
  safety: 'health-and-safety',
};

/** "18m left" / "25m overdue" for an SLA deadline. Null when there is no deadline. */
export function slaRemaining(dueAt: string | null): {
  label: string;
  overdue: boolean;
  msLeft: number;
} | null {
  if (!dueAt) return null;
  const msLeft = new Date(dueAt).getTime() - Date.now();
  const overdue = msLeft < 0;
  const abs = Math.abs(msLeft);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  // Under an hour, seconds matter — this is the countdown staff watch.
  const core = h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  return { label: overdue ? `${core} overdue` : `${core} left`, overdue, msLeft };
}

/** Full HH:MM:SS countdown for the incident detail screen. */
export function countdown(dueAt: string | null): string {
  if (!dueAt) return '--:--:--';
  const ms = Math.abs(new Date(dueAt).getTime() - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function slaWindowLabel(priority: IncidentPriority): string {
  const mins = SLA_MINUTES[priority];
  return mins >= 60 ? `${mins / 60}h` : `${mins} min`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}
