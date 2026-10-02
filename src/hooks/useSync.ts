import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as repo from '../db/repo';
import {
  drain,
  getSyncStatus,
  refreshCounts,
  resolveKeepServer,
  resolveUseMine,
  subscribeSync,
} from '../lib/sync';
import { subscribeConnectivity } from '../lib/connectivity';
import type { ConflictPayload } from '../types';

/** Live view of the sync engine for the status banner. */
export function useSyncStatus() {
  const [status, setStatus] = useState(getSyncStatus);
  useEffect(() => subscribeSync(setStatus), []);
  return status;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => subscribeConnectivity(setOnline), []);
  return online;
}

export interface ConflictEntry {
  outboxId: number;
  conflict: ConflictPayload;
  incidentTitle: string;
}

/**
 * Loads parked conflicts for the resolution screen, refreshing whenever the
 * sync engine reports a new one.
 */
export function useConflicts() {
  const [entries, setEntries] = useState<ConflictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const status = useSyncStatus();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await repo.listConflicts();
      const withTitles: ConflictEntry[] = [];
      for (const { row, conflict } of rows) {
        const incident = await repo.getIncident(conflict.incidentId);
        withTitles.push({
          outboxId: row.id,
          conflict,
          incidentTitle: incident?.title ?? 'Incident',
        });
      }
      if (!cancelled) {
        setEntries(withTitles);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status.conflicts]);

  const keepServer = async (entry: ConflictEntry) => {
    await resolveKeepServer(entry.outboxId, entry.conflict.incidentId);
    setEntries((prev) => prev.filter((e) => e.outboxId !== entry.outboxId));
    await queryClient.invalidateQueries();
  };

  // Named `applyMine` rather than `useMine`: a `use` prefix makes lint rules
  // (and readers) treat it as a Hook, which it is not.
  const applyMine = async (entry: ConflictEntry) => {
    await resolveUseMine(entry.outboxId, entry.conflict.serverVersion);
    setEntries((prev) => prev.filter((e) => e.outboxId !== entry.outboxId));
    await queryClient.invalidateQueries();
  };

  return { entries, loading, keepServer, applyMine };
}

/** Manual "sync now" for the pull-to-refresh and the status banner tap. */
export function useManualSync() {
  const queryClient = useQueryClient();
  return async () => {
    await drain();
    await refreshCounts();
    await queryClient.invalidateQueries();
  };
}
