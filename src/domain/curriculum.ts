import { targetChordFor } from './earGrading';
import type { ChordProgression } from './progressions';
import { SKILL_CATALOG, type MicroSkillDefinition, type SkillPracticeState } from './skills';

/**
 * Teach before test.
 *
 * A chord may not turn up in a scored game until the trainer has taught it and
 * heard you play it. Before this, the app would cheerfully open a progression
 * containing A7, F and D7 for someone who had never been shown any of them, and
 * then score them on it — which is not difficulty, it is an ambush.
 *
 * Pure: catalog and practice state in, a verdict out.
 *
 * The rule for "taught" is deliberately weak — one rep that was not a failure.
 * Requiring mastery would mean grinding a chord alone before it appeared in any
 * music, and playing chords in music is how anyone actually learns them. The
 * gate exists to guarantee an introduction, not a qualification.
 */

/** A chord, as the progression library names it. */
export interface ChordRef {
  root: string;
  quality: string;
}

const key = (chord: ChordRef): string => `${chord.root}|${chord.quality}`;

/**
 * Every chord the catalog can teach, mapped to the skill that teaches it.
 *
 * Derived from the shapes themselves via `targetChordFor`, so adding a shape
 * adds a chord to the curriculum with no second list to update.
 */
const DIFFICULTY_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;

/**
 * How good a lesson a shape is for the chord it makes.
 *
 * Lower is better. Several shapes produce the same chord — open E, the E-shape
 * barre at the 12th — and the one that teaches it is the easiest, not whichever
 * the catalog happens to list first. (It lists CAGED shapes first, which is how
 * "learn Em" came to mean a barre at the 7th fret until this was measured.)
 */
function lessonRank(definition: MicroSkillDefinition): number {
  const difficulty = DIFFICULTY_RANK[definition.difficulty] ?? 3;
  const openChord = definition.family === 'open_chord' ? 0 : 1;
  const powerChord = definition.family === 'power_chord' ? 0 : 1;
  return difficulty * 10 + openChord * 3 + powerChord;
}

export const TEACHING_SHAPE_BY_CHORD: ReadonlyMap<string, MicroSkillDefinition> = (() => {
  const map = new Map<string, MicroSkillDefinition>();

  for (const definition of SKILL_CATALOG) {
    const chord = targetChordFor(definition);
    if (!chord) continue;

    const existing = map.get(key(chord));
    if (!existing || lessonRank(definition) < lessonRank(existing)) {
      map.set(key(chord), definition);
    }
  }

  return map;
})();

export function teachingShapeFor(chord: ChordRef): MicroSkillDefinition | null {
  return TEACHING_SHAPE_BY_CHORD.get(key(chord)) ?? null;
}

/**
 * Whether a chord has been met.
 *
 * A chord nothing in the catalog teaches counts as met, and that is a decision
 * worth stating: the alternative is locking content permanently with no way to
 * unlock it, which would quietly delete most of the library. Those chords are
 * reported by `untaughtChords` instead, so the gap is visible rather than
 * silently tolerated.
 */
export function isChordTaught(
  chord: ChordRef,
  states: ReadonlyMap<string, SkillPracticeState>,
): boolean {
  const shape = teachingShapeFor(chord);
  if (!shape) return true;

  const state = states.get(shape.id);
  if (!state) return false;

  // One rep that was not a failure. See the note at the top of this file.
  return (state.totalReps ?? 0) > 0 && state.lastResult !== 'fail';
}

/** The chords a progression asks for. Riff steps are notes, not chords. */
export function chordsIn(progression: ChordProgression): ChordRef[] {
  const seen = new Map<string, ChordRef>();

  for (const step of progression.chords) {
    if (step.mode === 'riff') continue;
    const chord = { root: step.root, quality: step.quality };
    if (!seen.has(key(chord))) seen.set(key(chord), chord);
  }

  return [...seen.values()];
}

export interface LockState {
  unlocked: boolean;
  /** Chords in this progression that are teachable but not yet taught. */
  missing: ChordRef[];
  /** The next shape to learn, when there is one. */
  nextShape: MicroSkillDefinition | null;
}

export function lockStateOf(
  progression: ChordProgression,
  states: ReadonlyMap<string, SkillPracticeState>,
): LockState {
  const missing = chordsIn(progression).filter((chord) => !isChordTaught(chord, states));
  const nextShape = missing.length > 0 ? teachingShapeFor(missing[0]!) : null;

  return { unlocked: missing.length === 0, missing, nextShape };
}

export function isUnlocked(
  progression: ChordProgression,
  states: ReadonlyMap<string, SkillPracticeState>,
): boolean {
  return lockStateOf(progression, states).unlocked;
}

/** Chord names for a lock message: "Learn Am and F first". */
export function describeMissing(missing: readonly ChordRef[]): string {
  const names = missing.map((chord) => formatChordRef(chord));
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function formatChordRef(chord: ChordRef): string {
  switch (chord.quality) {
    case 'maj':
      return chord.root;
    case 'min':
      return `${chord.root}m`;
    default:
      return `${chord.root}${chord.quality}`;
  }
}

/**
 * Chords used by the given progressions that nothing in the catalog teaches.
 *
 * Not used at runtime — this is the coverage report, so a test can fail when
 * content is added that the curriculum has no lesson for.
 */
export function untaughtChords(progressions: readonly ChordProgression[]): ChordRef[] {
  const missing = new Map<string, ChordRef>();

  for (const progression of progressions) {
    for (const chord of chordsIn(progression)) {
      if (!teachingShapeFor(chord) && !missing.has(key(chord))) {
        missing.set(key(chord), chord);
      }
    }
  }

  return [...missing.values()];
}
