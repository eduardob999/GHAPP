import { createPitchDetector, type PitchDetectorHandle } from './pitchDetection';
import {
  DEFAULT_CHORD_CONFIG,
  detectChord,
  type ChordDetectionConfig,
  type ChordDetectionResult,
} from './chordDetection';

/**
 * The analysis loop, shared verbatim by the AudioWorklet and the main-thread
 * fallback.
 *
 * Everything here is plain arithmetic over typed arrays: no Web Audio, no DOM,
 * no React. That is what lets the exact same code run inside an
 * `AudioWorkletGlobalScope`, where none of those exist.
 *
 * Window sizes were chosen by measurement rather than taste. Chord accuracy on
 * the synthetic bench is identical at 8192 samples (~186 ms) and 16384
 * (~371 ms) — 13/13 clean and 39/39 under noise, zero wrong answers either way
 * — and falls apart at 4096, where a spectral bin is 10.8 Hz and a semitone at
 * the bottom of the guitar's range is only 4.9 Hz wide. 8192 is therefore the
 * shortest window that costs no accuracy, and halving the window halves the
 * dominant term in the perceived lag.
 */

/** Pitch window. 2048 is what the tuner has always used: ~46 ms at 44.1 kHz. */
export const PITCH_WINDOW_SAMPLES = 2048;

/** Chord window. See the note above — the shortest size that keeps accuracy. */
export const CHORD_WINDOW_SAMPLES = 8192;

export interface DspConfig {
  pitchEnabled: boolean;
  chordEnabled: boolean;
  /** Minimum gap between pitch analyses, in milliseconds. */
  pitchIntervalMs: number;
  /** Minimum gap between chord analyses, in milliseconds. */
  chordIntervalMs: number;
  chordMinClarity: number;
}

export const DEFAULT_DSP_CONFIG: DspConfig = {
  pitchEnabled: true,
  chordEnabled: false,
  // ~33 pitch readings a second: past the point where a tuner needle reads as
  // continuous, and cheap enough to be irrelevant.
  pitchIntervalMs: 30,
  // A new chord decision roughly eight times a second. Faster than this only
  // re-analyses samples we have already seen.
  chordIntervalMs: 120,
  chordMinClarity: DEFAULT_CHORD_CONFIG.minClarity,
};

export interface DspPitchFrame {
  frequency: number | null;
  clarity: number;
  rms: number;
}

export interface DspChordFrame {
  root: string | null;
  quality: string | null;
  confidence: number;
  noiseLevel: number;
  clarity: number;
}

export interface DspOnsetFrame {
  /** Analysis-thread time of the attack, in milliseconds. */
  atMs: number;
  /** How far the energy jumped above its recent baseline. */
  strength: number;
}

export interface DspFramePayload {
  /** Sample index at the end of the analysed window — a monotonic clock. */
  frameIndex: number;
  pitch?: DspPitchFrame;
  chord?: DspChordFrame;
  onset?: DspOnsetFrame;
}

/**
 * Attack detection by energy flux.
 *
 * A strum is a sudden rise in energy followed by a decay, so comparing the
 * current block against a slow-moving baseline finds the moment the pick lands.
 * This runs on every 128-sample quantum rather than on the analysis schedule,
 * which is the whole reason it is worth having: onsets need ~3 ms resolution to
 * grade timing, and the chord schedule only ticks eight times a second.
 *
 * Deliberately crude. Timing feedback wants "was that early or late", not a
 * musicological transcription, and a cheap detector on the audio thread beats
 * an accurate one that stalls it.
 */
class OnsetDetector {
  /** Rises must clear the baseline by this factor to count as an attack. */
  private static readonly RISE_RATIO = 1.8;
  /** Absolute floor, so room tone cannot trigger onsets. */
  private static readonly MIN_ENERGY = 0.008;
  /** Refractory period: a strum is one event, not six. */
  private static readonly HOLD_MS = 90;

  private baseline = 0;
  private lastOnsetMs = -Infinity;

  /** Returns onset strength when the block starts one, else null. */
  push(rms: number, nowMs: number): number | null {
    const previous = this.baseline;
    // Asymmetric smoothing: follow decays slowly so the baseline still
    // represents "before the attack" once a note is ringing.
    this.baseline = rms > previous ? previous * 0.7 + rms * 0.3 : previous * 0.95 + rms * 0.05;

    if (rms < OnsetDetector.MIN_ENERGY) return null;
    if (nowMs - this.lastOnsetMs < OnsetDetector.HOLD_MS) return null;
    if (previous > 0 && rms < previous * OnsetDetector.RISE_RATIO) return null;
    if (previous === 0 && rms < OnsetDetector.MIN_ENERGY * 2) return null;

    this.lastOnsetMs = nowMs;
    return previous > 0 ? rms / previous : rms;
  }
}

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const s = buffer[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * A fixed-capacity ring of recent samples.
 *
 * Allocated once. `process()` in a worklet runs every 128 samples — roughly 344
 * times a second — so allocating there would hand the garbage collector a
 * steady drip of work on the one thread that must never stall.
 */
class RingBuffer {
  private readonly data: Float32Array;
  private writeIndex = 0;
  private filled = 0;

  constructor(capacity: number) {
    this.data = new Float32Array(capacity);
  }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i += 1) {
      this.data[this.writeIndex] = samples[i] ?? 0;
      this.writeIndex = (this.writeIndex + 1) % this.data.length;
      if (this.filled < this.data.length) this.filled += 1;
    }
  }

  get ready(): boolean {
    return this.filled >= this.data.length;
  }

  /** Copies the most recent `out.length` samples, oldest first. */
  readInto(out: Float32Array): void {
    const n = out.length;
    const start = (this.writeIndex - n + this.data.length * 2) % this.data.length;
    for (let i = 0; i < n; i += 1) {
      out[i] = this.data[(start + i) % this.data.length] ?? 0;
    }
  }
}

export interface DspAnalyzer {
  /** Feed newly captured samples. Returns a frame when one is due. */
  push(samples: Float32Array, nowMs: number): DspFramePayload | null;
  setConfig(patch: Partial<DspConfig>): void;
  readonly config: DspConfig;
}

/**
 * Builds the analyzer for one sample rate.
 *
 * Pitch and chord run on independent schedules — a tuner wants many small
 * updates, a chord decision wants fewer and larger — and a single frame may
 * carry either, both, or neither.
 */
export function createDspAnalyzer(
  sampleRate: number,
  initial: Partial<DspConfig> = {},
): DspAnalyzer {
  let config: DspConfig = { ...DEFAULT_DSP_CONFIG, ...initial };

  const ring = new RingBuffer(CHORD_WINDOW_SAMPLES);
  const pitchWindow = new Float32Array(PITCH_WINDOW_SAMPLES);
  const chordWindow = new Float32Array(CHORD_WINDOW_SAMPLES);

  let pitchDetector: PitchDetectorHandle | null = null;
  let lastPitchAt = -Infinity;
  let lastChordAt = -Infinity;
  let frameIndex = 0;
  const onsets = new OnsetDetector();

  function chordConfig(): ChordDetectionConfig {
    return {
      ...DEFAULT_CHORD_CONFIG,
      // The window is already exactly the right length, so detectChord must not
      // trim it further.
      windowMs: (CHORD_WINDOW_SAMPLES / sampleRate) * 1000,
      minClarity: config.chordMinClarity,
    };
  }

  return {
    get config() {
      return config;
    },

    setConfig(patch: Partial<DspConfig>) {
      config = { ...config, ...patch };
    },

    push(samples: Float32Array, nowMs: number): DspFramePayload | null {
      ring.push(samples);
      frameIndex += samples.length;

      // Onsets are checked on every block, not on the analysis schedule — the
      // whole point is resolution the analysis cadence cannot give.
      const strength = onsets.push(computeRms(samples), nowMs);

      if (!ring.ready) {
        return strength === null
          ? null
          : { frameIndex, onset: { atMs: nowMs, strength } };
      }

      const wantPitch = config.pitchEnabled && nowMs - lastPitchAt >= config.pitchIntervalMs;
      const wantChord = config.chordEnabled && nowMs - lastChordAt >= config.chordIntervalMs;
      if (!wantPitch && !wantChord && strength === null) return null;

      const payload: DspFramePayload = { frameIndex };
      if (strength !== null) payload.onset = { atMs: nowMs, strength };

      if (wantPitch) {
        lastPitchAt = nowMs;
        ring.readInto(chordWindow);
        pitchWindow.set(
          chordWindow.subarray(CHORD_WINDOW_SAMPLES - PITCH_WINDOW_SAMPLES),
        );

        pitchDetector ??= createPitchDetector(PITCH_WINDOW_SAMPLES, sampleRate);
        const reading = pitchDetector.analyze(pitchWindow);
        payload.pitch = {
          frequency: reading.frequency,
          clarity: reading.clarity,
          rms: computeRms(pitchWindow),
        };
      }

      if (wantChord) {
        lastChordAt = nowMs;
        if (!wantPitch) ring.readInto(chordWindow);

        const result: ChordDetectionResult = detectChord(chordWindow, sampleRate, chordConfig());
        payload.chord = {
          root: result.chord?.root ?? null,
          quality: result.chord?.quality ?? null,
          confidence: result.chord?.confidence ?? 0,
          noiseLevel: result.noiseLevel,
          clarity: result.clarity,
        };
      }

      return payload;
    },
  };
}
