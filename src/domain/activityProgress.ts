import { compareHeard, type EarVerdict, type HeardChord, type TargetChord } from './earGrading';

/**
 * When an activity is over.
 *
 * The auto session used to run on a countdown: every activity carried a
 * duration and moved on when the clock expired, whether or not a note had been
 * played. That makes the timer the real scheduler and FSRS a bystander — the
 * session marches on at the same speed whether you are playing beautifully,
 * fumbling, or making a cup of tea.
 *
 * So there is no clock here. An activity ends when there is **evidence**:
 *
 * - enough clean frames to say it went well, or
 * - enough heard frames to judge it fairly, however it went.
 *
 * And silence advances nothing. Put the guitar down and the session waits,
 * which is the behaviour anyone would expect of a thing that claims to be
 * listening. It also means the session length is decided by the playing, which
 * is the only honest way for a practice app to measure a session.
 */

/** Clean frames that end an activity as soon as they arrive. About a second. */
export const CLEAN_FRAMES_TO_PASS = 10;

/**
 * Heard frames after which we judge on whatever we have.
 *
 * Roughly four seconds of *sound*, not of wall clock. Someone playing the wrong
 * chord confidently should not be stuck there for ever, but they should get
 * long enough to correct it.
 */
export const HEARD_FRAMES_TO_JUDGE = 40;

/** Frames of a chord that is nearly right, after which we call it close enough. */
const CLOSE_FRAMES_TO_JUDGE = 25;

export interface EvidenceState {
  /** Frames matching the target exactly. */
  clean: number;
  /** Frames that were at least close. */
  close: number;
  /** Frames carrying any chord at all. */
  heard: number;
  /** Every frame offered, including silence. Used only for reporting. */
  total: number;
}

export const EMPTY_EVIDENCE: EvidenceState = { clean: 0, close: 0, heard: 0, total: 0 };

/** Folds one frame into the running evidence. Silence counts toward nothing. */
export function addFrame(
  evidence: EvidenceState,
  target: TargetChord,
  frame: HeardChord,
): EvidenceState {
  const verdict: EarVerdict = compareHeard(target, frame);

  return {
    clean: evidence.clean + (verdict === 'clean' ? 1 : 0),
    close: evidence.close + (verdict === 'clean' || verdict === 'close' ? 1 : 0),
    heard: evidence.heard + (verdict === 'unheard' ? 0 : 1),
    total: evidence.total + 1,
  };
}

/**
 * Is there enough to call it?
 *
 * Note what is *not* here: elapsed time. An activity with no sound in it is
 * never complete, however long it has been on screen.
 */
export function isDecided(evidence: EvidenceState): boolean {
  if (evidence.clean >= CLEAN_FRAMES_TO_PASS) return true;
  if (evidence.close >= CLOSE_FRAMES_TO_JUDGE) return true;
  return evidence.heard >= HEARD_FRAMES_TO_JUDGE;
}

/**
 * How close to a verdict, 0–1, for the progress ring.
 *
 * Deliberately the *best* of the two routes to a decision, so a player holding
 * a clean chord sees the ring fill quickly rather than crawling toward the
 * pessimistic bound.
 */
export function decisionProgress(evidence: EvidenceState): number {
  return Math.min(
    1,
    Math.max(
      evidence.clean / CLEAN_FRAMES_TO_PASS,
      evidence.close / CLOSE_FRAMES_TO_JUDGE,
      evidence.heard / HEARD_FRAMES_TO_JUDGE,
    ),
  );
}

/** What to say while an activity is being decided. */
export function describeEvidence(evidence: EvidenceState): string {
  if (evidence.total === 0) return 'Play it when you are ready.';
  if (evidence.heard === 0) return 'Listening — nothing heard yet.';
  if (evidence.clean > 0) return 'That is it — hold it.';
  if (evidence.close > 0) return 'Close. Check every string is ringing.';
  return 'Heard something else — check the shape.';
}
