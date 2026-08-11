import { useEffect, useState } from 'react';
import { subscribeUserSkillStates } from '../storage/skillsState';
import type { SkillPracticeState } from '../domain/skills';

export interface SkillStatesResult {
  states: SkillPracticeState[];
  /** True until the first snapshot arrives, from cache or server. */
  loading: boolean;
  error: string | null;
}

/**
 * Live practice state for every skill the user has graded.
 *
 * Offline this resolves from Firestore's IndexedDB cache and keeps updating as
 * local writes land, so the practice panel never waits on the network.
 */
export function useSkillStates(uid: string): SkillStatesResult {
  const [result, setResult] = useState<SkillStatesResult>({
    states: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    setResult({ states: [], loading: true, error: null });

    return subscribeUserSkillStates(
      uid,
      (states) => setResult({ states, loading: false, error: null }),
      (error) => setResult({ states: [], loading: false, error: error.message }),
    );
  }, [uid]);

  return result;
}
