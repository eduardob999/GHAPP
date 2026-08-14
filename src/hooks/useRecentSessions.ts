import { useEffect, useState } from 'react';
import { subscribeRecentSessions, type SessionRecord } from '../storage/sessionLog';

export interface RecentSessionsState {
  sessions: SessionRecord[];
  loading: boolean;
  error: string | null;
}

/**
 * The last few practice runs, newest first.
 *
 * Reads the append-only log rather than skill state, so what is shown is what
 * actually happened rather than the scheduler's running summary of it.
 */
export function useRecentSessions(uid: string, count = 8): RecentSessionsState {
  const [state, setState] = useState<RecentSessionsState>({
    sessions: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    setState({ sessions: [], loading: true, error: null });

    return subscribeRecentSessions(
      uid,
      count,
      (sessions) => setState({ sessions, loading: false, error: null }),
      (error) => setState({ sessions: [], loading: false, error: error.message }),
    );
  }, [uid, count]);

  return state;
}
