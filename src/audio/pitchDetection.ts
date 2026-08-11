import { PitchDetector } from 'pitchy';

/**
 * The only module in the app that knows `pitchy` exists.
 *
 * pitchy implements McLeod Pitch Method — normalised square-difference plus
 * parabolic interpolation. It is a good fit here because it is monophonic,
 * allocation-free after construction, and cheap enough to run on the main
 * thread at tuner rates.
 *
 * Everything above this file sees `analyze(buffer) -> { frequency, clarity }`,
 * so swapping in an AudioWorklet-based detector later is a one-file change.
 */

export interface PitchReading {
  /** Detected pitch in Hz, or null when nothing usable was found. */
  frequency: number | null;
  /** Roughly 0–1. Near 1 means a strongly periodic, confident reading. */
  clarity: number;
}

export interface PitchDetectorOptions {
  /**
   * Readings below this clarity are discarded. 0.8–0.95 is the useful band;
   * lower lets noise through, higher drops the tail of a decaying note.
   */
  clarityThreshold?: number;
  /**
   * Frequency window, in Hz. Anything outside is treated as no reading, which
   * cheaply rejects both rumble and the octave-up errors MPM occasionally
   * makes on a bright pick attack.
   *
   * The defaults span a guitar in standard tuning down to drop-C (~65 Hz) and
   * up past the 24th fret on the high E (~1319 Hz).
   */
  minFrequency?: number;
  maxFrequency?: number;
  /** Below this input level the detector reports silence rather than guessing. */
  minVolumeDecibels?: number;
}

export interface PitchDetectorHandle {
  /** Exact buffer length this detector was built for. */
  readonly inputLength: number;
  /** Sample rate the readings are computed against. */
  readonly sampleRate: number;
  analyze(buffer: Float32Array): PitchReading;
}

const DEFAULTS = {
  clarityThreshold: 0.9,
  minFrequency: 65,
  maxFrequency: 1400,
  minVolumeDecibels: -50,
} as const;

const NO_PITCH: PitchReading = { frequency: null, clarity: 0 };

/**
 * Builds a detector bound to one buffer size and sample rate.
 *
 * Both are fixed for the life of an AudioContext, so binding them here keeps
 * internal buffers allocated once instead of per frame — which is what makes
 * this safe to call at 20+ Hz without producing garbage.
 */
export function createPitchDetector(
  inputLength: number,
  sampleRate: number,
  options: PitchDetectorOptions = {},
): PitchDetectorHandle {
  const clarityThreshold = options.clarityThreshold ?? DEFAULTS.clarityThreshold;
  const minFrequency = options.minFrequency ?? DEFAULTS.minFrequency;
  const maxFrequency = options.maxFrequency ?? DEFAULTS.maxFrequency;
  const minVolumeDecibels = options.minVolumeDecibels ?? DEFAULTS.minVolumeDecibels;

  const detector = PitchDetector.forFloat32Array(inputLength);
  detector.minVolumeDecibels = minVolumeDecibels;

  return {
    inputLength,
    sampleRate,

    analyze(buffer: Float32Array): PitchReading {
      const [frequency, clarity] = detector.findPitch(buffer, sampleRate);

      // pitchy returns [0, 0] when the input is too quiet to judge.
      if (frequency <= 0 || clarity < clarityThreshold) {
        return { frequency: null, clarity };
      }

      if (frequency < minFrequency || frequency > maxFrequency) {
        return { frequency: null, clarity };
      }

      return { frequency, clarity };
    },
  };
}

export { NO_PITCH };
