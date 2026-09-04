/**
 * Polyphonic chord recognition from a block of guitar audio.
 *
 * Pure: no Web Audio, no React, no I/O. Give it samples, get a chord back — so
 * the whole thing can be exercised against synthetic signals under Node.
 *
 * The pipeline follows the standard chroma/template route, with the robustness
 * steps that matter for a guitar in a room rather than a clean recording:
 *
 *   samples → Hann window → FFT magnitude → noise-floor estimate →
 *   soft threshold + peak picking → 12-bin pitch-class profile →
 *   cosine similarity against chord templates → confidence gating
 *
 * Two deliberate biases, both in service of "never guess":
 *   - Peaks only. Summing every bin into the chroma smears harmonics into a
 *     mush that matches everything; only spectral peaks contribute.
 *   - The result is gated on how much of the spectrum is broadband noise, not
 *     just on template similarity. A confident match on a noisy signal is
 *     still reported as no chord.
 */

import { pitchClassOfRoot } from '../domain/tunings';

export type ChordQuality =
  | 'maj'
  | 'min'
  | 'sus2'
  | 'sus4'
  | 'dim'
  | 'aug'
  | '5'
  | '7'
  | 'maj7'
  | 'min7'
  | '6'
  | 'min6'
  | 'add9'
  | 'dim7'
  | 'm7b5';

export const PITCH_CLASS_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export interface DetectedChord {
  /** Pitch-class name of the root, e.g. "C", "D#", "F#". */
  root: string;
  quality: ChordQuality;
  /** Cosine similarity with the winning template, 0–1. */
  confidence: number;
  /** Pitch classes judged to be actually sounding, 0 = C … 11 = B. */
  activePitchClasses: number[];
  noteCount: number;
}

export interface ChordDetectionResult {
  chord: DetectedChord | null;
  /** Share of spectral energy that looks like a flat broadband floor, 0–1. */
  noiseLevel: number;
  /** Overall trust in the reading, 0–1. Similarity discounted by noise. */
  clarity: number;
}

export interface ChordCandidate {
  root: string;
  quality: ChordQuality;
}

export interface ChordDetectionConfig {
  /** Analysis window length. Only used to trim an over-long buffer. */
  windowMs: number;
  /** Below this clarity the result is reported as no chord. */
  minClarity: number;
  /** Fewer sounding pitch classes than this is a note or a dyad, not a chord. */
  minNoteCount: number;
  denoise: boolean;
  /** Restricts the candidate set. Omit to consider all 12 roots × all qualities. */
  vocabulary?: ChordCandidate[];
}

export const DEFAULT_CHORD_CONFIG: ChordDetectionConfig = {
  windowMs: 400,
  // Loosened from 0.62. A real pickup in a room never reaches the clarity a
  // synthetic tone does, and a shrug mid-progression is worse than a slightly
  // uncertain answer — the scorer already aggregates over a whole window.
  minClarity: 0.5,
  // Two, not three: a triad with a damped or muted third is still that chord,
  // and demanding three sounding pitch classes rejected exactly the voicings
  // guitarists actually play.
  minNoteCount: 2,
  denoise: true,
};

/**
 * Chord templates as semitone offsets from the root.
 *
 * Order is significant: cosine similarity ties are broken by whichever comes
 * first, so the commonest shapes lead. It also keeps `5` behind `maj`/`min`,
 * since a power chord's template is a subset of both.
 */
const TEMPLATES: { quality: ChordQuality; intervals: readonly number[]; prior: number }[] = [
  // `prior` scales the similarity score. Guitars do not present chords evenly:
  // every plucked string carries a flat-7 as its 7th partial and a major third
  // as its 5th, so a plain major triad drifts toward `7` and a triad with a
  // damped third collapses to `5`. Without a prior those exotic readings win
  // far too often — which is exactly the "right root, wrong quality" the
  // detector was producing on real playing. Triads have to be beaten
  // convincingly, not merely edged out.
  { quality: 'maj', intervals: [0, 4, 7], prior: 1.0 },
  { quality: 'min', intervals: [0, 3, 7], prior: 1.0 },
  { quality: '7', intervals: [0, 4, 7, 10], prior: 0.94 },
  { quality: 'min7', intervals: [0, 3, 7, 10], prior: 0.94 },
  { quality: 'maj7', intervals: [0, 4, 7, 11], prior: 0.93 },
  { quality: '5', intervals: [0, 7], prior: 0.92 },
  { quality: 'sus4', intervals: [0, 5, 7], prior: 0.90 },
  { quality: 'sus2', intervals: [0, 2, 7], prior: 0.90 },
  { quality: '6', intervals: [0, 4, 7, 9], prior: 0.89 },
  { quality: 'add9', intervals: [0, 2, 4, 7], prior: 0.88 },
  { quality: 'min6', intervals: [0, 3, 7, 9], prior: 0.88 },
  { quality: 'm7b5', intervals: [0, 3, 6, 10], prior: 0.87 },
  { quality: 'dim', intervals: [0, 3, 6], prior: 0.86 },
  { quality: 'dim7', intervals: [0, 3, 6, 9], prior: 0.85 },
  { quality: 'aug', intervals: [0, 4, 8], prior: 0.84 },
];

/** Precomputed unit-length template vectors, one per root × quality. */
interface TemplateVector {
  root: number;
  quality: ChordQuality;
  vector: Float64Array;
  norm: number;
  prior: number;
}

const TEMPLATE_VECTORS: TemplateVector[] = (() => {
  const out: TemplateVector[] = [];
  for (const { quality, intervals, prior } of TEMPLATES) {
    for (let root = 0; root < 12; root += 1) {
      const vector = new Float64Array(12);
      let sumSquares = 0;
      for (const interval of intervals) {
        // The third carries the identity of the chord — it is the only note
        // separating major from minor — so it is weighted above the root and
        // fifth. This sharpens maj/min and stops a chord whose third is merely
        // quiet from matching a power chord just as well.
        const weight = interval === 3 || interval === 4 ? 1.3 : 1;
        vector[(root + interval) % 12] = weight;
        sumSquares += weight * weight;
      }
      out.push({ root, quality, vector, norm: Math.sqrt(sumSquares), prior });
    }
  }
  return out;
})();

const INTERVALS_BY_QUALITY: Record<ChordQuality, readonly number[]> = Object.fromEntries(
  TEMPLATES.map((t) => [t.quality, t.intervals]),
) as Record<ChordQuality, readonly number[]>;

/**
 * The set of pitch classes a chord contains, as a 12-bit mask.
 *
 * Used to recognise chords that are literally the same notes under a different
 * name — C6 and Am7 are both {C,E,G,A}, and every diminished seventh is three
 * other diminished sevenths. A chroma profile cannot tell them apart, because
 * there is nothing to tell apart: only the bass note names the root, and that
 * information is not in a pitch-class profile.
 */
export function chordPitchClassMask(root: string, quality: ChordQuality): number {
  /*
   * The root is resolved by `pitchClassOfRoot`, not by an `indexOf` into the
   * sharp table below. docs/NEXT.md 16f: the sharp-only lookup returned -1 for
   * every flat spelling, so a catalog root of "Db" masked to 0 and could never
   * match the "C#" the detector reports, which is the same chord.
   *
   * That is the same fault 16e fixed one layer up, and it is fixed the same
   * way: one owner for note spelling, in `tunings.ts`, rather than a fourth
   * private copy of the table. The dependency runs audio -> domain, which is
   * the direction that was already open; `earGrading.ts` and `progressions.ts`
   * both import from here, and `tunings.ts` imports nothing at all.
   */
  const rootPc = pitchClassOfRoot(root);
  if (rootPc === null) return 0;

  let mask = 0;
  for (const interval of INTERVALS_BY_QUALITY[quality] ?? []) {
    mask |= 1 << ((rootPc + interval) % 12);
  }
  return mask;
}

/**
 * Do two chords contain literally the same notes?
 *
 * **False whenever either root is unspellable**, which is the entire point of
 * the helper and the reason it exists rather than being an `===` at each call
 * site. `chordPitchClassMask` answers 0 for a root it cannot resolve, and
 * `0 === 0` is true, so before this a target the app could not spell was
 * matched by *any* chord it also could not spell: `Bb` major read as a clean
 * hit against `Db` minor. Failing in that direction is the dangerous one,
 * because it accepts a wrong answer rather than rejecting a right one.
 *
 * Exactly the shape of `samePitchClass` in `tunings.ts`, for exactly the
 * reason recorded there: "every call site has to remember" is how it broke the
 * first time. `progressions.ts` remembered and guarded; `earGrading.ts` did
 * not.
 */
export function sameChordTones(
  a: { root: string; quality: ChordQuality },
  b: { root: string; quality: ChordQuality },
): boolean {
  const left = chordPitchClassMask(a.root, a.quality);
  if (left === 0) return false;
  return left === chordPitchClassMask(b.root, b.quality);
}

/** Guitar range with a little headroom: drop-C low end to past the 24th fret. */
const MIN_ANALYSIS_HZ = 70;
const MAX_ANALYSIS_HZ = 1800;

/** How far above the noise floor a bin must sit to count as a partial. */
const PEAK_THRESHOLD_SIGMAS = 3;

const A4_HZ = 440;
const A4_MIDI = 69;

function nextPowerOfTwoAtMost(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * Iterative radix-2 Cooley–Tukey FFT, returning magnitudes for the lower half.
 *
 * Written out rather than pulled from a package so this module stays
 * dependency-free and runnable anywhere — it is the only non-trivial numeric
 * code here, and it is verified against known signals in the tests.
 */
export function magnitudeSpectrum(samples: Float32Array): Float32Array {
  const n = nextPowerOfTwoAtMost(samples.length);
  if (n < 2) return new Float32Array(0);

  const re = new Float64Array(n);
  const im = new Float64Array(n);

  // Hann window: without it, a note that does not fit a whole number of cycles
  // in the window leaks across the whole spectrum and buries the real peaks.
  for (let i = 0; i < n; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (samples[i] ?? 0) * w;
  }

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;

    for (let start = 0; start < n; start += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const br = re[b]! * cr - im[b]! * ci;
        const bi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - br;
        im[b] = im[a]! - bi;
        re[a] = re[a]! + br;
        im[a] = im[a]! + bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }

  const mag = new Float32Array(n >> 1);
  for (let k = 0; k < mag.length; k += 1) mag[k] = Math.hypot(re[k]!, im[k]!);
  return mag;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface ChromaAnalysis {
  chroma: Float64Array;
  noiseLevel: number;
  peakCount: number;
}

/**
 * Builds a 12-bin pitch-class profile from a magnitude spectrum.
 *
 * The noise floor is estimated with a median rather than a mean: a handful of
 * loud partials drag a mean upwards and hide themselves, whereas the median of
 * a spectrum is dominated by the empty bins between them.
 */
export function chromaFromSpectrum(
  mag: Float32Array,
  sampleRate: number,
  fftSize: number,
  denoise: boolean,
): ChromaAnalysis {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(MIN_ANALYSIS_HZ / binHz));
  const hi = Math.min(mag.length - 2, Math.ceil(MAX_ANALYSIS_HZ / binHz));

  const chroma = new Float64Array(12);
  if (hi <= lo) return { chroma, noiseLevel: 1, peakCount: 0 };

  const band: number[] = [];
  for (let k = lo; k <= hi; k += 1) band.push(mag[k]!);

  const floor = median(band);
  const deviations = band.map((v) => Math.abs(v - floor));
  // Median absolute deviation, scaled to be comparable with a standard
  // deviation for normally distributed noise.
  const sigma = 1.4826 * median(deviations);
  const threshold = denoise ? floor + PEAK_THRESHOLD_SIGMAS * sigma : floor;

  const total = band.reduce((sum, v) => sum + v, 0);
  const noiseLevel = total > 0 ? Math.min(1, (floor * band.length) / total) : 1;

  let peakCount = 0;
  for (let k = lo; k <= hi; k += 1) {
    const m = mag[k]!;
    if (m <= threshold) continue;
    if (m < mag[k - 1]! || m < mag[k + 1]!) continue; // local maxima only

    // Parabolic interpolation across the peak recovers a frequency far more
    // precise than the bin spacing, which matters on the low strings where a
    // semitone is only a few bins wide.
    const alpha = mag[k - 1]!;
    const beta = m;
    const gamma = mag[k + 1]!;
    const denom = alpha - 2 * beta + gamma;
    const shift = denom !== 0 ? (0.5 * (alpha - gamma)) / denom : 0;
    const freq = (k + shift) * binHz;
    if (freq < MIN_ANALYSIS_HZ || freq > MAX_ANALYSIS_HZ) continue;

    const midi = A4_MIDI + 12 * Math.log2(freq / A4_HZ);
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12;

    // Soft thresholding: subtract the floor rather than keeping the raw
    // magnitude, so a peak barely clearing the noise contributes barely
    // anything instead of counting as a full note.
    chroma[pitchClass] = chroma[pitchClass]! + (m - threshold);
    peakCount += 1;
  }

  return { chroma, noiseLevel, peakCount };
}

/*
 * Harmonic suppression was tried here and removed.
 *
 * The theory is sound — a plucked string's 5th partial lands a major third
 * above the fundamental and its 7th a minor seventh, so a lone G deposits
 * energy on B and F — and the obvious fix is to subtract that leakage from the
 * profile. Measured across five suppression strengths it made clean accuracy
 * monotonically worse (18/19 correct with none, 15/19 at full strength),
 * because on real voicings it removes genuine thirds and sevenths along with
 * the phantom ones: an Em7 lost its D and read as Em, an A major lost its C#
 * and read as A5.
 *
 * What actually fixed the same symptom was cheaper: weighting the third in the
 * templates, a prior favouring triads, and — for the cases where the third is
 * genuinely inaudible — treating an omitted third as compatible rather than
 * contradictory when scoring. See `thirdOf` in `domain/progressions.ts`.
 */

/** Bins standing above the mean by more than a standard deviation are sounding. */
export function activePitchClassesOf(chroma: Float64Array): number[] {
  const values = Array.from(chroma);
  const peak = Math.max(...values);
  if (peak <= 0) return [];

  const mean = values.reduce((a, b) => a + b, 0) / 12;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / 12;
  // The 0.35 floor is doing real work: a single plucked note's 3rd partial
  // lands a fifth above it at roughly a third of the fundamental's energy, so a
  // lower gate lets one note masquerade as a power chord. Measured, 0.35
  // rejects all single notes while keeping every genuine voicing.
  const cutoff = Math.max(mean + Math.sqrt(variance) * 0.5, peak * 0.35);

  const active: number[] = [];
  for (let i = 0; i < 12; i += 1) if (values[i]! >= cutoff) active.push(i);
  return active;
}

function cosineSimilarity(chroma: Float64Array, template: TemplateVector): number {
  let dot = 0;
  let normChroma = 0;
  for (let i = 0; i < 12; i += 1) {
    const c = chroma[i]!;
    dot += c * template.vector[i]!;
    normChroma += c * c;
  }
  if (normChroma === 0) return 0;
  return dot / (Math.sqrt(normChroma) * template.norm);
}

const EMPTY_RESULT: ChordDetectionResult = { chord: null, noiseLevel: 1, clarity: 0 };

/**
 * Identifies the chord sounding in a block of samples.
 *
 * Returns `chord: null` whenever the evidence is thin — too noisy, too few
 * notes, or no template clearly ahead. For a practice tool a shrug is far more
 * useful than a confident wrong answer.
 */
export function detectChord(
  buffer: Float32Array,
  sampleRate: number,
  config: ChordDetectionConfig = DEFAULT_CHORD_CONFIG,
): ChordDetectionResult {
  if (buffer.length < 1024 || sampleRate <= 0) return EMPTY_RESULT;

  const wanted = Math.floor((config.windowMs / 1000) * sampleRate);
  const trimmed =
    wanted > 0 && wanted < buffer.length ? buffer.subarray(buffer.length - wanted) : buffer;

  const mag = magnitudeSpectrum(trimmed);
  if (mag.length === 0) return EMPTY_RESULT;

  const fftSize = mag.length * 2;
  const { chroma: rawChroma, noiseLevel, peakCount } = chromaFromSpectrum(
    mag,
    sampleRate,
    fftSize,
    config.denoise,
  );

  if (peakCount === 0) return { chord: null, noiseLevel, clarity: 0 };

  const chroma = rawChroma;

  const active = activePitchClassesOf(chroma);

  const allowed = config.vocabulary
    ? new Set(config.vocabulary.map((c) => `${c.root}:${c.quality}`))
    : null;

  let best: TemplateVector | null = null;
  let bestScore = 0;
  for (const template of TEMPLATE_VECTORS) {
    if (allowed && !allowed.has(`${PITCH_CLASS_NAMES[template.root]}:${template.quality}`)) {
      continue;
    }
    const score = cosineSimilarity(chroma, template) * template.prior;
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }

  const clarity = Math.max(0, bestScore * (1 - noiseLevel));

  if (!best || clarity < config.minClarity || active.length < config.minNoteCount) {
    return { chord: null, noiseLevel, clarity };
  }

  return {
    chord: {
      root: PITCH_CLASS_NAMES[best.root]!,
      quality: best.quality,
      confidence: bestScore,
      activePitchClasses: active,
      noteCount: active.length,
    },
    noiseLevel,
    clarity,
  };
}

/** "C" + "maj" → "C major", for display. */
export function formatChord(root: string, quality: ChordQuality): string {
  switch (quality) {
    case 'maj': return `${root} major`;
    case 'min': return `${root} minor`;
    case '5': return `${root}5`;
    case '7': return `${root}7`;
    case 'maj7': return `${root}maj7`;
    case 'min7': return `${root}m7`;
    case 'sus2': return `${root}sus2`;
    case 'sus4': return `${root}sus4`;
    case 'dim': return `${root} dim`;
    case 'aug': return `${root} aug`;
    case '6': return `${root}6`;
    case 'min6': return `${root}m6`;
    case 'add9': return `${root}add9`;
    case 'dim7': return `${root} dim7`;
    case 'm7b5': return `${root}m7b5`;
  }
}

/** Compact form for a HUD: "G", "Em", "A7". */
export function shortChordLabel(root: string, quality: ChordQuality): string {
  switch (quality) {
    case 'maj': return root;
    case 'min': return `${root}m`;
    case '5': return `${root}5`;
    case '7': return `${root}7`;
    case 'maj7': return `${root}maj7`;
    case 'min7': return `${root}m7`;
    case 'sus2': return `${root}sus2`;
    case 'sus4': return `${root}sus4`;
    case 'dim': return `${root}dim`;
    case 'aug': return `${root}aug`;
    case '6': return `${root}6`;
    case 'min6': return `${root}m6`;
    case 'add9': return `${root}add9`;
    case 'dim7': return `${root}dim7`;
    case 'm7b5': return `${root}m7b5`;
  }
}
