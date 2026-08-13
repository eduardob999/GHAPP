import { createDspAnalyzer, type DspAnalyzer, type DspConfig } from '../dspCore';

/**
 * AudioWorkletProcessor running pitch and chord analysis on the audio thread.
 *
 * Bundled to a standalone file at build time (see the `gpc:dsp-worklet` plugin
 * in vite.config.ts) because `audioWorklet.addModule` loads a URL, not a
 * module from the app graph. It imports the same `dspCore` the main-thread
 * fallback uses, so there is exactly one copy of the DSP.
 *
 * Why this thread at all: the analysis itself is cheap — a chord decision costs
 * well under a millisecond — so this is not about throughput. It is about
 * *consistency*. The previous implementation sampled inside
 * `requestAnimationFrame`, which means a React re-render, a garbage collection
 * or a busy layout pass could delay analysis by a whole frame or more, and
 * which stops entirely when the tab is hidden. The audio thread runs on its own
 * clock at a fixed 128-sample quantum regardless of what the UI is doing.
 */

declare const sampleRate: number;
declare const currentTime: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

class DspProcessor extends AudioWorkletProcessor {
  private readonly analyzer: DspAnalyzer;

  constructor() {
    super();
    this.analyzer = createDspAnalyzer(sampleRate);

    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; config?: Partial<DspConfig> };
      if (data?.type === 'config' && data.config) {
        this.analyzer.setConfig(data.config);
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];

    // No input connected yet, or a silent render quantum. Staying alive is
    // important: returning false would permanently retire the processor.
    if (!channel || channel.length === 0) return true;

    // `currentTime` is the audio clock in seconds — unaffected by main-thread
    // stalls, which is precisely the point of running here.
    const payload = this.analyzer.push(channel, currentTime * 1000);
    if (payload) this.port.postMessage(payload);

    return true;
  }
}

registerProcessor('audio-dsp-processor', DspProcessor);
