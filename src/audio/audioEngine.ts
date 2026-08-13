import { createPitchDetector, type PitchDetectorOptions } from './pitchDetection';

/**
 * Microphone capture and analysis loop.
 *
 * Deliberately main-thread: an AnalyserNode read inside requestAnimationFrame
 * costs very little at tuner rates, needs no separate worklet module to ship
 * and precache, and rAF stops on its own when the tab is hidden — which is
 * exactly the battery behaviour we want. If polyphonic detection or sample-
 * accurate onset timing arrives later, this is the file that becomes an
 * AudioWorklet; nothing above it should need to change.
 *
 * Nothing here touches the network, so the tuner works from a cold cache with
 * the server down.
 */

export type AudioEngineErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'no-microphone'
  | 'device-busy'
  | 'device-lost'
  | 'unknown';

export class AudioEngineError extends Error {
  readonly code: AudioEngineErrorCode;

  constructor(code: AudioEngineErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AudioEngineError';
    this.code = code;
  }
}

export interface PitchSample {
  /** Detected pitch in Hz, or null when the input is silent or unclear. */
  frequency: number | null;
  /** Roughly 0–1 confidence from the detector. */
  clarity: number;
  /** RMS input level, 0–1. Drives the level meter and the silence gate. */
  rms: number;
  /** `performance.now()` at capture, for staleness checks upstream. */
  timestamp: number;
}

export type PitchListener = (sample: PitchSample) => void;

export interface AudioEngineOptions {
  /**
   * Analysis window in samples. 2048 at 48 kHz is ~43 ms, which holds three
   * full cycles of a low E (82.4 Hz) — enough for a stable reading without the
   * lag a larger window would add.
   */
  fftSize?: number;
  /**
   * Floor on the gap between analyses. rAF fires ~60 times a second; a tuner
   * updating ~25 times a second looks just as responsive for a fraction of the
   * CPU.
   */
  minIntervalMs?: number;
  detector?: PitchDetectorOptions;
  /**
   * Set false for consumers that only want raw audio frames. Skips building
   * the pitch detector entirely — which matters at the large `fftSize` chord
   * detection needs, where running McLeod on every frame would be pure waste.
   * When false, `subscribe` listeners never fire; use `onFrame` instead.
   */
  detectPitch?: boolean;
  /**
   * Raw time-domain window, straight from the AnalyserNode, once per analysis
   * tick. The buffer is reused between calls — copy it if you need to keep it.
   */
  onFrame?: (buffer: Float32Array, sampleRate: number) => void;
  /** Called if the microphone disappears mid-session (unplugged, taken over). */
  onDeviceLost?: (error: AudioEngineError) => void;
}

export interface AudioEngine {
  /** Prompts for microphone access and begins analysis. */
  start(): Promise<void>;
  /** Stops analysis and releases the microphone. Safe to call when idle. */
  stop(): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: PitchListener): () => void;
  isRunning(): boolean;
}

const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_MIN_INTERVAL_MS = 40;

/**
 * Browser voice processing is tuned for speech and destroys pitch detection:
 * AGC pumps the level of a decaying string, and noise suppression treats a
 * sustained note as stationary noise and gates it. All three are switched off.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

export function toAudioEngineError(error: unknown): AudioEngineError {
  if (error instanceof AudioEngineError) {
    return error;
  }

  const name = error instanceof DOMException ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new AudioEngineError(
        'permission-denied',
        'Microphone access was blocked. Allow it for this site in your browser, then try again.',
        error,
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new AudioEngineError(
        'no-microphone',
        'No microphone was found. Connect one and try again.',
        error,
      );
    case 'NotReadableError':
    case 'AbortError':
      return new AudioEngineError(
        'device-busy',
        'The microphone is in use by another application.',
        error,
      );
    default:
      return new AudioEngineError('unknown', 'Could not start the microphone.', error);
  }
}

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = buffer[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  const listeners = new Set<PitchListener>();

  let state: 'idle' | 'starting' | 'running' = 'idle';
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  // Pinned to ArrayBuffer rather than the default ArrayBufferLike: the Web Audio
  // typings reject a possibly-shared buffer here.
  let buffer: Float32Array<ArrayBuffer> | null = null;
  let detector: ReturnType<typeof createPitchDetector> | null = null;
  let frameHandle: number | null = null;
  let lastAnalysisAt = 0;
  let trackedTracks: MediaStreamTrack[] = [];

  function emit(sample: PitchSample): void {
    for (const listener of listeners) {
      listener(sample);
    }
  }

  function handleDeviceLost(): void {
    const error = new AudioEngineError(
      'device-lost',
      'The microphone was disconnected.',
    );
    stop();
    options.onDeviceLost?.(error);
  }

  function releaseResources(): void {
    if (frameHandle !== null) {
      cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }

    for (const track of trackedTracks) {
      track.removeEventListener('ended', handleDeviceLost);
    }
    trackedTracks = [];

    source?.disconnect();
    analyser?.disconnect();

    // Stopping every track is what actually clears the browser's recording
    // indicator; closing the context alone does not.
    stream?.getTracks().forEach((track) => track.stop());

    if (context && context.state !== 'closed') {
      void context.close().catch((error: unknown) => {
        console.warn('[audio] AudioContext did not close cleanly.', error);
      });
    }

    source = null;
    analyser = null;
    stream = null;
    context = null;
    buffer = null;
    detector = null;
  }

  function tick(now: number): void {
    frameHandle = requestAnimationFrame(tick);

    if (now - lastAnalysisAt < minIntervalMs) {
      return;
    }
    lastAnalysisAt = now;

    if (!analyser || !buffer || !context) {
      return;
    }

    analyser.getFloatTimeDomainData(buffer);
    options.onFrame?.(buffer, context.sampleRate);

    // Raw-frame consumers stop here; there is no pitch to report.
    if (!detector) {
      return;
    }

    const { frequency, clarity } = detector.analyze(buffer);

    emit({ frequency, clarity, rms: computeRms(buffer), timestamp: now });
  }

  async function start(): Promise<void> {
    if (state !== 'idle') {
      return;
    }

    state = 'starting';

    try {
      // getUserMedia is absent outside a secure context, which on a LAN IP over
      // plain http is a confusing way to fail. Name it.
      if (!window.isSecureContext) {
        throw new AudioEngineError(
          'insecure-context',
          'Microphone access needs a secure context. Use localhost or https.',
        );
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
        throw new AudioEngineError(
          'unsupported',
          'This browser does not support microphone capture.',
        );
      }

      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);

      // Between the await above and here the caller may have pressed Stop.
      if (state !== 'starting') {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        return;
      }

      trackedTracks = stream.getTracks();
      for (const track of trackedTracks) {
        track.addEventListener('ended', handleDeviceLost);
      }

      context = new AudioContext({ latencyHint: 'interactive' });

      // Chrome can hand back a suspended context even when created from a
      // gesture; resuming is a no-op when it is already running.
      if (context.state === 'suspended') {
        await context.resume();
      }

      analyser = context.createAnalyser();
      analyser.fftSize = fftSize;
      // Time-domain reads are raw, but leaving smoothing on would also affect
      // anything reading frequency data from this node later.
      analyser.smoothingTimeConstant = 0;

      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      // Intentionally not connected to context.destination — routing the mic to
      // the speakers would feed back.

      buffer = new Float32Array(analyser.fftSize);
      detector =
        options.detectPitch === false
          ? null
          : createPitchDetector(analyser.fftSize, context.sampleRate, options.detector ?? {});

      state = 'running';
      lastAnalysisAt = 0;
      frameHandle = requestAnimationFrame(tick);

      console.info(
        `[audio] Engine started at ${context.sampleRate} Hz, ${analyser.fftSize}-sample window.`,
      );
    } catch (error) {
      state = 'idle';
      releaseResources();
      throw toAudioEngineError(error);
    }
  }

  function stop(): void {
    if (state === 'idle') {
      return;
    }

    state = 'idle';
    releaseResources();
    console.info('[audio] Engine stopped, microphone released.');
  }

  return {
    start,
    stop,
    isRunning: () => state === 'running',
    subscribe(listener: PitchListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
