import { PROGRESSIONS, progressionIdFromSkillId, type ChordProgression } from './progressions';
import { planStructuredSession, type StructuredItem } from './sessionPlanner';
import { hasDiagram } from './shapeTrainer';
import { fullCatalog } from './sessionPlanner';
import { SKILL_CATALOG, type MicroSkillDefinition, type SkillPracticeState } from './skills';
import type { StreakSummary } from './streaks';

/**
 * The auto session: what to practise, in what order, at what tempo, decided
 * for you.
 *
 * This is the director, and it is pure — skill state and a clock in, a script
 * out. Nothing here touches React, audio or Firestore, so the whole of "what
 * should this person do next" can be tested by assertion rather than by
 * playing a guitar at a browser for ten minutes.
 *
 * The design has one rule behind it: **no configuration**. Every question this
 * could ask — how long, how fast, which drill, which key — is a question the
 * user does not have the information to answer well and should not have to
 * think about while holding a guitar. So it answers them from what it already
 * knows: what is due, how the last few runs went, and how long you have.
 */

/** What the player actually does for the next minute or so. */
export type ActivityKind =
  /** Check the tuning before anything is scored. */
  | 'tune'
  /** A chord shape on a timer, with its diagram. */
  | 'shape'
  /** A progression played against the chord detector. */
  | 'progression'
  /** Single notes, scored by pitch. */
  | 'riff'
  /** Picking accuracy on one string. */
  | 'sniper';

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  /** One line of coaching, shown while it runs. */
  coaching: string;
  /** Roughly how long this should take, for the progress rail. */
  seconds: number;
  /** The skill this activity practises, when there is one to file against. */
  skillId?: string;
  /** Progressions and riffs: which one, and how fast to take it. */
  progressionId?: string;
  tempoBpm?: number;
  /** Shapes: which shape's diagram to show. */
  shapeSkillId?: string;
  /** Sniper: which string. */
  targetString?: number;
}

export interface AutoSessionScript {
  activities: Activity[];
  /** Total of the parts, for the rail and for "about four minutes left". */
  totalSeconds: number;
  /** Why this session looks the way it does, in one line. */
  rationale: string;
}

export interface AutoSessionInput {
  states: readonly SkillPracticeState[];
  streak: StreakSummary;
  /** Wall clock, injected. Drives the "short session late at night" rule. */
  now: Date;
  /** Minutes the user has. Defaults to the seven-minute session the app is for. */
  minutes?: number;
  /**
   * False when the microphone is unavailable, which removes every activity
   * that can only be graded by ear rather than leaving them to fail.
   */
  canListen?: boolean;
  /** Accuracy of recent scored runs, newest first, 0–1. Drives the tempo. */
  recentAccuracy?: readonly number[];
}

/** The session the app is designed around. */
export const DEFAULT_SESSION_MINUTES = 7;

/**
 * Tempo as a fraction of a progression's written tempo.
 *
 * Starts below the written speed and only climbs on evidence. The written
 * tempo is a target, not a starting line — and arriving at it in control is
 * the entire point of practising with a metronome.
 */
export function tempoScaleFor(recentAccuracy: readonly number[] = []): number {
  if (recentAccuracy.length === 0) return 0.8;

  const sample = recentAccuracy.slice(0, 3);
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;

  if (mean >= 0.9) return 1.1;
  if (mean >= 0.75) return 1;
  if (mean >= 0.5) return 0.85;
  return 0.7;
}

/**
 * Whether harder material is allowed yet.
 *
 * Progressive means earned, not "advanced after three sessions". Intermediate
 * opens once you are landing most of what you play; advanced needs that *and*
 * a habit, because advanced material is where a beginner quietly gives up.
 */
export function unlockedLevel(
  streak: StreakSummary,
  recentAccuracy: readonly number[] = [],
): 'beginner' | 'intermediate' | 'advanced' {
  const sample = recentAccuracy.slice(0, 5);
  const mean = sample.length
    ? sample.reduce((sum, value) => sum + value, 0) / sample.length
    : 0;

  if (mean >= 0.85 && sample.length >= 3 && streak.longest >= 3) return 'advanced';
  if (mean >= 0.6 && sample.length >= 2) return 'intermediate';
  return 'beginner';
}

/** Late-night sessions are short and quiet — nobody drills barre chords at 1am. */
function isLateNight(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 22 || hour < 6;
}

function progressionFor(
  item: StructuredItem,
  level: 'beginner' | 'intermediate' | 'advanced',
): ChordProgression | null {
  const direct = progressionIdFromSkillId(item.definition.id);
  if (direct) return PROGRESSIONS.find((p) => p.id === direct) ?? null;

  // Nothing scheduled: pick something at or below the unlocked level, biased to
  // the standard tuning — asking someone to re-tune mid-session is exactly the
  // kind of configuration this mode exists to avoid.
  const allowed = level === 'advanced' ? 3 : level === 'intermediate' ? 2 : 1;
  const rank = { beginner: 1, intermediate: 2, advanced: 3 } as const;

  return (
    PROGRESSIONS.find(
      (p) => !p.tuning && rank[p.level] <= allowed && p.genre === 'Essentials',
    ) ?? null
  );
}

function activityFor(
  item: StructuredItem,
  level: 'beginner' | 'intermediate' | 'advanced',
  tempoScale: number,
): Activity | null {
  const { definition } = item;
  const seconds = definition.suggestedDurationSeconds ?? 40;

  // A scheduled progression is played, not described.
  const progression = progressionIdFromSkillId(definition.id)
    ? progressionFor(item, level)
    : null;

  if (progression) {
    const isRiff = progression.chords.every((chord) => chord.mode === 'riff');
    return {
      id: `act.${definition.id}`,
      kind: isRiff ? 'riff' : 'progression',
      title: progression.title,
      coaching: progression.teaches ?? 'Play it through, then again if it felt rough.',
      seconds,
      skillId: definition.id,
      progressionId: progression.id,
      tempoBpm: Math.round(progression.tempoBpm * tempoScale),
    };
  }

  if (definition.category === 'fretting_shape' && hasDiagram(definition)) {
    return {
      id: `act.${definition.id}`,
      kind: 'shape',
      title: definition.title,
      coaching: definition.description,
      seconds: Math.min(seconds, 45),
      skillId: definition.id,
      shapeSkillId: definition.id,
    };
  }

  if (definition.category === 'picking_technique') {
    const strings = definition.metadata.targetStrings;
    return {
      id: `act.${definition.id}`,
      kind: 'sniper',
      title: definition.title,
      coaching: definition.description,
      seconds: Math.min(seconds, 45),
      skillId: definition.id,
      ...(strings?.length ? { targetString: strings[0] } : {}),
    };
  }

  return null;
}

/**
 * Spreads the kinds out, so no two neighbours are the same thing.
 *
 * Same argument as the session planner's family interleaving, one level up:
 * four chord shapes in a row is blocked practice whichever module assembled it.
 * Round-robin across kinds, keeping each kind's own order — so the most overdue
 * item of each kind still comes first.
 */
function interleaveKinds(activities: readonly Activity[]): Activity[] {
  const buckets = new Map<ActivityKind, Activity[]>();

  for (const activity of activities) {
    const bucket = buckets.get(activity.kind);
    if (bucket) bucket.push(activity);
    else buckets.set(activity.kind, [activity]);
  }

  const queues = [...buckets.values()];
  const ordered: Activity[] = [];

  while (ordered.length < activities.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) ordered.push(next);
    }
  }

  return ordered;
}

/** Activities that cannot be graded without a microphone. */
const NEEDS_EAR: ReadonlySet<ActivityKind> = new Set(['tune', 'progression', 'riff', 'sniper']);

/**
 * Builds the session.
 *
 * The scheduled plan decides *what* — this is not a second scheduler, and a
 * second scheduler would immediately disagree with the first. What it adds is
 * the shape of the sitting: a tuning check before anything is scored, then the
 * planned work turned into things you can actually do, trimmed to the time
 * available.
 */
export function buildAutoSession(input: AutoSessionInput): AutoSessionScript {
  const {
    states,
    streak,
    now,
    canListen = true,
    recentAccuracy = [],
    minutes = DEFAULT_SESSION_MINUTES,
  } = input;

  const budgetSeconds = Math.max(60, Math.round(minutes * 60 * (isLateNight(now) ? 0.6 : 1)));
  const level = unlockedLevel(streak, recentAccuracy);
  const tempoScale = tempoScaleFor(recentAccuracy);

  // Plan roughly as many items as the budget can hold rather than a fixed
  // eight: the time available has to reach the *planner*, or a two-minute
  // sitting plans a ten-minute session and then throws most of it away.
  const planned = planStructuredSession(fullCatalog(SKILL_CATALOG), states, now, {
    maxItems: Math.max(3, Math.round(budgetSeconds / 45)),
  });

  const activities: Activity[] = [];

  // Tuning first, always, and only when there is something to listen with. An
  // out-of-tune guitar makes every scored activity after it a lie.
  if (canListen) {
    activities.push({
      id: 'act.tune',
      kind: 'tune',
      title: 'Quick tune-up',
      coaching: 'Play each string open. Nothing after this is worth scoring if the guitar is out.',
      seconds: 45,
    });
  }

  let used = activities.reduce((total, activity) => total + activity.seconds, 0);

  const body: Activity[] = [];
  for (const item of planned.all) {
    if (used >= budgetSeconds) break;

    const activity = activityFor(item, level, tempoScale);
    if (!activity) continue;
    if (!canListen && NEEDS_EAR.has(activity.kind)) continue;

    body.push(activity);
    used += activity.seconds;
  }

  // **Always something played through.** The planner is due-first, and on a
  // fresh account "due-first" is a run of beginner chord shapes — eight of them
  // in a row, which is the blocked practice this whole app is arguing against.
  // A session with no music in it also never exercises the ear, so one
  // progression is added if none was scheduled.
  if (canListen && !body.some((activity) => activity.kind === 'progression')) {
    const fallback = PROGRESSIONS.find(
      (p) => !p.tuning && p.genre === 'Essentials' && p.level === 'beginner',
    );

    if (fallback) {
      body.push({
        id: `act.${fallback.id}`,
        kind: 'progression',
        title: fallback.title,
        coaching: fallback.teaches ?? 'Play it through, in time.',
        seconds: 60,
        progressionId: fallback.id,
        tempoBpm: Math.round(fallback.tempoBpm * tempoScale),
      });
      used += 60;
    }
  }

  activities.push(...interleaveKinds(body));

  const rationale = [
    canListen ? null : 'no microphone, so nothing scored by ear',
    isLateNight(now) ? 'late, so a short one' : null,
    streak.current > 0 ? `day ${streak.current + (streak.practisedToday ? 0 : 1)}` : 'first day',
    `${level} material`,
    `${Math.round(tempoScale * 100)}% tempo`,
  ]
    .filter(Boolean)
    .join(' · ');

  return { activities, totalSeconds: used, rationale };
}

/** Where the session is up to, for the progress rail. */
export interface AutoSessionProgress {
  index: number;
  activity: Activity | null;
  done: number;
  total: number;
  secondsRemaining: number;
}

export function progressAt(script: AutoSessionScript, index: number): AutoSessionProgress {
  const activity = script.activities[index] ?? null;
  const remaining = script.activities
    .slice(index)
    .reduce((total, item) => total + item.seconds, 0);

  return {
    index,
    activity,
    done: Math.min(index, script.activities.length),
    total: script.activities.length,
    secondsRemaining: remaining,
  };
}

/** True when there is nothing left to do. */
export function isFinished(script: AutoSessionScript, index: number): boolean {
  return index >= script.activities.length;
}

/** Catalog lookup, so the session screen never has to know the catalog shape. */
export function definitionFor(skillId: string | undefined): MicroSkillDefinition | null {
  if (!skillId) return null;
  return fullCatalog(SKILL_CATALOG).find((definition) => definition.id === skillId) ?? null;
}
