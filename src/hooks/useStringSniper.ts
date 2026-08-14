import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngineError, type AudioEngineErrorCode } from '../audio/audioEngine';
import { createDspEngine, type DspEngine, type DspFrame } from '../audio/dspEngine';
import { frequencyToNote } from '../audio/notes';
import {
  evaluateSniperFrame,
  type SniperHitResult,
  type StringSniperConfig,
} from '../domain/stringSniper';

/**
 * Audio binding for the String Sniper drill.
 *
 * Reads pitch frames from the shared DSP engine, but keeps its own smoothing:
 * the tuner is tuned for a steady readout, which is the wrong feel for grading
 * individual pick attacks.
 *
 * Frames now arrive on the audio thread's clock at ~30 ms rather than on a
 * `requestAnimationFrame` tick, so a verdict lands roughly a frame-and-a-half
 * after the attack instead of waiting on whatever the UI was busy with.
 */

export interface SniperDetection {
  frequency: number | null;
  noteName: string | null;
  /** Cents from the nearest *acceptable* note, not the nearest chromatic one. */
  cents: number | null;
  clarity: number | null;
}

export interface StringSniperState {
  isRunning: boolean;
  /** True between the click and the microphone opening. */
  isStarting: boolean;
  currentConfig: StringSniperConfig | null;
  lastResult: SniperHitResult | null;
  lastDetected: SniperDetection;
  error: string | null;
  /** Why the microphone did not start, so the panel can advise rather than report. */
  errorCode: AudioEngineErrorCode | null;
  start: (config: StringSniperConfig) => Promise<void>;
  stop: () => void;
  resetResult: () => void;
}

/**
 * A pick attack reliably throws one octave-up outlier before the note settles.
 * Three frames at the engine's ~30 ms cadence is under 100 ms — enough for a
 * median to discard the outlier, quick enough to feel immediate.
 */
const SMOOTHING_WINDOW = 3;

/** How long a verdict stays on screen after the string stops ringing. */
const RESULT_HOLD_MS = 900;

const EMPTY_DETECTION: SniperDetection = {
  frequency: null,
  noteName: null,
  cents: null,
  clarity: null,
};

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

export function useStringSniper(): StringSniperState {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<StringSniperConfig | null>(null);
  const [lastResult, setLastResult] = useState<SniperHitResult | null>(null);
  const [lastDetected, setLastDetected] = useState<SniperDetection>(EMPTY_DETECTION);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AudioEngineErrorCode | null>(null);

  const engineRef = useRef<DspEngine | null>(null);
  // Read inside the audio callback, so changing target does not resubscribe.
  const configRef = useRef<StringSniperConfig | null>(null);
  const historyRef = useRef<number[]>([]);
  const lastPitchAtRef = useRef(0);

  const handleSample = useCallback((frame: DspFrame) => {
    const config = configRef.current;
    const sample = frame.pitch;
    if (!config || !sample) return;

    if (sample.frequency !== null) {
      historyRef.current.push(sample.frequency);
      if (historyRef.current.length > SMOOTHING_WINDOW) {
        historyRef.current.shift();
      }
      lastPitchAtRef.current = frame.timestamp;
    } else if (frame.timestamp - lastPitchAtRef.current > RESULT_HOLD_MS) {
      historyRef.current = [];
    }

    const smoothed = median(historyRef.current);
    const evaluation = evaluateSniperFrame(config, {
      frequency: smoothed,
      clarity: sample.clarity,
    });

    const note = smoothed === null ? null : frequencyToNote(smoothed);

    const detection: SniperDetection = {
      frequency: smoothed === null ? null : Math.round(smoothed * 10) / 10,
      noteName: note?.label ?? null,
      cents: evaluation.centsFromTarget,
      clarity: Math.round(sample.clarity * 100) / 100,
    };

    // Rounded above so an unchanged reading produces an equal object and React
    // can bail out — this runs ~25 times a second.
    setLastDetected((previous) =>
      previous.frequency === detection.frequency &&
      previous.noteName === detection.noteName &&
      previous.cents === detection.cents &&
      previous.clarity === detection.clarity
        ? previous
        : detection,
    );

    setLastResult((previous) => (previous === evaluation.result ? previous : evaluation.result));
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    configRef.current = null;
    historyRef.current = [];
    lastPitchAtRef.current = 0;

    setIsRunning(false);
    setIsStarting(false);
    setCurrentConfig(null);
    setLastResult(null);
    setLastDetected(EMPTY_DETECTION);
  }, []);

  const start = useCallback(
    async (config: StringSniperConfig) => {
      if (engineRef.current) return;

      setError(null);
      setErrorCode(null);
      setIsStarting(true);
      setLastResult(null);
      setLastDetected(EMPTY_DETECTION);
      historyRef.current = [];
      configRef.current = config;
      setCurrentConfig(config);

      const engine = createDspEngine({
        onDeviceLost: (deviceError) => {
          setError(deviceError.message);
          setErrorCode(deviceError.code);
          stop();
        },
      });
      engineRef.current = engine;
      engine.subscribe(handleSample);

      try {
        await engine.start({ pitchEnabled: true, chordEnabled: false });
        setIsStarting(false);
        setIsRunning(true);
        console.info('[sniper] Drill started:', config);
      } catch (startError: unknown) {
        const audioError =
          startError instanceof AudioEngineError
            ? startError
            : new AudioEngineError('unknown', 'Could not start the microphone.', startError);

        console.error('[sniper] Drill failed to start.', audioError);
        engineRef.current = null;
        configRef.current = null;
        setError(audioError.message);
        setErrorCode(audioError.code);
        setIsStarting(false);
        setIsRunning(false);
        setCurrentConfig(null);
      }
    },
    [handleSample, stop],
  );

  const resetResult = useCallback(() => {
    historyRef.current = [];
    setLastResult(null);
    setLastDetected(EMPTY_DETECTION);
  }, []);

  // Leaving a stream open would keep the browser's recording indicator lit.
  useEffect(() => stop, [stop]);

  return {
    isRunning,
    isStarting,
    currentConfig,
    lastResult,
    lastDetected,
    error,
    errorCode,
    start,
    stop,
    resetResult,
  };
}
