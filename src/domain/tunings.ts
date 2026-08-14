/**
 * Alternate tunings.
 *
 * Pure data and maths — no audio, no React. A tuning changes two things and
 * nothing else:
 *
 * 1. **Where the notes are.** Drop D moves the 6th string down a tone, so a
 *    one-finger power chord exists that does not exist in standard tuning.
 * 2. **What a shape sounds like.** In half-step-down tuning an E shape sounds
 *    E♭. The microphone hears E♭, so that is what the library must store as the
 *    step's root — with the shape you actually grab carried alongside it, or
 *    the HUD would be telling you to play a chord your hands have never made.
 *
 * That second point is why `semitoneShift` exists: the library is written in
 * shapes, and `soundingRoot` converts a shape name into what the detector will
 * hear.
 */

const PITCH_CLASS_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Flat spellings accepted on input, so "Bb" and "A#" both work. */
const FLAT_ALIASES: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#',
};

export type TuningId = 'standard' | 'drop-d' | 'half-step-down';

export interface Tuning {
  id: TuningId;
  /** Short name for a badge: "Drop D". */
  name: string;
  /** Open string pitches, 6th string first. */
  strings: readonly string[];
  /** How to get here from standard tuning, in one sentence. */
  instructions: string;
  /**
   * Semitones a *shape* sounds relative to standard tuning, when every string
   * moved by the same amount. Drop D is 0 because only the 6th string moved —
   * shapes that avoid it sound exactly where they always did.
   */
  semitoneShift: number;
  /** Strings that moved, 6th-first, for the tuner hint. Empty for standard. */
  changedStrings: readonly number[];
}

export const TUNINGS: Record<TuningId, Tuning> = {
  standard: {
    id: 'standard',
    name: 'Standard',
    strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    instructions: 'Standard tuning — nothing to change.',
    semitoneShift: 0,
    changedStrings: [],
  },
  'drop-d': {
    id: 'drop-d',
    name: 'Drop D',
    strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    instructions:
      'Drop the 6th string a whole tone, from E down to D — it should sound an octave below your open 4th string.',
    semitoneShift: 0,
    changedStrings: [6],
  },
  'half-step-down': {
    id: 'half-step-down',
    name: 'Half step down',
    strings: ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'],
    instructions:
      'Drop every string one semitone: E♭ A♭ D♭ G♭ B♭ E♭. Every shape keeps its name and sounds a semitone lower.',
    semitoneShift: -1,
    changedStrings: [6, 5, 4, 3, 2, 1],
  },
};

export const DEFAULT_TUNING: TuningId = 'standard';

/** Normalises a root name to the sharp spelling used everywhere else. */
export function normaliseRoot(root: string): string {
  return FLAT_ALIASES[root] ?? root;
}

export function pitchClassOfRoot(root: string): number | null {
  const index = PITCH_CLASS_NAMES.indexOf(normaliseRoot(root) as (typeof PITCH_CLASS_NAMES)[number]);
  return index === -1 ? null : index;
}

/** Transposes a root name by whole semitones, wrapping the octave. */
export function transposeRoot(root: string, semitones: number): string {
  const pc = pitchClassOfRoot(root);
  if (pc === null) return root;
  return PITCH_CLASS_NAMES[(((pc + semitones) % 12) + 12) % 12]!;
}

/**
 * What a shape *sounds* like in a tuning.
 *
 * An E shape in half-step-down tuning sounds E♭ — which is what the chord
 * detector will report, so it is what the library stores.
 */
export function soundingRoot(shapeRoot: string, tuning: TuningId): string {
  return transposeRoot(shapeRoot, TUNINGS[tuning].semitoneShift);
}

/** Transposes a pitch name with an octave ("E2" → "D#2"), for riff notes. */
export function transposeNote(note: string, semitones: number): string {
  const match = /^([A-G][#b]?)(-?\d+)$/.exec(note);
  if (!match) return note;

  const pc = pitchClassOfRoot(match[1]!);
  if (pc === null) return note;

  const midiish = pc + 12 * Number(match[2]) + semitones;
  const octave = Math.floor(midiish / 12);
  const name = PITCH_CLASS_NAMES[(((midiish % 12) + 12) % 12)]!;
  return `${name}${octave}`;
}

/** The same note, as it sounds in a tuning. */
export function soundingNote(note: string, tuning: TuningId): string {
  return transposeNote(note, TUNINGS[tuning].semitoneShift);
}
