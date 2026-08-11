import {
  groupingKey,
  type DifficultyLevel,
  type MicroSkillDefinition,
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
