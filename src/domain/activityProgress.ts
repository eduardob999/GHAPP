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

/* ── Notes, rather than chords ─────────────────────────────────────────────── */

/**
 * Counting pick attacks.
 *
 * Everything above is chord-shaped: frames of a held shape, weighed against a
 * target. A picked note is not that. It is an event, over in a moment, and the
 * question a picking activity asks is *how many landed*, not how long one was
 * held — so frames of evidence never accumulate and the activity sits there
 * until somebody presses Skip.
 *
 * An activity that knows which notes are coming uses `riffDrill`, which is what
 * String Sniper runs on. This is for the one activity that cannot: the tune-up,
 * where the whole point is that the strings may be *wrong*. Insisting on a
 * clean E2 before moving off the 6th string would strand a player with a flat
 * guitar on the very screen that exists to fix it. So it counts strikes and
 * asks nothing about their pitch.
 */
export interface StrikeState {
  /** Notes heard as separate attacks, oldest first. */
  readonly struck: readonly string[];
  /** The last note heard, so a ringing string is not counted twice. */
  lastHeard: string | null;
  /** The attack the last counted strike came from, when one was supplied. */
  lastOnsetAt: number | null;
}

export const EMPTY_STRIKES: StrikeState = { struck: [], lastHeard: null, lastOnsetAt: null };

/**
 * Folds one heard note in, counting attacks rather than frames.
 *
 * The rule is `hearNote`'s in `riffDrill.ts`, deliberately: a change of note is
 * a new strike, and so is a fresh onset on the same note — which is what lets a
 * string picked twice count twice. Silence is not a strike, but it does clear
 * the last note, so the next pick of the same string still counts where attack
 * detection missed it.
 *
 * Returns the state it was given when nothing changed, so a caller sampling on
 * a clock can compare by identity rather than re-rendering on every frame of
 * silence.
 */
export function addStrike(
  state: StrikeState,
  heard: string | null,
  onsetAt?: number | null,
): StrikeState {
  if (!heard) return state.lastHeard === null ? state : { ...state, lastHeard: null };

  const repicked = onsetAt != null && onsetAt !== state.lastOnsetAt;
  if (heard === state.lastHeard && !repicked) return state;

  return {
    struck: [...state.struck, heard],
    lastHeard: heard,
    lastOnsetAt: onsetAt ?? state.lastOnsetAt,
  };
}

/** True once as many strings have been struck as the activity asked for. */
export function isStruckThrough(state: StrikeState, expected: number): boolean {
  return state.struck.length >= Math.max(1, expected);
}

/** How far through the strikes, 0–1, for the progress rail. */
export function strikeProgress(state: StrikeState, expected: number): number {
  return Math.min(1, state.struck.length / Math.max(1, expected));
}

/** What to say while the strikes are being counted. */
export function describeStrikes(state: StrikeState, expected: number): string {
  if (state.struck.length === 0) return 'Play a string — it moves on by itself.';
  if (state.struck.length >= expected) return 'That is all of them.';
  return `${state.struck.length} of ${expected} heard. Keep going.`;
}
