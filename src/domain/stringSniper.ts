import { frequencyToMidi, midiToFrequency, frequencyToNote } from '../audio/notes';

/**
 * String Sniper: picking-accuracy drill logic.
 *
 * **What this can and cannot know.** A microphone hears pitch, not geometry.
 * The same note exists in several places on a guitar — A2 is the open 5th
 * string *and* the 5th fret of the 6th string — so no pitch detector can tell
 * you which string your pick actually struck. What this module checks is
 * whether the note you produced is *reachable on the target string within the
 * allowed frets*. On a narrow range (an open string) that is a tight, useful
 * test. On "any fret" it is a loose one, and `overlappingStrings` exists so the
 * UI can say so rather than implying more precision than there is.
 *
 * Pure and deterministic, so the decision boundaries can be tested directly.
 */

/** 1 is the high E, 6 is the low E — standard guitar numbering. */
export type GuitarStringIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface FretRange {
  min: number;
  max: number;
}

export interface StringSniperConfig {
  targetString: GuitarStringIndex;
  /** Omitted or null means any fret on that string. */
  allowedFrets?: FretRange | null;
  /** How far from an allowed note still counts as a hit. */
  toleranceCents?: number;
}

export type SniperHitResult = 'hit' | 'wrong_string' | 'off_pitch' | 'no_signal';

export const ALL_STRINGS: readonly GuitarStringIndex[] = [6, 5, 4, 3, 2, 1];

/** Standard tuning: E2 A2 D3 G3 B3 E4. */
export const OPEN_STRING_MIDI: Record<GuitarStringIndex, number> = {
  6: 40, // E2
  5: 45, // A2
  4: 50, // D3
  3: 55, // G3
  2: 59, // B3
  1: 64, // E4
};

export const STRING_LABELS: Record<GuitarStringIndex, string> = {
  6: 'Low E',
  5: 'A',
  4: 'D',
  3: 'G',
  2: 'B',
  1: 'High E',
};

/** Practical top of the neck for "any fret". */
export const HIGHEST_FRET = 20;

/**
 * Half a semitone. Inside a multi-fret range this effectively means "any fret
 * in range counts"; on a single-fret range it is a real intonation window.
 */
export const DEFAULT_TOLERANCE_CENTS = 50;

/**
 * How far outside the allowed range still reads as "right string, wrong note"
 * rather than "wrong string". Two semitones covers the usual off-by-one-fret
 * slip without swallowing a genuinely different string.
 */
export const NEAR_MISS_SEMITONES = 2;

/**
 * Confidence floor. The detector in `pitchDetection.ts` already discards
 * anything below its own threshold, so this mainly guards against a caller
 * passing a raw, ungated reading.
 */
export const SNIPER_MIN_CLARITY = 0.85;

export interface DetectedPitch {
  frequency: number | null;
  clarity: number;
  noteName?: string;
  cents?: number;
}

export interface SniperEvaluation {
  result: SniperHitResult;
  /** Fractional MIDI number of what was heard. */
  detectedMidi: number | null;
  /** Nearest note that would have counted, clamped into the allowed range. */
  nearestTargetMidi: number | null;
  /** Signed distance to that note. Negative is flat, positive is sharp. */
  centsFromTarget: number | null;
}

const NO_SIGNAL: SniperEvaluation = {
  result: 'no_signal',
  detectedMidi: null,
  nearestTargetMidi: null,
  centsFromTarget: null,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Normalises a possibly-reversed or missing fret range. */
export function fretRangeFor(config: StringSniperConfig): FretRange {
  const frets = config.allowedFrets ?? { min: 0, max: HIGHEST_FRET };
  return {
    min: Math.max(0, Math.min(frets.min, frets.max)),
    max: Math.max(0, Math.max(frets.min, frets.max)),
  };
}

/** MIDI band reachable on the target string within the allowed frets. */
export function midiRangeFor(config: StringSniperConfig): { lo: number; hi: number } {
  const open = OPEN_STRING_MIDI[config.targetString];
  const frets = fretRangeFor(config);
  return { lo: open + frets.min, hi: open + frets.max };
}

/** The same band in Hz, for display. */
export function frequencyRangeFor(config: StringSniperConfig): { lo: number; hi: number } {
  const { lo, hi } = midiRangeFor(config);
  return { lo: midiToFrequency(lo), hi: midiToFrequency(hi) };
}

/**
 * Other strings that can produce a pitch inside the target band.
 *
 * Non-empty means a hit does not prove the right string was plucked. Open low E
 * returns nothing — no other string reaches that low. Open G returns strings 4,
 * 5 and 6, all of which can sound a G3 further up the neck.
 */
export function overlappingStrings(config: StringSniperConfig): GuitarStringIndex[] {
  const { lo, hi } = midiRangeFor(config);

  return ALL_STRINGS.filter((string) => {
    if (string === config.targetString) return false;
    const open = OPEN_STRING_MIDI[string];
    return open <= hi && open + HIGHEST_FRET >= lo;
  });
}

/**
 * Grades one detected pitch against the target.
 *
 * The nearest acceptable note is found by rounding to the closest semitone and
 * then clamping into the allowed band — clamping rather than free rounding is
 * what makes a single-fret target (an open string) a genuine intonation test
 * instead of trivially snapping to whatever was played.
 */
export function evaluateSniperFrame(
  config: StringSniperConfig,
  detected: DetectedPitch,
): SniperEvaluation {
  const { frequency, clarity } = detected;

  if (
    frequency === null ||
    !Number.isFinite(frequency) ||
    frequency <= 0 ||
    clarity < SNIPER_MIN_CLARITY
  ) {
    return NO_SIGNAL;
  }

  const tolerance = config.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const detectedMidi = frequencyToMidi(frequency);
  const { lo, hi } = midiRangeFor(config);

  const roundedMidi = Math.round(detectedMidi);
  const nearestTargetMidi = clamp(roundedMidi, lo, hi);
  const centsFromTarget = Math.round((detectedMidi - nearestTargetMidi) * 100);

  if (Math.abs(centsFromTarget) <= tolerance) {
    return { result: 'hit', detectedMidi, nearestTargetMidi, centsFromTarget };
  }

  // Compared on the rounded semitone, not the raw float. Rounding first puts the
  // boundary halfway between two notes instead of exactly on one, where
  // floating-point noise out of frequencyToMidi would otherwise decide the
  // verdict: a pitch landing on 42.0000000001 must not read as further away
  // than one landing on 41.9999999999.
  const withinReach =
    roundedMidi >= lo - NEAR_MISS_SEMITONES && roundedMidi <= hi + NEAR_MISS_SEMITONES;

  return {
    result: withinReach ? 'off_pitch' : 'wrong_string',
    detectedMidi,
    nearestTargetMidi,
    centsFromTarget,
  };
}

/** Spec-shaped convenience wrapper around {@link evaluateSniperFrame}. */
export function evaluateHit(
  target: StringSniperConfig,
  detected: DetectedPitch,
): SniperHitResult {
  return evaluateSniperFrame(target, detected).result;
}

export interface FretPreset {
  id: string;
  label: string;
  range: FretRange | null;
}

export const FRET_PRESETS: readonly FretPreset[] = [
  { id: 'open', label: 'Open string only', range: { min: 0, max: 0 } },
  { id: 'frets-1-5', label: 'Frets 1–5', range: { min: 1, max: 5 } },
  { id: 'frets-5-9', label: 'Frets 5–9', range: { min: 5, max: 9 } },
  { id: 'any', label: 'Any fret', range: null },
];

export function describeFretRange(config: StringSniperConfig): string {
  if (!config.allowedFrets) return 'any fret';

  const { min, max } = fretRangeFor(config);
  if (min === 0 && max === 0) return 'open string';
  if (min === max) return `fret ${min}`;
  return `frets ${min}–${max}`;
}

/** e.g. "String 6 (Low E), open string". */
export function describeConfig(config: StringSniperConfig): string {
  const label = STRING_LABELS[config.targetString];
  return `String ${config.targetString} (${label}), ${describeFretRange(config)}`;
}

/** The note a target band starts on, for showing the user what to aim at. */
export function targetNoteLabel(config: StringSniperConfig): string {
  const { lo, hi } = midiRangeFor(config);
  const low = frequencyToNote(midiToFrequency(lo));
  const high = frequencyToNote(midiToFrequency(hi));

  if (!low || !high) return '—';
  return lo === hi ? low.label : `${low.label}–${high.label}`;
}
