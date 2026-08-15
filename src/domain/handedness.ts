/**
 * Left-handed mode.
 *
 * Pure, and smaller than it sounds: a left-handed guitar is a right-handed one
 * reflected, so the only thing that changes anywhere in this app is *which side
 * of a diagram the low E is drawn on*.
 *
 * What deliberately does **not** change:
 *
 * - **String numbers.** The 6th string is the low E for everybody. Renumbering
 *   them would make every skill id, every drill instruction and every piece of
 *   practice history mean something different depending on a profile flag.
 * - **Fret numbers**, for the same reason.
 * - **Audio.** A microphone hears pitch; pitch has no handedness.
 *
 * So this file is one predicate and one coordinate flip, and the rest of the
 * app can stay ignorant of the whole subject.
 */

export type Handedness = 'right' | 'left';

export const DEFAULT_HANDEDNESS: Handedness = 'right';

export function isLeftHanded(handedness: Handedness | undefined): boolean {
  return handedness === 'left';
}

/**
 * Where a string sits across the neck, as a 0-based column.
 *
 * Right-handed charts put the low E (string 6) on the left; a left-handed chart
 * is the mirror image, so string 1 goes there instead. Everything downstream
 * multiplies this by the string spacing, which keeps the flip in one place.
 */
export function stringColumn(string: number, handedness: Handedness = DEFAULT_HANDEDNESS): number {
  const rightHandedColumn = 6 - string;
  return handedness === 'left' ? 5 - rightHandedColumn : rightHandedColumn;
}

/** How to describe the orientation, for the setting and for a screen reader. */
export function describeHandedness(handedness: Handedness): string {
  return handedness === 'left'
    ? 'Left-handed: diagrams are mirrored, with the low E on the right.'
    : 'Right-handed: diagrams have the low E on the left, as printed chord charts do.';
}
