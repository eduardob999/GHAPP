import { describe, expect, it } from 'vitest';

import type { ChordQuality } from '../audio/chordDetection';
import {
  ON_TIME_WINDOW_MS,
  PROGRESSIONS,
  applyTiming,
  gradeFromSummary,
  pitchClassOf,
  scoreDetection,
  scoreRiffWindow,
  scoreWindow,
  summarise,
  timingVerdict,
  type ChordScore,
  type ProgressionChord,
  type RiffScore,
} from './progressions';

/**
 * The grading half of `progressions.ts`. Everything above `tuningOf` in that
 * file is catalog content and grows; nothing here counts it.
 *
 * The property this file exists to defend is in CLAUDE.md under "what must not
 * change": timing only ever demotes, never promotes, and a missing onset does
 * not demote either. It is a one line change to undo, and undoing it would make
 * the app feel more rewarding while making it lie about how you played.
 */

/** The chord under the microphone unless a test says otherwise. */
const TARGET: Pick<ProgressionChord, 'root' | 'quality'> = { root: 'G', quality: 'maj' };

/** One detection frame, as the detector reports one. */
const heard = (root: string, quality: ChordQuality): { root: string; quality: ChordQuality } => ({
  root,
  quality,
});

/** A rep's worth of frames: `n` copies of the same reading. */
const window = (n: number, frame: { root: string; quality: ChordQuality } | null) =>
  Array.from({ length: n }, () => frame);

/**
 * What the detector actually reports while a riff is played: a note stays in
 * the spectrum for as many frames as it rings, so every note arrives repeated.
 */
const ringing = (notes: readonly string[], frames = 4): string[] =>
  notes.flatMap((note) => Array.from({ length: frames }, () => note));

/** Every offset worth trying, on both sides of the window and outside it. */
const EVERY_OFFSET: readonly (number | null)[] = [
  null,
  -5_000,
  -(ON_TIME_WINDOW_MS + 1),
  -ON_TIME_WINDOW_MS,
  -1,
  0,
  1,
  ON_TIME_WINDOW_MS,
  ON_TIME_WINDOW_MS + 1,
  5_000,
];

const EVERY_SCORE: readonly ChordScore[] = ['hit', 'partial', 'miss', 'unclear'];

/**
 * Worst to best. The ordering between `unclear` and `miss` is arbitrary and
 * never load-bearing: only `hit` is ever moved, so the two non-hit failures
 * only have to sit below `partial`.
 */
const SCORE_RANK: Record<ChordScore, number> = { unclear: 0, miss: 1, partial: 2, hit: 3 };

describe('pitchClassOf', () => {
  it('reads the twelve natural and sharp names an octave apart as one class', () => {
    // Riff grading compares pitch classes precisely so that an octave error
    // from the detector, which is routine on a low string, is not a wrong note.
    expect(pitchClassOf('C0')).toBe(0);
    expect(pitchClassOf('C4')).toBe(0);
    expect(pitchClassOf('E2')).toBe(4);
    expect(pitchClassOf('E5')).toBe(4);
    expect(pitchClassOf('B9')).toBe(11);
  });

  it('accepts a note with no octave at all, which is how a chord root is spelled', () => {
    expect(pitchClassOf('A')).toBe(9);
    expect(pitchClassOf('F#')).toBe(6);
  });

  it('treats a flat and its sharp as the same pitch class', () => {
    expect(pitchClassOf('A#2')).toBe(pitchClassOf('Bb2'));
    expect(pitchClassOf('Db')).toBe(pitchClassOf('C#'));
    expect(pitchClassOf('Eb3')).toBe(3);
    expect(pitchClassOf('Gb1')).toBe(6);
  });

  it('reads a negative octave, because MIDI note 0 is C-1', () => {
    expect(pitchClassOf('C-1')).toBe(0);
    expect(pitchClassOf('A-1')).toBe(9);
  });

  it('ignores surrounding whitespace rather than failing on it', () => {
    expect(pitchClassOf('  G3  ')).toBe(7);
  });

  it('returns null for anything it cannot parse instead of guessing a class', () => {
    // Null is what keeps an unparseable note out of the riff comparison
    // entirely. Guessing here would silently invent a note the player never
    // played and then grade them against it.
    expect(pitchClassOf('H')).toBeNull();
    expect(pitchClassOf('')).toBeNull();
    expect(pitchClassOf('e2')).toBeNull();
    expect(pitchClassOf('C##')).toBeNull();
    expect(pitchClassOf('E2 G2')).toBeNull();
  });

  it('returns null for the two enharmonic spellings the table does not carry', () => {
    // NOTE, a finding rather than a preference: `Cb` and `E#` are legal note
    // names and parse as shape, but PITCH_CLASSES has no entry for either, so
    // they come back null. Nothing in the catalog spells a note that way today.
    expect(pitchClassOf('Cb')).toBeNull();
    expect(pitchClassOf('E#')).toBeNull();
    expect(pitchClassOf('Fb')).toBeNull();
    expect(pitchClassOf('B#')).toBeNull();
  });
});

describe('timingVerdict', () => {
  it('calls a missing onset "none" rather than early or late', () => {
    // This is the input that matters most. Attack detection is the least
    // reliable link in the chain and a fingerpicked chord may have no sharp
    // attack at all, so "we did not see one" has to be its own answer.
    expect(timingVerdict(null)).toBe('none');
  });

  it('counts the whole window either side of the beat as on time', () => {
    expect(timingVerdict(0)).toBe('on-time');
    expect(timingVerdict(ON_TIME_WINDOW_MS)).toBe('on-time');
    expect(timingVerdict(-ON_TIME_WINDOW_MS)).toBe('on-time');
  });

  it('is early below the window and late above it, exclusive at the boundary', () => {
    expect(timingVerdict(-(ON_TIME_WINDOW_MS + 1))).toBe('early');
    expect(timingVerdict(ON_TIME_WINDOW_MS + 1)).toBe('late');
    expect(timingVerdict(-5_000)).toBe('early');
    expect(timingVerdict(5_000)).toBe('late');
  });

  it('keeps the window wide enough that it is the playing being judged', () => {
    // The window is documented as roughly where a listener stops hearing a
    // strum as displaced, and deliberately wider than the detector's own
    // resolution. Narrowing it would turn measurement noise into feedback.
    expect(ON_TIME_WINDOW_MS).toBeGreaterThanOrEqual(50);
  });
});

describe('applyTiming: timing only ever demotes', () => {
  it('never returns a better score than it was given, for any offset', () => {
    // The property, swept. If somebody makes the app more rewarding by letting
    // good timing lift a score, this is the test that goes red.
    for (const score of EVERY_SCORE) {
      for (const offset of EVERY_OFFSET) {
        expect(SCORE_RANK[applyTiming(score, offset)]).toBeLessThanOrEqual(SCORE_RANK[score]);
      }
    }
  });

  it('either leaves the score alone or turns exactly one hit into a partial', () => {
    // Stronger than the ranking above: the only edge in the whole function is
    // hit to partial. It can never reach miss or unclear, because a badly
    // timed correct chord is still a correct chord.
    for (const score of EVERY_SCORE) {
      for (const offset of EVERY_OFFSET) {
        const after = applyTiming(score, offset);
        if (after !== score) {
          expect(score).toBe('hit');
          expect(after).toBe('partial');
        }
      }
    }
  });

  it('does not turn a partial into a hit, however perfectly it was timed', () => {
    expect(applyTiming('partial', 0)).toBe('partial');
    expect(applyTiming('partial', ON_TIME_WINDOW_MS)).toBe('partial');
  });

  it('does not rescue a miss or an unclear frame with perfect timing either', () => {
    expect(applyTiming('miss', 0)).toBe('miss');
    expect(applyTiming('unclear', 0)).toBe('unclear');
  });

  it('does demote a well played chord that landed conspicuously out of time', () => {
    // The other half of the rule. Timing has to be able to cost something, or
    // the toggle does nothing and the feature is decorative.
    expect(applyTiming('hit', ON_TIME_WINDOW_MS + 1)).toBe('partial');
    expect(applyTiming('hit', -(ON_TIME_WINDOW_MS + 1))).toBe('partial');
    expect(applyTiming('hit', 5_000)).toBe('partial');
  });

  it('leaves a hit alone when it landed inside the window', () => {
    expect(applyTiming('hit', 0)).toBe('hit');
    expect(applyTiming('hit', ON_TIME_WINDOW_MS)).toBe('hit');
    expect(applyTiming('hit', -ON_TIME_WINDOW_MS)).toBe('hit');
  });

  it('leaves every score exactly as it was when no onset was detected', () => {
    // A fingerpicked chord may have no attack to find. Charging the player for
    // the detector's blind spot would teach them to dig in rather than to play
    // in time, which is the opposite of the lesson.
    for (const score of EVERY_SCORE) {
      expect(applyTiming(score, null)).toBe(score);
    }
  });

  it('keeps a hit when the offset is not a number, failing toward the player', () => {
    // NOTE, a finding: NaN passes both comparisons in `timingVerdict`, so it
    // reads as 'on-time' rather than as a missing onset. The outcome is the
    // safe one either way, since 'none' and 'on-time' both leave a hit intact,
    // but the verdict itself is wrong and would show as "on time" in the UI.
    expect(timingVerdict(Number.NaN)).toBe('on-time');
    expect(applyTiming('hit', Number.NaN)).toBe('hit');
  });
});

describe('applyTiming over a whole run', () => {
  /** Four steps of the same score, folded through timing and summarised. */
  const runOf = (score: ChordScore, offsets: readonly (number | null)[]) =>
    summarise(offsets.map((offset) => applyTiming(score, offset)));

  const PERFECT = [0, 0, 0, 0] as const;
  const RAGGED = [200, -200, 300, -400] as const;
  const NO_ONSETS = [null, null, null, null] as const;

  it('grades a clean, well timed run as easy', () => {
    expect(gradeFromSummary(runOf('hit', PERFECT))).toBe('easy');
  });

  it('lets bad timing pull a clean run down the scheduler grade', () => {
    // Every chord was right and the run is still not easy. That is the whole
    // difference between a practice tool and a rhythm game, and it is the only
    // direction timing is allowed to move a grade.
    const ragged = gradeFromSummary(runOf('hit', RAGGED));
    expect(ragged).toBe('hard');
    expect(ragged).not.toBe(gradeFromSummary(runOf('hit', PERFECT)));
  });

  it('grades a run with no onsets at all exactly like a perfectly timed one', () => {
    // Silence from the onset detector must cost nothing. This is the case a
    // fingerpicker hits every session.
    expect(runOf('hit', NO_ONSETS)).toEqual(runOf('hit', PERFECT));
    expect(gradeFromSummary(runOf('hit', NO_ONSETS))).toBe('easy');
  });

  it('cannot lift a run of wrong chords out of fail, however good the timing', () => {
    expect(gradeFromSummary(runOf('miss', PERFECT))).toBe('fail');
    expect(gradeFromSummary(runOf('unclear', PERFECT))).toBe('fail');
  });

  it('cannot lift a run of near misses above what the pitch alone earned', () => {
    expect(gradeFromSummary(runOf('partial', PERFECT))).toBe(
      gradeFromSummary(summarise(['partial', 'partial', 'partial', 'partial'])),
    );
  });
});

describe('applyTiming on what the chord scorer actually produced', () => {
  // The end to end version of the rule: a real detection, scored on pitch,
  // then folded through timing. A wrong chord has to stay wrong.
  const perfectlyTimed = (frames: ({ root: string; quality: ChordQuality } | null)[]) =>
    applyTiming(scoreWindow(TARGET, frames).score, 0);

  it('leaves a wrong chord wrong even when it was played dead on the beat', () => {
    expect(perfectlyTimed(window(6, heard('A', 'maj')))).toBe('miss');
  });

  it('leaves a contradicted third at partial even when it was played dead on the beat', () => {
    expect(perfectlyTimed(window(6, heard('G', 'min')))).toBe('partial');
  });

  it('leaves silence unclear even when an onset was heard on the beat', () => {
    expect(perfectlyTimed(window(6, null))).toBe('unclear');
  });

  it('demotes the right chord to partial when it was late, and no further', () => {
    const late = applyTiming(scoreWindow(TARGET, window(6, heard('G', 'maj'))).score, 400);
    expect(late).toBe('partial');
  });
});

describe('scoreDetection', () => {
  it('is a hit when the root and the quality both match', () => {
    expect(scoreDetection(TARGET, heard('G', 'maj'))).toBe('hit');
  });

  it('is unclear, not a miss, when nothing was detected', () => {
    // Silence is not a wrong answer. Grading it as one would punish a quiet
    // room and a low signal identically to playing the wrong chord.
    expect(scoreDetection(TARGET, null)).toBe('unclear');
  });

  it('is a hit for the same notes under a different name', () => {
    // C6 and Am7 are both {C,E,G,A}. Nothing in a pitch-class profile
    // distinguishes them, and nothing in the player's hands did either.
    expect(scoreDetection({ root: 'C', quality: '6' }, heard('A', 'min7'))).toBe('hit');
    expect(scoreDetection({ root: 'A', quality: 'min7' }, heard('C', '6'))).toBe('hit');
  });

  it('is a hit for any of the four names of one diminished seventh', () => {
    for (const root of ['C', 'D#', 'F#', 'A']) {
      expect(scoreDetection({ root: 'C', quality: 'dim7' }, heard(root, 'dim7'))).toBe('hit');
    }
  });

  it('is a hit when the detector dropped or added a colour tone on the right root', () => {
    // Every plucked string carries a flat-7 and a major third among its
    // partials, so a perfectly good G major routinely reads as G7 or G5. That
    // is a measurement artefact and must not read as a mistake.
    expect(scoreDetection(TARGET, heard('G', '7'))).toBe('hit');
    expect(scoreDetection(TARGET, heard('G', '5'))).toBe('hit');
    expect(scoreDetection(TARGET, heard('G', 'sus4'))).toBe('hit');
    expect(scoreDetection(TARGET, heard('G', 'maj7'))).toBe('hit');
  });

  it('is a partial only when the third was contradicted on the right root', () => {
    // Playing minor where major was asked for is a real mistake and the one
    // quality error worth being told about.
    expect(scoreDetection(TARGET, heard('G', 'min'))).toBe('partial');
    expect(scoreDetection({ root: 'G', quality: 'min' }, heard('G', 'maj'))).toBe('partial');
  });

  it('is a miss on the wrong root, whatever the quality', () => {
    expect(scoreDetection(TARGET, heard('A', 'maj'))).toBe('miss');
    expect(scoreDetection(TARGET, heard('G#', 'maj'))).toBe('miss');
    expect(scoreDetection(TARGET, heard('D', 'min'))).toBe('miss');
  });

  it('does not recognise a flat spelling of the root it was given', () => {
    // NOTE, a finding: `scoreDetection` compares root strings and then falls
    // back on a pitch-class mask built by `chordPitchClassMask`, which only
    // knows the sharp names, so a flat-spelled target masks to 0 and the
    // enharmonic path is skipped. `tunings.ts` has `normaliseRoot` for exactly
    // this and `scoreDetection` does not call it. Nothing in the catalog
    // spells a root with a flat today, and `transposeRoot` emits sharps, so
    // this is latent rather than live.
    expect(scoreDetection({ root: 'Bb', quality: 'maj' }, heard('A#', 'maj'))).toBe('miss');
  });
});

describe('scoreWindow', () => {
  it('grades the best moment in the window rather than the average', () => {
    // A strum rings, decays and gets damped, and an arpeggio only spells the
    // full chord once its last note lands. Averaging would grade the decay.
    const frames = [null, heard('E', 'min'), heard('G', 'maj'), null];
    expect(scoreWindow(TARGET, frames).score).toBe('hit');
  });

  it('falls back to a partial when the best moment was only nearly right', () => {
    const frames = [heard('A', 'maj'), heard('G', 'min'), heard('D', 'maj')];
    expect(scoreWindow(TARGET, frames).score).toBe('partial');
  });

  it('reports unclear when every frame was silent, and counts nothing observed', () => {
    expect(scoreWindow(TARGET, window(5, null))).toEqual({
      score: 'unclear',
      hits: 0,
      observed: 0,
    });
  });

  it('reports unclear for an empty window rather than failing the step', () => {
    expect(scoreWindow(TARGET, []).score).toBe('unclear');
  });

  it('counts only the frames it actually saw, and only the ones that hit', () => {
    const frames = [heard('G', 'maj'), null, heard('G', 'maj'), heard('A', 'maj'), null];
    expect(scoreWindow(TARGET, frames)).toEqual({ score: 'hit', hits: 2, observed: 3 });
  });
});

describe('scoreRiffWindow: order, by longest common subsequence', () => {
  /** Four distinct pitch classes, so coverage and order can be read apart. */
  const RIFF = ['A2', 'C3', 'D3', 'E3'] as const;

  it('gives a perfect order ratio to a riff played in order', () => {
    expect(scoreRiffWindow(RIFF, ringing(RIFF)).orderRatio).toBe(1);
  });

  it('scores a reversed riff far below the same riff in order', () => {
    // The whole point of item 3 in docs/NEXT.md: the right notes in the wrong
    // sequence is most of what there is to get wrong in a riff, and coverage
    // alone gave it full marks. The shape is what is pinned here, not the
    // float: docs/NEXT.md records 0.25 against 1.00 for a four note riff.
    const inOrder = scoreRiffWindow(RIFF, ringing(RIFF)).orderRatio;
    const reversed = scoreRiffWindow(RIFF, ringing([...RIFF].reverse())).orderRatio;

    expect(reversed).toBeLessThan(inOrder);
    expect(reversed).toBeLessThan(0.5);
    expect(reversed).toBeGreaterThan(0);
  });

  it('still counts a reversed riff as full coverage, because the notes were right', () => {
    // Order and coverage are separate axes on purpose. Playing the wrong notes
    // is a bigger mistake than playing the right ones out of sequence.
    const reversed = scoreRiffWindow(RIFF, ringing([...RIFF].reverse()));
    expect(reversed.matched).toBe(reversed.wanted);
    expect(reversed.score).toBe('partial');
  });

  it('scores the wrong notes below a reversed riff, order ratio and grade alike', () => {
    const wrong = scoreRiffWindow(RIFF, ringing(['F2', 'F#2', 'G2', 'G#2']));
    expect(wrong.matched).toBe(0);
    expect(wrong.score).toBe('miss');
  });

  it('collapses a ringing note, because a held note is not a repeated note', () => {
    // The detector reports the same pitch on every frame for as long as the
    // string rings. Without the collapse those frames would read as extra
    // notes and drag the order ratio down for perfect playing.
    expect(scoreRiffWindow(RIFF, ringing(RIFF, 1)).orderRatio).toBe(1);
    expect(scoreRiffWindow(RIFF, ringing(RIFF, 20)).orderRatio).toBe(1);
    expect(scoreRiffWindow(RIFF, ringing(RIFF, 20))).toEqual(scoreRiffWindow(RIFF, ringing(RIFF, 1)));
  });

  it('collapses across octaves too, since the comparison is on pitch class', () => {
    const wobbling = ['A2', 'A3', 'A2', 'C3', 'C4', 'D3', 'E3'];
    expect(scoreRiffWindow(RIFF, wobbling).orderRatio).toBe(1);
  });

  it('ignores the octave entirely, so a detector octave error is not a wrong note', () => {
    // Octave errors are common on a low string. Penalising them would teach a
    // lesson about the microphone rather than about the riff.
    const shifted = RIFF.map((note) => `${note.slice(0, -1)}${Number(note.slice(-1)) + 2}`);
    const graded = scoreRiffWindow(RIFF, ringing(shifted));

    expect(graded.orderRatio).toBe(1);
    expect(graded.matched).toBe(graded.wanted);
    expect(graded.score).toBe('hit');
  });

  it('reads a flat spelling and its sharp as the same note', () => {
    expect(scoreRiffWindow(['A#2', 'D3'], ringing(['Bb2', 'D3'])).score).toBe('hit');
  });

  it('tolerates one extra note and one missed note rather than collapsing to zero', () => {
    // This is the reason for a subsequence rather than a strict comparison: a
    // fumbled extra note should cost a little, not everything.
    const withExtra = scoreRiffWindow(RIFF, ringing(['A2', 'C3', 'C#3', 'D3', 'E3']));
    expect(withExtra.orderRatio).toBe(1);

    const withGap = scoreRiffWindow(RIFF, ringing(['A2', 'D3', 'E3']));
    expect(withGap.orderRatio).toBeGreaterThan(0.5);
    expect(withGap.orderRatio).toBeLessThan(1);
  });

  it('gives a perfect order ratio to a riff whose own notes repeat', () => {
    // Was docs/NEXT.md 16a, and the reason this test reads the opposite way to
    // the one it replaces. The collapse used to be applied to what was heard
    // and not to what was written, so a riff written with a consecutive
    // repeat, "E2 E2 G2 A2", kept four notes on the expected side while a
    // perfect performance collapsed to three, and the order ratio topped out
    // at 0.75 however well it was played.
    const repeated = ['E2', 'E2', 'G2', 'A2'];
    const perfect = scoreRiffWindow(repeated, ringing(repeated));

    expect(perfect.orderRatio).toBe(1);
    expect(perfect.score).toBe('hit');
  });

  it('needs both the notes and the order to call a riff a hit', () => {
    // Coverage at or above 0.7 and order at or above 0.6. Either one alone
    // leaves the step at partial, which is what "you played it, not cleanly"
    // should look like.
    expect(scoreRiffWindow(RIFF, ringing(RIFF)).score).toBe('hit');
    expect(scoreRiffWindow(RIFF, ringing([...RIFF].reverse())).score).toBe('partial');
    expect(scoreRiffWindow(RIFF, ringing(['A2', 'C3'])).score).toBe('partial');
  });

  it('reports unclear, not a miss, when nothing usable was heard', () => {
    // Same reasoning as a silent chord frame: a quiet room is not a wrong note.
    expect(scoreRiffWindow(RIFF, [])).toEqual({
      score: 'unclear',
      matched: 0,
      wanted: 4,
      orderRatio: 0,
    });
    expect(scoreRiffWindow(RIFF, ['not a note', 'H4']).score).toBe('unclear');
  });

  it('reports unclear when the step itself carries no playable notes', () => {
    expect(scoreRiffWindow([], ringing(RIFF))).toEqual({
      score: 'unclear',
      matched: 0,
      wanted: 0,
      orderRatio: 0,
    });
  });

  it('drops unparseable notes from both sides instead of scoring them as wrong', () => {
    const graded = scoreRiffWindow(['A2', 'zzz', 'C3'], ringing(['A2', 'C3']));
    expect(graded.wanted).toBe(2);
    expect(graded.matched).toBe(2);
    expect(graded.orderRatio).toBe(1);
  });

  it('never reports an order ratio outside nought to one', () => {
    const cases: readonly (readonly string[])[] = [
      RIFF,
      [...RIFF].reverse(),
      ['A2', 'A2', 'A2'],
      ['F2', 'F#2'],
      [],
      ['A2', 'C3', 'D3', 'E3', 'G3', 'A3'],
    ];

    for (const played of cases) {
      const { orderRatio } = scoreRiffWindow(RIFF, ringing(played));
      expect(orderRatio).toBeGreaterThanOrEqual(0);
      expect(orderRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoreRiffWindow: riffs written with a repeated note', () => {
  /**
   * The four riffs named in docs/NEXT.md 16a, each of which capped at 0.75 for
   * a perfect performance before the expected side was collapsed too.
   */
  const NAMED_IN_16A: readonly (readonly string[])[] = [
    ['E2', 'E2', 'G2', 'A2'],
    ['G2', 'E2', 'E2', 'E2'],
    ['D2', 'D2', 'F2', 'G2'],
    ['B3', 'G3', 'E3', 'E3'],
  ];

  /** Every riff step the catalog actually ships, notes only. */
  const catalogRiffs = (): string[][] =>
    PROGRESSIONS.flatMap((progression) =>
      progression.chords
        .filter((chord) => chord.mode === 'riff' && (chord.notes?.length ?? 0) > 0)
        .map((chord) => [...(chord.notes ?? [])]),
    );

  const pitchClasses = (notes: readonly string[]): number[] =>
    notes.map(pitchClassOf).filter((pc): pc is number => pc !== null);

  const hasAdjacentRepeat = (notes: readonly string[]): boolean =>
    pitchClasses(notes).some((pc, i, all) => i > 0 && pc === all[i - 1]);

  it('scores every riff in the catalog a clean 1.00 when it is played as written', () => {
    // The test that would have caught 16a without anyone noticing the defect
    // first: a perfect performance of anything in the library is a perfect
    // score. It says nothing about how many riffs there are, so it does not go
    // stale as content is added.
    const riffs = catalogRiffs();
    expect(riffs.length).toBeGreaterThan(0);
    expect(riffs.some(hasAdjacentRepeat)).toBe(true);

    for (const notes of riffs) {
      const perfect = scoreRiffWindow(notes, ringing(notes));
      expect({ riff: notes.join(' '), order: perfect.orderRatio, score: perfect.score }).toEqual({
        riff: notes.join(' '),
        order: 1,
        score: 'hit',
      });
    }
  });

  it('gives each of the four riffs named in 16a a perfect score, not 0.75', () => {
    for (const notes of NAMED_IN_16A) {
      const perfect = scoreRiffWindow(notes, ringing(notes));
      expect(perfect.orderRatio).toBe(1);
      expect(perfect.score).toBe('hit');
      expect(perfect.matched).toBe(perfect.wanted);
    }
  });

  it('is the same riff to the domain whether the repeat was picked or held', () => {
    // The design question 16a raises, and the reason it is answered this way.
    // Both panels record a riff with `if (latestNote.current) bucket.push(...)`,
    // so a frame carrying no pitch is never stored: the silence between two
    // picks of the same note is gone before this file is reached. Picking E
    // twice and holding it once therefore arrive as the same array, and no
    // implementation can return two different numbers for one input. The only
    // choice available is which of the two the shared value should be correct
    // for, and the player who played it as written wins that.
    const asThePanelRecordsIt = (frames: readonly (string | null)[]): string[] =>
      frames.filter((note): note is string => Boolean(note));

    const pickedTwice = asThePanelRecordsIt([
      'E2', 'E2', 'E2', null, null, 'E2', 'E2', 'E2', 'G2', 'G2', 'A2', 'A2',
    ]);
    const heldOnce = asThePanelRecordsIt([
      'E2', 'E2', 'E2', 'E2', 'E2', 'E2', 'G2', 'G2', 'A2', 'A2',
    ]);

    const written = ['E2', 'E2', 'G2', 'A2'];
    expect(scoreRiffWindow(written, pickedTwice)).toEqual(scoreRiffWindow(written, heldOnce));
    expect(scoreRiffWindow(written, pickedTwice).orderRatio).toBe(1);
  });

  it('does not hand out a perfect order ratio to a repeated-note riff played wrong', () => {
    // Collapsing the expected side shortens the phrase it is judged against, so
    // it is worth proving the ratio can still fall. It can, on both shapes:
    // "E2 E2 G2 A2" is judged as E-G-A and "G2 E2 E2 E2" as G-E.
    expect(scoreRiffWindow(['E2', 'E2', 'G2', 'A2'], ringing(['A2', 'G2', 'E2'])).orderRatio)
      .toBeLessThan(0.5);
    expect(scoreRiffWindow(['G2', 'E2', 'E2', 'E2'], ringing(['E2', 'G2'])).orderRatio)
      .toBeLessThan(1);
    expect(scoreRiffWindow(['D2', 'D2', 'F2', 'G2'], ringing(['C2', 'C#2'])).score).toBe('miss');
  });

  it('collapses a repeat written across octaves, since octave is ignored throughout', () => {
    // "E2 E3" is one note here for the same reason "E2 E2" is: an octave slip
    // on a low string is the detector's commonest error and is discounted
    // everywhere else in this function.
    expect(scoreRiffWindow(['E2', 'E3', 'G2', 'A2'], ringing(['E2', 'G2', 'A2'])).orderRatio)
      .toBe(1);
    expect(scoreRiffWindow(['A#2', 'Bb2', 'D3'], ringing(['A#2', 'D3'])).orderRatio).toBe(1);
  });
});

describe('scoreRiffWindow: the fix moves nothing for a riff without repeats', () => {
  /**
   * `scoreRiffWindow` exactly as it read before 16a was fixed: the collapse
   * applied to the heard side and not to the expected one. Kept here so the
   * claim "this changes nothing for a riff with no consecutive repeat" is
   * checked rather than asserted.
   */
  const lcs = (a: readonly number[], b: readonly number[]): number => {
    const table = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0),
    );
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        table[i]![j] =
          a[i - 1] === b[j - 1]
            ? table[i - 1]![j - 1]! + 1
            : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
      }
    }
    return table[a.length]![b.length]!;
  };

  const beforeTheFix = (expected: readonly string[], heard: readonly string[]): RiffScore => {
    const wanted = new Set(
      expected.map(pitchClassOf).filter((pc): pc is number => pc !== null),
    );
    const got = new Set(heard.map(pitchClassOf).filter((pc): pc is number => pc !== null));

    if (wanted.size === 0) return { score: 'unclear', matched: 0, wanted: 0, orderRatio: 0 };
    if (got.size === 0) {
      return { score: 'unclear', matched: 0, wanted: wanted.size, orderRatio: 0 };
    }

    let matched = 0;
    for (const pc of wanted) if (got.has(pc)) matched += 1;
    const coverage = matched / wanted.size;

    const expectedSeq = expected
      .map(pitchClassOf)
      .filter((pc): pc is number => pc !== null);
    const heardSeq = heard
      .map(pitchClassOf)
      .filter((pc): pc is number => pc !== null)
      .filter((pc, i, all) => i === 0 || pc !== all[i - 1]);

    const inOrder = lcs(expectedSeq, heardSeq);
    const orderRatio = expectedSeq.length > 0 ? inOrder / expectedSeq.length : 0;
    const result = (score: ChordScore): RiffScore => ({
      score,
      matched,
      wanted: wanted.size,
      orderRatio,
    });

    if (coverage >= 0.7 && orderRatio >= 0.6) return result('hit');
    if (coverage >= 0.34 || orderRatio >= 0.5) return result('partial');
    return result('miss');
  };

  const pitchClasses = (notes: readonly string[]): number[] =>
    notes.map(pitchClassOf).filter((pc): pc is number => pc !== null);

  const hasAdjacentRepeat = (notes: readonly string[]): boolean =>
    pitchClasses(notes).some((pc, i, all) => i > 0 && pc === all[i - 1]);

  /** How the same riff might come out: right, wrong, and several kinds of nearly. */
  const waysOfPlaying = (notes: readonly string[]): string[][] => [
    ringing(notes),
    ringing([...notes].reverse()),
    ringing(notes.slice(1)),
    ringing(notes.slice(0, -1)),
    ringing([...notes, notes[0] ?? 'C3']),
    ringing([notes[0] ?? 'C3', ...notes]),
    ringing(['F#4', 'C#4']),
    ringing(notes, 1),
    ringing(notes, 25),
    [],
    ['not a note'],
  ];

  it('returns byte-for-byte what the old code returned, for every catalog riff without a repeat', () => {
    const withoutRepeats = PROGRESSIONS.flatMap((progression) =>
      progression.chords
        .filter((chord) => chord.mode === 'riff' && (chord.notes?.length ?? 0) > 0)
        .map((chord) => [...(chord.notes ?? [])]),
    ).filter((notes) => !hasAdjacentRepeat(notes));

    expect(withoutRepeats.length).toBeGreaterThan(0);

    for (const notes of withoutRepeats) {
      for (const played of waysOfPlaying(notes)) {
        expect(scoreRiffWindow(notes, played)).toEqual(beforeTheFix(notes, played));
      }
    }
  });

  it('returns byte-for-byte what the old code returned for the hand-written cases too', () => {
    // The riffs the rest of this file is written against, so the two describe
    // blocks above cannot drift from the old behaviour without this failing.
    const noRepeats: readonly (readonly string[])[] = [
      ['A2', 'C3', 'D3', 'E3'],
      ['F2', 'F#2', 'G2', 'G#2'],
      ['A2', 'G3', 'A2', 'G3'],
      ['G3', 'B3', 'E4', 'B3'],
      ['A#2', 'D3'],
      ['A2', 'zzz', 'C3'],
      ['C3'],
    ];

    for (const notes of noRepeats) {
      for (const played of waysOfPlaying(notes)) {
        expect(scoreRiffWindow(notes, played)).toEqual(beforeTheFix(notes, played));
      }
    }
  });

  it('differs from the old code only where the riff repeats a note', () => {
    // The other half of the same claim: the change is not a no-op everywhere.
    const repeated = ['E2', 'E2', 'G2', 'A2'];
    expect(beforeTheFix(repeated, ringing(repeated)).orderRatio).toBeCloseTo(0.75, 5);
    expect(scoreRiffWindow(repeated, ringing(repeated)).orderRatio).toBe(1);
  });
});
