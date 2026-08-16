import { chordPitchClassMask, type ChordQuality } from '../audio/chordDetection';
import type { MicroSkillDefinition, PracticeResult } from './skills';

/**
 * Grading a rep by ear.
 *
 * The app used to ask "how did that feel?" after every rep, and then scheduled
 * on the answer. Two things are wrong with that. It is the least reliable
 * signal available — people are generous after a rep they enjoyed and harsh
 * after one they did not — and it is a question you have to stop playing to
 * answer. The microphone already knows.
 *
 * So: a rep is a listening window, and the grade comes from what was actually
 * heard. Pure, so the rules are testable without a guitar; the panels supply
 * the observations.
 *
 * The one thing this deliberately does *not* do is punish silence. A rep with
 * nothing heard is `unheard`, not a fail — a flat battery, a muted interface or
 * a player who stopped to answer the door is not a failure to play the chord,
 * and filing it as one would poison the schedule with events that never
 * happened.
 */

/** Open strings in standard tuning, 6th first, as pitch classes. */
const OPEN_STRING_PITCH_CLASSES = [4, 9, 2, 7, 11, 4]; // E A D G B E

const PITCH_CLASS_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** What note sounds at a fret on a string, in standard tuning. */
export function noteAt(string: number, fret: number): string | null {
  const index = 6 - string;
  const open = OPEN_STRING_PITCH_CLASSES[index];
  if (open === undefined || fret < 0) return null;
  return PITCH_CLASS_NAMES[(open + fret) % 12] ?? null;
}

export interface TargetChord {
  root: string;
  quality: ChordQuality;
}

const QUALITY_FROM_CATALOG: Record<string, ChordQuality> = {
  major: 'maj',
  minor: 'min',
  power: '5',
  dominant: '7',
  dominant7: '7',
  major7: 'maj7',
  minor7: 'min7',
};

/**
 * The chord a fretting skill is asking for, derived rather than typed out.
 *
 * The catalog already says which string and fret carry the root, and what
 * quality the shape is. Deriving the chord from those means a shape cannot
 * drift out of step with the chord it is graded against — and that a new shape
 * becomes gradeable with no extra data.
 */
export function targetChordFor(definition: MicroSkillDefinition): TargetChord | null {
  if (definition.category !== 'fretting_shape') return null;

  const { rootString, rootFret, chordQuality } = definition.metadata;
  if (rootString === undefined || rootFret === undefined || !chordQuality) return null;

  const root = noteAt(rootString, rootFret);
  const quality = QUALITY_FROM_CATALOG[chordQuality];
  if (!root || !quality) return null;

  return { root, quality };
}

/** One frame of what the detector heard. Null means it heard nothing usable. */
export type HeardChord = { root: string; quality: ChordQuality } | null;

export type EarVerdict = 'clean' | 'close' | 'wrong' | 'unheard';

/**
 * Compares one frame against the target.
 *
 * `close` covers the readings a microphone genuinely produces from a correct
 * chord: the same notes named differently — a G whose 7th partial rings reads
 * as G7, a triad with a damped third collapses to G5. The rule is the one
 * Chord Hero already uses: only a *contradicted* third is wrong.
 */
export function compareHeard(target: TargetChord, heard: HeardChord): EarVerdict {
  if (!heard) return 'unheard';

  if (heard.root === target.root && heard.quality === target.quality) return 'clean';

  // Same set of notes under another name — enharmonic identity, not an error.
  if (chordPitchClassMask(heard.root, heard.quality) === chordPitchClassMask(target.root, target.quality)) {
    return 'clean';
  }

  if (heard.root !== target.root) return 'wrong';

  const thirdOf = (quality: ChordQuality): 'major' | 'minor' | 'none' => {
    if (quality === 'min' || quality === 'min7' || quality === 'min6' || quality === 'dim' || quality === 'dim7' || quality === 'm7b5') return 'minor';
    if (quality === '5' || quality === 'sus2' || quality === 'sus4') return 'none';
    return 'major';
  };

  const wanted = thirdOf(target.quality);
  const got = thirdOf(heard.quality);

  // A missing third is what a damped or buried string sounds like; a *wrong*
  // one means the other chord entirely.
  return wanted === got || got === 'none' || wanted === 'none' ? 'close' : 'wrong';
}

export interface EarResult {
  /** The grade to file with the scheduler, or null when nothing was heard. */
  grade: PracticeResult | null;
  /** Fraction of heard frames that matched cleanly, 0–1. */
  cleanFraction: number;
  /** Fraction that were at least close. */
  closeFraction: number;
  /** Frames where the detector reported something. */
  heardFrames: number;
  totalFrames: number;
  /** What was heard most often, for the feedback line. */
  mostHeard: HeardChord;
  verdict: EarVerdict;
}

/** Below this share of frames carrying any chord at all, we did not hear the rep. */
const MIN_HEARD_SHARE = 0.15;

/**
 * Turns a rep's worth of frames into a grade.
 *
 * The thresholds are deliberately generous about *duration* and strict about
 * *identity*: holding a chord cleanly for a third of a rep is a good rep, since
 * the rest is spent changing to it and away from it, but playing the wrong
 * chord confidently is a fail however long you hold it.
 */
export function gradeByEar(target: TargetChord, frames: readonly HeardChord[]): EarResult {
  const totalFrames = frames.length;
  const verdicts = frames.map((frame) => compareHeard(target, frame));

  const heardFrames = verdicts.filter((v) => v !== 'unheard').length;
  const clean = verdicts.filter((v) => v === 'clean').length;
  const close = verdicts.filter((v) => v === 'clean' || v === 'close').length;

  const counts = new Map<string, { chord: HeardChord; n: number }>();
  for (const frame of frames) {
    if (!frame) continue;
    const key = `${frame.root}|${frame.quality}`;
    const entry = counts.get(key) ?? { chord: frame, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  const mostHeard =
    [...counts.values()].sort((a, b) => b.n - a.n)[0]?.chord ?? null;

  const cleanFraction = totalFrames > 0 ? clean / totalFrames : 0;
  const closeFraction = totalFrames > 0 ? close / totalFrames : 0;

  // Nothing to judge: no frames at all, or the room was silent for the rep.
  if (totalFrames === 0 || heardFrames / totalFrames < MIN_HEARD_SHARE) {
    return {
      grade: null,
      cleanFraction,
      closeFraction,
      heardFrames,
      totalFrames,
      mostHeard,
      verdict: 'unheard',
    };
  }

  const grade: PracticeResult =
    cleanFraction >= 0.55 ? 'easy'
    : cleanFraction >= 0.3 ? 'good'
    : closeFraction >= 0.3 ? 'hard'
    : 'fail';

  const verdict: EarVerdict =
    grade === 'easy' || grade === 'good' ? 'clean' : grade === 'hard' ? 'close' : 'wrong';

  return { grade, cleanFraction, closeFraction, heardFrames, totalFrames, mostHeard, verdict };
}

/** One line of feedback, in the app's voice. */
export function describeEarResult(target: TargetChord, result: EarResult): string {
  const name = `${target.root}${target.quality === 'maj' ? '' : target.quality === 'min' ? 'm' : target.quality}`;

  switch (result.verdict) {
    case 'unheard':
      return 'Did not hear that one — play it again with the guitar closer to the microphone.';
    case 'clean':
      return result.cleanFraction >= 0.55
        ? `Clean ${name}, held well.`
        : `That was ${name}. Hold it a little longer next time.`;
    case 'close':
      return `Nearly — ${name} with something not quite ringing. Check every string sounds.`;
    case 'wrong':
      return result.mostHeard
        ? `That sounded like ${result.mostHeard.root}, not ${name}.`
        : `That was not ${name} yet.`;
  }
}

/* ── Where a note lives on the neck ────────────────────────────────────────── */

/** Open string pitches, 6th first, as MIDI numbers: E2 A2 D3 G3 B3 E4. */
const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64];

const NOTE_PATTERN = /^([A-G][#b]?)(-?\d+)$/;

export interface FretPosition {
  /** 6 (low E) to 1 (high E). */
  string: number;
  fret: number;
}

/** MIDI number for a pitch name with an octave, or null if it is not one. */
export function midiOf(note: string): number | null {
  const match = NOTE_PATTERN.exec(note);
  if (!match) return null;

  const flats: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const name = flats[match[1]!] ?? match[1]!;
  const pitchClass = PITCH_CLASS_NAMES.indexOf(name as (typeof PITCH_CLASS_NAMES)[number]);
  if (pitchClass === -1) return null;

  return pitchClass + 12 * (Number(match[2]) + 1);
}

/**
 * Where to play a note, as a string and a fret.
 *
 * Riffs were written as "A2 C3 D3 E3" — note names with octaves, which is only
 * readable if you already know the fretboard, and someone who already knows the
 * fretboard does not need an app to tell them where the notes are. The same
 * riff as "6:5 5:3 5:5 4:2" can be played by anyone holding a guitar.
 *
 * The lowest playable position is chosen, and positions within the first five
 * frets are preferred, because that is where a beginner's hand already is.
 */
export function fretPositionOf(note: string, maxFret = 12): FretPosition | null {
  const midi = midiOf(note);
  if (midi === null) return null;

  const options: FretPosition[] = [];

  for (let index = 0; index < OPEN_STRING_MIDI.length; index += 1) {
    const fret = midi - OPEN_STRING_MIDI[index]!;
    if (fret >= 0 && fret <= maxFret) options.push({ string: 6 - index, fret });
  }

  if (options.length === 0) return null;

  // Prefer the open position: lowest fret first, then the thickest string that
  // reaches it, which keeps a riff inside one hand position.
  options.sort((a, b) => a.fret - b.fret || b.string - a.string);
  return options[0]!;
}

/** "6:5" — string then fret, the way a chord chart reads. */
export function formatFretPosition(position: FretPosition): string {
  return `${position.string}:${position.fret}`;
}

/** A riff written where the hands can find it. */
export function describeRiffPositions(notes: readonly string[]): string {
  return notes
    .map((note) => {
      const position = fretPositionOf(note);
      return position ? formatFretPosition(position) : note;
    })
    .join('  ');
}
