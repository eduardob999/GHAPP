import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TUNING,
  TUNINGS,
  normaliseRoot,
  parseNote,
  pitchClassOf,
  pitchClassOfRoot,
  samePitchClass,
  soundingNote,
  soundingRoot,
  transposeNote,
  transposeRoot,
} from './tunings';

/**
 * Alternate tunings and, since 2026-09-03, the one note-name parser in the repo.
 *
 * This file did not exist before that. It was written with the fix for
 * docs/NEXT.md 16e, which moved parsing here out of two other modules, and its
 * first job is to pin the thing those modules disagreed about.
 */

const EVERY_SPELLING: ReadonlyArray<readonly [string, number]> = [
  ['C', 0], ['B#', 0],
  ['C#', 1], ['Db', 1],
  ['D', 2],
  ['D#', 3], ['Eb', 3],
  ['E', 4], ['Fb', 4],
  ['F', 5], ['E#', 5],
  ['F#', 6], ['Gb', 6],
  ['G', 7],
  ['G#', 8], ['Ab', 8],
  ['A', 9],
  ['A#', 10], ['Bb', 10],
  ['B', 11], ['Cb', 11],
];

describe('parseNote', () => {
  it('reads every accepted spelling to the pitch class it sounds', () => {
    for (const [name, pitchClass] of EVERY_SPELLING) {
      expect(parseNote(name), name).toEqual({ pitchClass, octave: null });
    }
  });

  it('keeps the octave when one is written, and reports null when none is', () => {
    expect(parseNote('E2')).toEqual({ pitchClass: 4, octave: 2 });
    expect(parseNote('E')).toEqual({ pitchClass: 4, octave: null });
  });

  it('reads a negative octave, because MIDI note 0 is C-1', () => {
    expect(parseNote('C-1')).toEqual({ pitchClass: 0, octave: -1 });
  });

  it('borrows an octave for the two spellings that cross the C boundary', () => {
    // Scientific pitch notation numbers octaves from C, so Cb4 is the B below
    // C4, which is B3, and B#3 is the C above B3, which is C4. Reading the
    // written digit literally would put both an octave out. Fb and E# do not
    // move, because the E-F boundary is not where the number changes.
    expect(parseNote('Cb4')).toEqual(parseNote('B3'));
    expect(parseNote('B#3')).toEqual(parseNote('C4'));
    expect(parseNote('Fb4')).toEqual(parseNote('E4'));
    expect(parseNote('E#4')).toEqual(parseNote('F4'));
  });

  it('is anchored at both ends, so junk with a note-shaped prefix is junk', () => {
    // riffDrill.ts used an unanchored regex until 2026-09-03 and read all of
    // these as real notes.
    expect(parseNote('Ebanana')).toBeNull();
    expect(parseNote('E2 G2')).toBeNull();
    expect(parseNote('C4x')).toBeNull();
    expect(parseNote('C##')).toBeNull();
    expect(parseNote('E 2')).toBeNull();
  });

  it('trims surrounding whitespace rather than failing on it', () => {
    expect(parseNote('  G3  ')).toEqual({ pitchClass: 7, octave: 3 });
  });

  it('rejects a lowercase name, a name outside A-G, and an empty string', () => {
    expect(parseNote('e2')).toBeNull();
    expect(parseNote('bb2')).toBeNull();
    expect(parseNote('H')).toBeNull();
    expect(parseNote('')).toBeNull();
  });
});

describe('pitchClassOf', () => {
  it('discards the octave, which is why an octave slip is not a wrong note', () => {
    expect(pitchClassOf('E2')).toBe(4);
    expect(pitchClassOf('E5')).toBe(4);
    expect(pitchClassOf('E')).toBe(4);
  });

  it('gives Cb4 and B3 one class, the octave borrow being invisible here', () => {
    expect(pitchClassOf('Cb4')).toBe(11);
    expect(pitchClassOf('B3')).toBe(11);
  });
});

describe('samePitchClass', () => {
  it('matches a flat against its sharp and an octave against another', () => {
    expect(samePitchClass('A#2', 'Bb3')).toBe(true);
    expect(samePitchClass('Cb', 'B4')).toBe(true);
    expect(samePitchClass('E#2', 'F9')).toBe(true);
  });

  it('WAS THE DEFECT: two unparseable names are not equal to each other', () => {
    // docs/NEXT.md 16e. Call sites compared `pitchClassOf(a) ===
    // pitchClassOf(b)`, and null === null, so an expected note the app could
    // not read was satisfied by any other string it could not read. That is a
    // wrong answer silently accepted, the worse of the two directions to fail
    // in, and it is why this helper exists rather than a rule each call site
    // has to remember.
    expect(samePitchClass('H2', 'not-a-note-at-all')).toBe(false);
    expect(samePitchClass('e2', 'e2')).toBe(false);
    expect(samePitchClass('', '')).toBe(false);
  });

  it('is false when either side alone fails to parse', () => {
    expect(samePitchClass('E2', 'H2')).toBe(false);
    expect(samePitchClass('H2', 'E2')).toBe(false);
  });

  it('is false for null or undefined on either side, rather than throwing', () => {
    expect(samePitchClass(null, null)).toBe(false);
    expect(samePitchClass('E2', null)).toBe(false);
    expect(samePitchClass(undefined, 'E2')).toBe(false);
  });
});

describe('pitchClassOfRoot', () => {
  it('reads a bare root, including the four spellings it used to reject', () => {
    for (const [name, pitchClass] of EVERY_SPELLING) {
      expect(pitchClassOfRoot(name), name).toBe(pitchClass);
    }
  });

  it('refuses a root with an octave, which pitchClassOf accepts', () => {
    // Deliberately narrower than `pitchClassOf`, and Ab7 is the reason. As a
    // chord that is an A-flat dominant seventh and not a note name at all; as
    // a note name it is A-flat in octave 7. Both answers below are correct for
    // the question being asked, and folding the two functions together would
    // make `transposeRoot('E2', 2)` answer "F#" and lose the octave.
    expect(pitchClassOfRoot('Ab7')).toBeNull();
    expect(pitchClassOf('Ab7')).toBe(8);
    expect(pitchClassOfRoot('E2')).toBeNull();
  });

  it('returns null for a name it does not know', () => {
    expect(pitchClassOfRoot('H')).toBeNull();
    expect(pitchClassOfRoot('e')).toBeNull();
    expect(pitchClassOfRoot('')).toBeNull();
  });
});

describe('normaliseRoot', () => {
  it('rewrites every flat and boundary spelling to the sharp name used elsewhere', () => {
    expect(normaliseRoot('Bb')).toBe('A#');
    expect(normaliseRoot('Db')).toBe('C#');
    expect(normaliseRoot('Cb')).toBe('B');
    expect(normaliseRoot('B#')).toBe('C');
    expect(normaliseRoot('Fb')).toBe('E');
    expect(normaliseRoot('E#')).toBe('F');
  });

  it('leaves a name it already agrees with, and a name it cannot read, alone', () => {
    expect(normaliseRoot('A#')).toBe('A#');
    expect(normaliseRoot('G')).toBe('G');
    expect(normaliseRoot('H')).toBe('H');
  });
});

describe('transposeRoot', () => {
  it('moves a root by whole semitones and wraps the octave', () => {
    expect(transposeRoot('C', 2)).toBe('D');
    expect(transposeRoot('B', 1)).toBe('C');
    expect(transposeRoot('C', -1)).toBe('B');
    expect(transposeRoot('C', 0)).toBe('C');
  });

  it('wraps a shift larger than an octave, and a negative one', () => {
    expect(transposeRoot('C', 12)).toBe('C');
    expect(transposeRoot('C', 17)).toBe('F');
    expect(transposeRoot('C', -13)).toBe('B');
  });

  it('returns a root it cannot read untouched rather than guessing', () => {
    expect(transposeRoot('H', 2)).toBe('H');
  });
});

describe('transposeNote', () => {
  it('moves a note and carries the octave across the C boundary', () => {
    expect(transposeNote('E2', -1)).toBe('D#2');
    expect(transposeNote('C3', -1)).toBe('B2');
    expect(transposeNote('B2', 1)).toBe('C3');
  });

  it('applies the octave borrow, so Cb4 transposes as the B3 it is', () => {
    // The one function where the borrow is visible. Cb4 is B3, so a semitone
    // below it is A#3. Reading the written 4 literally would answer "A#4".
    expect(transposeNote('Cb4', -1)).toBe('A#3');
    expect(transposeNote('Cb4', 0)).toBe('B3');
    expect(transposeNote('B#3', 1)).toBe('C#4');
    expect(transposeNote('B#3', 0)).toBe('C4');
  });

  it('leaves a name with no octave untouched, there being nothing to count from', () => {
    expect(transposeNote('E', -1)).toBe('E');
  });

  it('returns a name it cannot read untouched', () => {
    expect(transposeNote('H2', -1)).toBe('H2');
    expect(transposeNote('Ebanana', -1)).toBe('Ebanana');
  });
});

describe('the tuning table', () => {
  it('gives every tuning six strings, low to high', () => {
    for (const tuning of Object.values(TUNINGS)) {
      expect(tuning.strings, tuning.id).toHaveLength(6);
      for (const string of tuning.strings) {
        expect(parseNote(string), `${tuning.id}: ${string}`).not.toBeNull();
      }
    }
  });

  it('tunes half-step-down exactly one semitone below standard on every string', () => {
    const standard = TUNINGS.standard.strings;
    expect(TUNINGS['half-step-down'].strings).toEqual(
      standard.map((string) => transposeNote(string, -1)),
    );
  });

  it('moves only the 6th string for drop D, and moves it a whole tone', () => {
    // The invariant behind `semitoneShift: 0` for Drop D: shapes that avoid the
    // 6th string sound exactly where they always did.
    const standard = TUNINGS.standard.strings;
    const dropD = TUNINGS['drop-d'].strings;

    expect(dropD.slice(1)).toEqual(standard.slice(1));
    expect(dropD[0]).toBe(transposeNote(standard[0]!, -2));
    expect(TUNINGS['drop-d'].changedStrings).toEqual([6]);
  });

  it('starts in standard tuning, where nothing is shifted', () => {
    expect(DEFAULT_TUNING).toBe('standard');
    expect(TUNINGS.standard.semitoneShift).toBe(0);
    expect(TUNINGS.standard.changedStrings).toEqual([]);
  });
});

describe('soundingRoot and soundingNote', () => {
  it('sounds an E shape as E flat in half-step-down tuning', () => {
    // What the microphone hears is what the library has to store, which is the
    // whole reason semitoneShift exists.
    expect(soundingRoot('E', 'half-step-down')).toBe('D#');
    expect(soundingNote('E2', 'half-step-down')).toBe('D#2');
  });

  it('leaves a shape alone in standard and in drop D, both being shift zero', () => {
    for (const tuning of ['standard', 'drop-d'] as const) {
      expect(soundingRoot('E', tuning), tuning).toBe('E');
      expect(soundingNote('E2', tuning), tuning).toBe('E2');
    }
  });
});
