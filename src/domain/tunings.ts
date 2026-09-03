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

/**
 * Every note name this repo accepts on input, as a pitch class plus the octave
 * the spelling borrows from its neighbour.
 *
 * Sharps and flats are the obvious half. The other half is the four spellings
 * that cross a letter boundary, `Cb`, `B#`, `Fb` and `E#`, which were simply
 * missing until 2026-09-03 and are the reason docs/NEXT.md 16e exists. They are
 * legal names, they parse as a note shape, and the old lookup table had no row
 * for any of them, so each came back null.
 *
 * `octaveShift` is the part that is easy to get wrong. Scientific pitch
 * notation numbers octaves from C, so `Cb4` is the B *below* C4, which is B3,
 * and `B#3` is the C *above* B3, which is C4. Those two borrow an octave from
 * the neighbouring letter and carry -1 and +1 for it. `Fb` and `E#` sit inside
 * their own octave, because the E-F boundary is not where the number changes.
 *
 * Nothing that compares pitch classes can see any of this: octave is discarded
 * there by design, so `Cb4` and `B3` compare equal either way. It matters to
 * `transposeNote`, which is the one function here that has to keep the octave.
 */
const NOTE_SPELLINGS: Record<string, { pitchClass: number; octaveShift: number }> = {
  C: { pitchClass: 0, octaveShift: 0 },
  'C#': { pitchClass: 1, octaveShift: 0 },
  Cb: { pitchClass: 11, octaveShift: -1 },
  D: { pitchClass: 2, octaveShift: 0 },
  'D#': { pitchClass: 3, octaveShift: 0 },
  Db: { pitchClass: 1, octaveShift: 0 },
  E: { pitchClass: 4, octaveShift: 0 },
  'E#': { pitchClass: 5, octaveShift: 0 },
  Eb: { pitchClass: 3, octaveShift: 0 },
  F: { pitchClass: 5, octaveShift: 0 },
  'F#': { pitchClass: 6, octaveShift: 0 },
  Fb: { pitchClass: 4, octaveShift: 0 },
  G: { pitchClass: 7, octaveShift: 0 },
  'G#': { pitchClass: 8, octaveShift: 0 },
  Gb: { pitchClass: 6, octaveShift: 0 },
  A: { pitchClass: 9, octaveShift: 0 },
  'A#': { pitchClass: 10, octaveShift: 0 },
  Ab: { pitchClass: 8, octaveShift: 0 },
  B: { pitchClass: 11, octaveShift: 0 },
  'B#': { pitchClass: 0, octaveShift: 1 },
  Bb: { pitchClass: 10, octaveShift: 0 },
};

/**
 * A letter, an optional accidental, an optional signed octave, and nothing
 * else. Anchored at both ends on purpose: an unanchored version of this lived
 * in riffDrill.ts and matched the prefix of any string, so "Ebanana" read as
 * E flat and "E2 G2" read as E.
 */
const NOTE_PATTERN = /^([A-G][#b]?)(-?\d+)?$/;

/** A note name split into what it sounds and, if it said, where. */
export interface ParsedNote {
  /** 0 = C … 11 = B. */
  pitchClass: number;
  /**
   * Scientific pitch octave, already corrected for `Cb` and `B#`. Null when
   * the name carried none, which is how a chord root is written.
   */
  octave: number | null;
}

/**
 * The one note-name parser in this repo.
 *
 * There used to be three: this one, a copy in progressions.ts and a private
 * copy in riffDrill.ts, and they disagreed on six inputs. Case-sensitive by
 * choice, not by accident: see `pitchClassOf`.
 */
export function parseNote(noteName: string): ParsedNote | null {
  const match = NOTE_PATTERN.exec(noteName.trim());
  if (!match) return null;

  const spelling = NOTE_SPELLINGS[match[1]!];
  if (spelling === undefined) return null;

  const written = match[2];
  return {
    pitchClass: spelling.pitchClass,
    octave: written === undefined ? null : Number(written) + spelling.octaveShift,
  };
}

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
  const spelling = NOTE_SPELLINGS[root.trim()];
  return spelling === undefined ? root : PITCH_CLASS_NAMES[spelling.pitchClass]!;
}

/**
 * "A#2" or "Bb3" or "Cb4" -> 0–11. Null for anything unparseable.
 *
 * **Case-sensitive, deliberately.** Nothing types a note name into this app.
 * Expected notes are authored catalog data in progressions.ts and songs.ts;
 * heard notes are built by `frequencyToNote` from a fixed uppercase table. So
 * a lowercase `e2` is not a user being informal, it is a typo in the catalog,
 * and the whole point of the 16e fix is that an unparseable expectation now
 * fails visibly instead of matching whatever else failed to parse. Accepting
 * `e2` would take the one signal that surfaces the typo and throw it away.
 */
export function pitchClassOf(noteName: string): number | null {
  return parseNote(noteName)?.pitchClass ?? null;
}

/**
 * Do two note names sound the same pitch class?
 *
 * **False whenever either side fails to parse.** This is the whole of
 * docs/NEXT.md 16e. Callers used to write `pitchClassOf(a) === pitchClassOf(b)`
 * and `null === null` is true, so an expected note the app could not spell was
 * satisfied by *any* string it also could not spell: the drill advanced on a
 * note the player never played. Failing that way round is the dangerous one,
 * because a wrong answer is silently accepted rather than a right one rejected.
 *
 * A helper rather than a rule every call site has to remember, because "every
 * call site has to remember" is how it broke the first time.
 */
export function samePitchClass(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;

  const left = pitchClassOf(a);
  if (left === null) return false;

  return left === pitchClassOf(b);
}

/**
 * The pitch class of a chord ROOT, which is a note name with no octave.
 *
 * Kept separate from `pitchClassOf` rather than folded into it, and the reason
 * is `Ab7`. As a root that is an A-flat dominant seventh and is not a note name
 * at all; as a note name it is A-flat in octave 7. `pitchClassOf('Ab7')`
 * answers 8 and this answers null, and both are right for what they are asked.
 * Merging them would make `transposeRoot('E2', 2)` return "F#", quietly losing
 * the octave a caller had written.
 */
export function pitchClassOfRoot(root: string): number | null {
  const spelling = NOTE_SPELLINGS[root.trim()];
  return spelling === undefined ? null : spelling.pitchClass;
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

/**
 * Transposes a pitch name with an octave ("E2" → "D#2"), for riff notes.
 *
 * This is the one caller that needs `ParsedNote.octave` rather than just the
 * pitch class, and so the one place the `Cb`/`B#` octave borrow is visible:
 * `transposeNote('Cb4', -1)` is "A#3", because Cb4 is B3 and a semitone below
 * B3 is A#3. Reading the 4 literally would have answered "A#4", an octave out.
 *
 * A name with no octave is returned untouched, as before: there is nothing to
 * count from, and a chord root belongs in `transposeRoot`.
 */
export function transposeNote(note: string, semitones: number): string {
  const parsed = parseNote(note);
  if (parsed === null || parsed.octave === null) return note;

  const midiish = parsed.pitchClass + 12 * parsed.octave + semitones;
  const octave = Math.floor(midiish / 12);
  const name = PITCH_CLASS_NAMES[(((midiish % 12) + 12) % 12)]!;
  return `${name}${octave}`;
}

/** The same note, as it sounds in a tuning. */
export function soundingNote(note: string, tuning: TuningId): string {
  return transposeNote(note, TUNINGS[tuning].semitoneShift);
}
