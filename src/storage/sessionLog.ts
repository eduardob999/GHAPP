import {
  Timestamp,
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Append-only practice history at `/users/{uid}/sessions/{sessionId}`.
 *
 * Separate from `/users/{uid}/skills` on purpose. Skill state is a *summary*
 * that the scheduler overwrites on every rep — change the algorithm and the
 * old numbers are gone. This is the raw record of what actually happened, so a
 * future scheduler can be evaluated against real history rather than starting
 * from nothing.
 *
 * Covered by the Task 1 security rules through their `{document=**}` wildcard;
 * no rules change is needed.
 */

const USERS = 'users';
const SESSIONS = 'sessions';

export type SessionKind = 'chord-hero' | 'today' | 'shape-trainer' | 'drill';

export interface SessionEntry {
  kind: SessionKind;
  /** What was practised: a progression id, a skill id, a drill name. */
  subject: string;
  /** Human-readable, so a log line is legible without the catalog to hand. */
  title: string;
  /** 0–1. Fraction of steps cleanly hit. */
  accuracy: number;
  steps: number;
  hits: number;
  partials: number;
  misses: number;
  tempoBpm?: number;
  bestStreak?: number;
  /** Mean absolute attack offset in ms, when onsets were detected. */
  meanTimingMs?: number;
  /**
   * Where the verdict came from. Absent means audio, which is what every record
   * written before self-grading existed was. Worth keeping: a future scheduler
   * evaluated against this history should know which rows are a microphone's
   * opinion and which are the player's.
   */
  graded?: 'audio' | 'self';
}

export interface SessionRecord extends SessionEntry {
  id: string;
  recordedAt?: Timestamp;
  /**
   * Client clock, written at the same moment as `recordedAt`. This is the one
   * to count streaks by: it is present the instant the write hits the local
   * cache, whereas `serverTimestamp()` reads back null until the server lands —
   * so offline, a run recorded today would otherwise not count as today.
   */
  at?: Timestamp;
}

function sessionsCollection(uid: string) {
  return collection(db, USERS, uid, SESSIONS);
}

/**
 * Appends one run to the log.
 *
 * **Do not await for UI purposes.** Offline this resolves only once the server
 * acknowledges the write; the local cache has it immediately. Same reasoning as
 * everywhere else in `src/storage/`.
 */
export async function appendSession(uid: string, entry: SessionEntry): Promise<void> {
  const payload: DocumentData = {
    ...entry,
    // A client timestamp too, so the ordering is usable offline before the
    // server value lands — `serverTimestamp()` reads back null until then.
    at: Timestamp.now(),
    recordedAt: serverTimestamp(),
  };

  await addDoc(sessionsCollection(uid), payload);
}

/** Most recent sessions first. */
export function subscribeRecentSessions(
  uid: string,
  count: number,
  onChange: (sessions: SessionRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const recent = query(sessionsCollection(uid), orderBy('at', 'desc'), limit(count));

  return onSnapshot(
    recent,
    { includeMetadataChanges: true },
    (snapshot) => {
      onChange(
        snapshot.docs.map((doc) => {
          const data = doc.data({ serverTimestamps: 'estimate' });
          return {
            id: doc.id,
            kind: (data['kind'] ?? 'drill') as SessionKind,
            subject: String(data['subject'] ?? ''),
            title: String(data['title'] ?? ''),
            accuracy: Number(data['accuracy'] ?? 0),
            steps: Number(data['steps'] ?? 0),
            hits: Number(data['hits'] ?? 0),
            partials: Number(data['partials'] ?? 0),
            misses: Number(data['misses'] ?? 0),
            ...(data['tempoBpm'] !== undefined ? { tempoBpm: Number(data['tempoBpm']) } : {}),
            ...(data['bestStreak'] !== undefined
              ? { bestStreak: Number(data['bestStreak']) }
              : {}),
            ...(data['meanTimingMs'] !== undefined
              ? { meanTimingMs: Number(data['meanTimingMs']) }
              : {}),
            ...(data['recordedAt'] ? { recordedAt: data['recordedAt'] as Timestamp } : {}),
            ...(data['at'] ? { at: data['at'] as Timestamp } : {}),
            ...(data['graded'] === 'self' || data['graded'] === 'audio'
              ? { graded: data['graded'] }
              : {}),
          };
        }),
      );
    },
    (error) => {
      console.error('[firestore] Session log subscription failed.', error);
      onError?.(error);
    },
  );
}
