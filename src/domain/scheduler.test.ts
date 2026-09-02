import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EASE,
  describeInterval,
  scheduleNext,
  type SchedulerStateInput,
} from './scheduler';

const NOW = new Date('2026-01-01T09:00:00Z');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

/** An item with some history: due today, several clean reps behind it. */
const practised = (over: Partial<SchedulerStateInput> = {}): SchedulerStateInput => ({
  stability: 10,
  difficulty: 5,
  reps: 6,
  lapses: 0,
  intervalDays: 12,
  lastPracticedAt: ago(12),
  ...over,
});

describe('scheduleNext', () => {
  it('is deterministic: the same rep graded twice gives the same answer', () => {
    const a = scheduleNext(practised(), 'good', NOW);
    const b = scheduleNext(practised(), 'good', NOW);
    expect(a).toEqual(b);
  });

  it('puts the due date exactly one interval ahead of now', () => {
    const next = scheduleNext(practised(), 'good', NOW);
    expect(next.dueAt.getTime()).toBe(NOW.getTime() + next.intervalDays * DAY_MS);
  });

  it('pulls a failure sharply back in, though not to the same day', () => {
    // NOTE, and it is a finding rather than a preference: FAIL_INTERVAL_DAYS is
    // named and commented as "a failure comes back in about two and a half
    // hours", but it is only the lower clamp on EVERY grade, so it binds for
    // nothing a player would actually have practised. Measured: a lapse returns
    // in 0.84 days at stability 1, 2.71 at stability 10 and 4.56 at stability
    // 30. This test records what the code does; docs/NEXT.md carries the
    // question of whether that is what it should do.
    const passed = scheduleNext(practised(), 'good', NOW);
    const failed = scheduleNext(practised(), 'fail', NOW);

    expect(failed.intervalDays).toBeLessThan(passed.intervalDays / 4);
    expect(failed.intervalDays).toBeGreaterThanOrEqual(0.1);
  });

  it('does bring a barely-known item back the same day when it fails', () => {
    const shaky = practised({ stability: 0.3, intervalDays: 0.5 });
    const next = scheduleNext(shaky, 'fail', NOW);
    expect(next.dueAt.getTime() - NOW.getTime()).toBeLessThan(8 * HOUR_MS);
  });

  it('never returns an interval below the floor, whatever the grade', () => {
    for (const result of ['fail', 'hard', 'good', 'easy'] as const) {
      const next = scheduleNext(practised({ stability: 0.001 }), result, NOW);
      expect(next.intervalDays).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('never schedules further out than half a year', () => {
    const veryStable = practised({ stability: 5000, difficulty: 1, intervalDays: 180 });
    expect(scheduleNext(veryStable, 'easy', NOW).intervalDays).toBeLessThanOrEqual(180);
  });

  it('counts reps and lapses the way the model does', () => {
    expect(scheduleNext(practised(), 'good', NOW).reps).toBe(7);
    expect(scheduleNext(practised(), 'good', NOW).lapses).toBe(0);
    expect(scheduleNext(practised(), 'fail', NOW).lapses).toBe(1);
  });

  it('starts a never-practised skill from the grade alone', () => {
    const fresh: SchedulerStateInput = {};
    const next = scheduleNext(fresh, 'good', NOW);

    expect(next.reps).toBe(1);
    expect(next.lapses).toBe(0);
    expect(next.intervalDays).toBeGreaterThan(0);
    expect(next.predictedRecall).toBe(1);
  });

  it('rounds what it stores, so two decimals is all anyone ever sees', () => {
    const next = scheduleNext(practised(), 'good', NOW);
    for (const value of [next.intervalDays, next.stability, next.difficulty, next.ease]) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
    expect(Math.round(next.predictedRecall * 1000) / 1000).toBe(next.predictedRecall);
  });
});

describe('scheduleNext, the same sitting', () => {
  // Massed practice is not spaced practice. FSRS assumes reviews are spaced, so
  // a second rep minutes later would otherwise read as durable memory.
  const justNow = practised({ lastPracticedAt: new Date(NOW.getTime() - 10 * 60 * 1000) });

  it('will not let a repeated pass push the interval further out', () => {
    const next = scheduleNext(justNow, 'easy', NOW);
    expect(next.intervalDays).toBeLessThanOrEqual(justNow.intervalDays!);
  });

  it('still lets a failure pull the item back in', () => {
    const next = scheduleNext(justNow, 'fail', NOW);
    expect(next.intervalDays).toBeLessThan(justNow.intervalDays!);
  });

  it('stops holding the interval down once the sitting is over', () => {
    const later = practised({ lastPracticedAt: new Date(NOW.getTime() - 2 * HOUR_MS) });
    const held = scheduleNext(justNow, 'easy', NOW);
    const free = scheduleNext(later, 'easy', NOW);
    expect(free.intervalDays).toBeGreaterThan(held.intervalDays);
  });
});

describe('ease', () => {
  it('reads high for an easy item and low for a punishing one', () => {
    const easy = scheduleNext(practised({ difficulty: 1 }), 'good', NOW).ease;
    const hard = scheduleNext(practised({ difficulty: 10 }), 'good', NOW).ease;
    expect(easy).toBeGreaterThan(hard);
  });

  it('stays inside the range the rest of the app expects', () => {
    for (const difficulty of [1, 2.5, 5, 7.5, 10]) {
      const { ease } = scheduleNext(practised({ difficulty }), 'good', NOW);
      expect(ease).toBeGreaterThanOrEqual(1.3);
      expect(ease).toBeLessThanOrEqual(3.5);
    }
  });

  it('has a default that sits inside that range', () => {
    expect(DEFAULT_EASE).toBeGreaterThanOrEqual(1.3);
    expect(DEFAULT_EASE).toBeLessThanOrEqual(3.5);
  });
});

describe('describeInterval', () => {
  it('talks in hours below a day, and never says zero hours', () => {
    expect(describeInterval(0.1)).toBe('about 2 hours');
    expect(describeInterval(0.04)).toBe('about an hour');
    expect(describeInterval(0.0001)).toBe('about an hour');
  });

  it('talks in days above one, in the singular where it should', () => {
    expect(describeInterval(1)).toBe('about a day');
    expect(describeInterval(1.4)).toBe('about a day');
    expect(describeInterval(12)).toBe('about 12 days');
  });
});
