/**
 * A click track for the timed panels.
 *
 * Scheduled with Web Audio's own clock rather than `setInterval`. A timer that
 * fires "about every 750 ms" is fine for a progress bar and useless for playing
 * in time — the audio clock is sample-accurate and unaffected by main-thread
 * load, so each click lands exactly where the beat is.
 *
 * The click pitch is chosen to be inaudible *to the analysis*, not to you.
 * `chordDetection` only looks between 70 Hz and 1800 Hz and the pitch detector
 * between 65 Hz and 1400 Hz, so a click above 2 kHz is filtered out of the
 * chroma before it can be mistaken for part of a chord. Without that the
 * metronome would score itself.
 */

/** Comfortably above the analysis band, so the mic can hear it and the DSP cannot. */
const ACCENT_HZ = 2800;
const BEAT_HZ = 2100;

/** How far ahead beats are queued, and how often we top the queue up. */
const LOOKAHEAD_S = 0.2;
const TICK_MS = 40;

export interface Metronome {
  /** Begins clicking at `bpm`, counting `beatsPerBar` before the accent repeats. */
  start(bpm: number, beatsPerBar?: number): Promise<void>;
  stop(): void;
  setBpm(bpm: number): void;
  isRunning(): boolean;
}

export function createMetronome(): Metronome {
  let context: AudioContext | null = null;
  let timer: number | null = null;
  let nextBeatAt = 0;
  let beat = 0;
  let bpm = 80;
  let beatsPerBar = 4;

  function scheduleClick(at: number, accent: boolean): void {
    if (!context) return;

    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;

    // A short exponential decay rather than a hard stop: a square-edged gate
    // produces a click of its own, spread right across the spectrum.
    gain.gain.setValueAtTime(accent ? 0.3 : 0.18, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);

    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(at);
    osc.stop(at + 0.05);
  }

  function pump(): void {
    if (!context) return;
    const secondsPerBeat = 60 / bpm;

    while (nextBeatAt < context.currentTime + LOOKAHEAD_S) {
      scheduleClick(nextBeatAt, beat % beatsPerBar === 0);
      nextBeatAt += secondsPerBeat;
      beat += 1;
    }
  }

  return {
    isRunning: () => context !== null,

    async start(nextBpm: number, bars = 4) {
      if (context) return;
      bpm = nextBpm;
      beatsPerBar = bars;
      beat = 0;

      context = new AudioContext({ latencyHint: 'interactive' });
      if (context.state === 'suspended') await context.resume();

      nextBeatAt = context.currentTime + 0.06;
      pump();
      timer = window.setInterval(pump, TICK_MS);
    },

    setBpm(nextBpm: number) {
      bpm = nextBpm;
    },

    stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (context && context.state !== 'closed') {
        void context.close().catch(() => {});
      }
      context = null;
    },
  };
}
