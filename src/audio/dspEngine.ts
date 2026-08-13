import {
  AudioEngineError,
  MIC_CONSTRAINTS,
  createAudioEngine,
  toAudioEngineError,
  type AudioEngine,
} from './audioEngine';
import {
  CHORD_WINDOW_SAMPLES,
  createDspAnalyzer,
  DEFAULT_DSP_CONFIG,
  type DspConfig,
  type DspFramePayload,
} from './dspCore';

/**
 * One microphone, one analysis pipeline, many consumers.
 *
 * Runs the DSP inside an AudioWorklet where possible, and falls back to the
 * original main-thread engine where `audioWorklet` is missing or the module
 * fails to load. Both paths drive the *same* `dspCore` analyzer and emit the
 * same frames, so nothing above this file can tell which one is running —
 * apart from `usingWorklet`, which exists only so the UI can say so.
 */

export interface DspPitch {
  frequency: number | null;
  clarity: number;
  rms: number;
}

export interface DspChord {
  root: string | null;
  quality: string | null;
  confidence: number;
  noiseLevel: number;
  clarity: number;
}

export interface DspFrame {
  /** `performance.now()` when the frame reached the main thread. */
  timestamp: number;
  /** Monotonic sample counter from the analysis thread. */
  frameIndex: number;
  pitch?: DspPitch;
  chord?: DspChord;
}

export type DspListener = (frame: DspFrame) => void;

export interface DspEngineOptions {
  onDeviceLost?: (error: AudioEngineError) => void;
}

export interface DspEngine {
  start(config?: Partial<DspConfig>): Promise<void>;
  stop(): void;
  subscribe(listener: DspListener): () => void;
  setConfig(config: Partial<DspConfig>): void;
  isRunning(): boolean;
  /** False when running the main-thread fallback. Diagnostics only. */
  usingWorklet(): boolean;
}

const WORKLET_PROCESSOR = 'audio-dsp-processor';

/** Resolved against the app base, so it works from the /GHAPP/ sub-path too. */
function workletUrl(): string {
  return new URL(
    'audio-dsp-worklet.js',
    new URL(import.meta.env.BASE_URL, location.href),
  ).toString();
}

export function createDspEngine(options: DspEngineOptions = {}): DspEngine {
  const listeners = new Set<DspListener>();

  let config: DspConfig = { ...DEFAULT_DSP_CONFIG };
  let state: 'idle' | 'starting' | 'running' = 'idle';
  let worklet = false;

  // Worklet path
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let sink: GainNode | null = null;
  let tracks: MediaStreamTrack[] = [];

  // Fallback path
  let fallback: AudioEngine | null = null;
  let fallbackConfigDirty = false;

  function emit(payload: DspFramePayload): void {
    const frame: DspFrame = {
      timestamp: performance.now(),
      frameIndex: payload.frameIndex,
      ...(payload.pitch ? { pitch: payload.pitch } : {}),
      ...(payload.chord ? { chord: payload.chord } : {}),
    };
    for (const listener of listeners) listener(frame);
  }

  function handleDeviceLost(): void {
    const error = new AudioEngineError('device-lost', 'The microphone was disconnected.');
    stop();
    options.onDeviceLost?.(error);
  }

  function releaseWorklet(): void {
    for (const track of tracks) track.removeEventListener('ended', handleDeviceLost);
    tracks = [];

    if (node) node.port.onmessage = null;
    source?.disconnect();
    node?.disconnect();
    sink?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());

    if (context && context.state !== 'closed') {
      void context.close().catch((error: unknown) => {
        console.warn('[dsp] AudioContext did not close cleanly.', error);
      });
    }

    source = null;
    node = null;
    sink = null;
    stream = null;
    context = null;
  }

  /**
   * Main-thread fallback.
   *
   * Reuses the Task 2 engine in raw-frame mode. Each callback delivers a full
   * `CHORD_WINDOW_SAMPLES` window, which completely replaces the analyzer's
   * ring — so the identical analyzer works unmodified on both paths.
   */
  async function startFallback(): Promise<void> {
    // Built lazily: the device's real sample rate is only known once the first
    // frame arrives, and the analyzer is bound to one rate.
    let analyzer: ReturnType<typeof createDspAnalyzer> | null = null;
    let analyzerRate = 0;

    const engine = createAudioEngine({
      fftSize: CHORD_WINDOW_SAMPLES,
      minIntervalMs: Math.min(config.pitchIntervalMs, config.chordIntervalMs),
      detectPitch: false,
      onFrame: (buffer, sampleRate) => {
        if (!analyzer || analyzerRate !== sampleRate || fallbackConfigDirty) {
          analyzer = createDspAnalyzer(sampleRate, config);
          analyzerRate = sampleRate;
          fallbackConfigDirty = false;
        }
        const payload = analyzer.push(buffer, performance.now());
        if (payload) emit(payload);
      },
      ...(options.onDeviceLost ? { onDeviceLost: options.onDeviceLost } : {}),
    });

    fallback = engine;
    await engine.start();
    worklet = false;
    console.info('[dsp] Started on the main thread (AudioWorklet unavailable).');
  }

  async function startWorklet(): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);

    if (state !== 'starting') {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      return;
    }

    tracks = stream.getTracks();
    for (const track of tracks) track.addEventListener('ended', handleDeviceLost);

    context = new AudioContext({ latencyHint: 'interactive' });
    if (context.state === 'suspended') await context.resume();

    if (!context.audioWorklet) {
      throw new Error('AudioWorklet is not available on this AudioContext.');
    }
    await context.audioWorklet.addModule(workletUrl());

    node = new AudioWorkletNode(context, WORKLET_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event: MessageEvent) => emit(event.data as DspFramePayload);
    node.port.postMessage({ type: 'config', config });

    source = context.createMediaStreamSource(stream);

    // A worklet only runs while its graph is being pulled toward a
    // destination. Routing through a silent gain keeps it scheduled without
    // playing the microphone back into the room.
    sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);

    worklet = true;
    console.info(
      `[dsp] Started on the audio thread at ${context.sampleRate} Hz ` +
        `(pitch every ${config.pitchIntervalMs}ms, chords every ${config.chordIntervalMs}ms).`,
    );
  }

  function stop(): void {
    if (state === 'idle') return;
    state = 'idle';

    fallback?.stop();
    fallback = null;
    releaseWorklet();

    console.info('[dsp] Stopped, microphone released.');
  }

  return {
    isRunning: () => state === 'running',
    usingWorklet: () => worklet,

    setConfig(patch: Partial<DspConfig>) {
      config = { ...config, ...patch };
      // Worklet: pushed across the port. Fallback: picked up when the analyzer
      // is next rebuilt, which is why it is keyed on `config` identity.
      node?.port.postMessage({ type: 'config', config });
      fallbackConfigDirty = true;
    },

    async start(patch: Partial<DspConfig> = {}) {
      if (state !== 'idle') return;
      state = 'starting';
      config = { ...config, ...patch };

      try {
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

        // `in` rather than a property read: `audioWorklet` is a getter on
        // BaseAudioContext.prototype, and reading it off the prototype invokes
        // it with the wrong `this`, which throws "Illegal invocation".
        const canUseWorklet =
          typeof AudioWorkletNode !== 'undefined' && 'audioWorklet' in AudioContext.prototype;

        if (canUseWorklet) {
          try {
            await startWorklet();
          } catch (workletError: unknown) {
            // A blocked microphone is fatal on either path; only a worklet
            // *loading* problem is worth retrying on the main thread.
            if (
              workletError instanceof AudioEngineError ||
              (workletError instanceof DOMException &&
                ['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError'].includes(
                  workletError.name,
                ))
            ) {
              throw workletError;
            }
            console.warn('[dsp] Worklet failed to load; using the main thread.', workletError);
            releaseWorklet();
            await startFallback();
          }
        } else {
          await startFallback();
        }

        state = 'running';
      } catch (error: unknown) {
        state = 'idle';
        fallback?.stop();
        fallback = null;
        releaseWorklet();
        throw toAudioEngineError(error);
      }
    },

    stop,

    subscribe(listener: DspListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
