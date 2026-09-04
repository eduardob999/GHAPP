import { fretPositionOf, formatFretPosition } from './earGrading';
import { samePitchClass } from './tunings';

/**
 * Playing a riff, note by note.
 *
 * String Sniper used to drill single notes: pick the 3rd string eight times.
 * It measured the right thing — did the pick land where you aimed — and taught
 * nothing, because nobody plays one string eight times in any music ever
 * written. This turns the same measurement into a riff: the notes are real, in
 * order, and the drill still knows exactly which ones you hit.
 *
 * Pure. The panel supplies the notes it hears; this decides what that means.
 *
 * There is no clock. The cursor advances when the *expected note* is heard, so
 * a slow player is not punished and a stopped player is not advanced past —
 * the same rule the auto session runs on.
 */

export interface RiffDrillState {
  /** Notes still to play, in order. */
  readonly notes: readonly string[];
  /** How many have been played correctly. */
  cursor: number;
  /** Notes heard that were not the one being waited for. */
  wrong: number;
  /** The last note heard, so a ringing string is not counted repeatedly. */
  lastHeard: string | null;
  /**
   * Timestamp of the attack the last accepted note came from, when one was
   * supplied. This is what tells a re-picked string from a ringing one, which
   * the note stream alone cannot: both report the same name on every frame.
   * Null when the caller passes no onsets, and then the drill behaves exactly
   * as it did before onsets existed. See docs/NEXT.md 16d.
   */
  lastOnsetAt: number | null;
}

export function startRiff(notes: readonly string[]): RiffDrillState {
  return { notes, cursor: 0, wrong: 0, lastHeard: null, lastOnsetAt: null };
}

export function isRiffComplete(state: RiffDrillState): boolean {
  return state.cursor >= state.notes.length;
}

/** The note the drill is waiting for, or null when the riff is done. */
export function expectedNote(state: RiffDrillState): string | null {
  return state.notes[state.cursor] ?? null;
}

/**
 * Folds one heard note into the drill.
 *
 * A note that is still ringing reports on every frame, so only a *change* of
 * note counts — otherwise holding one note would advance the whole riff, or
 * rack up dozens of wrong notes for a single mistake.
 *
 * Compared by pitch class, so an octave slip is not a wrong note. Through
 * `samePitchClass`, which is false when either side is unspellable: the old
 * `pitchClassOf(heard) === pitchClassOf(expected)` advanced the cursor on
 * `null === null`, so a riff note the app could not parse was satisfied by any
 * other string it could not parse. See docs/NEXT.md 16e.
 *
 * **`onsetAt` is how a repeated note gets played at all** (docs/NEXT.md 16d).
 * Ignoring an unchanged name is what stops a ringing string advancing the
 * whole riff, and it also made `['E2','E2','G2','A2']` IMPOSSIBLE: the second
 * E2 was swallowed, the cursor never moved off it, and every note after it
 * counted wrong unless a silent frame happened to fall between the two picks.
 * A riff that cannot be completed is worse than one graded badly.
 *
 * The note stream alone cannot tell a re-pick from a ring, because both report
 * the same name on every frame. An attack can. So a new onset timestamp is
 * taken as a fresh pick and bypasses the sameness check.
 *
 * **Optional on purpose.** Called without it, every path below behaves exactly
 * as it did before, so the drill is never made worse by a caller that has no
 * onsets to give. `StringSniperPanel` supplies them; the detector was already
 * keeping them for Chord Hero.
 */
export function hearNote(
  state: RiffDrillState,
  heard: string | null,
  onsetAt?: number | null,
): RiffDrillState {
  if (!heard) return { ...state, lastHeard: null };

  // A fresh attack, rather than the same note still sounding.
  const repicked = onsetAt != null && onsetAt !== state.lastOnsetAt;
  if (heard === state.lastHeard && !repicked) return state;

  const nextOnsetAt = onsetAt ?? state.lastOnsetAt;
  const expected = expectedNote(state);
  if (!expected) return { ...state, lastHeard: heard, lastOnsetAt: nextOnsetAt };

  const same = samePitchClass(heard, expected);

  return {
    ...state,
    cursor: same ? state.cursor + 1 : state.cursor,
    wrong: same ? state.wrong : state.wrong + 1,
    lastHeard: heard,
    lastOnsetAt: nextOnsetAt,
  };
}

export interface RiffSummary {
  played: number;
  total: number;
  wrong: number;
  /** Correct notes as a share of every note struck. */
  accuracy: number;
}

export function summariseRiff(state: RiffDrillState): RiffSummary {
  const struck = state.cursor + state.wrong;

  return {
    played: state.cursor,
    total: state.notes.length,
    wrong: state.wrong,
    accuracy: struck === 0 ? 0 : state.cursor / struck,
  };
}

/**
 * The grade for a completed riff.
 *
 * Null when nothing was played — silence files nothing, as everywhere else.
 * The bar is where it is because the notes are written on screen as string and
 * fret: this measures whether the pick landed where you aimed, not whether you
 * remembered the riff.
 */
export function gradeRiff(summary: RiffSummary): 'easy' | 'good' | 'hard' | 'fail' | null {
  if (summary.played + summary.wrong === 0) return null;
  if (summary.played < summary.total) return 'hard';

  if (summary.accuracy >= 0.95) return 'easy';
  if (summary.accuracy >= 0.75) return 'good';
  if (summary.accuracy >= 0.5) return 'hard';
  return 'fail';
}

/** The riff as playable instructions: "5:0 → 5:3 → 4:0". */
export function riffPositions(notes: readonly string[]): string[] {
  return notes.map((note) => {
    const position = fretPositionOf(note);
    return position ? formatFretPosition(position) : note;
  });
}
