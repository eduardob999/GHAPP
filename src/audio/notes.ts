/**
 * Frequency to musical-note maths.
 *
 * Pure functions, no audio dependencies — this is the piece the drill and
 * scheduler work in later milestones will reuse for interval and chord logic.
 */

/** Concert pitch. Everything else is derived from this. */
export const A4_FREQUENCY = 440;

/** MIDI note number of A4, the anchor for the conversions below. */
const A4_MIDI = 69;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface NoteReading {
  /** Pitch class without the octave, e.g. "A" or "F#". */
  name: string;
  octave: number;
  /** Display label, e.g. "A3". */
  label: string;
  /** MIDI note number of the nearest semitone. */
  midi: number;
  /** Ideal frequency of that semitone, in Hz. */
  targetFrequency: number;
  /**
   * How far the input sits from that semitone, in cents (hundredths of a
   * semitone). Always within ±50 — beyond that a different note is nearer.
   * Negative is flat, positive is sharp.
   */
  cents: number;
}

export function frequencyToMidi(frequency: number): number {
  return A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY);
}

export function midiToFrequency(midi: number): number {
  return A4_FREQUENCY * 2 ** ((midi - A4_MIDI) / 12);
}

/**
 * Names the semitone nearest to a frequency and says how far off it is.
 *
 * Returns null for values that cannot be a pitch, so callers get one thing to
 * check rather than a note object full of NaN.
 */
export function frequencyToNote(frequency: number): NoteReading | null {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return null;
  }

  const exactMidi = frequencyToMidi(frequency);
  const midi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - midi) * 100);

  // The modulo keeps this in 0..11, so the fallback is unreachable — it exists
  // to satisfy noUncheckedIndexedAccess without an assertion.
  const pitchClass = ((midi % 12) + 12) % 12;
  const name = NOTE_NAMES[pitchClass] ?? 'C';

  // MIDI 60 is C4, so the octave boundary sits at each multiple of 12.
  const octave = Math.floor(midi / 12) - 1;

  return {
    name,
    octave,
    label: `${name}${octave}`,
    midi,
    targetFrequency: midiToFrequency(midi),
    cents,
  };
}

/**
 * Within how many cents counts as "in tune".
 *
 * Ten cents is roughly the point where a trained ear stops hearing beating
 * against a reference on guitar, and it is loose enough that normal string
 * wobble does not flicker the indicator.
 */
export const IN_TUNE_CENTS = 10;

export function isInTune(cents: number, tolerance = IN_TUNE_CENTS): boolean {
  return Math.abs(cents) <= tolerance;
}
