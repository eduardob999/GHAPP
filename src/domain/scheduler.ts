import type { PracticeResult } from './skills';

/**
 * Spaced-practice scheduling.
 *
 * SM-2 in spirit, not in letter: an ease factor that drifts with how a rep felt,
 * multiplying an interval that grows or shrinks accordingly. The goal is only
 * to push easy material apart and bring failures back soon — not to model
 * memory decay accurately.
 *
 * Every function here is pure. `now` is a parameter rather than a call to
 * `Date.now()` so the behaviour is reproducible and testable.
 */

export type { PracticeResult };

export interface SchedulerStateInput {
  ease?: number;
  intervalDays?: number;
  lastPracticedAt?: Date | null;
}

export interface SchedulerUpdate {
  ease: number;
  intervalDays: number;
  dueAt: Date;
}

export const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.5;

/**
 * Baseline interval for a skill that has never been practised. Everything else
 * is derived by multiplying this, which avoids special-casing the first rep.
 */
const BASELINE_INTERVAL_DAYS = 0.5;

/** Floor for a normal interval — twelve hours between reps of the same item. */
const MIN_INTERVAL_DAYS = 0.25;

/** A failure comes back in about two and a half hours, i.e. later today. */
const FAIL_INTERVAL_DAYS = 0.1;

const MAX_INTERVAL_DAYS = 180;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Grading the same skill twice inside this window is treated as one sitting, so
 * repeated taps cannot inflate an interval to weeks. Shrinking is still allowed
 * — a fail should always pull the item back in.
 */
const REPEAT_WINDOW_HOURS = 1;

const EASE_DELTA: Record<PracticeResult, number> = {
  easy: 0.15,
  good: 0.02,
  hard: -0.15,
  fail: -0.3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Two decimals is well below the resolution anyone perceives, and it keeps
 *  stored values and test expectations readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextInterval(previous: number, result: PracticeResult, ease: number): number {
  switch (result) {
    case 'easy':
      return Math.max(previous * ease, BASELINE_INTERVAL_DAYS);
    case 'good':
      return Math.max(previous * 1.2, BASELINE_INTERVAL_DAYS);
    case 'hard':
      return Math.max(previous * 0.7, MIN_INTERVAL_DAYS);
    case 'fail':
      return FAIL_INTERVAL_DAYS;
  }
}

/**
 * Computes the new scheduling state for one graded rep.
 *
 * Deterministic: the same state, result and `now` always produce the same
 * output.
 */
export function scheduleNext(
  state: SchedulerStateInput,
  result: PracticeResult,
  now: Date = new Date(),
): SchedulerUpdate {
  const previousEase = state.ease ?? DEFAULT_EASE;
  const previousInterval = state.intervalDays ?? BASELINE_INTERVAL_DAYS;

  const ease = round(clamp(previousEase + EASE_DELTA[result], MIN_EASE, MAX_EASE));

  let intervalDays = nextInterval(previousInterval, result, ease);

  // Same-sitting repeat: allow the interval to fall but not to climb.
  const lastPracticedAt = state.lastPracticedAt;
  if (lastPracticedAt) {
    const hoursSince = (now.getTime() - lastPracticedAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince >= 0 && hoursSince < REPEAT_WINDOW_HOURS) {
      intervalDays = Math.min(intervalDays, previousInterval);
    }
  }

  intervalDays = round(clamp(intervalDays, FAIL_INTERVAL_DAYS, MAX_INTERVAL_DAYS));

  return {
    ease,
    intervalDays,
    dueAt: new Date(now.getTime() + intervalDays * MILLISECONDS_PER_DAY),
  };
}

/** Rough, friendly rendering of an interval. Used for the "next due" hint. */
export function describeInterval(intervalDays: number): string {
  if (intervalDays < 1) {
    const hours = Math.max(1, Math.round(intervalDays * 24));
    return hours === 1 ? 'about an hour' : `about ${hours} hours`;
  }

  const days = Math.round(intervalDays);
  return days === 1 ? 'about a day' : `about ${days} days`;
}
