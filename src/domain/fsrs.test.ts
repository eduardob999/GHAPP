import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEIGHTS,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
  MIN_REVIEWS_TO_ADAPT,
  TARGET_RETENTION,
  adaptWeights,
  describeStability,
  intervalFor,
  retrievability,
  reviewSkill,
  type FsrsState,
  type ReviewOutcome,
} from './fsrs';

const NOW = new Date('2026-01-01T09:00:00Z');
const DAY_MS = 86_400_000;

/** A settled item: several clean reps behind it, middling difficulty. */
const settled = (over: Partial<FsrsState> = {}): FsrsState => ({
  stability: 10,
  difficulty: 5,
  reps: 6,
  lapses: 0,
  ...over,
});

describe('retrievability', () => {
  it('is certain the moment a rep ends and decays from there', () => {
    expect(retrievability(0, 10)).toBe(1);
    expect(retrievability(5, 10)).toBeLessThan(1);
    expect(retrievability(50, 10)).toBeLessThan(retrievability(5, 10));
  });

  it('treats an item with no stability as already forgotten', () => {
    expect(retrievability(1, 0)).toBe(0);
    expect(retrievability(1, -3)).toBe(0);
  });

  it('decays more slowly the more stable the item is', () => {
    expect(retrievability(7, 30)).toBeGreaterThan(retrievability(7, 3));
  });
});

describe('intervalFor', () => {
  // This is the property the whole schedule rests on: the interval is chosen so
  // that recall has fallen to the target and no further by the time it is due.
  it('lands on the target retention, for any stability inside the clamps', () => {
    for (const stability of [1, 3, 10, 20]) {
      const days = intervalFor(stability);
      expect(retrievability(days, stability)).toBeCloseTo(TARGET_RETENTION, 6);
    }
  });

  it('honours a caller who wants to be reminded sooner', () => {
    expect(intervalFor(10, 0.95)).toBeLessThan(intervalFor(10, TARGET_RETENTION));
  });

  it('clamps at both ends rather than returning minutes or years', () => {
    expect(intervalFor(0.001)).toBe(MIN_INTERVAL_DAYS);
    expect(intervalFor(10_000)).toBe(MAX_INTERVAL_DAYS);
  });
});

describe('reviewSkill, first rep', () => {
  it('starts from the grade alone and claims no prediction', () => {
    const first = reviewSkill({ state: null, result: 'good', elapsedDays: 0 }, NOW);

    expect(first.state.reps).toBe(1);
    expect(first.state.lapses).toBe(0);
    // Nothing was known beforehand, so there was nothing to be wrong about.
    expect(first.predictedRecall).toBe(1);
  });

  it('counts a failed first rep as a lapse', () => {
    const first = reviewSkill({ state: null, result: 'fail', elapsedDays: 0 }, NOW);
    expect(first.state.lapses).toBe(1);
  });

  it('opens wider the better the first rep went', () => {
    const grades = (['fail', 'hard', 'good', 'easy'] as const).map(
      (result) => reviewSkill({ state: null, result, elapsedDays: 0 }, NOW).state.stability,
    );

    for (let i = 1; i < grades.length; i += 1) {
      expect(grades[i]!).toBeGreaterThan(grades[i - 1]!);
    }
  });

  it('puts the due date exactly one interval ahead of now', () => {
    const first = reviewSkill({ state: null, result: 'good', elapsedDays: 0 }, NOW);
    expect(first.dueAt.getTime()).toBe(NOW.getTime() + first.intervalDays * DAY_MS);
  });
});

describe('reviewSkill, later reps', () => {
  it('counts the rep and only counts a lapse when it was failed', () => {
    const passed = reviewSkill({ state: settled(), result: 'good', elapsedDays: 10 }, NOW);
    expect(passed.state.reps).toBe(7);
    expect(passed.state.lapses).toBe(0);

    const failed = reviewSkill({ state: settled(), result: 'fail', elapsedDays: 10 }, NOW);
    expect(failed.state.reps).toBe(7);
    expect(failed.state.lapses).toBe(1);
  });

  it('never leaves a failure more stable than it found it', () => {
    // The one hard guarantee in the lapse path, and the one worth a regression
    // test: forgetting something must never lengthen its interval.
    for (const stability of [0.5, 3, 10, 40]) {
      const before = settled({ stability });
      const after = reviewSkill({ state: before, result: 'fail', elapsedDays: 30 }, NOW);
      expect(after.state.stability).toBeLessThanOrEqual(stability);
    }
  });

  it('rewards a nearly forgotten rep more than a fresh one', () => {
    // The claim the model exists to make: recall that was hard-won is worth
    // more than recall that was never in doubt.
    const fresh = reviewSkill({ state: settled(), result: 'good', elapsedDays: 1 }, NOW);
    const overdue = reviewSkill({ state: settled(), result: 'good', elapsedDays: 60 }, NOW);

    expect(overdue.state.stability).toBeGreaterThan(fresh.state.stability);
    expect(overdue.predictedRecall).toBeLessThan(fresh.predictedRecall);
  });

  it('gains less on a hard pass than a good one, and most on an easy one', () => {
    const at = (result: 'hard' | 'good' | 'easy'): number =>
      reviewSkill({ state: settled(), result, elapsedDays: 10 }, NOW).state.stability;

    expect(at('hard')).toBeLessThan(at('good'));
    expect(at('good')).toBeLessThan(at('easy'));
  });

  it('gains less on a harder item than an easy one, all else equal', () => {
    const easyItem = reviewSkill(
      { state: settled({ difficulty: 2 }), result: 'good', elapsedDays: 10 },
      NOW,
    );
    const hardItem = reviewSkill(
      { state: settled({ difficulty: 9 }), result: 'good', elapsedDays: 10 },
      NOW,
    );

    expect(hardItem.state.stability).toBeLessThan(easyItem.state.stability);
  });

  it('keeps difficulty inside its scale however the reps go', () => {
    let state = settled({ difficulty: 5 });
    for (let i = 0; i < 40; i += 1) {
      state = reviewSkill({ state, result: 'easy', elapsedDays: 5 }, NOW).state;
    }
    expect(state.difficulty).toBeGreaterThanOrEqual(1);

    state = settled({ difficulty: 5 });
    for (let i = 0; i < 40; i += 1) {
      state = reviewSkill({ state, result: 'fail', elapsedDays: 5 }, NOW).state;
    }
    expect(state.difficulty).toBeLessThanOrEqual(10);
  });

  it('treats a negative elapsed time as zero rather than crediting it', () => {
    const backwards = reviewSkill({ state: settled(), result: 'good', elapsedDays: -5 }, NOW);
    const same = reviewSkill({ state: settled(), result: 'good', elapsedDays: 0 }, NOW);
    expect(backwards.state.stability).toBeCloseTo(same.state.stability, 10);
  });
});

describe('adaptWeights', () => {
  const outcomes = (count: number, predicted: number, recalledCount: number): ReviewOutcome[] =>
    Array.from({ length: count }, (_, i) => ({ predicted, recalled: i < recalledCount }));

  it('does nothing until there is enough evidence to act on', () => {
    const thin = outcomes(MIN_REVIEWS_TO_ADAPT - 1, 0.9, 0);
    expect(adaptWeights(thin)).toBe(DEFAULT_WEIGHTS);
  });

  it('leaves the weights alone when the model is close enough', () => {
    // Predicted 0.9, recalled 18 of 20: an error of zero.
    expect(adaptWeights(outcomes(20, 0.9, 18))).toBe(DEFAULT_WEIGHTS);
  });

  it('slows the schedule when the player forgets more than predicted', () => {
    // Predicted 0.9, actually recalled half the time: over-confident.
    const adapted = adaptWeights(outcomes(20, 0.9, 10));
    expect(adapted[8]!).toBeLessThan(DEFAULT_WEIGHTS[8]!);
  });

  it('stretches the schedule when the player forgets less than predicted', () => {
    const adapted = adaptWeights(outcomes(20, 0.6, 20));
    expect(adapted[8]!).toBeGreaterThan(DEFAULT_WEIGHTS[8]!);
  });

  it('moves the growth term by at most twenty percent either way', () => {
    // One catastrophic week must not be able to wreck the schedule.
    const worst = adaptWeights(outcomes(50, 1, 0));
    const best = adaptWeights(outcomes(50, 0, 50));

    expect(worst[8]!).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS[8]! + Math.log(0.8));
    expect(best[8]!).toBeLessThanOrEqual(DEFAULT_WEIGHTS[8]! + Math.log(1.2));
  });

  it('changes only the growth term', () => {
    const adapted = adaptWeights(outcomes(20, 0.9, 10));
    expect(adapted).toHaveLength(DEFAULT_WEIGHTS.length);
    adapted.forEach((value, i) => {
      if (i !== 8) expect(value).toBe(DEFAULT_WEIGHTS[i]);
    });
  });
});

describe('describeStability', () => {
  it('names each band at its boundaries', () => {
    expect(describeStability(0.9)).toBe('shaky');
    expect(describeStability(1)).toBe('coming along');
    expect(describeStability(3.9)).toBe('coming along');
    expect(describeStability(4)).toBe('solid');
    expect(describeStability(13.9)).toBe('solid');
    expect(describeStability(14)).toBe('yours');
  });
});
