import { describe, expect, it } from 'vitest';
import {
  OPEN_STRINGS,
  buildAutoSession,
  pickingNotes,
  type Activity,
} from './autoSession';
import { SKILL_BY_ID, type PickingSkillDefinition, type SkillPracticeState } from './skills';
import type { StreakSummary } from './streaks';

const NO_STREAK: StreakSummary = {
  current: 0,
  longest: 0,
  practisedToday: false,
  daysSinceLast: null,
  totalDays: 0,
};

const NOW = new Date('2026-09-10T18:00:00');

function picking(id: string): PickingSkillDefinition {
  const definition = SKILL_BY_ID.get(id);
  if (!definition || definition.category !== 'picking_technique') {
    throw new Error(`Not a picking skill: ${id}`);
  }
  return definition;
}

/**
 * The rule these are here for: **nothing in a session may need the Skip
 * button to end.**
 *
 * Every activity is finished either by the notes it names or by the chord it
 * is waiting to hear. A picking drill used to carry neither — no notes, no
 * target chord, nothing the sampler could ever decide on — so it sat on screen
 * until the player pressed Skip, and was then filed as "not heard".
 */
describe('buildAutoSession — every activity can finish on its own', () => {
  const states: SkillPracticeState[] = [];

  it('gives the tune-up a string per open string to hear', () => {
    const script = buildAutoSession({ states, streak: NO_STREAK, now: NOW });
    const tune = script.activities.find((activity) => activity.kind === 'tune');

    expect(tune?.notes).toEqual(OPEN_STRINGS);
    expect(tune?.notes).toHaveLength(6);
  });

  it('gives every picked activity the notes that end it', () => {
    // A long sitting, so the plan reaches past the opening chord shapes.
    const script = buildAutoSession({ states, streak: NO_STREAK, now: NOW, minutes: 45 });
    const picked = script.activities.filter(
      (activity: Activity) =>
        activity.kind === 'riff' || activity.kind === 'sniper' || activity.kind === 'tune',
    );

    expect(picked.length).toBeGreaterThan(0);
    for (const activity of picked) {
      expect(activity.notes?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('leaves chord work to be judged by ear rather than by notes', () => {
    const script = buildAutoSession({ states, streak: NO_STREAK, now: NOW, minutes: 45 });
    const chordWork = script.activities.filter((activity) => activity.kind === 'progression');

    for (const activity of chordWork) expect(activity.notes).toBeUndefined();
  });
});

describe('pickingNotes', () => {
  it('drills a written riff where the catalog has one', () => {
    // The string-set skills are drilled by the same riffs String Sniper uses.
    const notes = pickingNotes(picking('picking.string-set.4-6.alternate'));

    expect(notes.length).toBeGreaterThan(4);
    expect(notes).toContain('E2');
  });

  it('turns a single-string sniper into a set of strikes on that string', () => {
    const notes = pickingNotes(picking('picking.single.5th-string'));

    expect(notes).toEqual(Array.from({ length: 8 }, () => 'A2'));
  });

  it('cycles the strings a fingerstyle pattern names', () => {
    // p-i-m-a: thumb on the 4th, then index, middle and ring on 3, 2 and 1.
    const notes = pickingNotes(picking('picking.fingerstyle.p-i-m-a'));

    expect(notes.slice(0, 4)).toEqual(['D3', 'G3', 'B3', 'E4']);
    expect(notes).toHaveLength(8);
  });

  it('names every picking skill in the catalog, or the session must not offer it', () => {
    for (const [id, definition] of SKILL_BY_ID) {
      if (definition.category !== 'picking_technique' || !definition.active) continue;
      expect(pickingNotes(definition), id).not.toHaveLength(0);
    }
  });
});
