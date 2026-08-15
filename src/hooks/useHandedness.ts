import type { User } from 'firebase/auth';
import { DEFAULT_HANDEDNESS, type Handedness } from '../domain/handedness';
import { useUserProfile } from './useUserProfile';

/**
 * Which way round to draw the diagrams.
 *
 * A one-line hook so the three panels that draw a fretboard do not each have to
 * know that the setting lives on the user profile — and so that changing where
 * it is stored is one edit rather than four.
 */
export function useHandedness(user: User): Handedness {
  const { profile } = useUserProfile(user);
  return profile?.handedness ?? DEFAULT_HANDEDNESS;
}
