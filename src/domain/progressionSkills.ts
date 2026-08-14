import {
  PROGRESSIONS,
  needsRetuning,
  progressionSkillId,
  tuningOf,
  type ChordProgression,
} from './progressions';
import type { DifficultyLevel, MicroSkillDefinition } from './skills';

/**
 * Progressions, expressed as micro-skills.
 *
 * Today's Session plans over a catalog of `MicroSkillDefinition`. Chord Hero was
 * writing practice state to `/users/{uid}/skills` but had no entry in that
 * catalog, so the scheduler recorded runs and could never *offer* one back —
 * which is the whole point of spacing them.
 *
 * These are derived rather than hand-written: the progression library is the
 * single source of truth, and adding a progression automatically makes it
 * schedulable.
 */

const LEVEL_TO_DIFFICULTY: Record<ChordProgression['level'], DifficultyLevel> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
};

function toSkill(progression: ChordProgression): MicroSkillDefinition {
  const bars = progression.chords.length;
  const beats = progression.chords.reduce((n, c) => n + c.durationBeats, 0);
  const seconds = Math.round((beats * 60) / progression.tempoBpm);

  return {
    id: progressionSkillId(progression.id),
    category: 'theory',
    family: 'progression',
    difficulty: LEVEL_TO_DIFFICULTY[progression.level],
    title: progression.title,
    description: (
      `${progression.description ?? ''} Play it through in Chord Hero — ${bars} steps at ` +
      `${progression.tempoBpm} bpm` +
      // A card that needs the guitar re-tuned has to say so on the card: the
      // scheduler can offer it at any point in a session, and finding out after
      // you have started is worse than not being offered it.
      `${needsRetuning(progression) ? ` in ${tuningOf(progression).name} tuning` : ''}.`
    ).trim(),
    suggestedDurationSeconds: seconds,
    active: true,
    metadata: {
      ...(progression.teaches ? { scaleName: progression.teaches } : {}),
      chordSymbol: progression.genre,
    },
  };
}

export const PROGRESSION_SKILLS: readonly MicroSkillDefinition[] =
  PROGRESSIONS.map(toSkill);

/** Catalog entries for progressions, keyed by skill id. */
export const PROGRESSION_SKILL_BY_ID: ReadonlyMap<string, MicroSkillDefinition> = new Map(
  PROGRESSION_SKILLS.map((skill) => [skill.id, skill]),
);
