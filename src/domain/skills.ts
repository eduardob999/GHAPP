import type { Timestamp } from 'firebase/firestore';

/**
 * The micro-skill catalog and the shape of per-skill practice state.
 *
 * A micro-skill is deliberately small: one shape, in one position, practisable
 * in 20–60 seconds. That granularity is what lets the scheduler interleave
 * families and space individual weak spots rather than whole topics.
 *
 * String numbers follow guitar convention throughout: **6 is the low E, 1 is
 * the high E**.
 */

export type SkillCategory = 'fretting_shape' | 'picking_technique' | 'theory';

export type FrettingFamily =
  | 'caged_shape'
  | 'open_chord'
  | 'barre_chord'
  | 'power_chord'
  | 'scale_pattern';

export type PickingFamily = 'single_string' | 'string_set' | 'fingerstyle_pattern';

export type TheoryFamily = 'progression' | 'interval' | 'scale_over_chord';

export type SkillFamily = FrettingFamily | PickingFamily | TheoryFamily;

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export type CagedShape = 'C' | 'A' | 'G' | 'E' | 'D';

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'power'
  | 'dominant'
  | 'dominant7'
  | 'sus2'
  | 'sus4';

export type FingerNumber = 1 | 2 | 3 | 4;

/** One stopped or open note in a chord diagram. */
export interface FingerPosition {
  /** 6 (low E) to 1 (high E). */
  string: number;
  /** 0 is an open string. */
  fret: number;
  finger?: FingerNumber;
  /** Part of a barre — the diagram joins same-fret barre notes into a bar. */
  barre?: boolean;
}

export type PickingTechnique = 'pick' | 'bare' | 'fingerstyle';

export interface FrettingMetadata {
  shapeName?: CagedShape;
  chordQuality?: ChordQuality;
  /** String carrying the root, 6 (low E) to 1 (high E). */
  rootString?: number;
  /** Fret carrying the root. 0 means an open position. */
  rootFret?: number;
  scaleName?: string;

  // ── Diagram data ─────────────────────────────────────────────────────────
  // All optional: a skill without `fingers` simply has no diagram and is left
  // out of the shape trainer. Scale patterns are the current example.

  /** Lowest fret to draw. 0 draws the nut. */
  lowestFret?: number;
  /** Highest fret to draw. */
  highestFret?: number;
  /** Stopped notes. Strings absent from this list and not muted ring open. */
  fingers?: FingerPosition[];
  /** Strings that must not sound, drawn with an ✕ above the nut. */
  mutedStrings?: number[];
}

export interface PickingMetadata {
  technique: PickingTechnique;
  /** Strings involved, 6 (low E) to 1 (high E). */
  targetStrings: number[];
  patternName?: string;
}

export interface TheoryMetadata {
  key?: string;
  scaleName?: string;
  progressionPattern?: string;
  chordSymbol?: string;
}

interface BaseSkillDefinition {
  /** Stable identifier. Never reuse or renumber — practice history is keyed on it. */
  id: string;
  difficulty: DifficultyLevel;
  title: string;
  description: string;
  suggestedDurationSeconds?: number;
  /** Retiring a skill without deleting the history behind it. */
  active: boolean;
}

export interface FrettingSkillDefinition extends BaseSkillDefinition {
  category: 'fretting_shape';
  family?: FrettingFamily;
  metadata: FrettingMetadata;
}

export interface PickingSkillDefinition extends BaseSkillDefinition {
  category: 'picking_technique';
  family?: PickingFamily;
  metadata: PickingMetadata;
}

export interface TheorySkillDefinition extends BaseSkillDefinition {
  category: 'theory';
  family?: TheoryFamily;
  metadata: TheoryMetadata;
}

/**
 * Discriminated on `category`, so narrowing a definition also narrows its
 * `family` and `metadata` to the matching shapes.
 */
export type MicroSkillDefinition =
  | FrettingSkillDefinition
  | PickingSkillDefinition
  | TheorySkillDefinition;

export type PracticeResult = 'easy' | 'good' | 'hard' | 'fail';

/**
 * Per-user, per-skill state, stored at `/users/{uid}/skills/{skillId}`.
 *
 * `dueAt` and `lastPracticedAt` are written as concrete client timestamps
 * rather than `serverTimestamp()`. That is deliberate: a pending server
 * timestamp reads back as null from the local cache, and a null `dueAt` would
 * make every graded skill invisible to the planner until the network returned —
 * exactly when offline practice needs to keep working. `createdAt`/`updatedAt`
 * are server timestamps because nothing schedules on them.
 */
export interface SkillPracticeState {
  skillId: string;
  lastResult?: PracticeResult;
  lastPracticedAt?: Timestamp;
  /**
   * Derived from FSRS difficulty and kept for display and for documents written
   * before FSRS existed. Nothing schedules on it any more.
   */
  ease?: number;
  intervalDays?: number;
  /** FSRS: days until recall decays to the retention target. */
  stability?: number;
  /** FSRS: 1 (trivial) to 10 (punishing). */
  difficulty?: number;
  /** FSRS: failures after the skill was previously known. */
  lapses?: number;
  /** What the model expected before the last rep, 0–1. */
  predictedRecall?: number;
  dueAt?: Timestamp;
  totalReps?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Human-readable labels for the small tag on each practice card. */
export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  fretting_shape: 'Fretting',
  picking_technique: 'Picking',
  theory: 'Theory',
};

export const FAMILY_LABELS: Record<SkillFamily, string> = {
  caged_shape: 'CAGED',
  open_chord: 'Open chord',
  barre_chord: 'Barre',
  power_chord: 'Power chord',
  scale_pattern: 'Scale',
  single_string: 'Single string',
  string_set: 'String set',
  fingerstyle_pattern: 'Fingerstyle',
  progression: 'Progression',
  interval: 'Interval',
  scale_over_chord: 'Scale over chord',
};

/**
 * The seed catalog.
 *
 * Static and global — it ships in the bundle rather than living in Firestore,
 * so it costs no reads and works offline from the first launch. Only the
 * per-user state travels over the network.
 */
export const SKILL_CATALOG: readonly MicroSkillDefinition[] = [
  // ── Fretting: CAGED shapes ────────────────────────────────────────────────
  {
    id: 'fretting.caged.c-shape.major.3rd',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'intermediate',
    title: 'C-shape major at 3rd fret',
    description:
      'Form the C-shape major with the root on the 5th string, 3rd fret. Strum strings 5–1 and check every note rings.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: {
      shapeName: 'C',
      chordQuality: 'major',
      rootString: 5,
      rootFret: 3,
      lowestFret: 0,
      highestFret: 3,
      mutedStrings: [6],
      fingers: [
        { string: 5, fret: 3, finger: 3 },
        { string: 4, fret: 2, finger: 2 },
        { string: 2, fret: 1, finger: 1 },
      ],
    },
  },
  {
    id: 'fretting.caged.a-shape.major.5th',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'intermediate',
    title: 'A-shape major at 5th fret',
    description:
      'A-shape major, root on the 5th string, 5th fret. Keep the barre light and let strings 5–1 sound cleanly.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: {
      shapeName: 'A',
      chordQuality: 'major',
      rootString: 5,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      mutedStrings: [6],
      fingers: [
        { string: 5, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 5, finger: 1, barre: true },
        { string: 3, fret: 5, finger: 1, barre: true },
        { string: 2, fret: 5, finger: 1, barre: true },
        { string: 1, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 7, finger: 2 },
        { string: 3, fret: 7, finger: 3 },
        { string: 2, fret: 7, finger: 4 },
      ],
    },
  },
  {
    id: 'fretting.caged.g-shape.major.7th',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'advanced',
    title: 'G-shape major at 7th fret',
    description:
      'The awkward one. G-shape major with the root on the 6th string, 7th fret. Aim for the outer strings first.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: {
      shapeName: 'G',
      chordQuality: 'major',
      rootString: 6,
      rootFret: 7,
      lowestFret: 4,
      highestFret: 7,
      fingers: [
        { string: 4, fret: 4, finger: 1, barre: true },
        { string: 3, fret: 4, finger: 1, barre: true },
        { string: 2, fret: 4, finger: 1, barre: true },
        { string: 5, fret: 6, finger: 2 },
        { string: 6, fret: 7, finger: 3 },
        { string: 1, fret: 7, finger: 4 },
      ],
    },
  },
  {
    id: 'fretting.caged.e-shape.major.5th',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'intermediate',
    title: 'E-shape major at 5th fret',
    description:
      'E-shape major barre, root on the 6th string, 5th fret. Strum all six strings and listen for a dead 2nd string.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: {
      shapeName: 'E',
      chordQuality: 'major',
      rootString: 6,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      fingers: [
        { string: 6, fret: 5, finger: 1, barre: true },
        { string: 5, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 5, finger: 1, barre: true },
        { string: 3, fret: 5, finger: 1, barre: true },
        { string: 2, fret: 5, finger: 1, barre: true },
        { string: 1, fret: 5, finger: 1, barre: true },
        { string: 5, fret: 7, finger: 3 },
        { string: 4, fret: 7, finger: 4 },
        { string: 3, fret: 6, finger: 2 },
      ],
    },
  },
  {
    id: 'fretting.caged.d-shape.major.10th',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'advanced',
    title: 'D-shape major at 10th fret',
    description:
      'D-shape major up at the 10th fret, root on the 4th string. Only strings 4–1 sound; mute the rest.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: {
      shapeName: 'D',
      chordQuality: 'major',
      rootString: 4,
      rootFret: 10,
      lowestFret: 10,
      highestFret: 13,
      mutedStrings: [6, 5],
      fingers: [
        { string: 4, fret: 10, finger: 1 },
        { string: 3, fret: 12, finger: 2 },
        { string: 1, fret: 12, finger: 3 },
        { string: 2, fret: 13, finger: 4 },
      ],
    },
  },
  {
    id: 'fretting.caged.a-shape.minor.5th',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'intermediate',
    title: 'A-shape minor at 5th fret',
    description:
      'Am-shape barre, root on the 5th string, 5th fret. Compare it against the major shape and feel the one-finger difference.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: {
      shapeName: 'A',
      chordQuality: 'minor',
      rootString: 5,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      mutedStrings: [6],
      fingers: [
        { string: 5, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 5, finger: 1, barre: true },
        { string: 3, fret: 5, finger: 1, barre: true },
        { string: 2, fret: 5, finger: 1, barre: true },
        { string: 1, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 7, finger: 3 },
        { string: 3, fret: 7, finger: 4 },
        { string: 2, fret: 6, finger: 2 },
      ],
    },
  },
  {
    id: 'fretting.caged.e-shape.minor.7th',
    category: 'fretting_shape',
    family: 'caged_shape',
    difficulty: 'intermediate',
    title: 'E-shape minor at 7th fret',
    description:
      'Em-shape barre, root on the 6th string, 7th fret. Move between it and the major shape without releasing the barre.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: {
      shapeName: 'E',
      chordQuality: 'minor',
      rootString: 6,
      rootFret: 7,
      lowestFret: 7,
      highestFret: 10,
      fingers: [
        { string: 6, fret: 7, finger: 1, barre: true },
        { string: 5, fret: 7, finger: 1, barre: true },
        { string: 4, fret: 7, finger: 1, barre: true },
        { string: 3, fret: 7, finger: 1, barre: true },
        { string: 2, fret: 7, finger: 1, barre: true },
        { string: 1, fret: 7, finger: 1, barre: true },
        { string: 5, fret: 9, finger: 3 },
        { string: 4, fret: 9, finger: 4 },
      ],
    },
  },

  // ── Fretting: open chords ─────────────────────────────────────────────────
  {
    id: 'fretting.open.g',
    category: 'fretting_shape',
    family: 'open_chord',
    difficulty: 'beginner',
    title: 'Open G major',
    description: 'Open G. Fret it, strum, release, re-form. Ten clean repetitions.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'major',
      rootString: 6,
      rootFret: 3,
      lowestFret: 0,
      highestFret: 3,
      fingers: [
        { string: 6, fret: 3, finger: 2 },
        { string: 5, fret: 2, finger: 1 },
        { string: 1, fret: 3, finger: 3 },
      ],
    },
  },
  {
    id: 'fretting.open.c',
    category: 'fretting_shape',
    family: 'open_chord',
    difficulty: 'beginner',
    title: 'Open C major',
    description: 'Open C. Watch that the 1st string stays clear of your third finger.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'major',
      rootString: 5,
      rootFret: 3,
      lowestFret: 0,
      highestFret: 3,
      mutedStrings: [6],
      fingers: [
        { string: 5, fret: 3, finger: 3 },
        { string: 4, fret: 2, finger: 2 },
        { string: 2, fret: 1, finger: 1 },
      ],
    },
  },
  {
    id: 'fretting.open.d',
    category: 'fretting_shape',
    family: 'open_chord',
    difficulty: 'beginner',
    title: 'Open D major',
    description: 'Open D, strings 4–1 only. Practise muting the 5th and 6th strings with your thumb.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'major',
      rootString: 4,
      rootFret: 0,
      lowestFret: 0,
      highestFret: 3,
      mutedStrings: [6, 5],
      fingers: [
        { string: 3, fret: 2, finger: 1 },
        { string: 1, fret: 2, finger: 2 },
        { string: 2, fret: 3, finger: 3 },
      ],
    },
  },
  {
    id: 'fretting.open.e-minor',
    category: 'fretting_shape',
    family: 'open_chord',
    difficulty: 'beginner',
    title: 'Open E minor',
    description: 'Open Em across all six strings. The easiest full-width chord — use it to check your strumming arc.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'minor',
      rootString: 6,
      rootFret: 0,
      lowestFret: 0,
      highestFret: 3,
      fingers: [
        { string: 5, fret: 2, finger: 2 },
        { string: 4, fret: 2, finger: 3 },
      ],
    },
  },
  {
    id: 'fretting.open.a-minor',
    category: 'fretting_shape',
    family: 'open_chord',
    difficulty: 'beginner',
    title: 'Open A minor',
    description: 'Open Am, strings 5–1. Switch between Am and open C without lifting your first finger.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'minor',
      rootString: 5,
      rootFret: 0,
      lowestFret: 0,
      highestFret: 3,
      mutedStrings: [6],
      fingers: [
        { string: 4, fret: 2, finger: 2 },
        { string: 3, fret: 2, finger: 3 },
        { string: 2, fret: 1, finger: 1 },
      ],
    },
  },

  // ── Fretting: barre chords ────────────────────────────────────────────────
  {
    id: 'fretting.barre.e-shape.major.5th',
    category: 'fretting_shape',
    family: 'barre_chord',
    difficulty: 'intermediate',
    title: 'E-shape major barre at 5th fret (A major)',
    description:
      'Full six-string barre at the 5th fret. Roll the first finger slightly onto its side and use the least pressure that still sounds.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: {
      shapeName: 'E',
      chordQuality: 'major',
      rootString: 6,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      fingers: [
        { string: 6, fret: 5, finger: 1, barre: true },
        { string: 5, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 5, finger: 1, barre: true },
        { string: 3, fret: 5, finger: 1, barre: true },
        { string: 2, fret: 5, finger: 1, barre: true },
        { string: 1, fret: 5, finger: 1, barre: true },
        { string: 5, fret: 7, finger: 3 },
        { string: 4, fret: 7, finger: 4 },
        { string: 3, fret: 6, finger: 2 },
      ],
    },
  },
  {
    id: 'fretting.barre.a-shape.major.5th',
    category: 'fretting_shape',
    family: 'barre_chord',
    difficulty: 'intermediate',
    title: 'A-shape major barre at 5th fret (D major)',
    description: 'A-shape barre, strings 5–1. Check the 1st string is not being choked by the ring finger.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: {
      shapeName: 'A',
      chordQuality: 'major',
      rootString: 5,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      mutedStrings: [6],
      fingers: [
        { string: 5, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 5, finger: 1, barre: true },
        { string: 3, fret: 5, finger: 1, barre: true },
        { string: 2, fret: 5, finger: 1, barre: true },
        { string: 1, fret: 5, finger: 1, barre: true },
        { string: 4, fret: 7, finger: 2 },
        { string: 3, fret: 7, finger: 3 },
        { string: 2, fret: 7, finger: 4 },
      ],
    },
  },
  {
    id: 'fretting.barre.e-shape.minor.8th',
    category: 'fretting_shape',
    family: 'barre_chord',
    difficulty: 'advanced',
    title: 'E-shape minor barre at 8th fret (C minor)',
    description: 'Em-shape barre high on the neck, where string tension is lower but spacing is tighter.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: {
      shapeName: 'E',
      chordQuality: 'minor',
      rootString: 6,
      rootFret: 8,
      lowestFret: 8,
      highestFret: 11,
      fingers: [
        { string: 6, fret: 8, finger: 1, barre: true },
        { string: 5, fret: 8, finger: 1, barre: true },
        { string: 4, fret: 8, finger: 1, barre: true },
        { string: 3, fret: 8, finger: 1, barre: true },
        { string: 2, fret: 8, finger: 1, barre: true },
        { string: 1, fret: 8, finger: 1, barre: true },
        { string: 5, fret: 10, finger: 3 },
        { string: 4, fret: 10, finger: 4 },
      ],
    },
  },
  {
    id: 'fretting.barre.a-shape.minor.7th',
    category: 'fretting_shape',
    family: 'barre_chord',
    difficulty: 'advanced',
    title: 'A-shape minor barre at 7th fret (E minor)',
    description: 'Am-shape barre at the 7th fret. Alternate it with the open Em and listen for the same chord.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: {
      shapeName: 'A',
      chordQuality: 'minor',
      rootString: 5,
      rootFret: 7,
      lowestFret: 7,
      highestFret: 10,
      mutedStrings: [6],
      fingers: [
        { string: 5, fret: 7, finger: 1, barre: true },
        { string: 4, fret: 7, finger: 1, barre: true },
        { string: 3, fret: 7, finger: 1, barre: true },
        { string: 2, fret: 7, finger: 1, barre: true },
        { string: 1, fret: 7, finger: 1, barre: true },
        { string: 4, fret: 9, finger: 3 },
        { string: 3, fret: 9, finger: 4 },
        { string: 2, fret: 8, finger: 2 },
      ],
    },
  },

  // ── Fretting: power chords ────────────────────────────────────────────────
  {
    id: 'fretting.power.6th-string.3rd',
    category: 'fretting_shape',
    family: 'power_chord',
    difficulty: 'beginner',
    title: 'Power chord, 6th string root, 3rd fret (G5)',
    description: 'Two-note G5 on strings 6 and 5. Mute everything else with the side of your picking hand.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'power',
      rootString: 6,
      rootFret: 3,
      lowestFret: 3,
      highestFret: 6,
      mutedStrings: [4, 3, 2, 1],
      fingers: [
        { string: 6, fret: 3, finger: 1 },
        { string: 5, fret: 5, finger: 3 },
      ],
    },
  },
  {
    id: 'fretting.power.6th-string.5th',
    category: 'fretting_shape',
    family: 'power_chord',
    difficulty: 'beginner',
    title: 'Power chord, 6th string root, 5th fret (A5)',
    description: 'A5 on strings 6 and 5. Slide between the 3rd and 5th fret shapes without lifting.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'power',
      rootString: 6,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      mutedStrings: [4, 3, 2, 1],
      fingers: [
        { string: 6, fret: 5, finger: 1 },
        { string: 5, fret: 7, finger: 3 },
      ],
    },
  },
  {
    id: 'fretting.power.5th-string.5th',
    category: 'fretting_shape',
    family: 'power_chord',
    difficulty: 'beginner',
    title: 'Power chord, 5th string root, 5th fret (D5)',
    description: 'D5 on strings 5 and 4. The 6th string must stay silent — that is the whole exercise.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'power',
      rootString: 5,
      rootFret: 5,
      lowestFret: 5,
      highestFret: 8,
      mutedStrings: [6, 3, 2, 1],
      fingers: [
        { string: 5, fret: 5, finger: 1 },
        { string: 4, fret: 7, finger: 3 },
      ],
    },
  },
  {
    id: 'fretting.power.5th-string.7th',
    category: 'fretting_shape',
    family: 'power_chord',
    difficulty: 'beginner',
    title: 'Power chord, 5th string root, 7th fret (E5)',
    description: 'E5 on strings 5 and 4. Jump between this and the 6th-string A5 to practise string switching.',
    suggestedDurationSeconds: 20,
    active: true,
    metadata: {
      chordQuality: 'power',
      rootString: 5,
      rootFret: 7,
      lowestFret: 7,
      highestFret: 10,
      mutedStrings: [6, 3, 2, 1],
      fingers: [
        { string: 5, fret: 7, finger: 1 },
        { string: 4, fret: 9, finger: 3 },
      ],
    },
  },

  // ── Fretting: scale patterns ──────────────────────────────────────────────
  {
    id: 'fretting.scale.minor-pentatonic.box1.5th',
    category: 'fretting_shape',
    family: 'scale_pattern',
    difficulty: 'intermediate',
    title: 'A minor pentatonic, box 1 at 5th fret',
    description: 'Ascend and descend box 1 twice, one note per beat. Keep it slow enough that nothing buzzes.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: { scaleName: 'minor pentatonic', rootString: 6, rootFret: 5 },
  },
  {
    id: 'fretting.scale.minor-pentatonic.box2.8th',
    category: 'fretting_shape',
    family: 'scale_pattern',
    difficulty: 'advanced',
    title: 'A minor pentatonic, box 2 at 8th fret',
    description: 'Box 2, then join it to box 1 with a slide on the 3rd string.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: { scaleName: 'minor pentatonic', rootString: 5, rootFret: 8 },
  },

  // ── Picking: single string ────────────────────────────────────────────────
  {
    id: 'picking.single.3rd-string',
    category: 'picking_technique',
    family: 'single_string',
    difficulty: 'beginner',
    title: 'String sniper: 3rd string',
    description:
      'Eyes closed. Pick the 3rd string eight times without touching a neighbour. Reset if you clip one.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'pick', targetStrings: [3] },
  },
  {
    id: 'picking.single.4th-string',
    category: 'picking_technique',
    family: 'single_string',
    difficulty: 'beginner',
    title: 'String sniper: 4th string',
    description: 'Eyes closed, eight clean strikes on the 4th string. The inner strings are the hard ones.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'pick', targetStrings: [4] },
  },
  {
    id: 'picking.single.5th-string',
    category: 'picking_technique',
    family: 'single_string',
    difficulty: 'beginner',
    title: 'String sniper: 5th string',
    description: 'Eight strikes on the 5th string from a resting hand position, without looking.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'pick', targetStrings: [5] },
  },
  {
    id: 'picking.single.1st-string.bare',
    category: 'picking_technique',
    family: 'single_string',
    difficulty: 'intermediate',
    title: 'Bare-hand accuracy: 1st string',
    description: 'No pick. Index finger only, eight strikes on the 1st string. Consistent tone matters more than speed.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'bare', targetStrings: [1] },
  },

  // ── Picking: string sets ──────────────────────────────────────────────────
  {
    id: 'picking.string-set.2-4.alternate',
    category: 'picking_technique',
    family: 'string_set',
    difficulty: 'intermediate',
    title: 'Strings 2–4, alternate picking',
    description: 'Eight notes across strings 4, 3 and 2, strict down-up. Open strings are fine.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'pick', targetStrings: [4, 3, 2], patternName: 'alternate' },
  },
  {
    id: 'picking.string-set.4-6.alternate',
    category: 'picking_technique',
    family: 'string_set',
    difficulty: 'intermediate',
    title: 'Strings 4–6, alternate picking',
    description: 'The bass side, strict down-up. Watch that the pick does not dig in deeper on the wound strings.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'pick', targetStrings: [6, 5, 4], patternName: 'alternate' },
  },
  {
    id: 'picking.string-set.1-3.alternate',
    category: 'picking_technique',
    family: 'string_set',
    difficulty: 'beginner',
    title: 'Strings 1–3, alternate picking',
    description: 'Treble side, strict down-up across strings 3, 2 and 1.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'pick', targetStrings: [3, 2, 1], patternName: 'alternate' },
  },
  {
    id: 'picking.string-set.3-5.skip',
    category: 'picking_technique',
    family: 'string_set',
    difficulty: 'advanced',
    title: 'String skipping: 5 to 3',
    description: 'Alternate between the 5th and 3rd strings, skipping the 4th entirely. Eight pairs.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: { technique: 'pick', targetStrings: [5, 3], patternName: 'skip' },
  },

  // ── Picking: fingerstyle ──────────────────────────────────────────────────
  {
    id: 'picking.fingerstyle.p-i-m-a',
    category: 'picking_technique',
    family: 'fingerstyle_pattern',
    difficulty: 'beginner',
    title: 'Fingerstyle: p-i-m-a on open strings',
    description:
      'Thumb on the 4th string, then index, middle and ring on strings 3, 2 and 1. Four cycles, evenly.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'fingerstyle', targetStrings: [4, 3, 2, 1], patternName: 'p-i-m-a' },
  },
  {
    id: 'picking.fingerstyle.travis-basic',
    category: 'picking_technique',
    family: 'fingerstyle_pattern',
    difficulty: 'advanced',
    title: 'Fingerstyle: alternating bass',
    description:
      'Over an open C, alternate the thumb between strings 5 and 4 while the index picks the 2nd string off the beat.',
    suggestedDurationSeconds: 60,
    active: true,
    metadata: { technique: 'fingerstyle', targetStrings: [5, 4, 2], patternName: 'alternating-bass' },
  },
  {
    id: 'picking.fingerstyle.thumb-bass',
    category: 'picking_technique',
    family: 'fingerstyle_pattern',
    difficulty: 'beginner',
    title: 'Fingerstyle: thumb independence',
    description: 'Thumb alone, alternating strings 6 and 4 over an open Em. Steady and even — no other fingers.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { technique: 'fingerstyle', targetStrings: [6, 4], patternName: 'thumb-only' },
  },

  // ── Theory: progressions ──────────────────────────────────────────────────
  {
    id: 'theory.progression.I-V-vi-IV.g',
    category: 'theory',
    family: 'progression',
    difficulty: 'beginner',
    title: 'I–V–vi–IV in G major',
    description: 'Name the four chords, then play them. (G – D – Em – C.) Say each name as you change.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { key: 'G major', progressionPattern: 'I-V-vi-IV' },
  },
  {
    id: 'theory.progression.ii-V-I.c',
    category: 'theory',
    family: 'progression',
    difficulty: 'intermediate',
    title: 'ii–V–I in C major',
    description: 'Work out the three chords before you play them. (Dm – G – C.)',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { key: 'C major', progressionPattern: 'ii-V-I' },
  },
  {
    id: 'theory.progression.I-IV-V.a',
    category: 'theory',
    family: 'progression',
    difficulty: 'beginner',
    title: 'I–IV–V in A major',
    description: 'Name and play the three chords of a blues in A. (A – D – E.)',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { key: 'A major', progressionPattern: 'I-IV-V' },
  },

  // ── Theory: scale over chord ──────────────────────────────────────────────
  {
    id: 'theory.scale-over-chord.a-minor-pentatonic.am',
    category: 'theory',
    family: 'scale_over_chord',
    difficulty: 'beginner',
    title: 'A minor pentatonic over Am',
    description: 'Hold an Am, then play the scale over it. Find the chord tones inside the scale shape.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: { key: 'A minor', scaleName: 'minor pentatonic', chordSymbol: 'Am' },
  },
  {
    id: 'theory.scale-over-chord.e-mixolydian.e7',
    category: 'theory',
    family: 'scale_over_chord',
    difficulty: 'advanced',
    title: 'E Mixolydian over E7',
    description: 'Why does Mixolydian fit a dominant chord and the major scale does not? Find the flat 7th.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: { key: 'E', scaleName: 'Mixolydian', chordSymbol: 'E7' },
  },
  {
    id: 'theory.scale-over-chord.g-major.cmaj7',
    category: 'theory',
    family: 'scale_over_chord',
    difficulty: 'intermediate',
    title: 'G major scale over Cmaj7',
    description: 'Cmaj7 is the IV chord of G major. Play the G major scale over it and hear it resolve.',
    suggestedDurationSeconds: 45,
    active: true,
    metadata: { key: 'G major', scaleName: 'major', chordSymbol: 'Cmaj7' },
  },

  // ── Theory: intervals ─────────────────────────────────────────────────────
  {
    id: 'theory.interval.perfect-fifth',
    category: 'theory',
    family: 'interval',
    difficulty: 'beginner',
    title: 'Perfect fifths across the neck',
    description:
      'From any root on the 6th or 5th string, find the fifth: same shape as a power chord. Three roots.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { scaleName: 'interval', chordSymbol: 'P5' },
  },
  {
    id: 'theory.interval.major-third',
    category: 'theory',
    family: 'interval',
    difficulty: 'intermediate',
    title: 'Major thirds from a 6th-string root',
    description:
      'Find the major third above three different roots on the 6th string. It is the note that decides major or minor.',
    suggestedDurationSeconds: 30,
    active: true,
    metadata: { scaleName: 'interval', chordSymbol: 'M3' },
  },
];

/** Lookup by id, for resolving stored practice state back to a definition. */
export const SKILL_BY_ID: ReadonlyMap<string, MicroSkillDefinition> = new Map(
  SKILL_CATALOG.map((skill) => [skill.id, skill]),
);

/**
 * Grouping key used to keep one session from turning into ten barre chords.
 * Falls back to the category for definitions that declare no family.
 */
export function groupingKey(definition: MicroSkillDefinition): string {
  return definition.family ?? definition.category;
}
