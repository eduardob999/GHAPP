import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioEngineError,
  createAudioEngine,
  type AudioEngine,
  type PitchSample,
} from '../audio/audioEngine';
import { frequencyToNote, type NoteReading } from '../audio/notes';

/**
 * React binding for the audio engine.
 *
 * Owns three things the engine deliberately does not: the smoothing that makes
 * a plucked string readable, the hold that stops the display blanking between
 * notes, and the render throttling that keeps a 25 Hz sample stream from
 * re-rendering on every identical frame.
 */

export interface TunerState {
  isRunning: boolean;
  /** True between the click and the microphone actually opening. */
  isStarting: boolean;
  error: AudioEngineError | null;
  /** Smoothed pitch in Hz, or null when nothing is being played. */
  frequency: number | null;
  /** Detector confidence, 0–1. */
  clarity: number;
  /** RMS input level, 0–1, for the level meter. */
  level: number;
  note: NoteReading | null;
  /** Convenience for display, e.g. "A3". Null when no pitch is detected. */
  noteName: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * A plucked string is not perfectly steady: the attack transient and the first
 * few cycles of a bend can each produce a stray reading, often an octave out.
 * The median of the last few samples rejects those outright, where a mean would
 * average them in.
 */
const SMOOTHING_WINDOW = 5;

/**
 * How long a reading survives after the sound stops. Long enough to see what
 * you just played, short enough that it does not look stuck.
 */
const HOLD_MS = 600;

interface Reading {
  frequency: number | null;
  clarity: number;
  level: number;
}

const SILENT: Reading = { frequency: null, clarity: 0, level: 0 };

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const low = sorted[middle - 1];
  const high = sorted[middle];
  return low !== undefined && high !== undefined ? (low + high) / 2 : null;
}

export function usePitchDetector(): TunerState {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<AudioEngineError | null>(null);
  const [reading, setReading] = useState<Reading>(SILENT);

  const engineRef = useRef<AudioEngine | null>(null);
  const historyRef = useRef<number[]>([]);
  const lastPitchAtRef = useRef(0);

  const handleSample = useCallback((sample: PitchSample) => {
    if (sample.frequency !== null) {
      historyRef.current.push(sample.frequency);
      if (historyRef.current.length > SMOOTHING_WINDOW) {
        historyRef.current.shift();
      }
      lastPitchAtRef.current = sample.timestamp;
    } else if (sample.timestamp - lastPitchAtRef.current > HOLD_MS) {
      historyRef.current = [];
    }

    const smoothed = median(historyRef.current);

    // Rounded to display precision so that an unchanged reading produces an
    // identical object and React can bail out of the re-render.
    const next: Reading = {
      frequency: smoothed === null ? null : Math.round(smoothed * 10) / 10,
      clarity: Math.round(sample.clarity * 100) / 100,
      level: Math.round(sample.rms * 1000) / 1000,
    };

    setReading((previous) =>
      previous.frequency === next.frequency &&
      previous.clarity === next.clarity &&
      previous.level === next.level
        ? previous
        : next,
    );
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    historyRef.current = [];
    lastPitchAtRef.current = 0;
    setIsRunning(false);
    setIsStarting(false);
    setReading(SILENT);
  }, []);

  const start = useCallback(() => {
    if (engineRef.current) {
      return;
    }

    setError(null);
    setIsStarting(true);

    const engine = createAudioEngine({
      onDeviceLost: (deviceError) => {
        setError(deviceError);
        stop();
      },
    });
    engineRef.current = engine;
    engine.subscribe(handleSample);

    // Kicked off rather than awaited: this runs from a click handler, and the
    // permission prompt can sit open for as long as the user likes.
    engine.start().then(
      () => {
        setIsStarting(false);
        setIsRunning(true);
      },
      (startError: unknown) => {
        const audioError =
          startError instanceof AudioEngineError
            ? startError
            : new AudioEngineError('unknown', 'Could not start the microphone.', startError);

        console.error('[audio] Tuner failed to start.', audioError);
        engineRef.current = null;
        setError(audioError);
        setIsStarting(false);
        setIsRunning(false);
      },
    );
  }, [handleSample, stop]);

  // Releasing the microphone when the panel goes away matters more than usual:
  // a stray stream leaves the browser's recording indicator lit.
  useEffect(() => stop, [stop]);

  const note = reading.frequency === null ? null : frequencyToNote(reading.frequency);

  return {
    isRunning,
    isStarting,
    error,
    frequency: reading.frequency,
    clarity: reading.clarity,
    level: reading.level,
    note,
    noteName: note?.label ?? null,
    start,
    stop,
  };
}
