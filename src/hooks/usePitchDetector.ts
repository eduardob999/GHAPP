import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngineError } from '../audio/audioEngine';
import { createDspEngine, type DspEngine, type DspFrame } from '../audio/dspEngine';
import { frequencyToNote, type NoteReading } from '../audio/notes';

/**
 * React binding for pitch, on top of the shared DSP engine.
 *
 * Public shape is unchanged from Task 2 — TunerPanel needs no edits — but the
 * analysis now runs on the audio thread and arrives roughly every 30 ms rather
 * than on a `requestAnimationFrame` tick that competes with React.
 *
 * The smoothing window shrank with it. A 5-sample median at the old ~40 ms
 * cadence added about 200 ms of lag before a reading settled; 5 samples at
 * 30 ms is nearer 150 ms, and because the cadence no longer stutters under
 * main-thread load the filter has less jitter to absorb in the first place.
 */

export interface TunerState {
  isRunning: boolean;
  isStarting: boolean;
  error: AudioEngineError | null;
  frequency: number | null;
  clarity: number;
  level: number;
  note: NoteReading | null;
  noteName: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * A pick attack throws one octave-up outlier before the note settles; a median
 * discards it where a mean would fold it in.
 */
const SMOOTHING_WINDOW = 5;

/** How long a reading survives after the string stops sounding. */
const HOLD_MS = 500;

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
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  return low !== undefined && high !== undefined ? (low + high) / 2 : null;
}

export function usePitchDetector(): TunerState {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<AudioEngineError | null>(null);
  const [reading, setReading] = useState<Reading>(SILENT);

  const engineRef = useRef<DspEngine | null>(null);
  const historyRef = useRef<number[]>([]);
  const lastPitchAtRef = useRef(0);

  const handleFrame = useCallback((frame: DspFrame) => {
    const pitch = frame.pitch;
    if (!pitch) return;

    if (pitch.frequency !== null) {
      historyRef.current.push(pitch.frequency);
      if (historyRef.current.length > SMOOTHING_WINDOW) historyRef.current.shift();
      lastPitchAtRef.current = frame.timestamp;
    } else if (frame.timestamp - lastPitchAtRef.current > HOLD_MS) {
      historyRef.current = [];
    }

    const smoothed = median(historyRef.current);
    const next: Reading = {
      frequency: smoothed === null ? null : Math.round(smoothed * 10) / 10,
      clarity: Math.round(pitch.clarity * 100) / 100,
      level: Math.round(pitch.rms * 1000) / 1000,
    };

    // Rounded to display precision, so an unchanged reading is an equal object
    // and React bails out of the re-render.
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
    if (engineRef.current) return;

    setError(null);
    setIsStarting(true);

    const engine = createDspEngine({
      onDeviceLost: (deviceError) => {
        setError(deviceError);
        stop();
      },
    });
    engineRef.current = engine;
    engine.subscribe(handleFrame);

    // Not awaited: this runs from a click handler and the permission prompt can
    // sit open for as long as the user likes.
    engine.start({ pitchEnabled: true, chordEnabled: false }).then(
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
  }, [handleFrame, stop]);

  // A stray stream leaves the browser's recording indicator lit.
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
