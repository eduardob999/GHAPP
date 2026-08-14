/**
 * The practice companion's state of mind.
 *
 * Pure, and deliberately so: what the character feels is a function of what you
 * have actually done, not of a timer or a random number. That means it can be
 * tested, and — more importantly — it means the companion never congratulates
 * you for nothing. An encouraging noise that fires regardless of what happened
 * is worth exactly nothing after the second time you hear it.
 */

export type CompanionMood =
  /** Nothing has happened yet — a new friend. */
  | 'new'
  /** Between things, content. */
  | 'idle'
  /** The microphone is open and it is paying attention. */
  | 'listening'
  /** That went well. */
  | 'pleased'
  /** That did not, and it is on your side about it. */
  | 'encouraging'
  /** A streak milestone, right now. */
  | 'celebrating'
  /** A few days away. */
  | 'missed-you'
  /** A long time away, or the small hours. */
  | 'sleepy';

export interface CompanionContext {
  /** Current daily streak, in days. */
  streak: number;
  practisedToday: boolean;
  /** Whole days since the last practice; null if there has never been one. */
  daysSinceLast: number | null;
  /** True while a drill has the microphone open. */
  listening: boolean;
  /** Accuracy of the run that just finished, 0–1, or null if none has. */
  lastAccuracy: number | null;
  /** Set on the render where a milestone has just been earned. */
  milestoneJustReached: boolean;
}

/** Above this a run counts as gone well; below the low mark, as a rough one. */
const PLEASED_AT = 0.6;
const ENCOURAGE_BELOW = 0.4;

/** Days away before the companion notices. */
const MISSED_AFTER_DAYS = 3;
const SLEEPY_AFTER_DAYS = 10;

/**
 * Precedence matters more than the individual rules: a milestone outranks
 * everything, and *anything that just happened* outranks the ambient state.
 * Otherwise a long absence would drown out the run you just finished, which is
 * the one thing the user is actually looking at.
 */
export function companionMood(context: CompanionContext): CompanionMood {
  if (context.milestoneJustReached) return 'celebrating';
  if (context.listening) return 'listening';

  if (context.lastAccuracy !== null) {
    if (context.lastAccuracy >= PLEASED_AT) return 'pleased';
    if (context.lastAccuracy < ENCOURAGE_BELOW) return 'encouraging';
    return 'idle';
  }

  if (context.daysSinceLast === null) return 'new';
  if (context.daysSinceLast >= SLEEPY_AFTER_DAYS) return 'sleepy';
  if (context.daysSinceLast >= MISSED_AFTER_DAYS) return 'missed-you';
  if (context.practisedToday) return 'pleased';

  return 'idle';
}

const LINES: Record<CompanionMood, readonly string[]> = {
  new: [
    'Hello! Play me something.',
    'First time? Start with two chords.',
  ],
  idle: [
    'Ready when you are.',
    'Seven minutes is a real session.',
    'Pick one thing and do it properly.',
  ],
  listening: [
    'Listening…',
    'Go on, I am all ears.',
    'Take your time.',
  ],
  pleased: [
    'That sounded good.',
    'Nice. Same again tomorrow?',
    'Your hands are learning that one.',
  ],
  encouraging: [
    'Slow it down and it will come.',
    'That one is hard. Try it at half speed.',
    'Nobody plays it clean the first week.',
  ],
  celebrating: [
    'Look at you!',
    'That is worth stopping to notice.',
    'A proper milestone.',
  ],
  'missed-you': [
    'There you are. Shall we?',
    'Been a few days — start gently.',
    'Welcome back. Nothing is lost.',
  ],
  sleepy: [
    'Oh! You are back.',
    'I dozed off. Two chords to wake me up?',
    'It has been a while. Start small.',
  ],
};

/**
 * A line for the mood, chosen deterministically.
 *
 * `seed` is normally the streak or the day number: the line changes as your
 * practice does, and stays put across re-renders. A random pick would flicker
 * every time React re-rendered the card, which reads as a nervous tic.
 */
export function companionLine(
  mood: CompanionMood,
  seed = 0,
): string {
  const lines = LINES[mood];
  const index = ((Math.trunc(seed) % lines.length) + lines.length) % lines.length;
  return lines[index]!;
}

/** Every line, for tests and for anyone auditing the app's voice. */
export const COMPANION_LINES = LINES;

/**
 * What the streak counter should say beneath the character.
 *
 * Zero is not "0 days" — a counter reading zero is a small daily reproach, and
 * the point of the whole design is that coming back is easy.
 */
export function streakLabel(streak: number, practisedToday: boolean): string {
  if (streak === 0) return 'No streak yet — today can be day one.';
  if (streak === 1) return practisedToday ? 'Day one. Come back tomorrow.' : 'One day so far.';
  return practisedToday
    ? `${streak} days in a row.`
    : `${streak} days — practise today to keep it.`;
}
