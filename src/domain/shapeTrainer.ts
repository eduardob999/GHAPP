import {
  FAMILY_LABELS,
  type FingerPosition,
  type FrettingFamily,
  type FrettingSkillDefinition,
  type MicroSkillDefinition,
  type SkillPracticeState,
} from './skills';

/**
 * Selecting and describing fretting shapes for the trainer.
 *
 * Pure and deterministic — the trainer is just a view over the same catalog and
 * the same scheduler state that Today's Session uses. Nothing here knows about
 * Firestore or React.
 */

/** Families that carry chord diagrams. Scale patterns are deliberately absent. */
export const DIAGRAM_FAMILIES: readonly FrettingFamily[] = [
  'caged_shape',
  'open_chord',
  'barre_chord',
  'power_chord',
];

export interface ShapeDiagram {
  rootString: number;
  rootFret: number;
  lowestFret: number;
  highestFret: number;
  fingers: FingerPosition[];
  mutedStrings: number[];
}

/** A fretting skill from one of the diagram families. */
export function isShapeSkill(
  definition: MicroSkillDefinition,
): definition is FrettingSkillDefinition {
  return (
    definition.category === 'fretting_shape' &&
    definition.family !== undefined &&
    DIAGRAM_FAMILIES.includes(definition.family)
  );
}

/** True when a definition carries enough metadata to draw. */
export function hasDiagram(definition: MicroSkillDefinition): boolean {
  return toDiagram(definition) !== null;
}

/**
 * Pulls diagram data out of a definition, or returns null when the skill is not
 * drawable. Every field the renderer needs is guaranteed non-optional here, so
 * the component has no defaults of its own to invent.
 */
export function toDiagram(definition: MicroSkillDefinition): ShapeDiagram | null {
  if (!isShapeSkill(definition)) return null;

  const { fingers, rootString, rootFret, lowestFret, highestFret, mutedStrings } =
    definition.metadata;

  if (!fingers || fingers.length === 0) return null;
  if (rootString === undefined || rootFret === undefined) return null;
  if (highestFret === undefined) return null;

  return {
    rootString,
    rootFret,
    lowestFret: lowestFret ?? 0,
    highestFret,
    fingers,
    mutedStrings: mutedStrings ?? [],
  };
}

const DIFFICULTY_ORDER = { beginner: 0, intermediate: 1, advanced: 2 } as const;

/**
 * Every drawable shape, easiest first, then catalog order so the list is stable
 * between renders.
 */
export function trainableShapes(
  catalog: readonly MicroSkillDefinition[],
): FrettingSkillDefinition[] {
  return catalog
    .map((definition, order) => ({ definition, order }))
    .filter(
      (entry): entry is { definition: FrettingSkillDefinition; order: number } =>
        entry.definition.active && isShapeSkill(entry.definition) && hasDiagram(entry.definition),
    )
    .sort(
      (a, b) =>
        DIFFICULTY_ORDER[a.definition.difficulty] - DIFFICULTY_ORDER[b.definition.difficulty] ||
        a.order - b.order,
    )
    .map((entry) => entry.definition);
}

/**
 * Picks what to work on next.
 *
 * Overdue material first, then anything never attempted, then whatever comes
 * round soonest — the same priority Today's Session uses, narrowed to shapes.
 * The current shape is skipped unless it is the only one available.
 */
export function nextShape(
  shapes: readonly FrettingSkillDefinition[],
  states: readonly SkillPracticeState[],
  now: Date,
  currentId?: string,
): FrettingSkillDefinition | null {
  if (shapes.length === 0) return null;

  const stateById = new Map(states.map((state) => [state.skillId, state]));
  const candidates = shapes.filter((shape) => shape.id !== currentId);
  const pool = candidates.length > 0 ? candidates : shapes;

  const ranked = pool.map((shape, order) => {
    const dueAt = stateById.get(shape.id)?.dueAt?.toDate() ?? null;

    // 0 = due now, 1 = never practised, 2 = scheduled for later.
    let tier: number;
    let key: number;

    if (dueAt === null) {
      tier = stateById.has(shape.id) ? 2 : 1;
      key = 0;
    } else if (dueAt.getTime() <= now.getTime()) {
      tier = 0;
      key = dueAt.getTime();
    } else {
      tier = 2;
      key = dueAt.getTime();
    }

    return { shape, tier, key, order };
  });

  ranked.sort((a, b) => a.tier - b.tier || a.key - b.key || a.order - b.order);

  return ranked[0]?.shape ?? null;
}

/** e.g. "CAGED · E shape · Major". */
export function describeShape(definition: FrettingSkillDefinition): string {
  const parts: string[] = [];

  if (definition.family) parts.push(FAMILY_LABELS[definition.family]);
  if (definition.metadata.shapeName) parts.push(`${definition.metadata.shapeName} shape`);

  const quality = definition.metadata.chordQuality;
  if (quality) parts.push(quality.charAt(0).toUpperCase() + quality.slice(1));

  return parts.join(' · ');
}

/**
 * Chord-chart notation, low E first: "x-3-2-0-1-0".
 *
 * A string sounds the highest fret pressed on it, since a note stopped above a
 * barre overrides the barre underneath.
 */
export function shapeToTab(diagram: ShapeDiagram): string {
  const muted = new Set(diagram.mutedStrings);

  return [6, 5, 4, 3, 2, 1]
    .map((string) => {
      if (muted.has(string)) return 'x';

      const frets = diagram.fingers.filter((f) => f.string === string).map((f) => f.fret);
      return String(frets.length > 0 ? Math.max(...frets) : 0);
    })
    .join('-');
}

/** Rep lengths, kept short on purpose — brief focused reps beat noodling. */
export const REP_DURATIONS_SECONDS = [20, 30, 40] as const;

export const DEFAULT_REP_SECONDS = 30;
