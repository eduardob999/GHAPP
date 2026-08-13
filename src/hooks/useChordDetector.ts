import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioEngineError,
  createAudioEngine,
  type AudioEngine,
} from '../audio/audioEngine';
import {
  DEFAULT_CHORD_CONFIG,
  detectChord,
  type ChordDetectionConfig,
  type ChordDetectionResult,
  type DetectedChord,
} from '../audio/chordDetection';

/**
 * Live chord recognition.
 *
 * Runs the audio engine in raw-frame mode: no pitch detection, and a much
 * larger analysis window than the tuner. `AnalyserNode.getFloatTimeDomainData`
 * always hands back the most recent `fftSize` samples, so the window is
 * inherently contiguous and no ring buffer of our own is needed.
 *
 * Frames are smoothed before they reach the UI. A single window straddling a
 * chord change contains both chords and matches neither well, so raw
 * frame-by-frame output flickers; requiring agreement across consecutive
 * frames trades a little latency for a reading that holds still.
 */

export interface ChordDetectorState {
  isRunning: boolean;
  isStarting: boolean;
  /** Smoothed chord, or null when nothing convincing is sounding. */
  currentChord: DetectedChord | null;
  /** Newest raw analysis, for noise and clarity read-outs. */
  currentResult: ChordDetectionResult | null;
  error: string | null;
  start: (config?: Partial<ChordDetectionConfig>) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * Window length in samples. 16384 spans ~370 ms at 44.1 kHz, which is long
 * enough to resolve a semitone at the bottom of the guitar's range (a little
 * under 5 Hz apart at the low E) and to catch a whole arpeggio figure, while
 * still updating several times a second.
 */
const ANALYSIS_FFT_SIZE = 16384;

/** Detection cadence. Analysis is far too costly to run on every rAF tick. */
const DETECT_INTERVAL_MS = 180;

/** Consecutive agreeing frames before a chord is published. */
const STABLE_FRAMES = 2;

/** How long a published chord survives once the sound stops. */
const HOLD_MS = 700;

function sameChord(a: DetectedChord | null, b: DetectedChord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.root === b.root && a.quality === b.quality;
}

export function useChordDetector(): ChordDetectorState {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [currentChord, setCurrentChord] = useState<DetectedChord | null>(null);
  const [currentResult, setCurrentResult] = useState<ChordDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const configRef = useRef<ChordDetectionConfig>(DEFAULT_CHORD_CONFIG);
  const lastAnalysisRef = useRef(0);
  const pendingRef = useRef<{ chord: DetectedChord | null; count: number }>({
    chord: null,
    count: 0,
  });
  const publishedAtRef = useRef(0);

  const handleFrame = useCallback((buffer: Float32Array, sampleRate: number) => {
    const now = performance.now();
    if (now - lastAnalysisRef.current < DETECT_INTERVAL_MS) return;
    lastAnalysisRef.current = now;

    const result = detectChord(buffer, sampleRate, configRef.current);
    setCurrentResult(result);

    const candidate = result.chord;
    const pending = pendingRef.current;

    if (sameChord(candidate, pending.chord)) {
      pending.count += 1;
    } else {
      pending.chord = candidate;
      pending.count = 1;
    }

    if (candidate !== null && pending.count >= STABLE_FRAMES) {
      publishedAtRef.current = now;
      setCurrentChord((previous) => (sameChord(previous, candidate) ? previous : candidate));
      return;
    }

    // Nothing convincing right now. Keep showing the last chord briefly so a
    // decaying strum does not blink out mid-ring.
    if (candidate === null && now - publishedAtRef.current > HOLD_MS) {
      setCurrentChord((previous) => (previous === null ? previous : null));
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    pendingRef.current = { chord: null, count: 0 };
    lastAnalysisRef.current = 0;
    publishedAtRef.current = 0;
    setIsRunning(false);
    setIsStarting(false);
    setCurrentChord(null);
    setCurrentResult(null);
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = { chord: null, count: 0 };
    publishedAtRef.current = 0;
    setCurrentChord(null);
    setCurrentResult(null);
  }, []);

  const start = useCallback(
    async (config: Partial<ChordDetectionConfig> = {}) => {
      if (engineRef.current) return;

      configRef.current = { ...DEFAULT_CHORD_CONFIG, ...config };
      setError(null);
      setIsStarting(true);
      reset();

      const engine = createAudioEngine({
        fftSize: ANALYSIS_FFT_SIZE,
        detectPitch: false,
        onFrame: handleFrame,
        onDeviceLost: (deviceError) => {
          setError(deviceError.message);
          stop();
        },
      });
      engineRef.current = engine;

      try {
        await engine.start();
        setIsStarting(false);
        setIsRunning(true);
        console.info('[chord] Detector started.');
      } catch (startError: unknown) {
        const audioError =
          startError instanceof AudioEngineError
            ? startError
            : new AudioEngineError('unknown', 'Could not start the microphone.', startError);

        console.error('[chord] Detector failed to start.', audioError);
        engineRef.current = null;
        setError(audioError.message);
        setIsStarting(false);
        setIsRunning(false);
      }
    },
    [handleFrame, reset, stop],
  );

  // A stray stream would leave the browser's recording indicator lit.
  useEffect(() => stop, [stop]);

  return {
    isRunning,
    isStarting,
    currentChord,
    currentResult,
    error,
    start,
    stop,
    reset,
  };
}
