import { describe, expect, it } from 'vitest';

import {
  expectedNote,
  gradeRiff,
  hearNote,
  isRiffComplete,
  riffPositions,
  startRiff,
  summariseRiff,
  type RiffSummary,
} from './riffDrill';

/**
 * String Sniper's riff cursor: pure state, folded one heard note at a time.
 *
 * No audio here, only the fold `hearNote` performs — this file drives it with
 * synthetic detections the way the panel would report them.
 */

describe('startRiff', () => {
  it('begins at the first note with nothing played and nothing wrong', () => {
    const state = startRiff(['E2', 'G2', 'A2']);

    expect(state.cursor).toBe(0);
    expect(state.wrong).toBe(0);
    expect(state.lastHeard).toBeNull();
    expect(state.notes).toEqual(['E2', 'G2', 'A2']);
  });
});

describe('isRiffComplete', () => {
  it('is not complete while notes remain', () => {
    expect(isRiffComplete(startRiff(['E2', 'G2']))).toBe(false);
  });

  it('is complete once the cursor reaches the end', () => {
    const state = startRiff(['E2']);
    const after = hearNote(state, 'E2');
    expect(after.cursor).toBe(1);
    expect(isRiffComplete(after)).toBe(true);
  });

  it('treats an empty riff as complete from the start', () => {
    // Nothing to play, so nothing stands between "started" and "done".
    expect(isRiffComplete(startRiff([]))).toBe(true);
  });
});

describe('expectedNote', () => {
  it('names the note at the cursor, moving forward as notes are played', () => {
    const state = startRiff(['E2', 'G2']);
    expect(expectedNote(state)).toBe('E2');

    const after = hearNote(state, 'E2');
    expect(expectedNote(after)).toBe('G2');
  });

  it('returns null once the riff is finished, not the last note again', () => {
    const state = hearNote(startRiff(['E2']), 'E2');
    expect(expectedNote(state)).toBeNull();
  });
});

describe('hearNote — the normal path', () => {
  it('advances the cursor on a note that matches what is expected', () => {
    const state = startRiff(['E2', 'G2']);
    const after = hearNote(state, 'E2');

    expect(after.cursor).toBe(1);
    expect(after.wrong).toBe(0);
  });

  it('counts a mismatched note as wrong without moving the cursor', () => {
    const state = startRiff(['E2', 'G2']);
    const after = hearNote(state, 'A2');

    expect(after.cursor).toBe(0);
    expect(after.wrong).toBe(1);
  });

  it('compares by pitch class, so an octave slip is not a wrong note', () => {
    // The module's own docstring: "Compared by pitch class, so an octave slip
    // is not a wrong note."
    const state = startRiff(['E2']);
    const after = hearNote(state, 'E4');

    expect(after.cursor).toBe(1);
    expect(after.wrong).toBe(0);
  });

  it('accepts the enharmonic spelling of the expected note, in either direction', () => {
    const sharpExpected = hearNote(startRiff(['A#2']), 'Bb2');
    expect(sharpExpected.cursor).toBe(1);
    expect(sharpExpected.wrong).toBe(0);

    const flatExpected = hearNote(startRiff(['Bb2']), 'A#2');
    expect(flatExpected.cursor).toBe(1);
    expect(flatExpected.wrong).toBe(0);
  });

  it('does not advance or count wrong for a frame carrying no note', () => {
    const state = startRiff(['E2']);
    const after = hearNote(state, null);

    expect(after.cursor).toBe(0);
    expect(after.wrong).toBe(0);
    expect(after.lastHeard).toBeNull();
  });

  it('resets lastHeard to null on a silent frame, ready to hear the next note as new', () => {
    const held = hearNote(startRiff(['E2', 'G2']), 'E2');
    expect(held.lastHeard).toBe('E2');

    const silent = hearNote(held, null);
    expect(silent.lastHeard).toBeNull();
    // The silence itself changes nothing about progress.
    expect(silent.cursor).toBe(1);
    expect(silent.wrong).toBe(0);
  });

  it('does not recount a ringing correct note held across several frames', () => {
    const state = startRiff(['E2', 'G2']);
    const first = hearNote(state, 'E2');
    const second = hearNote(first, 'E2');
    const third = hearNote(second, 'E2');

    expect(first.cursor).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('does not recount a ringing wrong note either — one mistake, not one per frame', () => {
    const state = startRiff(['E2']);
    const first = hearNote(state, 'G2');
    const second = hearNote(first, 'G2');

    expect(first.wrong).toBe(1);
    expect(second.wrong).toBe(1);
    expect(second).toEqual(first);
  });

  it('neither rewards nor punishes notes heard after the riff is already finished', () => {
    const finished = hearNote(startRiff(['E2']), 'E2');
    expect(isRiffComplete(finished)).toBe(true);

    const strummedAgain = hearNote(finished, 'G2');

    expect(strummedAgain.cursor).toBe(1);
    expect(strummedAgain.wrong).toBe(0);
    // lastHeard still tracks what is ringing, so a change is still visible later.
    expect(strummedAgain.lastHeard).toBe('G2');
  });
});

describe('hearNote — known defect 16d: a genuine consecutive repeat can stall the riff', () => {
  // docs/NEXT.md item 16d, filed 2026-09-03. `hearNote` ignores a heard note
  // equal to `lastHeard` so a ringing note is not counted on every frame — but
  // that same guard cannot tell a ringing string apart from a deliberate
  // second pick of the identical note, because both look like "heard the same
  // name again". A riff with a real consecutive repeat therefore only advances
  // past the repeat if a null frame lands between the two picks to clear
  // `lastHeard` first. This is pinned as the code's actual behaviour, not as
  // the intended one — do not "fix" this test if riffDrill.ts changes; update
  // it only once the fix is landed and re-verify against the new behaviour.
  const RIFF = ['E2', 'E2', 'G2', 'A2'] as const;

  it('stalls forever on the second note of a repeat played with no silence between the picks', () => {
    let state = startRiff(RIFF);
    state = hearNote(state, 'E2'); // first E2: cursor 0 -> 1
    expect(state.cursor).toBe(1);

    state = hearNote(state, 'E2'); // second pick, string never went quiet: ignored
    expect(state.cursor).toBe(1); // stuck — this is the defect

    state = hearNote(state, 'G2'); // still "waiting" for the second E2
    state = hearNote(state, 'A2');

    expect(state.cursor).toBe(1);
    expect(state.wrong).toBe(2); // G2 and A2 both scored wrong against expected E2
    expect(isRiffComplete(state)).toBe(false);
    expect(expectedNote(state)).toBe('E2'); // the riff can never finish from here
  });

  it('completes the identical riff when one silent frame separates the repeated picks', () => {
    let state = startRiff(RIFF);
    state = hearNote(state, 'E2');
    state = hearNote(state, null); // the reset the defect depends on
    state = hearNote(state, 'E2'); // now counted as a new, distinct hit
    state = hearNote(state, 'G2');
    state = hearNote(state, 'A2');

    expect(state.wrong).toBe(0);
    expect(isRiffComplete(state)).toBe(true);
  });
});

describe('hearNote — pitchClassOf on the spellings the sibling modules also stumble on', () => {
  // A sibling `pitchClassOf` in progressions.ts is proven (progressions.test.ts)
  // to return null for Cb, E#, Fb and B#, spellings whose lookup table has no
  // entry even though they parse as a note shape. riffDrill.ts carries its own
  // private copy of the same idea and is not exported, so it is exercised here
  // through hearNote rather than called directly.
  const CASES: ReadonlyArray<{ note: string; realEquivalent: string }> = [
    { note: 'Cb2', realEquivalent: 'B2' },
    { note: 'E#2', realEquivalent: 'F2' },
    { note: 'Fb2', realEquivalent: 'E2' },
    { note: 'B#2', realEquivalent: 'C2' },
  ];

  for (const { note, realEquivalent } of CASES) {
    it(`treats "${note}" as unparseable rather than as its enharmonic equivalent "${realEquivalent}"`, () => {
      const state = startRiff([note]);

      const real = hearNote(state, realEquivalent);
      expect(real.cursor, `${note} should not match ${realEquivalent}`).toBe(0);
      expect(real.wrong).toBe(1);
    });
  }

  it('FINDING: two different unparseable notes compare equal to each other, both being null', () => {
    // pitchClassOf returns null for anything it cannot parse, and hearNote
    // compares with `pitchClassOf(heard) === pitchClassOf(expected)`. Two
    // strings that both fail to parse both come back null, and null === null,
    // so an expected note the module cannot spell is satisfied by ANY other
    // unparseable string, not only by the note actually fingered. Recorded as
    // the code behaves; not a defect this file is asked to fix.
    const state = startRiff(['Cb2']);
    const matched = hearNote(state, 'not-a-note-at-all');

    expect(matched.cursor).toBe(1);
    expect(matched.wrong).toBe(0);
  });

  it('is case-sensitive: a lowercase letter fails to parse and falls into the same null trap', () => {
    const state = startRiff(['e2']);
    const matched = hearNote(state, 'still-not-a-note');

    // 'e2' does not match the [A-G] class the regex requires, so it is also
    // unparseable, and the same null === null quirk applies to it.
    expect(matched.cursor).toBe(1);
    expect(matched.wrong).toBe(0);
  });
});

describe('summariseRiff', () => {
  it('reports nothing struck and zero accuracy before any note is heard', () => {
    const summary = summariseRiff(startRiff(['E2', 'G2']));

    expect(summary.played).toBe(0);
    expect(summary.wrong).toBe(0);
    expect(summary.total).toBe(2);
    expect(summary.accuracy).toBe(0);
  });

  it('divides correct hits by every note struck, correct and wrong together', () => {
    let state = startRiff(['E2', 'G2', 'A2', 'E2']);
    state = hearNote(state, 'E2'); // correct
    state = hearNote(state, null);
    state = hearNote(state, 'A2'); // wrong (expected G2)
    state = hearNote(state, null);
    state = hearNote(state, 'G2'); // correct

    const summary = summariseRiff(state);
    expect(summary.played).toBe(2);
    expect(summary.wrong).toBe(1);
    expect(summary.accuracy).toBeCloseTo(2 / 3, 10);
  });

  it('reports full accuracy for a riff played correctly all the way through', () => {
    let state = startRiff(['E2', 'G2']);
    state = hearNote(state, 'E2');
    state = hearNote(state, null);
    state = hearNote(state, 'G2');

    const summary = summariseRiff(state);
    expect(summary.played).toBe(2);
    expect(summary.total).toBe(2);
    expect(summary.accuracy).toBe(1);
  });
});

describe('gradeRiff', () => {
  it('grades nothing when nothing was struck, correct or wrong', () => {
    const summary: RiffSummary = { played: 0, total: 5, wrong: 0, accuracy: 0 };
    expect(gradeRiff(summary)).toBeNull();
  });

  it('grades an unfinished riff "hard" no matter how clean the part played was', () => {
    // Completion gates the top grades: `played < total` is checked before
    // accuracy at all, so a perfect but incomplete run cannot score "easy".
    const summary: RiffSummary = { played: 2, total: 5, wrong: 0, accuracy: 1 };
    expect(gradeRiff(summary)).toBe('hard');
  });

  it('grades a completed riff by accuracy, at the thresholds the bar is drawn on', () => {
    const at = (accuracy: number): RiffSummary => ({ played: 10, total: 10, wrong: 0, accuracy });

    expect(gradeRiff(at(0.95))).toBe('easy');
    expect(gradeRiff(at(0.9499))).toBe('good');
    expect(gradeRiff(at(0.75))).toBe('good');
    expect(gradeRiff(at(0.7499))).toBe('hard');
    expect(gradeRiff(at(0.5))).toBe('hard');
    expect(gradeRiff(at(0.4999))).toBe('fail');
  });

  it('agrees with summariseRiff end to end for a riff played cleanly', () => {
    let state = startRiff(['E2', 'G2', 'A2']);
    state = hearNote(state, 'E2');
    state = hearNote(state, null);
    state = hearNote(state, 'G2');
    state = hearNote(state, null);
    state = hearNote(state, 'A2');

    expect(gradeRiff(summariseRiff(state))).toBe('easy');
  });

  it('agrees with summariseRiff end to end for a riff with more wrong notes than right', () => {
    let state = startRiff(['E2']);
    state = hearNote(state, 'G2');
    state = hearNote(state, null);
    state = hearNote(state, 'A2');
    state = hearNote(state, null);
    state = hearNote(state, 'E2'); // finally correct, riff complete

    const summary = summariseRiff(state);
    expect(summary.played).toBe(1);
    expect(summary.wrong).toBe(2);
    expect(gradeRiff(summary)).toBe('fail'); // 1/3 accuracy
  });
});

describe('riffPositions', () => {
  it('writes each playable note as string and fret', () => {
    expect(riffPositions(['E2', 'A2'])).toEqual(['6:0', '5:0']);
  });

  it('leaves a note it cannot place on the fretboard exactly as written', () => {
    // Mirrors `describeRiffPositions` in earGrading.ts: better the raw name a
    // player can look up than a blank in the middle of the riff.
    expect(riffPositions(['not-a-note'])).toEqual(['not-a-note']);
  });

  it('returns an empty list for an empty riff', () => {
    expect(riffPositions([])).toEqual([]);
  });
});
