import type { ChordQuality } from '../audio/chordDetection';

/**
 * Chord progressions for Chord Hero.
 *
 * Pure data plus the scoring rules. No audio, no React — so the stepping and
 * grading logic can be driven from tests with synthetic detections.
 */

export type PlayMode = 'strum' | 'arpeggio';

export interface ProgressionChord {
  /** Unique within its progression. */
  id: string;
  root: string;
  quality: ChordQuality;
  positionMetadata?: {
    rootString: number;
    rootFret: number;
    /** Links to a MicroSkillDefinition so the trainer's diagram can be reused. */
    shapeId?: string;
  };
  durationBeats: number;
  mode: PlayMode;
}

export interface ChordProgression {
  id: string;
  title: string;
  description?: string;
  tempoBpm: number;
  chords: ProgressionChord[];
}

export type ChordScore = 'hit' | 'partial' | 'miss' | 'unclear';

export const PROGRESSIONS: readonly ChordProgression[] = [
  {
    id: 'prog.i-v-vi-iv.g',
    title: 'I–V–vi–IV in G',
    description: 'The four chords behind half of pop music. Open positions, one bar each.',
    tempoBpm: 80,
    chords: [
      { id: 'g', root: 'G', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 6, rootFret: 3, shapeId: 'fretting.open.g' } },
      { id: 'd', root: 'D', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 4, rootFret: 0, shapeId: 'fretting.open.d' } },
      { id: 'em', root: 'E', quality: 'min', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 6, rootFret: 0, shapeId: 'fretting.open.e-minor' } },
      { id: 'c', root: 'C', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 5, rootFret: 3, shapeId: 'fretting.open.c' } },
    ],
  },
  {
    id: 'prog.i-iv-v.a',
    title: 'I–IV–V blues in A',
    description: 'Twelve-bar shape, shortened. Open A and D, then E.',
    tempoBpm: 88,
    chords: [
      { id: 'a1', root: 'A', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 5, rootFret: 0 } },
      { id: 'd1', root: 'D', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 4, rootFret: 0, shapeId: 'fretting.open.d' } },
      { id: 'a2', root: 'A', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 5, rootFret: 0 } },
      { id: 'e1', root: 'E', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 6, rootFret: 0 } },
    ],
  },
  {
    id: 'prog.am-vamp.arpeggio',
    title: 'Am–F vamp, arpeggiated',
    description: 'Pick the notes one at a time rather than strumming. Pick or fingers.',
    tempoBpm: 70,
    chords: [
      { id: 'am', root: 'A', quality: 'min', durationBeats: 4, mode: 'arpeggio',
        positionMetadata: { rootString: 5, rootFret: 0, shapeId: 'fretting.open.a-minor' } },
      { id: 'f', root: 'F', quality: 'maj', durationBeats: 4, mode: 'arpeggio',
        positionMetadata: { rootString: 6, rootFret: 1 } },
      { id: 'c', root: 'C', quality: 'maj', durationBeats: 4, mode: 'arpeggio',
        positionMetadata: { rootString: 5, rootFret: 3, shapeId: 'fretting.open.c' } },
      { id: 'g', root: 'G', quality: 'maj', durationBeats: 4, mode: 'arpeggio',
        positionMetadata: { rootString: 6, rootFret: 3, shapeId: 'fretting.open.g' } },
    ],
  },
  {
    id: 'prog.barre.e-shape.walk',
    title: 'Barre walk: A–D–E (5th fret)',
    description: 'Same three chords as the blues, played as barres up the neck.',
    tempoBpm: 72,
    chords: [
      { id: 'a', root: 'A', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 6, rootFret: 5, shapeId: 'fretting.barre.e-shape.major.5th' } },
      { id: 'd', root: 'D', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 5, rootFret: 5, shapeId: 'fretting.barre.a-shape.major.5th' } },
      { id: 'e', root: 'E', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 6, rootFret: 12 } },
      { id: 'a2', root: 'A', quality: 'maj', durationBeats: 4, mode: 'strum',
        positionMetadata: { rootString: 6, rootFret: 5, shapeId: 'fretting.barre.e-shape.major.5th' } },
    ],
  },
];

export const PROGRESSION_BY_ID: ReadonlyMap<string, ChordProgression> = new Map(
  PROGRESSIONS.map((p) => [p.id, p]),
);

/** Milliseconds one chord occupies at a given tempo. */
export function chordDurationMs(chord: ProgressionChord, tempoBpm: number): number {
  return (chord.durationBeats * 60_000) / tempoBpm;
}

export function progressionDurationMs(progression: ChordProgression, tempoBpm: number): number {
  return progression.chords.reduce((total, c) => total + chordDurationMs(c, tempoBpm), 0);
}

/**
 * Which chord is sounding at `elapsedMs`, and how far through it we are.
 *
 * Returns null past the end, which is how the panel knows the run is over.
 */
export function chordAt(
  progression: ChordProgression,
  tempoBpm: number,
  elapsedMs: number,
): { index: number; chord: ProgressionChord; startMs: number; endMs: number } | null {
  let start = 0;
  for (let index = 0; index < progression.chords.length; index += 1) {
    const chord = progression.chords[index]!;
    const end = start + chordDurationMs(chord, tempoBpm);
    if (elapsedMs < end) {
      return { index, chord, startMs: start, endMs: end };
    }
    start = end;
  }
  return null;
}

/**
 * Grades one observation against the target.
 *
 * `partial` exists because getting the root right and the quality wrong is a
 * different mistake from playing the wrong chord entirely — usually one finger
 * out — and telling a learner that is more useful than a bare "miss".
 */
export function scoreDetection(
  expected: Pick<ProgressionChord, 'root' | 'quality'>,
  detected: { root: string; quality: ChordQuality } | null,
): ChordScore {
  if (!detected) return 'unclear';
  if (detected.root !== expected.root) return 'miss';
  if (detected.quality === expected.quality) return 'hit';
  return 'partial';
}

/**
 * Reduces a window of observations to a single grade.
 *
 * Deliberately generous to the best moment rather than the average: a strum
 * rings, decays and gets damped, and an arpeggio only spells the full chord
 * once its last note lands. Grading the peak matches how it felt to play.
 */
export function scoreWindow(
  expected: Pick<ProgressionChord, 'root' | 'quality'>,
  observations: ({ root: string; quality: ChordQuality } | null)[],
): { score: ChordScore; hits: number; observed: number } {
  const observed = observations.filter((o) => o !== null).length;
  let best: ChordScore = observed === 0 ? 'unclear' : 'miss';
  let hits = 0;

  for (const observation of observations) {
    const score = scoreDetection(expected, observation);
    if (score === 'hit') hits += 1;
    if (score === 'hit') best = 'hit';
    else if (score === 'partial' && best !== 'hit') best = 'partial';
  }

  return { score: best, hits, observed };
}

export interface ProgressionSummary {
  hit: number;
  partial: number;
  miss: number;
  unclear: number;
  total: number;
}

export function summarise(scores: ChordScore[]): ProgressionSummary {
  const summary: ProgressionSummary = { hit: 0, partial: 0, miss: 0, unclear: 0, total: scores.length };
  for (const score of scores) summary[score] += 1;
  return summary;
}
