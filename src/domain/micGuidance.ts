import type { AudioEngineErrorCode } from '../audio/audioEngine';

/**
 * What to tell someone whose microphone did not start.
 *
 * Pure: a code in, words out. Type-only import from `src/audio`, so this stays
 * free of Web Audio at runtime and can be tested under Node.
 *
 * The app's rule for this is in the roadmap under Milestone 4: everything that
 * does not need audio keeps working when audio is unavailable. An error message
 * on its own does not clear that bar — a message says what went wrong, and what
 * the user needs is what to do next, plus a way to carry on practising in the
 * meantime.
 */

export interface MicGuidance {
  /** One line, in plain words. Not the exception's message. */
  headline: string;
  /** Why it happened, when that is not obvious. */
  explanation: string;
  /** Concrete steps, in order. Empty when there is nothing the user can do. */
  steps: readonly string[];
  /** Whether trying again could plausibly work. */
  canRetry: boolean;
  /**
   * Whether to offer the self-graded fallback. False only when the microphone
   * is *working* — a device that vanished mid-run may well come back, and
   * offering the fallback is never wrong when it does not.
   */
  offerSelfGrading: boolean;
}

const GUIDANCE: Record<AudioEngineErrorCode, MicGuidance> = {
  'permission-denied': {
    headline: 'The microphone is blocked.',
    explanation:
      'Your browser is refusing microphone access for this page. Nothing is recorded or uploaded when you allow it — the audio never leaves the device.',
    steps: [
      'Click the padlock or camera icon in the address bar.',
      'Set Microphone to Allow.',
      'Reload the page, then press Play again.',
    ],
    canRetry: true,
    offerSelfGrading: true,
  },
  'no-microphone': {
    headline: 'No microphone found.',
    explanation: 'Nothing is plugged in, or the browser cannot see any input device.',
    steps: [
      'Plug in a microphone, or unmute the built-in one.',
      'Check your system sound settings list it as an input.',
      'Press Try again.',
    ],
    canRetry: true,
    offerSelfGrading: true,
  },
  'device-busy': {
    headline: 'The microphone is in use.',
    explanation:
      'Another app or tab has it open. Most systems hand the microphone to one program at a time.',
    steps: [
      'Close other calls, recorders, or tabs using the microphone.',
      'Press Try again.',
    ],
    canRetry: true,
    offerSelfGrading: true,
  },
  'device-lost': {
    headline: 'The microphone disconnected.',
    explanation: 'The input device went away mid-session — usually an unplugged cable or a switched audio device.',
    steps: ['Plug it back in, or pick another input.', 'Press Try again.'],
    canRetry: true,
    offerSelfGrading: true,
  },
  'insecure-context': {
    headline: 'This page cannot ask for the microphone.',
    explanation:
      'Browsers only allow microphone access over https or on localhost. The app itself is fine — this is where it is being served from.',
    steps: ['Open the app over https, or from localhost.'],
    canRetry: false,
    offerSelfGrading: true,
  },
  unsupported: {
    headline: 'This browser cannot capture audio.',
    explanation:
      'It does not support the microphone APIs the drills need. Everything that does not listen still works.',
    steps: ['Try a current version of Chrome, Edge, Firefox or Safari.'],
    canRetry: false,
    offerSelfGrading: true,
  },
  unknown: {
    headline: 'The microphone would not start.',
    explanation: 'Something went wrong opening the audio input, and the browser did not say what.',
    steps: ['Press Try again.', 'If it keeps happening, reload the page.'],
    canRetry: true,
    offerSelfGrading: true,
  },
};

export function micGuidance(code: AudioEngineErrorCode): MicGuidance {
  return GUIDANCE[code] ?? GUIDANCE.unknown;
}

/** Every code the guidance covers, for a test that none is forgotten. */
export const MIC_GUIDANCE_CODES = Object.keys(GUIDANCE) as AudioEngineErrorCode[];
