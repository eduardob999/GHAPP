/**
 * Reward sounds.
 *
 * Three short arpeggios, scheduled on the audio clock like the metronome so
 * they land evenly rather than at the mercy of the main thread.
 *
 * **Pitched above the analysis band, for the same reason the metronome is.**
 * `chordDetection` looks between 70 Hz and 1800 Hz and the pitch detector
 * between 65 Hz and 1400 Hz. A chime built from partials above 1975 Hz cannot
 * reach the chroma, so a reward that fires while a drill is still listening
 * cannot be mistaken for something you played. That freedom is worth the
 * slightly glassy timbre: it means the sound design never has to know what the
 * DSP is doing.
 *
 * One `AudioContext`, created on the first sound and kept — a context per
 * chime would leak, and browsers cap how many you may open.
 */

export type ChimeName =
  /** A run finished well. */
  | 'success'
  /** A run finished; nothing to celebrate, nothing to apologise for. */
  | 'gentle'
  /** A streak milestone. */
  | 'milestone';

interface ChimeVoice {
  /** Partials, in Hz, played in sequence. */
  notes: readonly number[];
  /** Seconds between the start of each note. */
  spacing: number;
  /** Seconds each note takes to decay to silence. */
  decay: number;
  gain: number;
}

// B6, E7, G#7 — a major triad, entirely above the analysis ceiling.
const VOICES: Record<ChimeName, ChimeVoice> = {
  success: { notes: [1975.5, 2637, 3322], spacing: 0.08, decay: 0.35, gain: 0.16 },
  gentle: { notes: [2093, 2349], spacing: 0.11, decay: 0.3, gain: 0.1 },
  milestone: {
    notes: [1975.5, 2637, 3322, 3951, 5274],
    spacing: 0.09,
    decay: 0.55,
    gain: 0.18,
  },
};

export interface ChimePlayer {
  play(name: ChimeName): void;
  /** Releases the audio context. Safe to call more than once. */
  close(): void;
}

export function createChimePlayer(): ChimePlayer {
  let context: AudioContext | null = null;

  function ensureContext(): AudioContext | null {
    if (context && context.state !== 'closed') return context;

    try {
      context = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      // No Web Audio — the app is silent, which is a fine outcome for a reward
      // sound. Nothing else should fail because of it.
      return null;
    }

    return context;
  }

  return {
    play(name) {
      const audio = ensureContext();
      if (!audio) return;

      // A context created before any user gesture starts suspended; resuming is
      // asynchronous, and the scheduled notes simply wait for it.
      if (audio.state === 'suspended') void audio.resume().catch(() => {});

      const voice = VOICES[name];
      const start = audio.currentTime + 0.02;

      voice.notes.forEach((frequency, index) => {
        const at = start + index * voice.spacing;
        const osc = audio.createOscillator();
        const gain = audio.createGain();

        osc.type = 'triangle';
        osc.frequency.value = frequency;

        // Exponential in and out: a square gate would spread a click right
        // across the spectrum, including straight through the analysis band the
        // rest of this file exists to stay out of.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(voice.gain, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + voice.decay);

        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(at);
        osc.stop(at + voice.decay + 0.05);
      });
    },

    close() {
      if (context && context.state !== 'closed') {
        void context.close().catch(() => {});
      }
      context = null;
    },
  };
}

/** The frequencies a chime can emit, for tests that assert it stays clear of the DSP. */
export function chimePartials(name: ChimeName): readonly number[] {
  return VOICES[name].notes;
}
