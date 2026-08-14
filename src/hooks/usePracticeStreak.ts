import { useMemo } from 'react';
import { summariseStreak, type StreakSummary } from '../domain/streaks';
import { useRecentSessions } from './useRecentSessions';

export interface PracticeStreakState {
  streak: StreakSummary;
  /** Accuracy of the most recent run, 0–1, or null if there has never been one. */
  lastAccuracy: number | null;
  loading: boolean;
  error: string | null;
}

/**
 * How many days in a row the user has practised.
 *
 * Counted from the append-only session log, not from skill state: skill state is
 * a summary the scheduler overwrites, so it cannot say *when* anything happened.
 *
 * The window is finite — a streak longer than this many sessions would be
 * undercounted — but 400 runs is well over a year of daily practice, and an
 * unbounded query on every dashboard render is not worth the completeness.
 */
export function usePracticeStreak(uid: string, lookback = 400): PracticeStreakState {
  const { sessions, loading, error } = useRecentSessions(uid, lookback);

  return useMemo(() => {
    const dates = sessions
      .map((session) => session.at?.toDate() ?? session.recordedAt?.toDate() ?? null)
      .filter((date): date is Date => date !== null);

    return {
      streak: summariseStreak(dates, new Date()),
      lastAccuracy: sessions[0]?.accuracy ?? null,
      loading,
      error,
    };
  }, [sessions, loading, error]);
}
