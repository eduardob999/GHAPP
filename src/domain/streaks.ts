/**
 * Practice streaks, counted in calendar days.
 *
 * Pure: dates in, summary out, `now` injected like everywhere else in
 * `src/domain/`. The input is the append-only session log rather than skill
 * state, because a streak is a record of *what happened* — the scheduler's
 * summary is overwritten every rep and cannot be counted twice.
 *
 * Days are local, not UTC. A streak is a human thing: practising at 23:50 and
 * again at 00:10 is two days by the calendar on the wall, and that is the
 * calendar the user is looking at.
 */

export interface StreakSummary {
  /** Consecutive days up to today, or up to yesterday if today is still empty. */
  current: number;
  /** The best run ever recorded, which may be the current one. */
  longest: number;
  practisedToday: boolean;
  /** Whole days between the last practice day and today. Null if never. */
  daysSinceLast: number | null;
  /** Distinct days with at least one session. */
  totalDays: number;
}

/** Local calendar day, as a sortable key. */
export function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whole days from `a`'s calendar day to `b`'s, ignoring the clock. */
export function dayDifference(a: Date, b: Date): number {
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  // Divide by 24h *after* flattening to midnight, so a DST shift — where a
  // local day is 23 or 25 hours long — still rounds to the right whole day.
  return Math.round((end - start) / 86_400_000);
}

export function summariseStreak(dates: readonly Date[], now: Date): StreakSummary {
  const days = [...new Set(dates.map(dayKey))].sort();

  if (days.length === 0) {
    return {
      current: 0,
      longest: 0,
      practisedToday: false,
      daysSinceLast: null,
      totalDays: 0,
    };
  }

  const asDate = (key: string): Date => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year!, month! - 1, day!);
  };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = dayDifference(asDate(days[i - 1]!), asDate(days[i]!)) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const last = asDate(days[days.length - 1]!);
  const daysSinceLast = dayDifference(last, now);

  // A streak is alive today if you practised today, and still alive if you
  // practised yesterday and the day is not over yet. Anything older is broken —
  // deliberately no grace period, because a streak that cannot break is not a
  // streak, it is a counter.
  const current = daysSinceLast <= 1 ? run : 0;

  return {
    current,
    longest,
    practisedToday: daysSinceLast === 0,
    daysSinceLast,
    totalDays: days.length,
  };
}

export interface StreakMilestone {
  days: number;
  name: string;
  /** What it means, in the app's voice. */
  blurb: string;
}

/**
 * Rewards for showing up, not for playing well.
 *
 * The whole design leans on short distributed sessions, so the thing worth
 * rewarding is the distribution. Accuracy already has its own feedback.
 */
export const STREAK_MILESTONES: readonly StreakMilestone[] = [
  { days: 2, name: 'Back again', blurb: 'Two days running. The hardest one is the second.' },
  { days: 3, name: 'Three in a row', blurb: 'Three days. This is where it starts to stick.' },
  { days: 7, name: 'A full week', blurb: 'Seven days. Your hands have noticed.' },
  { days: 14, name: 'Fortnight', blurb: 'Two weeks. Genuinely rare.' },
  { days: 30, name: 'A month', blurb: 'Thirty days. This is a habit now, not a plan.' },
  { days: 60, name: 'Two months', blurb: 'Sixty days. Most people never get here.' },
  { days: 100, name: 'Century', blurb: 'One hundred days. Extraordinary.' },
];

/** The milestone landed on exactly today, or null. */
export function reachedMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => m.days === streak) ?? null;
}

/** The one being worked towards, or null past the last. */
export function nextMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => m.days > streak) ?? null;
}

/**
 * How far along the current streak is toward the next milestone, 0–1.
 *
 * Measured from zero rather than from the milestone just passed, because the
 * bar sits next to a "2 / 3 days" label and the two have to agree. Filling from
 * the last milestone would show an empty bar the moment you earn one, which
 * reads as losing something.
 */
export function milestoneProgress(streak: number): number {
  const next = nextMilestone(streak);
  if (!next) return 1;

  return Math.max(0, Math.min(1, streak / next.days));
}

/** Every milestone earned so far, newest first. */
export function earnedMilestones(bestStreak: number): StreakMilestone[] {
  return STREAK_MILESTONES.filter((m) => m.days <= bestStreak).reverse();
}
