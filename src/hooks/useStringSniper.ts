import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioEngineError,
  createAudioEngine,
  type AudioEngine,
  type PitchSample,
} from '../audio/audioEngine';
import { frequencyToNote } from '../audio/notes';
import {
  evaluateSniperFrame,
  type SniperHitResult,
  type StringSniperConfig,
} from '../domain/stringSniper';

/**
 * Audio binding for the String Sniper drill.
 *
 * Runs its own `AudioEngine` rather than reusing `usePitchDetector`. The tuner's
 * hook is tuned for a steady readout — a 5-sample median and a 600 ms hold —
 * which is the right feel for tuning and the wrong one for grading individual
 * pick attacks. Keeping them separate also means this cannot regress the tuner.
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
  start: (config: StringSniperConfig) => Promise<void>;
  stop: () => void;
  resetResult: () => void;
}

/**
 * A pick attack reliably throws one octave-up outlier before the note settles —
 * the same effect the tuner smooths. Three samples (~120 ms) is enough for a
 * median to discard it while staying quick enough to feel immediate.
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

  const engineRef = useRef<AudioEngine | null>(null);
  // Read inside the audio callback, so changing target does not resubscribe.
  const configRef = useRef<StringSniperConfig | null>(null);
  const historyRef = useRef<number[]>([]);
  const lastPitchAtRef = useRef(0);

  const handleSample = useCallback((sample: PitchSample) => {
    const config = configRef.current;
    if (!config) return;

    if (sample.frequency !== null) {
      historyRef.current.push(sample.frequency);
      if (historyRef.current.length > SMOOTHING_WINDOW) {
        historyRef.current.shift();
      }
      lastPitchAtRef.current = sample.timestamp;
    } else if (sample.timestamp - lastPitchAtRef.current > RESULT_HOLD_MS) {
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
      setIsStarting(true);
      setLastResult(null);
      setLastDetected(EMPTY_DETECTION);
      historyRef.current = [];
      configRef.current = config;
      setCurrentConfig(config);

      const engine = createAudioEngine({
        onDeviceLost: (deviceError) => {
          setError(deviceError.message);
          stop();
        },
      });
      engineRef.current = engine;
      engine.subscribe(handleSample);

      try {
        await engine.start();
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
    start,
    stop,
    resetResult,
  };
}
