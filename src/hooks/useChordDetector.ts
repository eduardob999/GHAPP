import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngineError, type AudioEngineErrorCode } from '../audio/audioEngine';
import { createDspEngine, type DspEngine, type DspFrame } from '../audio/dspEngine';
import { frequencyToNote } from '../audio/notes';
import {
  DEFAULT_CHORD_CONFIG,
  type ChordDetectionConfig,
  type ChordDetectionResult,
  type ChordQuality,
  type DetectedChord,
} from '../audio/chordDetection';

/**
 * Live chord recognition.
 *
 * Analysis happens on the audio thread via the shared DSP engine; this hook
 * only smooths what arrives.
 *
 * Latency budget, which is what this was all for. Previously: a 371 ms window,
 * analysed every 180 ms, published only after two consecutive agreeing frames —
 * up to ~700 ms before a chord change showed up. Now: a 186 ms window (measured
 * to be exactly as accurate), analysed every 120 ms, published on the first
 * frame that agrees with a recent one. Worst case is roughly 300 ms, and the
 * cadence no longer wobbles with main-thread load.
 *
 * Some agreement is still required. A window straddling a chord change contains
 * both chords and matches neither well, so publishing raw frames flickers at
 * every transition.
 */

export interface ChordDetectorState {
  isRunning: boolean;
  /** Wall-clock times of detected attacks, newest last. Cleared by `reset`. */
  onsets: number[];
  /** Latest single note heard, e.g. "A2". Drives riff scoring. */
  currentNote: string | null;
  isStarting: boolean;
  /** Smoothed chord, or null when nothing convincing is sounding. */
  currentChord: DetectedChord | null;
  /** Newest raw analysis, for noise and clarity read-outs. */
  currentResult: ChordDetectionResult | null;
  error: string | null;
  /**
   * Why the microphone did not start, as a code the UI can act on. The message
   * alone is only good for printing; the code is what selects the advice.
   */
  errorCode: AudioEngineErrorCode | null;
  /**
   * Opens the microphone. Resolves `true` when it is actually listening — a
   * caller that starts a timed run regardless would score a whole progression
   * of misses against a microphone that never opened, and file that as a fail.
   */
  start: (config?: Partial<ChordDetectionConfig>) => Promise<boolean>;
  stop: () => void;
  reset: () => void;
}

/**
 * How many of the last few frames must agree before a chord is published.
 *
 * Two-of-three rather than two-consecutive: an isolated bad frame in the middle
 * of a steadily held chord no longer resets the count, so a chord that is
 * genuinely sounding is not delayed by one unlucky window.
 */
const AGREEMENT_WINDOW = 3;
const AGREEMENT_REQUIRED = 2;

/** How long a published chord survives once the sound stops. */
const HOLD_MS = 600;

function sameChord(a: DetectedChord | null, b: DetectedChord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.root === b.root && a.quality === b.quality;
}

export function useChordDetector(): ChordDetectorState {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [currentChord, setCurrentChord] = useState<DetectedChord | null>(null);
  const [currentResult, setCurrentResult] = useState<ChordDetectionResult | null>(null);
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const onsetsRef = useRef<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AudioEngineErrorCode | null>(null);

  const engineRef = useRef<DspEngine | null>(null);
  const configRef = useRef<ChordDetectionConfig>(DEFAULT_CHORD_CONFIG);
  const recentRef = useRef<(DetectedChord | null)[]>([]);
  const publishedAtRef = useRef(0);

  const handleFrame = useCallback((frame: DspFrame) => {
    // Pitch rides along on the same engine: riff steps are scored note by note,
    // chord steps by chord, and both need the same microphone.
    if (frame.pitch) {
      const note = frame.pitch.frequency === null ? null : frequencyToNote(frame.pitch.frequency);
      const label = note?.label ?? null;
      setCurrentNote((previous) => (previous === label ? previous : label));
    }

    if (frame.onset) {
      // Kept in a ref, not state: onsets arrive far too often to re-render on,
      // and the consumer reads them when it grades a step.
      onsetsRef.current.push(frame.timestamp);
      if (onsetsRef.current.length > 256) onsetsRef.current.shift();
    }

    const chordFrame = frame.chord;
    if (!chordFrame) return;

    const candidate: DetectedChord | null =
      chordFrame.root !== null && chordFrame.quality !== null
        ? {
            root: chordFrame.root,
            quality: chordFrame.quality as ChordQuality,
            confidence: chordFrame.confidence,
            activePitchClasses: [],
            noteCount: 0,
          }
        : null;

    setCurrentResult({
      chord: candidate,
      noiseLevel: chordFrame.noiseLevel,
      clarity: chordFrame.clarity,
    });

    const recent = recentRef.current;
    recent.push(candidate);
    if (recent.length > AGREEMENT_WINDOW) recent.shift();

    // Publish the first chord that at least two of the last three frames agree
    // on — the newest one wins ties, so a genuine change is picked up promptly.
    if (candidate) {
      const agreeing = recent.filter((c) => sameChord(c, candidate)).length;
      if (agreeing >= AGREEMENT_REQUIRED) {
        publishedAtRef.current = frame.timestamp;
        setCurrentChord((previous) => (sameChord(previous, candidate) ? previous : candidate));
        return;
      }
    }

    // Nothing convincing. Hold the last chord briefly so a decaying strum does
    // not blink out mid-ring.
    if (!candidate && frame.timestamp - publishedAtRef.current > HOLD_MS) {
      setCurrentChord((previous) => (previous === null ? previous : null));
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    recentRef.current = [];
    publishedAtRef.current = 0;
    setIsRunning(false);
    setIsStarting(false);
    setCurrentChord(null);
    setCurrentResult(null);
  }, []);

  const reset = useCallback(() => {
    recentRef.current = [];
    publishedAtRef.current = 0;
    onsetsRef.current = [];
    onsetsRef.current = [];
    setCurrentChord(null);
    setCurrentResult(null);
    setCurrentNote(null);
  }, []);

  const start = useCallback(
    async (config: Partial<ChordDetectionConfig> = {}) => {
      if (engineRef.current) return true;

      configRef.current = { ...DEFAULT_CHORD_CONFIG, ...config };
      setError(null);
      setErrorCode(null);
      setIsStarting(true);
      reset();

      const engine = createDspEngine({
        onDeviceLost: (deviceError) => {
          setError(deviceError.message);
          setErrorCode(deviceError.code);
          stop();
        },
      });
      engineRef.current = engine;
      engine.subscribe(handleFrame);

      try {
        await engine.start({
          pitchEnabled: true,
          chordEnabled: true,
          chordMinClarity: configRef.current.minClarity,
        });
        setIsStarting(false);
        setIsRunning(true);
        console.info(
          `[chord] Detector started (${engine.usingWorklet() ? 'audio thread' : 'main thread'}).`,
        );
      } catch (startError: unknown) {
        const audioError =
          startError instanceof AudioEngineError
            ? startError
            : new AudioEngineError('unknown', 'Could not start the microphone.', startError);

        console.error('[chord] Detector failed to start.', audioError);
        engineRef.current = null;
        setError(audioError.message);
        setErrorCode(audioError.code);
        setIsStarting(false);
        setIsRunning(false);
        return false;
      }

      return true;
    },
    [handleFrame, reset, stop],
  );

  // A stray stream would leave the browser's recording indicator lit.
  useEffect(() => stop, [stop]);

  return {
    isRunning,
    isStarting,
    onsets: onsetsRef.current,
    currentNote,
    currentChord,
    currentResult,
    error,
    errorCode,
    start,
    stop,
    reset,
  };
}
