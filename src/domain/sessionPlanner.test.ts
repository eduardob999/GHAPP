import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';

import { PROGRESSION_SKILLS } from './progressionSkills';
import {
  DEFAULT_COOL_DOWN_ITEMS,
  DEFAULT_MAX_ITEMS,
  DEFAULT_MAX_PER_FAMILY,
  DEFAULT_WARM_UP_ITEMS,
  dueDateOf,
  fullCatalog,
  planSession,
  planStructuredSession,
  summariseOutcome,
  type PlannedItem,
} from './sessionPlanner';
import {
  groupingKey,
  type DifficultyLevel,
  type FrettingFamily,
  type MicroSkillDefinition,
  type SkillPracticeState,
} from './skills';

const NOW = new Date('2026-01-01T09:00:00Z');
const DAY_MS = 86_400_000;

/** Negative days are in the future, which is how "not due yet" is written here. */
const daysAgo = (days: number): Timestamp => Timestamp.fromMillis(NOW.getTime() - days * DAY_MS);

const shape = (
  id: string,
  family: FrettingFamily,
  difficulty: DifficultyLevel = 'beginner',
): MicroSkillDefinition => ({
  id,
  category: 'fretting_shape',
  family,
  difficulty,
  title: id,
  description: id,
  active: true,
  metadata: {},
});

/** No family at all, so the grouping key has to fall back to the category. */
const unfamilied = (id: string): MicroSkillDefinition => ({
  id,
  category: 'fretting_shape',
  difficulty: 'beginner',
  title: id,
  description: id,
  active: true,
  metadata: {},
});

/** `count` skills of one family, named `<family>-0`, `<family>-1`, and so on. */
const many = (family: FrettingFamily, count: number): MicroSkillDefinition[] =>
  Array.from({ length: count }, (_, index) => shape(`${family}-${index}`, family));

/** Practised, going well, and overdue by `days`. */
const overdue = (
  skillId: string,
  days: number,
  over: Partial<SkillPracticeState> = {},
): SkillPracticeState => ({
  skillId,
  ease: 2.5,
  totalReps: 5,
  lastResult: 'good',
  dueAt: daysAgo(days),
  lastPracticedAt: daysAgo(days + 3),
  ...over,
});

const ids = (items: readonly PlannedItem[]): string[] =>
  items.map((item) => item.definition.id);

const familiesOf = (items: readonly PlannedItem[]): string[] =>
  items.map((item) => groupingKey(item.definition));

describe('dueDateOf', () => {
  it('says nothing is due for a skill that has never been practised', () => {
    expect(dueDateOf(undefined)).toBeNull();
  });

  it('tolerates a practised skill whose dueAt never arrived', () => {
    // Not hypothetical: a pending server timestamp reads back absent from the
    // local cache, which is exactly when offline practice has to keep working.
    expect(dueDateOf({ skillId: 'a', totalReps: 3 })).toBeNull();
  });

  it('converts the stored timestamp to the moment it stands for', () => {
    const due = dueDateOf({ skillId: 'a', dueAt: daysAgo(2) });
    expect(due?.getTime()).toBe(NOW.getTime() - 2 * DAY_MS);
  });
});

describe('fullCatalog', () => {
  it('offers every progression alongside the hand-written skills, so a progression can be scheduled at all', () => {
    // Chord Hero used to write practice state for progressions that had no
    // catalog entry, so the scheduler could record a run and never offer it back.
    const combined = fullCatalog([shape('mine', 'open_chord')]);
    const combinedIds = combined.map((definition) => definition.id);

    expect(combinedIds).toContain('mine');
    for (const progression of PROGRESSION_SKILLS) {
      expect(combinedIds).toContain(progression.id);
    }
  });

  it('leaves the catalog it was given untouched', () => {
    const mine = [shape('mine', 'open_chord')];
    fullCatalog(mine);
    expect(mine).toHaveLength(1);
  });
});

describe('planSession, what gets in', () => {
  it('returns nothing when nothing is active', () => {
    expect(planSession([], [], NOW)).toEqual([]);
    expect(planSession([{ ...shape('gone', 'barre_chord'), active: false }], [], NOW)).toEqual([]);
  });

  it('never offers a retired skill, however overdue its history says it is', () => {
    // Retiring is deliberately not deleting: the history stays and the card goes.
    const catalog = [{ ...shape('gone', 'barre_chord'), active: false }];
    expect(planSession(catalog, [overdue('gone', 30)], NOW)).toEqual([]);
  });

  it('offers a skill that has never been practised', () => {
    const plan = planSession([shape('new', 'open_chord')], [], NOW);
    expect(ids(plan)).toEqual(['new']);
    expect(plan[0]?.state).toBeUndefined();
  });

  it('leaves a skill alone until it comes due', () => {
    const catalog = [shape('later', 'open_chord')];
    expect(planSession(catalog, [overdue('later', -1)], NOW)).toEqual([]);
  });

  it('counts a skill due at this exact moment as due', () => {
    // The boundary is where an off-by-one hides a skill for a whole extra day.
    const catalog = [shape('now', 'open_chord')];
    expect(ids(planSession(catalog, [overdue('now', 0)], NOW))).toEqual(['now']);
  });

  it('still offers a practised skill with no due date, rather than dropping it from every future session', () => {
    const catalog = [shape('orphan', 'open_chord')];
    const state: SkillPracticeState = { skillId: 'orphan', totalReps: 4, ease: 2.5 };
    const plan = planSession(catalog, [state], NOW);

    expect(ids(plan)).toEqual(['orphan']);
    expect(plan[0]?.state).toBe(state);
  });

  it('carries the stored state alongside the definition, so a card can show its history', () => {
    const catalog = [shape('known', 'open_chord')];
    const state = overdue('known', 3);
    expect(planSession(catalog, [state], NOW)[0]?.state).toBe(state);
  });

  it('ignores stored state for a skill the catalog no longer has', () => {
    const plan = planSession([shape('here', 'open_chord')], [overdue('vanished', 9)], NOW);
    expect(ids(plan)).toEqual(['here']);
  });
});

describe('planSession, priority', () => {
  it('is deterministic: the same inputs give the same session twice', () => {
    const catalog = [...many('open_chord', 3), ...many('barre_chord', 3)];
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));
    expect(planSession(catalog, states, NOW)).toEqual(planSession(catalog, states, NOW));
  });

  it('starts with the most overdue skill', () => {
    const catalog = [...many('open_chord', 2), ...many('power_chord', 2)];
    const states = [
      overdue('open_chord-0', 1),
      overdue('open_chord-1', 2),
      overdue('power_chord-0', 30),
      overdue('power_chord-1', 3),
    ];
    expect(ids(planSession(catalog, states, NOW))[0]).toBe('power_chord-0');
  });

  it('keeps a family in most-overdue-first order inside the session', () => {
    const catalog = many('barre_chord', 3);
    const states = [
      overdue('barre_chord-0', 1),
      overdue('barre_chord-1', 20),
      overdue('barre_chord-2', 5),
    ];
    expect(ids(planSession(catalog, states, NOW))).toEqual([
      'barre_chord-1',
      'barre_chord-2',
      'barre_chord-0',
    ]);
  });

  it('fills the session with due work before it reaches for anything unseen', () => {
    // Selection, not running order: interleaving can still place a late-chosen
    // item early, so this asserts what was chosen rather than where it landed.
    const catalog = [
      ...many('open_chord', 4),
      ...many('barre_chord', 4),
      ...many('power_chord', 4),
      ...many('caged_shape', 4),
    ];
    const states = catalog
      .filter((definition) => !definition.id.startsWith('caged'))
      .map((definition, index) => overdue(definition.id, index + 1));

    const plan = planSession(catalog, states, NOW);

    expect(plan).toHaveLength(DEFAULT_MAX_ITEMS);
    expect(plan.every((item) => item.state !== undefined)).toBe(true);
  });

  it('meets easier unseen material before harder', () => {
    const catalog = [
      shape('a-advanced', 'open_chord', 'advanced'),
      shape('b-beginner', 'open_chord', 'beginner'),
      shape('c-intermediate', 'open_chord', 'intermediate'),
    ];
    expect(ids(planSession(catalog, [], NOW))).toEqual([
      'b-beginner',
      'c-intermediate',
      'a-advanced',
    ]);
  });

  it('breaks a tie between unseen skills on catalog order, so the list is stable', () => {
    const catalog = [shape('second', 'open_chord'), shape('first', 'open_chord')];
    expect(ids(planSession(catalog, [], NOW))).toEqual(['second', 'first']);
  });
});

describe('planSession, no family may take over the sitting', () => {
  it('stops a family at the cap even when it owns every due skill', () => {
    const catalog = many('barre_chord', 12);
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));

    expect(planSession(catalog, states, NOW, { maxPerFamily: 3, maxItems: 20 })).toHaveLength(3);
  });

  it('applies its own cap when the caller asks for nothing', () => {
    const catalog = many('barre_chord', 12);
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));

    expect(planSession(catalog, states, NOW)).toHaveLength(
      Math.min(DEFAULT_MAX_PER_FAMILY, DEFAULT_MAX_ITEMS),
    );
  });

  it('groups a skill with no declared family by its category instead', () => {
    // groupingKey falls back to the category, so a family-less skill is still
    // covered by the cap rather than escaping it.
    const catalog = Array.from({ length: 6 }, (_, index) => unfamilied(`loose-${index}`));
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));

    expect(planSession(catalog, states, NOW, { maxPerFamily: 2 })).toHaveLength(2);
  });

  it('does not end the session at the cap: it goes on to other families', () => {
    const catalog = [...many('barre_chord', 6), ...many('open_chord', 6)];
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));

    const plan = planSession(catalog, states, NOW, { maxPerFamily: 2, maxItems: 10 });
    expect(plan).toHaveLength(4);
    expect(new Set(familiesOf(plan))).toEqual(new Set(['barre_chord', 'open_chord']));
  });

  it('never runs longer than the session limit', () => {
    const catalog = [
      ...many('open_chord', 10),
      ...many('barre_chord', 10),
      ...many('power_chord', 10),
      ...many('caged_shape', 10),
    ];
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));

    expect(planSession(catalog, states, NOW)).toHaveLength(DEFAULT_MAX_ITEMS);
    expect(planSession(catalog, states, NOW, { maxItems: 3 })).toHaveLength(3);
  });

  it('spreads the families through the running order instead of playing them in blocks', () => {
    // The cap alone gives four open chords and then four power chords, which is
    // blocked practice in a rota's clothing. Adjacency is the thing that matters.
    const catalog = [...many('open_chord', 4), ...many('power_chord', 4)];
    const states = catalog.map((definition, index) => overdue(definition.id, 20 - index));

    const keys = familiesOf(planSession(catalog, states, NOW));

    expect(keys).toHaveLength(8);
    for (let index = 1; index < keys.length; index += 1) {
      expect(keys[index]).not.toBe(keys[index - 1]);
    }
  });

  it('keeps the most overdue skill first even after interleaving', () => {
    const catalog = [...many('open_chord', 4), ...many('power_chord', 4)];
    const states = catalog.map((definition, index) => overdue(definition.id, 20 - index));

    expect(ids(planSession(catalog, states, NOW))[0]).toBe('open_chord-0');
  });

  it('loses nothing to interleaving: every chosen skill is still played once', () => {
    const catalog = [...many('open_chord', 3), ...many('power_chord', 2), ...many('caged_shape', 4)];
    const states = catalog.map((definition, index) => overdue(definition.id, index + 1));

    const plan = planSession(catalog, states, NOW, { maxItems: 20 });
    expect(new Set(ids(plan)).size).toBe(plan.length);
    expect(plan).toHaveLength(catalog.length);
  });
});

describe('planStructuredSession', () => {
  /** Five due skills across two families, so no cap binds and a shape is possible. */
  const catalog = [...many('open_chord', 3), ...many('power_chord', 2)];
  const plain = [
    overdue('open_chord-0', 10),
    overdue('open_chord-1', 9),
    overdue('open_chord-2', 8),
    overdue('power_chord-0', 7),
    overdue('power_chord-1', 6),
  ];

  it('gives a long enough session a beginning, a middle and an end', () => {
    const session = planStructuredSession(catalog, plain, NOW);

    expect(session.warmUp).toHaveLength(DEFAULT_WARM_UP_ITEMS);
    expect(session.coolDown).toHaveLength(DEFAULT_COOL_DOWN_ITEMS);
    expect(session.rotation.length).toBeGreaterThan(0);
  });

  it('labels every item with the phase it is actually in', () => {
    const session = planStructuredSession(catalog, plain, NOW);

    expect(session.warmUp.every((item) => item.phase === 'warm-up')).toBe(true);
    expect(session.rotation.every((item) => item.phase === 'rotation')).toBe(true);
    expect(session.coolDown.every((item) => item.phase === 'cool-down')).toBe(true);
  });

  it('gives the cool-down first pick on day one, when nothing is comfortable yet', () => {
    // docs/NEXT.md 16b. With no practice history `comfort()` answers -1 for
    // every item, so the sort is a stable no-op and plan order stands. The
    // cool-down is taken first, so it gets the head of the plan and the warm-up
    // takes what follows. The docstring said the warm-up got first pick, which
    // was backwards, and nothing pinned the real behaviour, which is how the
    // sentence drifted unnoticed.
    const plan = ids(planSession(catalog, [], NOW));
    const session = planStructuredSession(catalog, [], NOW);

    // The assertion that actually pins the claim: the cool-down holds the HEAD
    // of the plan, and the warm-up holds what comes straight after it.
    expect(ids(session.coolDown)).toEqual(plan.slice(0, DEFAULT_COOL_DOWN_ITEMS));
    expect(ids(session.warmUp)).toEqual(
      plan.slice(DEFAULT_COOL_DOWN_ITEMS, DEFAULT_COOL_DOWN_ITEMS + DEFAULT_WARM_UP_ITEMS),
    );
  });

  it('plays the cool-down last, even though it was chosen first', () => {
    const session = planStructuredSession(catalog, plain, NOW);

    expect(ids(session.all)).toEqual([
      ...ids(session.warmUp),
      ...ids(session.rotation),
      ...ids(session.coolDown),
    ]);
  });

  it('practises nothing twice, because the bookends come out of the rotation', () => {
    const session = planStructuredSession(catalog, plain, NOW);
    const planned = planSession(catalog, plain, NOW);

    expect(new Set(ids(session.all)).size).toBe(session.all.length);
    expect(new Set(ids(session.all))).toEqual(new Set(ids(planned)));
  });

  it('gives the cool-down first pick of the most comfortable skill, because ending well matters most', () => {
    const states = [
      ...plain.slice(0, 3),
      overdue('power_chord-0', 7, { ease: 3.4, totalReps: 10, lastResult: 'easy' }),
      ...plain.slice(4),
    ];
    const session = planStructuredSession(catalog, states, NOW);

    expect(ids(session.coolDown)).toEqual(['power_chord-0']);
    expect(ids(session.warmUp)).not.toContain('power_chord-0');
  });

  it('will not close on something that was just failed', () => {
    // A high ease is not enough: stopping on a failure teaches you that practice
    // feels bad, which is the whole reason the cool-down exists.
    const states = [
      ...plain.slice(0, 3),
      overdue('power_chord-0', 7, { ease: 3.4, totalReps: 10, lastResult: 'fail' }),
      overdue('power_chord-1', 6, { ease: 2.5, totalReps: 10, lastResult: 'good' }),
    ];
    const session = planStructuredSession(catalog, states, NOW);

    expect(ids(session.coolDown)).toEqual(['power_chord-1']);
  });

  it('stops counting reps at ten, so grinding one skill cannot make it the safest thing you own', () => {
    const states = [
      ...plain.slice(0, 3),
      overdue('power_chord-0', 7, { ease: 3.4, totalReps: 10, lastResult: 'good' }),
      overdue('power_chord-1', 6, { ease: 2.5, totalReps: 1000, lastResult: 'good' }),
    ];
    const session = planStructuredSession(catalog, states, NOW);

    expect(ids(session.coolDown)).toEqual(['power_chord-0']);
  });

  it('treats a practised skill with no stored ease as comfortable rather than unknown', () => {
    // ease is a legacy display field. A document written before FSRS may not
    // carry one, and that is not evidence the skill is hard.
    const states = [
      ...plain.slice(0, 3),
      { skillId: 'power_chord-0', totalReps: 10, lastResult: 'good', dueAt: daysAgo(7) },
      overdue('power_chord-1', 6, { ease: 1.3, totalReps: 10, lastResult: 'good' }),
    ] satisfies SkillPracticeState[];
    const session = planStructuredSession(catalog, states, NOW);

    expect(ids(session.coolDown)).toEqual(['power_chord-0']);
  });

  it('never opens or closes on something never practised while anything practised is planned', () => {
    // A warm-up is not the place to meet something new, and a cool-down that
    // introduces a struggle is not a cool-down.
    const session = planStructuredSession(catalog, plain.slice(0, 3), NOW);

    expect(session.warmUp).not.toHaveLength(0);
    expect([...session.warmUp, ...session.coolDown].every((item) => item.state !== undefined)).toBe(
      true,
    );
  });

  it('still gives day one a shape, with no history at all', () => {
    // NOTE: the module comment says "the warm-up simply takes the easiest of
    // what is planned". With no history every item scores the same comfort, so
    // the ordering is the plan's own and the cool-down, picking first, is what
    // takes the easiest item. The warm-up gets the next two. Recorded as the
    // code behaves; the comment reads the other way round.
    const fresh = [
      shape('advanced-first', 'open_chord', 'advanced'),
      shape('easy-a', 'open_chord', 'beginner'),
      shape('easy-b', 'open_chord', 'beginner'),
      shape('middling', 'open_chord', 'intermediate'),
      shape('advanced-last', 'open_chord', 'advanced'),
    ];
    const session = planStructuredSession(fresh, [], NOW, { maxPerFamily: 5 });

    expect(ids(session.coolDown)).toEqual(['easy-a']);
    expect(ids(session.warmUp)).toEqual(['easy-b', 'middling']);
    expect(ids(session.rotation)).toEqual(['advanced-first', 'advanced-last']);
  });

  it('calls a session too short to have a shape all rotation, which is honest', () => {
    const short = many('open_chord', DEFAULT_WARM_UP_ITEMS + DEFAULT_COOL_DOWN_ITEMS);
    const session = planStructuredSession(short, [], NOW, { maxPerFamily: short.length });

    expect(session.warmUp).toEqual([]);
    expect(session.coolDown).toEqual([]);
    expect(session.rotation).toHaveLength(short.length);
    expect(session.all.every((item) => item.phase === 'rotation')).toBe(true);
  });

  it('takes a shape as soon as there is one item more than the bookends need', () => {
    const enough = many('open_chord', DEFAULT_WARM_UP_ITEMS + DEFAULT_COOL_DOWN_ITEMS + 1);
    const session = planStructuredSession(enough, [], NOW, { maxPerFamily: enough.length });

    expect(session.warmUp).toHaveLength(DEFAULT_WARM_UP_ITEMS);
    expect(session.coolDown).toHaveLength(DEFAULT_COOL_DOWN_ITEMS);
    expect(session.rotation).toHaveLength(1);
  });

  it('honours bookends the caller sizes itself', () => {
    const session = planStructuredSession(catalog, plain, NOW, {
      warmUpItems: 1,
      coolDownItems: 2,
    });

    expect(session.warmUp).toHaveLength(1);
    expect(session.coolDown).toHaveLength(2);
    expect(session.all).toHaveLength(5);
  });

  it('passes the session limits through to the plan underneath', () => {
    const session = planStructuredSession(catalog, plain, NOW, { maxItems: 4 });
    expect(session.all).toHaveLength(4);
  });

  it('returns an empty session rather than failing when there is nothing to practise', () => {
    expect(planStructuredSession([], [], NOW)).toEqual({
      warmUp: [],
      rotation: [],
      coolDown: [],
      all: [],
    });
  });
});

describe('summariseOutcome', () => {
  it('reports no accuracy rather than dividing by zero when nothing was graded', () => {
    const outcome = summariseOutcome([], 5);
    expect(outcome.graded).toBe(0);
    expect(outcome.accuracy).toBe(0);
  });

  it('counts every grade it was given', () => {
    const outcome = summariseOutcome(['easy', 'good', 'good', 'hard', 'fail'], 5);

    expect(outcome.easy).toBe(1);
    expect(outcome.good).toBe(2);
    expect(outcome.hard).toBe(1);
    expect(outcome.fail).toBe(1);
    expect(outcome.graded).toBe(5);
  });

  it('reads accuracy as how much went well: clean for easy and good, half for hard, nothing for a failure', () => {
    expect(summariseOutcome(['easy'], 1).accuracy).toBe(1);
    expect(summariseOutcome(['good'], 1).accuracy).toBe(1);
    expect(summariseOutcome(['hard'], 1).accuracy).toBe(0.5);
    expect(summariseOutcome(['fail'], 1).accuracy).toBe(0);
  });

  it('keeps accuracy inside 0 to 1 whatever the mix', () => {
    const outcome = summariseOutcome(['easy', 'good', 'hard', 'fail'], 4);
    expect(outcome.accuracy).toBeGreaterThanOrEqual(0);
    expect(outcome.accuracy).toBeLessThanOrEqual(1);
  });

  it('keeps the number of items separate from the number graded, because a session can be abandoned', () => {
    // Accuracy is a fraction of what was graded, not of what was offered, so
    // walking away after two of ten does not read as an eighty percent failure.
    const outcome = summariseOutcome(['good', 'good'], 10);

    expect(outcome.items).toBe(10);
    expect(outcome.graded).toBe(2);
    expect(outcome.accuracy).toBe(1);
  });
});
