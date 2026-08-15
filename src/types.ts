import type { Handedness } from './domain/handedness';
import type { Timestamp } from 'firebase/firestore';

/**
 * The document stored at /users/{uid}.
 *
 * Timestamp fields are nullable because Firestore writes `serverTimestamp()` as
 * null in the local cache until the server confirms the real value. Offline,
 * that null can stick around for a while — render accordingly.
 */
export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
  /** Demo counter used to prove that offline writes queue and later sync. */
  practicePings: number;
  /**
   * Which way round the fretboard diagrams are drawn. Stored per user rather
   * than per device: a left-handed player is left-handed on their phone too,
   * and a device-local setting would make the second device a second account.
   */
  handedness?: Handedness;
}

/**
 * Where a snapshot came from, so the UI can be honest about it.
 *
 * `cache` means Firestore answered from IndexedDB without reaching the server —
 * either you are offline, or the server round-trip has not landed yet.
 */
export interface ProfileSnapshot {
  profile: UserProfile | null;
  fromCache: boolean;
  hasPendingWrites: boolean;
}
