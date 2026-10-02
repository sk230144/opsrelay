import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as repo from '../db/repo';
import { onIncidentPush } from '../lib/socket';
import { pullAll } from '../lib/sync';
import { useAuth } from '../stores/auth';
import { SLA_MINUTES, type IncidentPriority } from '../types';

/**
 * Reads always come from SQLite, never straight from the network. A pull
 * refreshes the cache and the query re-reads it, so the UI renders identically
 * online and offline.
 */

export const INCIDENTS_KEY = ['incidents'] as const;

export function useIncidents() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: INCIDENTS_KEY,
    queryFn: async () => {
      // Kick a background refresh, but resolve from the cache either way.
      void pullAll().then(() =>
        queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY })
      );
      return repo.listIncidents();
    },
    staleTime: 15_000,
  });

  // A live push should update the list without a manual refresh.
  useEffect(() => {
    return onIncidentPush(() => {
      void queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
    });
  }, [queryClient]);

  return query;
}

export function useIncident(id: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['incident', id],
    queryFn: () => (id ? repo.getIncident(id) : null),
    enabled: !!id,
  });

  useEffect(() => {
    if (!id) return;
    return onIncidentPush((incident) => {
      if (incident.id === id) {
        void queryClient.invalidateQueries({ queryKey: ['incident', id] });
      }
    });
  }, [id, queryClient]);

  return query;
}

export type IncidentFilter = 'open' | 'mine' | 'critical';

/** Splits the incident list into the three tabs the dashboard exposes. */
export function useFilteredIncidents(filter: IncidentFilter) {
  const { data = [], ...rest } = useIncidents();
  const userId = useAuth((s) => s.user?.id);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'open':
        return data.filter((i) => i.status !== 'resolved');
      case 'mine':
        return data.filter((i) => i.assigneeId === userId && i.status !== 'resolved');
      case 'critical':
        return data.filter((i) => i.priority === 'critical' && i.status !== 'resolved');
    }
  }, [data, filter, userId]);

  return { data: filtered, ...rest };
}

export function useDashboardStats() {
  const { data = [] } = useIncidents();
  const userId = useAuth((s) => s.user?.id);

  return useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return {
      critical: data.filter((i) => i.priority === 'critical' && i.status !== 'resolved')
        .length,
      open: data.filter((i) => i.status !== 'resolved').length,
      assignedToMe: data.filter((i) => i.assigneeId === userId && i.status !== 'resolved')
        .length,
      resolvedToday: data.filter(
        (i) => i.resolvedAt && new Date(i.resolvedAt) >= startOfDay
      ).length,
    };
  }, [data, userId]);
}

/**
 * Drives SLA countdowns. One interval for the whole screen rather than one per
 * card, so a list of 50 incidents still ticks cheaply.
 */
export function useTicker(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Computes the SLA deadline for a new incident from its priority. */
export function slaDueFor(priority: IncidentPriority, from = new Date()): string {
  return new Date(from.getTime() + SLA_MINUTES[priority] * 60_000).toISOString();
}

/** Invalidates every incident-derived query after a local write. */
export function useRefreshIncidents() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
    await queryClient.invalidateQueries({ queryKey: ['incident'] });
  }, [queryClient]);
}
