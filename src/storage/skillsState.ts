import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocsFromCache,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { scheduleNext, type SchedulerUpdate } from '../domain/scheduler';
import type { PracticeResult, SkillPracticeState } from '../domain/skills';

/**
 * Practice state at `/users/{uid}/skills/{skillId}`.
 *
 * Like `userState.ts`, this is the only place that knows the collection layout —
 * components and hooks go through these functions rather than importing `db`.
 *
 * The security rules from Task 1 already cover this: the `/users/{uid}` rule
 * carries a `{document=**}` wildcard, so subcollections inherit the same
 * owner-only check without a rules change.
 */

const USERS_COLLECTION = 'users';
const SKILLS_SUBCOLLECTION = 'skills';

/**
 * Server timestamps read back as null from the local cache until the server
 * confirms them. `estimate` substitutes the local clock instead, so a freshly
 * graded skill shows a plausible `updatedAt` offline rather than a blank.
 * Scheduling never depends on these — `dueAt` is written as a real client
 * timestamp precisely so it is readable immediately.
 */
const SNAPSHOT_OPTIONS = { serverTimestamps: 'estimate' } as const;

function skillsCollection(uid: string) {
  return collection(db, USERS_COLLECTION, uid, SKILLS_SUBCOLLECTION);
}

function skillDoc(uid: string, skillId: string) {
  return doc(db, USERS_COLLECTION, uid, SKILLS_SUBCOLLECTION, skillId);
}

function toSkillPracticeState(
  snapshot: DocumentSnapshot<DocumentData>,
): SkillPracticeState | null {
  const data = snapshot.data(SNAPSHOT_OPTIONS);
  if (!data) return null;

  const state: SkillPracticeState = { skillId: snapshot.id };

  // Assigned conditionally rather than as `?? undefined`: exactOptionalPropertyTypes
  // distinguishes "absent" from "present and undefined".
  if (data['lastResult']) state.lastResult = data['lastResult'] as PracticeResult;
  if (data['lastPracticedAt']) state.lastPracticedAt = data['lastPracticedAt'] as Timestamp;
  if (typeof data['ease'] === 'number') state.ease = data['ease'];
  if (typeof data['intervalDays'] === 'number') state.intervalDays = data['intervalDays'];
  if (data['dueAt']) state.dueAt = data['dueAt'] as Timestamp;
  if (typeof data['totalReps'] === 'number') state.totalReps = data['totalReps'];
  if (data['createdAt']) state.createdAt = data['createdAt'] as Timestamp;
  if (data['updatedAt']) state.updatedAt = data['updatedAt'] as Timestamp;

  return state;
}

/**
 * Live subscription to every skill state for a user.
 *
 * Ordered by `dueAt` so output is deterministic. Offline this serves from the
 * IndexedDB cache and keeps firing as local writes land, which is what lets the
 * practice panel update instantly with no network.
 *
 * **Cache-first, deliberately.** `onSnapshot` on a *cold* cache with no
 * reachable server can wait indefinitely for its first snapshot: there is
 * nothing local to serve and nothing remote to ask. A first-ever launch offline
 * then sits on "working out what to practise…" forever, which makes a liar of
 * the whole offline-first design. Reading the cache explicitly settles that in
 * milliseconds — with an empty result, which is the correct answer for a user
 * who has never practised — and the live listener takes over from there.
 */
export function subscribeUserSkillStates(
  uid: string,
  onChange: (states: SkillPracticeState[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const skillsQuery = query(skillsCollection(uid), orderBy('dueAt', 'asc'));

  let livePublished = false;

  void getDocsFromCache(skillsQuery)
    .then((snapshot) => {
      if (livePublished) return;
      onChange(
        snapshot.docs
          .map(toSkillPracticeState)
          .filter((state): state is SkillPracticeState => state !== null),
      );
    })
    .catch(() => {
      if (!livePublished) onChange([]);
    });

  return onSnapshot(
    skillsQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      livePublished = true;
      const states = snapshot.docs
        .map(toSkillPracticeState)
        .filter((state): state is SkillPracticeState => state !== null);

      onChange(states);
    },
    (error) => {
      console.error('[firestore] Skill state subscription failed.', error);
      onError?.(error);
    },
  );
}

export interface RecordPracticeInput {
  skillId: string;
  result: PracticeResult;
  /**
   * The state this grade is being applied to. Callers that already hold it —
   * anything driven by `subscribeUserSkillStates` — should pass it, which skips
   * a read entirely and means the local write lands immediately even offline.
   * Pass `null` to assert the skill is new; omit to have it looked up.
   */
  current?: SkillPracticeState | null;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

async function readCurrentState(
  uid: string,
  skillId: string,
): Promise<SkillPracticeState | null> {
  try {
    return toSkillPracticeState(await getDoc(skillDoc(uid, skillId)));
  } catch (error) {
    // Offline with a cold cache. Treating the skill as new schedules it sooner
    // than ideal, which is a far better failure than blocking the write.
    console.warn('[firestore] Could not read existing skill state; treating as new.', error);
    return null;
  }
}

/**
 * Applies a practice result and writes the new schedule.
 *
 * **Do not await this for UI purposes.** Offline, Firestore applies the write to
 * the local cache at once but leaves the returned promise pending until the
 * server acknowledges it — potentially for hours. Fire it, catch failures, and
 * let `subscribeUserSkillStates` drive the interface. Same reasoning as
 * `userState.ts`.
 */
export async function upsertSkillPracticeState(
  uid: string,
  input: RecordPracticeInput,
): Promise<void> {
  const { skillId, result } = input;
  const now = input.now ?? new Date();

  const current =
    input.current !== undefined ? input.current : await readCurrentState(uid, skillId);

  const update: SchedulerUpdate = scheduleNext(
    {
      ...(current?.ease !== undefined ? { ease: current.ease } : {}),
      ...(current?.intervalDays !== undefined ? { intervalDays: current.intervalDays } : {}),
      lastPracticedAt: current?.lastPracticedAt?.toDate() ?? null,
    },
    result,
    now,
  );

  await setDoc(
    skillDoc(uid, skillId),
    {
      skillId,
      lastResult: result,
      // Client timestamps, not serverTimestamp(): the planner reads dueAt back
      // from the cache immediately after this write, and a pending server
      // timestamp would read as null.
      lastPracticedAt: Timestamp.fromDate(now),
      dueAt: Timestamp.fromDate(update.dueAt),
      ease: update.ease,
      intervalDays: update.intervalDays,
      // increment() rather than a read-modify-write, so two devices practising
      // offline both count when they reconnect.
      totalReps: increment(1),
      updatedAt: serverTimestamp(),
      ...(current ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
}
