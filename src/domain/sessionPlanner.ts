import { PROGRESSION_SKILLS } from './progressionSkills';
import {
  groupingKey,
  type DifficultyLevel,
  type MicroSkillDefinition,
  type PracticeResult,
  type SkillPracticeState,
} from './skills';

/**
 * Chooses what to practise right now.
 *
 * Two rules do most of the work: anything due comes first, most overdue first;
 * and no single family may dominate a session. The second rule is the point —
 * ten barre chords in a row is blocked practice, which feels productive and
 * transfers poorly. Interleaving families is what the whole design is for.
 *
 * Pure, like the scheduler: `now` is passed in.
 */

export interface PlannedItem {
  definition: MicroSkillDefinition;
  /** Absent for a skill that has never been practised. */
  state?: SkillPracticeState;
}

export interface PlanSessionOptions {
  maxItems?: number;
  maxPerFamily?: number;
}

/** Short enough to finish in one sitting. */
export const DEFAULT_MAX_ITEMS = 10;

export const DEFAULT_MAX_PER_FAMILY = 4;

const DIFFICULTY_ORDER: Record<DifficultyLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

/** Firestore `Timestamp` to `Date`, tolerating the field being absent. */
export function dueDateOf(state: SkillPracticeState | undefined): Date | null {
  const dueAt = state?.dueAt;
  return dueAt ? dueAt.toDate() : null;
}

/**
 * Everything Today's Session can schedule: the hand-written micro-skills plus
 * every Chord Hero progression, which are derived from the progression library
 * so the two can never drift apart.
 */
export function fullCatalog(
  catalog: readonly MicroSkillDefinition[],
): readonly MicroSkillDefinition[] {
  return [...catalog, ...PROGRESSION_SKILLS];
}

export function planSession(
  catalog: readonly MicroSkillDefinition[],
  states: readonly SkillPracticeState[],
  now: Date,
  options: PlanSessionOptions = {},
): PlannedItem[] {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxPerFamily = options.maxPerFamily ?? DEFAULT_MAX_PER_FAMILY;

  const stateById = new Map(states.map((state) => [state.skillId, state]));
  const active = catalog.filter((definition) => definition.active);

  const due: { item: PlannedItem; dueAt: number }[] = [];
  const fresh: { item: PlannedItem; rank: number; order: number }[] = [];

  active.forEach((definition, order) => {
    const state = stateById.get(definition.id);

    if (!state) {
      fresh.push({
        item: { definition },
        rank: DIFFICULTY_ORDER[definition.difficulty],
        order,
      });
      return;
    }

    const dueAt = dueDateOf(state);

    // A practised skill with no dueAt should not exist, but if one does, showing
    // it is better than silently dropping it from every future session.
    if (dueAt === null) {
      due.push({ item: { definition, state }, dueAt: 0 });
      return;
    }

    if (dueAt.getTime() <= now.getTime()) {
      due.push({ item: { definition, state }, dueAt: dueAt.getTime() });
    }
  });

  // Most overdue first.
  due.sort((a, b) => a.dueAt - b.dueAt);

  // Easiest unseen material first, then catalog order so the result is stable.
  fresh.sort((a, b) => a.rank - b.rank || a.order - b.order);

  const chosen: PlannedItem[] = [];
  const perFamily = new Map<string, number>();

  const tryAdd = (item: PlannedItem): void => {
    const key = groupingKey(item.definition);
    const used = perFamily.get(key) ?? 0;

    if (used >= maxPerFamily) {
      return;
    }

    perFamily.set(key, used + 1);
    chosen.push(item);
  };

  for (const candidate of due) {
    if (chosen.length >= maxItems) break;
    tryAdd(candidate.item);
  }

  for (const candidate of fresh) {
    if (chosen.length >= maxItems) break;
    tryAdd(candidate.item);
  }

  return interleaveByFamily(chosen);
}

/**
 * Spreads families across the running order.
 *
 * The per-family cap controls how *many* items a family contributes, but not
 * where they land — selection alone yields four open chords, then four power
 * chords, which is blocked practice wearing a rota's clothing. Round-robin
 * across families fixes the adjacency.
 *
 * Priority survives: buckets are visited in order of first appearance, so the
 * most overdue item is still first, and each family's internal order is kept.
 */
function interleaveByFamily(items: PlannedItem[]): PlannedItem[] {
  const buckets = new Map<string, PlannedItem[]>();

  for (const item of items) {
    const key = groupingKey(item.definition);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(item);
    } else {
      // Map preserves insertion order, which is the priority order.
      buckets.set(key, [item]);
    }
  }

  const queues = [...buckets.values()];
  const ordered: PlannedItem[] = [];

  while (ordered.length < items.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) ordered.push(next);
    }
  }

  return ordered;
}

/* ── Session shape ────────────────────────────────────────────────────────── */

/**
 * Where an item sits in the sitting.
 *
 * A flat list of ten tasks is a rota, not a session. Motor-learning practice
 * has a shape: something easy and physical to get the hands moving, the real
 * work in the middle while attention is freshest, and something you already
 * play well at the end — because how a session *finishes* is what you remember
 * of it, and stopping on a failure teaches you that practice feels bad.
 */
export type SessionPhase = 'warm-up' | 'rotation' | 'cool-down';

export interface StructuredItem extends PlannedItem {
  phase: SessionPhase;
}

export interface StructuredSession {
  warmUp: StructuredItem[];
  rotation: StructuredItem[];
  coolDown: StructuredItem[];
  /** Every item in playing order. */
  all: StructuredItem[];
}

export const DEFAULT_WARM_UP_ITEMS = 2;
export const DEFAULT_COOL_DOWN_ITEMS = 1;

/** SM-2 starts at 2.5; anything at or above that has never been graded badly. */
const COMFORTABLE_EASE = 2.5;

/**
 * How well a skill is known, for choosing the bookends. Higher is safer.
 *
 * Never-practised skills score below everything else on purpose: a warm-up is
 * not the place to meet something new, and a cool-down that introduces a
 * struggle is not a cool-down.
 */
function comfort(item: PlannedItem): number {
  const state = item.state;
  if (!state) return -1;

  const ease = state.ease ?? COMFORTABLE_EASE;
  const reps = Math.min(state.totalReps ?? 0, 10) / 10;
  const lastBonus =
    state.lastResult === 'easy' ? 1 : state.lastResult === 'good' ? 0.5 : state.lastResult === 'fail' ? -1 : 0;

  return ease + reps + lastBonus;
}

/**
 * Gives a planned session a beginning, a middle and an end.
 *
 * Built on top of `planSession` rather than beside it: the middle *is* the
 * existing due-first, family-interleaved rotation, and the bookends are drawn
 * from the same chosen items so nothing is practised twice in one sitting.
 *
 * When there is not enough history to have a comfortable skill, the warm-up
 * simply takes the easiest of what is planned. A session that refuses to start
 * until you have a history is no use on day one.
 */
export function planStructuredSession(
  catalog: readonly MicroSkillDefinition[],
  states: readonly SkillPracticeState[],
  now: Date,
  options: PlanSessionOptions & {
    warmUpItems?: number;
    coolDownItems?: number;
  } = {},
): StructuredSession {
  const planned = planSession(catalog, states, now, options);

  const warmUpItems = options.warmUpItems ?? DEFAULT_WARM_UP_ITEMS;
  const coolDownItems = options.coolDownItems ?? DEFAULT_COOL_DOWN_ITEMS;

  // Too short to have a shape: it is all rotation, and that is honest.
  if (planned.length <= warmUpItems + coolDownItems) {
    const all = planned.map((item): StructuredItem => ({ ...item, phase: 'rotation' }));
    return { warmUp: [], rotation: all, coolDown: [], all };
  }

  const byComfort = [...planned].sort((a, b) => comfort(b) - comfort(a));
  const taken = new Set<MicroSkillDefinition>();

  const take = (count: number): PlannedItem[] => {
    const picked: PlannedItem[] = [];
    for (const item of byComfort) {
      if (picked.length >= count) break;
      if (taken.has(item.definition)) continue;
      taken.add(item.definition);
      picked.push(item);
    }
    return picked;
  };

  // The cool-down gets first pick of the most comfortable item, because ending
  // well matters more than starting well.
  const coolDown = take(coolDownItems).map((item): StructuredItem => ({ ...item, phase: 'cool-down' }));
  const warmUp = take(warmUpItems).map((item): StructuredItem => ({ ...item, phase: 'warm-up' }));
  const rotation = planned
    .filter((item) => !taken.has(item.definition))
    .map((item): StructuredItem => ({ ...item, phase: 'rotation' }));

  return { warmUp, rotation, coolDown, all: [...warmUp, ...rotation, ...coolDown] };
}

export interface SessionOutcome {
  items: number;
  graded: number;
  easy: number;
  good: number;
  hard: number;
  fail: number;
  /** Fraction of *graded* items that went well, 0–1. */
  accuracy: number;
}

/**
 * The sitting, as numbers for the log.
 *
 * Accuracy counts easy and good as clean and half-credits hard, which matches
 * how Chord Hero's accuracy reads: "how much of this went well", not "how many
 * buttons did you press".
 */
export function summariseOutcome(
  grades: readonly PracticeResult[],
  items: number,
): SessionOutcome {
  const count = (result: PracticeResult) => grades.filter((g) => g === result).length;

  const easy = count('easy');
  const good = count('good');
  const hard = count('hard');
  const fail = count('fail');
  const graded = grades.length;

  return {
    items,
    graded,
    easy,
    good,
    hard,
    fail,
    accuracy: graded === 0 ? 0 : (easy + good + hard * 0.5) / graded,
  };
}
