import { chordPitchClassMask, type ChordQuality } from '../audio/chordDetection';
import {
  DEFAULT_TUNING,
  TUNINGS,
  pitchClassOfRoot,
  soundingNote,
  soundingRoot,
  transposeRoot,
  type TuningId,
} from './tunings';

/**
 * Chord progressions for Chord Hero.
 *
 * Pure data plus the scoring rules. No audio, no React — so the stepping and
 * grading logic can be driven from tests with synthetic detections.
 */

/**
 * How a step is meant to be played. The scorer branches on this: chord modes are
 * graded by chord recognition, `riff` by the notes heard.
 */
export type PlayMode =
  | 'strum'
  | 'arpeggio'
  | 'fingerstyle'
  | 'palm-mute'
  | 'riff';

export const PLAY_MODE_HINTS: Record<PlayMode, string> = {
  strum: 'Strum and let it ring',
  arpeggio: 'Pick the notes one at a time',
  fingerstyle: 'Thumb on the bass, fingers on top — no pick',
  'palm-mute': 'Palm-mute: rest your picking hand on the bridge',
  riff: 'Play the notes in order',
};

/** Difficulty, so the library can be filtered as you improve. */
export type ProgressionLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ProgressionChord {
  /** Unique within its progression. */
  id: string;
  root: string;
  quality: ChordQuality;
  positionMetadata?: {
    rootString: number;
    rootFret: number;
    /** Links to a MicroSkillDefinition so the trainer's diagram can be reused. */
    shapeId?: string;
  };
  durationBeats: number;
  mode: PlayMode;
  /**
   * Riff steps only: the notes to play, in order, as pitch names with octave
   * ("E2", "G3"). Scored by pitch rather than chord recognition.
   */
  notes?: string[];
  /**
   * The shape your hands make, when it is not the same as the chord that
   * sounds. In half-step-down tuning an E shape sounds E♭: `root` is what the
   * detector hears, this is what to grab.
   */
  shapeLabel?: string;
}

export interface ChordProgression {
  id: string;
  title: string;
  description?: string;
  tempoBpm: number;
  chords: ProgressionChord[];
  level: ProgressionLevel;
  /** Grouping for the picker: "Pop", "Blues", "Jazz", "Riffs"… */
  genre: string;
  /** What this one is actually teaching you. */
  teaches?: string;
  /** Tuning required. Absent means standard. */
  tuning?: TuningId;
  /**
   * Catalog skill ids this progression is a workout for, so Today's Session can
   * offer a picking-hand card straight into Chord Hero. Progressions are already
   * schedulable in their own right — this links them to *hand-written* skills
   * they happen to drill.
   */
  practisesSkillIds?: readonly string[];
}

/** Every genre in the library, in the order the picker should show them. */
export const GENRES = [
  'Essentials',
  'Pop',
  'Rock',
  'Blues',
  'Folk & Country',
  'Jazz',
  'Modal & Exotic',
  'Fingerstyle',
  'Riffs',
  'Sevenths',
  'Tunings',
  'Workouts',
] as const;

export type ChordScore = 'hit' | 'partial' | 'miss' | 'unclear';

type StepOpts = {
  beats?: number;
  mode?: PlayMode;
  string?: number;
  fret?: number;
  shape?: string;
  notes?: string[];
  /** Shape name, when it differs from the sounding chord. */
  label?: string;
};

/** Compact step builder — the library is data, and reads better dense. */
function step(id: string, root: string, quality: ChordQuality, o: StepOpts = {}): ProgressionChord {
  return {
    id,
    root,
    quality,
    durationBeats: o.beats ?? 4,
    mode: o.mode ?? 'strum',
    ...(o.string !== undefined && o.fret !== undefined
      ? {
          positionMetadata: {
            rootString: o.string,
            rootFret: o.fret,
            ...(o.shape ? { shapeId: o.shape } : {}),
          },
        }
      : {}),
    ...(o.notes ? { notes: o.notes } : {}),
    ...(o.label ? { shapeLabel: o.label } : {}),
  };
}

/** Open-position anchors, so the library is not littered with magic numbers. */
const OPEN = {
  E: { string: 6, fret: 0 },
  A: { string: 5, fret: 0 },
  D: { string: 4, fret: 0, shape: 'fretting.open.d' },
  G: { string: 6, fret: 3, shape: 'fretting.open.g' },
  C: { string: 5, fret: 3, shape: 'fretting.open.c' },
  Em: { string: 6, fret: 0, shape: 'fretting.open.e-minor' },
  Am: { string: 5, fret: 0, shape: 'fretting.open.a-minor' },
  F: { string: 6, fret: 1 },
  Dm: { string: 4, fret: 0 },
  B: { string: 5, fret: 2 },
} as const;

/**
 * The progression library.
 *
 * Ordered roughly by difficulty inside each genre. Everything here is playable
 * on an acoustic in standard tuning; nothing needs a capo.
 */
const CORE_PROGRESSIONS: readonly ChordProgression[] = [
  // ── Essentials ────────────────────────────────────────────────────────────
  {
    id: 'prog.two-chord.em-c', title: 'Two-chord starter: Em – C', genre: 'Essentials',
    level: 'beginner', tempoBpm: 70,
    description: 'The gentlest possible start. Two chords, four beats each.',
    teaches: 'Clean chord changes without a time penalty.',
    chords: [step('em', 'E', 'min', OPEN.Em), step('c', 'C', 'maj', OPEN.C),
             step('em2', 'E', 'min', OPEN.Em), step('c2', 'C', 'maj', OPEN.C)],
  },
  {
    id: 'prog.i-v-vi-iv.g', title: 'I–V–vi–IV in G', genre: 'Essentials',
    level: 'beginner', tempoBpm: 80,
    description: 'The four chords behind half of pop music.',
    teaches: 'The most common progression in Western popular music.',
    chords: [step('g', 'G', 'maj', OPEN.G), step('d', 'D', 'maj', OPEN.D),
             step('em', 'E', 'min', OPEN.Em), step('c', 'C', 'maj', OPEN.C)],
  },
  {
    id: 'prog.i-iv-v.a', title: 'I–IV–V in A', genre: 'Essentials',
    level: 'beginner', tempoBpm: 88,
    description: 'Three chords, a thousand songs.',
    teaches: 'The primary triads: tonic, subdominant, dominant.',
    chords: [step('a', 'A', 'maj', OPEN.A), step('d', 'D', 'maj', OPEN.D),
             step('a2', 'A', 'maj', OPEN.A), step('e', 'E', 'maj', OPEN.E)],
  },
  {
    id: 'prog.g-c-d-fast', title: 'G–C–D, two beats each', genre: 'Essentials',
    level: 'intermediate', tempoBpm: 84,
    description: 'Same shapes, half the time. This is where changes get real.',
    teaches: 'Changing chords without stopping the strumming hand.',
    chords: [step('g', 'G', 'maj', { ...OPEN.G, beats: 2 }), step('c', 'C', 'maj', { ...OPEN.C, beats: 2 }),
             step('d', 'D', 'maj', { ...OPEN.D, beats: 2 }), step('g2', 'G', 'maj', { ...OPEN.G, beats: 2 }),
             step('c2', 'C', 'maj', { ...OPEN.C, beats: 2 }), step('d2', 'D', 'maj', { ...OPEN.D, beats: 2 })],
  },

  // ── Pop ───────────────────────────────────────────────────────────────────
  {
    id: 'prog.vi-iv-i-v.em', title: 'vi–IV–I–V in G (the sad one)', genre: 'Pop',
    level: 'beginner', tempoBpm: 76,
    description: 'The same four chords starting on the minor. Completely different mood.',
    teaches: 'How rotation changes the emotional centre of a progression.',
    chords: [step('em', 'E', 'min', OPEN.Em), step('c', 'C', 'maj', OPEN.C),
             step('g', 'G', 'maj', OPEN.G), step('d', 'D', 'maj', OPEN.D)],
  },
  {
    id: 'prog.50s.c', title: '50s doo-wop: I–vi–IV–V in C', genre: 'Pop',
    level: 'beginner', tempoBpm: 72,
    description: 'Stand By Me, Earth Angel, and a few hundred others.',
    teaches: 'The doo-wop turnaround.',
    chords: [step('c', 'C', 'maj', OPEN.C), step('am', 'A', 'min', OPEN.Am),
             step('f', 'F', 'maj', OPEN.F), step('g', 'G', 'maj', OPEN.G)],
  },
  {
    id: 'prog.axis.d', title: 'I–V–vi–IV in D', genre: 'Pop',
    level: 'intermediate', tempoBpm: 90,
    description: 'The axis progression moved to D — different shapes, same feeling.',
    teaches: 'Transposing a familiar progression to a new key.',
    chords: [step('d', 'D', 'maj', OPEN.D), step('a', 'A', 'maj', OPEN.A),
             step('bm', 'B', 'min', { string: 5, fret: 2 }), step('g', 'G', 'maj', OPEN.G)],
  },
  {
    id: 'prog.pop-punk', title: 'Pop-punk: I–V–vi–IV, palm-muted', genre: 'Pop',
    level: 'intermediate', tempoBpm: 100,
    description: 'Same four chords, muted and driving.',
    teaches: 'Palm-muting without losing the chord.',
    chords: [step('g', 'G', 'maj', { ...OPEN.G, mode: 'palm-mute' }),
             step('d', 'D', 'maj', { ...OPEN.D, mode: 'palm-mute' }),
             step('em', 'E', 'min', { ...OPEN.Em, mode: 'palm-mute' }),
             step('c', 'C', 'maj', { ...OPEN.C, mode: 'palm-mute' })],
  },

  // ── Rock ──────────────────────────────────────────────────────────────────
  {
    id: 'prog.mixolydian-rock', title: 'I–bVII–IV in A (rock cadence)', genre: 'Rock',
    level: 'intermediate', tempoBpm: 92,
    description: 'A–G–D. The flat seven is what makes it sound like rock rather than pop.',
    teaches: 'The bVII borrowed from Mixolydian.',
    chords: [step('a', 'A', 'maj', OPEN.A), step('g', 'G', 'maj', OPEN.G),
             step('d', 'D', 'maj', OPEN.D), step('a2', 'A', 'maj', OPEN.A)],
  },
  {
    id: 'prog.power.e5-g5-a5', title: 'Power chords: E5–G5–A5–D5', genre: 'Rock',
    level: 'beginner', tempoBpm: 96,
    description: 'Two notes each. Mute everything you are not fretting.',
    teaches: 'Moveable power-chord shapes on the 6th and 5th strings.',
    chords: [step('e5', 'E', '5', { string: 6, fret: 0, mode: 'palm-mute' }),
             step('g5', 'G', '5', { string: 6, fret: 3, mode: 'palm-mute', shape: 'fretting.power.6th-string.3rd' }),
             step('a5', 'A', '5', { string: 6, fret: 5, mode: 'palm-mute', shape: 'fretting.power.6th-string.5th' }),
             step('d5', 'D', '5', { string: 5, fret: 5, mode: 'palm-mute', shape: 'fretting.power.5th-string.5th' })],
  },
  {
    id: 'prog.barre.walk', title: 'Barre walk: A–D–E at the 5th', genre: 'Rock',
    level: 'advanced', tempoBpm: 72,
    description: 'The same blues, played entirely with barres up the neck.',
    teaches: 'E-shape and A-shape barres, and moving between them.',
    chords: [step('a', 'A', 'maj', { string: 6, fret: 5, shape: 'fretting.barre.e-shape.major.5th' }),
             step('d', 'D', 'maj', { string: 5, fret: 5, shape: 'fretting.barre.a-shape.major.5th' }),
             step('e', 'E', 'maj', { string: 6, fret: 12 }),
             step('a2', 'A', 'maj', { string: 6, fret: 5, shape: 'fretting.barre.e-shape.major.5th' })],
  },
  {
    id: 'prog.minor-rock', title: 'i–bVI–bVII in Em', genre: 'Rock',
    level: 'intermediate', tempoBpm: 84,
    description: 'Em–C–D. The Aeolian cadence — heroic, and everywhere in film music.',
    teaches: 'Building a progression out of the natural minor scale.',
    chords: [step('em', 'E', 'min', OPEN.Em), step('c', 'C', 'maj', OPEN.C),
             step('d', 'D', 'maj', OPEN.D), step('em2', 'E', 'min', OPEN.Em)],
  },

  // ── Blues ─────────────────────────────────────────────────────────────────
  {
    id: 'prog.blues.12bar.a', title: '12-bar blues in A (full)', genre: 'Blues',
    level: 'intermediate', tempoBpm: 84,
    description: 'The whole twelve bars, one chord per bar. The form every blues uses.',
    teaches: 'The complete 12-bar form, including the turnaround.',
    chords: [step('a1','A','7',OPEN.A), step('a2','A','7',OPEN.A), step('a3','A','7',OPEN.A), step('a4','A','7',OPEN.A),
             step('d1','D','7',OPEN.D), step('d2','D','7',OPEN.D), step('a5','A','7',OPEN.A), step('a6','A','7',OPEN.A),
             step('e1','E','7',OPEN.E), step('d3','D','7',OPEN.D), step('a7','A','7',OPEN.A), step('e2','E','7',OPEN.E)],
  },
  {
    id: 'prog.blues.quickchange', title: 'Blues quick-change in E', genre: 'Blues',
    level: 'intermediate', tempoBpm: 88,
    description: 'Bar two goes to the IV and straight back. Shortened to eight bars.',
    teaches: 'The quick change, and dominant 7th shapes.',
    chords: [step('e1','E','7',OPEN.E), step('a1','A','7',OPEN.A), step('e2','E','7',OPEN.E), step('e3','E','7',OPEN.E),
             step('a2','A','7',OPEN.A), step('a3','A','7',OPEN.A), step('e4','E','7',OPEN.E), step('b1','B','7',OPEN.B)],
  },
  {
    id: 'prog.blues.minor.am', title: 'Minor blues in Am', genre: 'Blues',
    level: 'advanced', tempoBpm: 76,
    description: 'Am–Dm–Am–E7. Darker, and the E7 pulls much harder.',
    teaches: 'Minor blues, and why the V stays dominant.',
    chords: [step('am','A','min',OPEN.Am), step('dm','D','min',OPEN.Dm),
             step('am2','A','min',OPEN.Am), step('e7','E','7',OPEN.E)],
  },

  // ── Folk & Country ────────────────────────────────────────────────────────
  {
    id: 'prog.country.g', title: 'Country I–IV–I–V in G', genre: 'Folk & Country',
    level: 'beginner', tempoBpm: 96,
    description: 'Bright and open. Let the top strings ring.',
    teaches: 'Keeping a steady pulse while changing chords.',
    chords: [step('g','G','maj',OPEN.G), step('c','C','maj',OPEN.C),
             step('g2','G','maj',OPEN.G), step('d','D','maj',OPEN.D)],
  },
  {
    id: 'prog.folk.sus', title: 'Dsus workout: D–Dsus4–D–Dsus2', genre: 'Folk & Country',
    level: 'intermediate', tempoBpm: 80,
    description: 'One finger moves. Listen to how much changes.',
    teaches: 'Suspensions, and hearing the third leave and return.',
    chords: [step('d','D','maj',{...OPEN.D, beats:2}), step('dsus4','D','sus4',{string:4,fret:0,beats:2}),
             step('d2','D','maj',{...OPEN.D, beats:2}), step('dsus2','D','sus2',{string:4,fret:0,beats:2})],
  },
  {
    id: 'prog.folk.travis', title: 'Travis picking: C–Am–F–G', genre: 'Fingerstyle',
    level: 'advanced', tempoBpm: 66,
    description: 'No pick. Thumb alternates the bass while fingers pick the top.',
    teaches: 'Independence between thumb and fingers.',
    chords: [step('c','C','maj',{...OPEN.C, mode:'fingerstyle'}), step('am','A','min',{...OPEN.Am, mode:'fingerstyle'}),
             step('f','F','maj',{...OPEN.F, mode:'fingerstyle'}), step('g','G','maj',{...OPEN.G, mode:'fingerstyle'})],
  },
  {
    id: 'prog.fingerstyle.em-am', title: 'Fingerstyle vamp: Em–Am', genre: 'Fingerstyle',
    level: 'beginner', tempoBpm: 60,
    description: 'Slow. Thumb on the bass string, index-middle-ring on strings 3-2-1.',
    teaches: 'The p-i-m-a pattern on two easy shapes.',
    chords: [step('em','E','min',{...OPEN.Em, mode:'fingerstyle'}), step('am','A','min',{...OPEN.Am, mode:'fingerstyle'}),
             step('em2','E','min',{...OPEN.Em, mode:'fingerstyle'}), step('am2','A','min',{...OPEN.Am, mode:'fingerstyle'})],
  },

  // ── Arpeggios ─────────────────────────────────────────────────────────────
  {
    id: 'prog.arp.am-f-c-g', title: 'Arpeggios: Am–F–C–G (pick)', genre: 'Fingerstyle',
    level: 'intermediate', tempoBpm: 70,
    description: 'Pick the notes one at a time, low to high. Let them overlap.',
    teaches: 'Arpeggiating a chord without losing the shape.',
    chords: [step('am','A','min',{...OPEN.Am, mode:'arpeggio'}), step('f','F','maj',{...OPEN.F, mode:'arpeggio'}),
             step('c','C','maj',{...OPEN.C, mode:'arpeggio'}), step('g','G','maj',{...OPEN.G, mode:'arpeggio'})],
  },
  {
    id: 'prog.arp.bare', title: 'Arpeggios: D–A–Bm–G (fingers)', genre: 'Fingerstyle',
    level: 'advanced', tempoBpm: 64,
    description: 'Same idea, no pick. Bare fingers give a rounder attack.',
    teaches: 'Bare-hand arpeggios and even dynamics between fingers.',
    chords: [step('d','D','maj',{...OPEN.D, mode:'fingerstyle'}), step('a','A','maj',{...OPEN.A, mode:'fingerstyle'}),
             step('bm','B','min',{string:5,fret:2,mode:'fingerstyle'}), step('g','G','maj',{...OPEN.G, mode:'fingerstyle'})],
  },

  // ── Jazz ──────────────────────────────────────────────────────────────────
  {
    id: 'prog.jazz.ii-v-i.c', title: 'ii–V–I in C', genre: 'Jazz',
    level: 'intermediate', tempoBpm: 76,
    description: 'Dm7–G7–Cmaj7. The single most important progression in jazz.',
    teaches: 'The ii–V–I and its seventh chords.',
    chords: [step('dm7','D','min7',OPEN.Dm), step('g7','G','7',OPEN.G),
             step('cmaj7','C','maj7',OPEN.C), step('cmaj7b','C','maj7',OPEN.C)],
  },
  {
    id: 'prog.jazz.ii-v-i.minor', title: 'Minor ii–V–i in Am', genre: 'Jazz',
    level: 'advanced', tempoBpm: 72,
    description: 'Bm7b5 is hard — a B diminished shape will do while you learn it.',
    teaches: 'The minor ii–V–i and the half-diminished sound.',
    chords: [step('bdim','B','dim',{string:5,fret:2}), step('e7','E','7',OPEN.E),
             step('am','A','min',OPEN.Am), step('am2','A','min',OPEN.Am)],
  },
  {
    id: 'prog.jazz.autumn', title: 'Autumn Leaves (first eight)', genre: 'Jazz',
    level: 'advanced', tempoBpm: 68,
    description: 'Am7–D7–Gmaj7–Cmaj7–F#dim–B7–Em. A ii–V–I that keeps going.',
    teaches: 'Cycle-of-fourths movement and a real jazz standard.',
    chords: [step('am7','A','min7',OPEN.Am), step('d7','D','7',OPEN.D),
             step('gmaj7','G','maj7',OPEN.G), step('cmaj7','C','maj7',OPEN.C),
             step('fdim','F','dim',{string:6,fret:2}), step('b7','B','7',OPEN.B),
             step('em','E','min',OPEN.Em), step('em2','E','min',OPEN.Em)],
  },
  {
    id: 'prog.jazz.rhythm', title: 'Rhythm changes turnaround in G', genre: 'Jazz',
    level: 'advanced', tempoBpm: 80,
    description: 'G–Em–Am–D7, two beats each. The engine of a thousand jazz tunes.',
    teaches: 'The I–vi–ii–V turnaround at speed.',
    chords: [step('g','G','maj',{...OPEN.G,beats:2}), step('em','E','min',{...OPEN.Em,beats:2}),
             step('am','A','min',{...OPEN.Am,beats:2}), step('d7','D','7',{...OPEN.D,beats:2}),
             step('g2','G','maj',{...OPEN.G,beats:2}), step('em2','E','min',{...OPEN.Em,beats:2}),
             step('am2','A','min',{...OPEN.Am,beats:2}), step('d72','D','7',{...OPEN.D,beats:2})],
  },

  // ── Modal & Exotic ────────────────────────────────────────────────────────
  {
    id: 'prog.andalusian', title: 'Andalusian cadence: Am–G–F–E', genre: 'Modal & Exotic',
    level: 'intermediate', tempoBpm: 74,
    description: 'Flamenco, and half of what people think of as "Spanish guitar".',
    teaches: 'The descending Phrygian cadence.',
    chords: [step('am','A','min',OPEN.Am), step('g','G','maj',OPEN.G),
             step('f','F','maj',OPEN.F), step('e','E','maj',OPEN.E)],
  },
  {
    id: 'prog.dorian.vamp', title: 'Dorian vamp: Dm–G', genre: 'Modal & Exotic',
    level: 'intermediate', tempoBpm: 82,
    description: 'A minor chord with a major IV. Jazzy, floating, never resolves.',
    teaches: 'The Dorian mode and its characteristic major sixth.',
    chords: [step('dm','D','min',OPEN.Dm), step('g','G','maj',OPEN.G),
             step('dm2','D','min',OPEN.Dm), step('g2','G','maj',OPEN.G)],
  },
  {
    id: 'prog.phrygian', title: 'Phrygian: Em–F', genre: 'Modal & Exotic',
    level: 'intermediate', tempoBpm: 78,
    description: 'A minor chord and the major chord a semitone above it. Menacing.',
    teaches: 'The Phrygian flat-second, the darkest common mode.',
    chords: [step('em','E','min',OPEN.Em), step('f','F','maj',OPEN.F),
             step('em2','E','min',OPEN.Em), step('f2','F','maj',OPEN.F)],
  },
  {
    id: 'prog.pachelbel', title: 'Pachelbel: D–A–Bm–F#m–G–D–G–A', genre: 'Modal & Exotic',
    level: 'advanced', tempoBpm: 78,
    description: 'The canon. Eight chords, and you will recognise it instantly.',
    teaches: 'A long descending sequence — real chord-change stamina.',
    chords: [step('d','D','maj',OPEN.D), step('a','A','maj',OPEN.A),
             step('bm','B','min',{string:5,fret:2}), step('fsm','F#','min',{string:6,fret:2}),
             step('g','G','maj',OPEN.G), step('d2','D','maj',OPEN.D),
             step('g2','G','maj',OPEN.G), step('a2','A','maj',OPEN.A)],
  },
  {
    id: 'prog.chromatic-mediant', title: 'Uncommon: C–E–F–Fm', genre: 'Modal & Exotic',
    level: 'advanced', tempoBpm: 70,
    description: 'A major III where you expect a minor, then a borrowed minor iv.',
    teaches: 'Chromatic mediants and modal interchange — the cinematic sound.',
    chords: [step('c','C','maj',OPEN.C), step('e','E','maj',OPEN.E),
             step('f','F','maj',OPEN.F), step('fm','F','min',{string:6,fret:1})],
  },

  // ── Riffs (scored note by note) ───────────────────────────────────────────
  {
    id: 'riff.pentatonic.am', title: 'Riff: A minor pentatonic box 1', genre: 'Riffs',
    level: 'beginner', tempoBpm: 60,
    description: 'Five notes up the box, one per beat. Slow and clean.',
    teaches: 'The first shape every lead guitarist learns.',
    chords: [step('r1','A','min',{mode:'riff',string:6,fret:5,beats:4,notes:['A2','C3','D3','E3']}),
             step('r2','A','min',{mode:'riff',string:5,fret:5,beats:4,notes:['G3','A3','C4','D4']}),
             step('r3','A','min',{mode:'riff',string:5,fret:5,beats:4,notes:['D4','C4','A3','G3']}),
             step('r4','A','min',{mode:'riff',string:6,fret:5,beats:4,notes:['E3','D3','C3','A2']})],
  },
  {
    id: 'riff.open-e', title: 'Riff: open low-E groove', genre: 'Riffs',
    level: 'beginner', tempoBpm: 84,
    description: 'Open E, then the 3rd and 5th frets. Palm-mute it.',
    teaches: 'Single-string accuracy on the thickest string.',
    chords: [step('r1','E','5',{mode:'riff',string:6,fret:0,beats:4,notes:['E2','E2','G2','A2']}),
             step('r2','E','5',{mode:'riff',string:6,fret:0,beats:4,notes:['E2','A2','G2','E2']}),
             step('r3','E','5',{mode:'riff',string:6,fret:0,beats:4,notes:['E2','E2','A#2','A2']}),
             step('r4','E','5',{mode:'riff',string:6,fret:0,beats:4,notes:['G2','E2','E2','E2']})],
  },
  {
    id: 'riff.chromatic', title: 'Riff: chromatic warm-up', genre: 'Workouts',
    level: 'beginner', tempoBpm: 66,
    description: 'Frets 1-2-3-4 on the low E, one finger each. The classic warm-up.',
    teaches: 'One finger per fret, and evenness between fingers.',
    chords: [step('r1','F','5',{mode:'riff',string:6,fret:1,beats:4,notes:['F2','F#2','G2','G#2']}),
             step('r2','A','5',{mode:'riff',string:5,fret:0,beats:4,notes:['A#2','B2','C3','C#3']}),
             step('r3','D','5',{mode:'riff',string:4,fret:0,beats:4,notes:['D#3','E3','F3','F#3']}),
             step('r4','G','5',{mode:'riff',string:3,fret:0,beats:4,notes:['G#3','A3','A#3','B3']})],
  },
  {
    id: 'riff.blues-lick.e', title: 'Riff: blues lick in E', genre: 'Riffs',
    level: 'intermediate', tempoBpm: 72,
    description: 'The blue note is the B♭ — lean on it.',
    teaches: 'The blues scale and where its tension lives.',
    chords: [step('r1','E','min',{mode:'riff',string:6,fret:0,beats:4,notes:['E3','G3','A3','A#3']}),
             step('r2','E','min',{mode:'riff',string:6,fret:0,beats:4,notes:['B3','A#3','A3','G3']}),
             step('r3','E','min',{mode:'riff',string:6,fret:0,beats:4,notes:['E3','G3','B3','D4']}),
             step('r4','E','min',{mode:'riff',string:6,fret:0,beats:4,notes:['B3','G3','E3','E3']})],
  },
  {
    id: 'riff.major-scale.g', title: 'Riff: G major scale, one octave', genre: 'Workouts',
    level: 'intermediate', tempoBpm: 70,
    description: 'Up and back down. Name the notes as you play them.',
    teaches: 'The major scale under your fingers and in your ear.',
    chords: [step('r1','G','maj',{mode:'riff',string:6,fret:3,beats:4,notes:['G2','A2','B2','C3']}),
             step('r2','G','maj',{mode:'riff',string:5,fret:5,beats:4,notes:['D3','E3','F#3','G3']}),
             step('r3','G','maj',{mode:'riff',string:5,fret:5,beats:4,notes:['G3','F#3','E3','D3']}),
             step('r4','G','maj',{mode:'riff',string:6,fret:3,beats:4,notes:['C3','B2','A2','G2']})],
  },

  // ── Workouts ──────────────────────────────────────────────────────────────
  {
    id: 'prog.workout.barre-cycle', title: 'Barre cycle: F–Bb–Eb–Ab', genre: 'Workouts',
    level: 'advanced', tempoBpm: 60,
    description: 'Four barres, no open strings anywhere. Brutal and worth it.',
    teaches: 'Barre stamina and moving shapes up the neck.',
    chords: [step('f','F','maj',{string:6,fret:1}), step('bb','A#','maj',{string:5,fret:1}),
             step('eb','D#','maj',{string:6,fret:11}), step('ab','G#','maj',{string:6,fret:4})],
  },
  {
    id: 'prog.workout.caged-c', title: 'CAGED: C major in five positions', genre: 'Workouts',
    level: 'advanced', tempoBpm: 56,
    description: 'The same chord, five places on the neck. Slow — this is a map lesson.',
    teaches: 'That CAGED shapes are one chord seen from five angles.',
    chords: [step('c1','C','maj',{...OPEN.C}), step('c2','C','maj',{string:5,fret:3,shape:'fretting.caged.a-shape.major.5th'}),
             step('c3','C','maj',{string:6,fret:8}), step('c4','C','maj',{string:4,fret:10,shape:'fretting.caged.d-shape.major.10th'}),
             step('c5','C','maj',{string:5,fret:3}), step('c6','C','maj',{...OPEN.C})],
  },
  {
    id: 'prog.jazz.sixths', title: 'Sixth chords: C6–Am7–Dm7–G7', genre: 'Jazz',
    level: 'advanced', tempoBpm: 72,
    description: 'C6 and Am7 are the same four notes — the bass decides which you hear.',
    teaches: 'Sixth chords, and that a chord is a set of notes plus a bass note.',
    chords: [step('c6','C','6',OPEN.C), step('am7','A','min7',OPEN.Am),
             step('dm7','D','min7',OPEN.Dm), step('g7','G','7',OPEN.G)],
  },
  {
    id: 'prog.folk.add9', title: 'Ringing add9s: Cadd9–G–D–Em', genre: 'Folk & Country',
    level: 'intermediate', tempoBpm: 78,
    description: 'Keep the top two strings open through all four. That is the whole trick.',
    teaches: 'Add9 voicings and letting open strings ring through changes.',
    chords: [step('cadd9','C','add9',OPEN.C), step('g','G','maj',OPEN.G),
             step('d','D','maj',OPEN.D), step('em','E','min',OPEN.Em)],
  },
  {
    id: 'prog.jazz.halfdim', title: 'Half-diminished: Bm7b5–E7–Am', genre: 'Jazz',
    level: 'advanced', tempoBpm: 66,
    description: 'The minor ii–V–i done properly. Bm7b5 is the same notes as Dm6.',
    teaches: 'The half-diminished chord and its role as a minor ii.',
    chords: [step('bm7b5','B','m7b5',{string:5,fret:2}), step('e7','E','7',OPEN.E),
             step('am','A','min',OPEN.Am), step('am2','A','min',OPEN.Am)],
  },
  {
    id: 'prog.modal.dim7-passing', title: 'Passing diminished: C–C#dim7–Dm–G7', genre: 'Modal & Exotic',
    level: 'advanced', tempoBpm: 68,
    description: 'A diminished seventh walking between two chords a tone apart.',
    teaches: 'The passing diminished — a chromatic step that sounds inevitable.',
    chords: [step('c','C','maj',OPEN.C), step('csdim','C#','dim7',{string:5,fret:4}),
             step('dm','D','min',OPEN.Dm), step('g7','G','7',OPEN.G)],
  },
  {
    id: 'prog.workout.minor-shapes', title: 'Minor shapes: Am–Dm–Em–Bm', genre: 'Workouts',
    level: 'intermediate', tempoBpm: 70,
    description: 'Three open minors and one barre. Bm is the one to watch.',
    teaches: 'Minor shapes, open and barred.',
    chords: [step('am','A','min',OPEN.Am), step('dm','D','min',OPEN.Dm),
             step('em','E','min',OPEN.Em), step('bm','B','min',{string:5,fret:2})],
  },
];

// ── Sevenths, through all twelve keys ────────────────────────────────────────

/**
 * The ii–V–I in every key, generated rather than typed out.
 *
 * Twelve near-identical progressions is exactly the kind of data that rots when
 * hand-written: one transposition slip and a key teaches the wrong cadence.
 * Deriving them from the root means the shapes are right by construction, and
 * the only thing that varies is the difficulty — the guitar has opinions about
 * keys even when the theory does not.
 */
const ALL_ROOTS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Keys a guitarist meets first. The rest are barre territory, so slower. */
const FRIENDLY_KEYS: ReadonlySet<string> = new Set(['C', 'D', 'E', 'F', 'G', 'A']);

function rootSlug(root: string): string {
  return root.replace('#', 's').toLowerCase();
}

/** Lowest fret where a root sits on the 6th (E) or 5th (A) string. */
function fretOf(root: string, openPitchClass: number): number {
  const pc = pitchClassOfRoot(root);
  return pc === null ? 0 : (((pc - openPitchClass) % 12) + 12) % 12;
}

const E_STRING = 4;
const A_STRING = 9;

function seventhCadence(key: string): ChordProgression {
  const ii = transposeRoot(key, 2);
  const v = transposeRoot(key, 7);
  const friendly = FRIENDLY_KEYS.has(key);

  return {
    id: `prog.sevenths.ii-v-i.${rootSlug(key)}`,
    title: `Sevenths: ii–V–I in ${key}`,
    genre: 'Sevenths',
    level: friendly ? 'intermediate' : 'advanced',
    tempoBpm: friendly ? 72 : 64,
    description: `${ii}m7 – ${v}7 – ${key}maj7, then hold the tonic. Rootless voicings are fine — the third and seventh are what carry it.`,
    teaches: `The ii–V–I in ${key}: where the dominant pulls, and how the same three shapes move round the neck.`,
    chords: [
      step('ii', ii, 'min7', { string: 5, fret: fretOf(ii, A_STRING) }),
      step('v', v, '7', { string: 6, fret: fretOf(v, E_STRING) }),
      step('i', key, 'maj7', { string: 5, fret: fretOf(key, A_STRING) }),
      step('i2', key, 'maj7', { string: 5, fret: fretOf(key, A_STRING) }),
    ],
  };
}

export const SEVENTH_KEY_PROGRESSIONS: readonly ChordProgression[] =
  ALL_ROOTS.map(seventhCadence);

/**
 * All twelve dominant sevenths in one run, round the circle of fourths.
 *
 * Two beats each, so the whole cycle is a single 24-bar lap and you feel the
 * shapes rather than think about them.
 */
const DOMINANT_CYCLE: ChordProgression = {
  id: 'prog.sevenths.dominant-cycle',
  title: 'Dominant cycle: all twelve 7th chords',
  genre: 'Sevenths',
  level: 'advanced',
  tempoBpm: 60,
  description: 'C7 round the circle of fourths and back to C. Two beats each — keep moving.',
  teaches: 'Every dominant seventh, and that a fourth up is always the next shape along.',
  chords: Array.from({ length: 12 }, (_, i) => {
    const root = transposeRoot('C', (i * 5) % 12);
    return step(`d${i}`, root, '7', {
      beats: 2,
      string: i % 2 === 0 ? 6 : 5,
      fret: fretOf(root, i % 2 === 0 ? E_STRING : A_STRING),
    });
  }),
};

// ── Alternate tunings ────────────────────────────────────────────────────────

/** Shape notes written in standard, sounded a semitone lower. */
function flatNotes(notes: readonly string[]): string[] {
  return notes.map((note) => soundingNote(note, 'half-step-down'));
}

/** A step named by the shape you grab, rooted at the chord that sounds. */
function shapeStep(
  id: string,
  shapeRoot: string,
  quality: ChordQuality,
  tuning: TuningId,
  o: StepOpts = {},
): ProgressionChord {
  return step(id, soundingRoot(shapeRoot, tuning), quality, {
    ...o,
    label: `${shapeRoot} shape`,
  });
}

const TUNING_PROGRESSIONS: readonly ChordProgression[] = [
  {
    id: 'prog.dropd.power', title: 'Drop D: one-finger power chords', genre: 'Tunings',
    level: 'beginner', tempoBpm: 88, tuning: 'drop-d',
    description: 'D5–F5–G5–C5, each a single finger flat across the bottom three strings.',
    teaches: 'Why anyone bothers with drop D: the fifth comes for free.',
    chords: [step('d5','D','5',{mode:'palm-mute',string:6,fret:0}),
             step('f5','F','5',{mode:'palm-mute',string:6,fret:3}),
             step('g5','G','5',{mode:'palm-mute',string:6,fret:5}),
             step('c5','C','5',{mode:'palm-mute',string:6,fret:10})],
  },
  {
    id: 'riff.dropd.low-d', title: 'Drop D: low-string groove', genre: 'Tunings',
    level: 'beginner', tempoBpm: 80, tuning: 'drop-d',
    description: 'The open 6th string is now a D, a whole tone below where your ear expects it.',
    teaches: 'Where the notes moved to on the dropped string.',
    chords: [step('r1','D','5',{mode:'riff',string:6,fret:0,notes:['D2','D2','F2','G2']}),
             step('r2','D','5',{mode:'riff',string:6,fret:0,notes:['D2','G2','F2','D2']}),
             step('r3','D','5',{mode:'riff',string:6,fret:0,notes:['D2','D2','A2','G2']}),
             step('r4','D','5',{mode:'riff',string:6,fret:0,notes:['F2','D2','D2','D2']})],
  },
  {
    id: 'prog.dropd.folk', title: 'Drop D: D–C–G–D with a droning bass', genre: 'Tunings',
    level: 'intermediate', tempoBpm: 74, tuning: 'drop-d',
    description: 'Open D rings under everything. G moves to the 5th fret in this tuning — the old 3rd fret is now an A.',
    teaches: 'That every shape touching the 6th string needs re-learning two frets up.',
    chords: [step('d','D','maj',{string:6,fret:0}),
             step('c','C','maj',{string:5,fret:3,shape:'fretting.open.c'}),
             step('g','G','maj',{string:6,fret:5,label:'G, 6th string at the 5th fret'}),
             step('d2','D','maj',{string:6,fret:0})],
  },
  {
    id: 'prog.halfstep.rock', title: 'Half step down: E–A–B shapes', genre: 'Tunings',
    level: 'intermediate', tempoBpm: 76, tuning: 'half-step-down',
    description: 'The shapes you already know. They sound E♭, A♭ and B♭ — the detector agrees with your ears, not with your fingers.',
    teaches: 'That a tuning renames every chord without changing a single shape.',
    chords: [shapeStep('e','E','maj','half-step-down',{string:6,fret:0}),
             shapeStep('a','A','maj','half-step-down',{string:5,fret:0}),
             shapeStep('b','B','maj','half-step-down',{string:5,fret:2}),
             shapeStep('e2','E','maj','half-step-down',{string:6,fret:0})],
  },
  {
    id: 'prog.halfstep.power', title: 'Half step down: E5–G5–A5 shapes', genre: 'Tunings',
    level: 'beginner', tempoBpm: 92, tuning: 'half-step-down',
    description: 'Slack strings, heavier sound. Palm-mute and dig in.',
    teaches: 'Power chords in a tuning where the strings fight back less.',
    chords: [shapeStep('e5','E','5','half-step-down',{mode:'palm-mute',string:6,fret:0}),
             shapeStep('g5','G','5','half-step-down',{mode:'palm-mute',string:6,fret:3}),
             shapeStep('a5','A','5','half-step-down',{mode:'palm-mute',string:6,fret:5}),
             shapeStep('e5b','E','5','half-step-down',{mode:'palm-mute',string:6,fret:0})],
  },
  {
    id: 'riff.halfstep.pentatonic', title: 'Half step down: minor pentatonic', genre: 'Tunings',
    level: 'intermediate', tempoBpm: 68, tuning: 'half-step-down',
    description: 'The open-position E minor pentatonic shape, sounding in E♭ minor.',
    teaches: 'Hearing a familiar shape land a semitone below where you left it.',
    chords: [step('r1','D#','min',{mode:'riff',string:6,fret:0,notes:flatNotes(['E2','G2','A2','B2']),label:'E minor pentatonic shape'}),
             step('r2','D#','min',{mode:'riff',string:5,fret:0,notes:flatNotes(['D3','E3','G3','A3']),label:'E minor pentatonic shape'}),
             step('r3','D#','min',{mode:'riff',string:5,fret:0,notes:flatNotes(['A3','G3','E3','D3']),label:'E minor pentatonic shape'}),
             step('r4','D#','min',{mode:'riff',string:6,fret:0,notes:flatNotes(['B2','A2','G2','E2']),label:'E minor pentatonic shape'})],
  },
];

// ── Picking-hand riffs for the string-set skills ─────────────────────────────

/**
 * The four string-set micro-skills, as riffs Chord Hero can actually score.
 *
 * The catalog has asked for "eight notes across strings 4, 3 and 2, strict
 * down-up" since Task 3, and until now the only way to grade that was to grade
 * yourself. These stay on the named strings — every note is an open string or a
 * low fret on the target set — so a wandering pick shows up as a wrong pitch.
 */
const STRING_SET_RIFFS: readonly ChordProgression[] = [
  {
    id: 'riff.string-set.1-3', title: 'Picking: strings 1–3, alternate', genre: 'Workouts',
    level: 'beginner', tempoBpm: 72,
    description: 'Strings 3, 2 and 1 only. Strict down-up, and keep the pick shallow.',
    teaches: 'Alternate picking on the treble side without clipping a neighbour.',
    practisesSkillIds: ['picking.string-set.1-3.alternate'],
    chords: [step('r1','G','maj',{mode:'riff',string:3,fret:0,notes:['G3','B3','E4','B3']}),
             step('r2','G','maj',{mode:'riff',string:3,fret:2,notes:['A3','C4','F4','C4']}),
             step('r3','G','maj',{mode:'riff',string:1,fret:0,notes:['E4','B3','G3','B3']}),
             step('r4','G','maj',{mode:'riff',string:3,fret:0,notes:['G3','G3','B3','E4']})],
  },
  {
    id: 'riff.string-set.2-4', title: 'Picking: strings 2–4, alternate', genre: 'Workouts',
    level: 'intermediate', tempoBpm: 72,
    description: 'Strings 4, 3 and 2. Eight notes a bar, down-up throughout.',
    teaches: 'Crossing strings in the middle of the neck, where both neighbours can be hit.',
    practisesSkillIds: ['picking.string-set.2-4.alternate'],
    chords: [step('r1','D','maj',{mode:'riff',string:4,fret:0,notes:['D3','G3','B3','G3']}),
             step('r2','D','maj',{mode:'riff',string:4,fret:2,notes:['E3','A3','C4','A3']}),
             step('r3','D','maj',{mode:'riff',string:2,fret:0,notes:['B3','G3','D3','G3']}),
             step('r4','D','maj',{mode:'riff',string:4,fret:0,notes:['D3','D3','G3','B3']})],
  },
  {
    id: 'riff.string-set.4-6', title: 'Picking: strings 4–6, alternate', genre: 'Workouts',
    level: 'intermediate', tempoBpm: 68,
    description: 'The wound strings. Watch that the pick does not dig deeper as it crosses.',
    teaches: 'Even attack across the bass strings.',
    practisesSkillIds: ['picking.string-set.4-6.alternate'],
    chords: [step('r1','E','min',{mode:'riff',string:6,fret:0,notes:['E2','A2','D3','A2']}),
             step('r2','E','min',{mode:'riff',string:6,fret:2,notes:['F#2','B2','E3','B2']}),
             step('r3','E','min',{mode:'riff',string:4,fret:0,notes:['D3','A2','E2','A2']}),
             step('r4','E','min',{mode:'riff',string:6,fret:0,notes:['E2','E2','A2','D3']})],
  },
  {
    id: 'riff.string-set.3-5.skip', title: 'Picking: string skipping, 5 to 3', genre: 'Workouts',
    level: 'advanced', tempoBpm: 60,
    description: 'The 4th string is never played. Jump straight over it, both directions.',
    teaches: 'Clearing a string entirely — the pick has to travel further and still land.',
    practisesSkillIds: ['picking.string-set.3-5.skip'],
    chords: [step('r1','A','min',{mode:'riff',string:5,fret:0,notes:['A2','G3','A2','G3']}),
             step('r2','A','min',{mode:'riff',string:5,fret:2,notes:['B2','A3','B2','A3']}),
             step('r3','A','min',{mode:'riff',string:5,fret:3,notes:['C3','B3','C3','B3']}),
             step('r4','A','min',{mode:'riff',string:5,fret:0,notes:['A2','A3','G3','A2']})],
  },
];

/**
 * The whole library.
 *
 * Hand-written entries first, then the generated ones — the picker groups by
 * genre, so the ordering here only decides what comes first inside a genre.
 */
export const PROGRESSIONS: readonly ChordProgression[] = [
  ...CORE_PROGRESSIONS,
  ...SEVENTH_KEY_PROGRESSIONS,
  DOMINANT_CYCLE,
  ...TUNING_PROGRESSIONS,
  ...STRING_SET_RIFFS,
];

/** The tuning a progression wants, defaulted. */
export function tuningOf(progression: ChordProgression) {
  return TUNINGS[progression.tuning ?? DEFAULT_TUNING];
}

/** True when playing this needs the guitar re-tuned. */
export function needsRetuning(progression: ChordProgression): boolean {
  return (progression.tuning ?? DEFAULT_TUNING) !== DEFAULT_TUNING;
}

/** Progressions that drill a hand-written catalog skill, for the hand-off. */
export function progressionsForSkill(skillId: string): ChordProgression[] {
  return PROGRESSIONS.filter((p) => p.practisesSkillIds?.includes(skillId));
}

export const PROGRESSION_BY_ID: ReadonlyMap<string, ChordProgression> = new Map(
  PROGRESSIONS.map((p) => [p.id, p]),
);

/** Milliseconds one chord occupies at a given tempo. */
export function chordDurationMs(chord: ProgressionChord, tempoBpm: number): number {
  return (chord.durationBeats * 60_000) / tempoBpm;
}

export function progressionDurationMs(progression: ChordProgression, tempoBpm: number): number {
  return progression.chords.reduce((total, c) => total + chordDurationMs(c, tempoBpm), 0);
}

/**
 * Which chord is sounding at `elapsedMs`, and how far through it we are.
 *
 * Returns null past the end, which is how the panel knows the run is over.
 */
export function chordAt(
  progression: ChordProgression,
  tempoBpm: number,
  elapsedMs: number,
): { index: number; chord: ProgressionChord; startMs: number; endMs: number } | null {
  let start = 0;
  for (let index = 0; index < progression.chords.length; index += 1) {
    const chord = progression.chords[index]!;
    const end = start + chordDurationMs(chord, tempoBpm);
    if (elapsedMs < end) {
      return { index, chord, startMs: start, endMs: end };
    }
    start = end;
  }
  return null;
}

/**
 * The third is what makes a chord major or minor. Everything else is colour.
 *
 * `none` covers the qualities that simply omit the third — a power chord, a
 * suspension — which is not the same as having the *wrong* third.
 */
export type ChordThird = 'major' | 'minor' | 'none';

export function thirdOf(quality: ChordQuality): ChordThird {
  switch (quality) {
    case 'min':
    case 'min7':
    case 'dim':
    case 'min6':
    case 'dim7':
    case 'm7b5':
      return 'minor';
    case 'maj':
    case 'maj7':
    case '7':
    case 'aug':
    case '6':
    case 'add9':
      return 'major';
    case '5':
    case 'sus2':
    case 'sus4':
      return 'none';
  }
}

/**
 * Grades one observation against the target.
 *
 * Only a *contradicted* third counts as partial. This matters more than it
 * sounds: every plucked string carries a flat-7 and a major third among its
 * partials, and a third that is damped, muted or just quieter than its
 * neighbours drops out of the spectrum altogether — so a perfectly good G major
 * routinely reads as G7 or G5 through a microphone. Calling those "wrong
 * quality" punished playing that was in fact correct, which is why the verdict
 * appeared so often.
 *
 * Playing a minor chord where a major was asked for is still a partial. That is
 * a real mistake and worth being told about.
 */
export function scoreDetection(
  expected: Pick<ProgressionChord, 'root' | 'quality'>,
  detected: { root: string; quality: ChordQuality } | null,
): ChordScore {
  if (!detected) return 'unclear';
  if (detected.root === expected.root && detected.quality === expected.quality) return 'hit';

  // Same notes under a different name is not a mistake. C6 and Am7 are both
  // {C,E,G,A}; every diminished seventh is three other diminished sevenths.
  // Nothing in a pitch-class profile distinguishes them, and nothing in the
  // player's hands did either.
  const expectedMask = chordPitchClassMask(expected.root, expected.quality);
  const detectedMask = chordPitchClassMask(detected.root, detected.quality);
  if (expectedMask !== 0 && expectedMask === detectedMask) return 'hit';

  if (detected.root !== expected.root) return 'miss';

  const wanted = thirdOf(expected.quality);
  const heard = thirdOf(detected.quality);

  // An omitted third cannot contradict anything.
  if (wanted === 'none' || heard === 'none' || wanted === heard) return 'hit';

  return 'partial';
}

/**
 * Reduces a window of observations to a single grade.
 *
 * Deliberately generous to the best moment rather than the average: a strum
 * rings, decays and gets damped, and an arpeggio only spells the full chord
 * once its last note lands. Grading the peak matches how it felt to play.
 */
export function scoreWindow(
  expected: Pick<ProgressionChord, 'root' | 'quality'>,
  observations: ({ root: string; quality: ChordQuality } | null)[],
): { score: ChordScore; hits: number; observed: number } {
  const observed = observations.filter((o) => o !== null).length;
  let best: ChordScore = observed === 0 ? 'unclear' : 'miss';
  let hits = 0;

  for (const observation of observations) {
    const score = scoreDetection(expected, observation);
    if (score === 'hit') hits += 1;
    if (score === 'hit') best = 'hit';
    else if (score === 'partial' && best !== 'hit') best = 'partial';
  }

  return { score: best, hits, observed };
}

const PITCH_CLASSES: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** "A#2" or "Bb3" -> 0–11. Null for anything unparseable. */
export function pitchClassOf(noteName: string): number | null {
  const match = /^([A-G][#b]?)(-?\d+)?$/.exec(noteName.trim());
  if (!match) return null;
  const pc = PITCH_CLASSES[match[1]!];
  return pc === undefined ? null : pc;
}

/**
 * Grades a riff by how much of it was heard.
 *
 * Compared on pitch class, ignoring octave: the point of a riff drill is the
 * shape and the timing, and octave errors from the detector are common enough
 * on a low string that penalising them would teach the wrong lesson. Coverage,
 * not order — a riff played slightly out of sequence is a far smaller mistake
 * than playing the wrong notes.
 */
export interface RiffScore {
  score: ChordScore;
  matched: number;
  wanted: number;
  /** 0–1: how much of the expected sequence appeared in the right order. */
  orderRatio: number;
}

/**
 * Longest common subsequence length, on pitch classes.
 *
 * Coverage alone gave full marks for playing the right notes in the wrong
 * order, which for a riff is most of what there is to get wrong. LCS asks the
 * more useful question — how much of the phrase came out in sequence — while
 * still tolerating an extra note or a missed one, which a strict comparison
 * would not.
 */
function longestCommonSubsequence(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  let previous = new Array<number>(b.length + 1).fill(0);
  let current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }

  return previous[b.length] ?? 0;
}

export function scoreRiffWindow(
  expected: readonly string[],
  heard: readonly string[],
): RiffScore {
  const wanted = new Set(
    expected.map(pitchClassOf).filter((pc): pc is number => pc !== null),
  );
  const got = new Set(heard.map(pitchClassOf).filter((pc): pc is number => pc !== null));

  if (wanted.size === 0) return { score: 'unclear', matched: 0, wanted: 0, orderRatio: 0 };
  if (got.size === 0) {
    return { score: 'unclear', matched: 0, wanted: wanted.size, orderRatio: 0 };
  }

  let matched = 0;
  for (const pc of wanted) if (got.has(pc)) matched += 1;
  const coverage = matched / wanted.size;

  // Sequences, with consecutive repeats collapsed: the detector reports the
  // same note on every frame while it rings, and that is not a repeated note.
  const expectedSeq = expected
    .map(pitchClassOf)
    .filter((pc): pc is number => pc !== null);
  const heardSeq = heard
    .map(pitchClassOf)
    .filter((pc): pc is number => pc !== null)
    .filter((pc, i, all) => i === 0 || pc !== all[i - 1]);

  const inOrder = longestCommonSubsequence(expectedSeq, heardSeq);
  const orderRatio = expectedSeq.length > 0 ? inOrder / expectedSeq.length : 0;

  const result = (score: ChordScore): RiffScore => ({
    score,
    matched,
    wanted: wanted.size,
    orderRatio,
  });

  // Both the right notes and most of them in the right order.
  if (coverage >= 0.7 && orderRatio >= 0.6) return result('hit');
  if (coverage >= 0.34 || orderRatio >= 0.5) return result('partial');
  return result('miss');
}

/**
 * Skill id a progression's practice history is stored under.
 *
 * Namespaced so it cannot collide with the micro-skill catalog, while still
 * living in `/users/{uid}/skills` and going through the same scheduler — a
 * progression you keep fumbling comes back sooner, exactly like a chord shape.
 */
export function progressionSkillId(progressionId: string): string {
  return `chordhero.${progressionId}`;
}

/** The inverse: recovers a progression id from a skill id, or null. */
export function progressionIdFromSkillId(skillId: string): string | null {
  return skillId.startsWith('chordhero.') ? skillId.slice('chordhero.'.length) : null;
}

/**
 * Turns a run into a scheduler grade.
 *
 * Deliberately forgiving at the bottom: `fail` should mean "I could not play
 * this", not "the room was loud". Anything where more than a third of the
 * chords landed counts as at least `hard`, which brings it back soon without
 * resetting its history.
 */
export function gradeFromSummary(summary: ProgressionSummary): PracticeGrade {
  if (summary.total === 0) return 'fail';
  const clean = summary.hit / summary.total;
  const nearly = (summary.hit + summary.partial) / summary.total;

  if (clean >= 0.9) return 'easy';
  if (clean >= 0.65) return 'good';
  if (nearly >= 0.35) return 'hard';
  return 'fail';
}

export type PracticeGrade = 'easy' | 'good' | 'hard' | 'fail';

export type TimingVerdict = 'early' | 'on-time' | 'late' | 'none';

/**
 * How close the attack was to the start of its step.
 *
 * A 70 ms window either side counts as on time. That is roughly where a
 * listener stops hearing a strum as displaced, and it is wider than the
 * detector's own resolution, so the feedback reflects your playing rather than
 * the measurement.
 */
export const ON_TIME_WINDOW_MS = 70;

export function timingVerdict(offsetMs: number | null): TimingVerdict {
  if (offsetMs === null) return 'none';
  if (offsetMs < -ON_TIME_WINDOW_MS) return 'early';
  if (offsetMs > ON_TIME_WINDOW_MS) return 'late';
  return 'on-time';
}

/**
 * Folds timing into a score already earned on pitch.
 *
 * Deliberately one-way: timing can only *demote*. Landing a chord perfectly in
 * the pocket does not upgrade a wrong chord, but playing the right chord
 * conspicuously out of time is not a clean hit either — which is the whole
 * difference between a practice tool and a rhythm game.
 *
 * A missing onset never demotes. Attack detection is the least reliable part of
 * the chain: a fingerpicked chord may have no sharp attack at all, and
 * punishing that would teach you to dig in rather than to play in time.
 */
export function applyTiming(score: ChordScore, offsetMs: number | null): ChordScore {
  if (score !== 'hit') return score;
  return timingVerdict(offsetMs) === 'on-time' || offsetMs === null ? 'hit' : 'partial';
}

/**
 * A progression rebuilt from only the steps that went badly.
 *
 * The most useful thing after a run is another run of just the bits you
 * fumbled — repeating the four chords you already play cleanly is where
 * practice time goes to die. Returns null when nothing needs work.
 *
 * Duration is stretched: a step you missed deserves longer than one you nailed.
 */
export function missedStepsProgression(
  progression: ChordProgression,
  scores: ReadonlyMap<string, ChordScore>,
  tempoScale = 0.75,
): ChordProgression | null {
  const weak = progression.chords.filter((step) => {
    const score = scores.get(step.id);
    return score !== undefined && score !== 'hit';
  });

  if (weak.length === 0) return null;

  return {
    ...progression,
    id: `${progression.id}.misses`,
    title: `${progression.title} — the tricky bits`,
    description: `The ${weak.length} step${weak.length === 1 ? '' : 's'} that did not land, slower.`,
    tempoBpm: Math.max(40, Math.round(progression.tempoBpm * tempoScale)),
    chords: weak.map((step) => ({ ...step, durationBeats: step.durationBeats })),
  };
}

/**
 * Next tempo in a ramp.
 *
 * Only climbs on a clean pass, and never past 1.3× the written tempo — the
 * point is to arrive at the real speed in control, not to chase a number.
 */
export function rampTempo(
  currentBpm: number,
  baseBpm: number,
  accuracy: number,
): number {
  if (accuracy < 0.8) return currentBpm;
  return Math.min(Math.round(baseBpm * 1.3), Math.round(currentBpm * 1.1));
}

export interface ProgressionSummary {
  hit: number;
  partial: number;
  miss: number;
  unclear: number;
  total: number;
}

export function summarise(scores: ChordScore[]): ProgressionSummary {
  const summary: ProgressionSummary = { hit: 0, partial: 0, miss: 0, unclear: 0, total: scores.length };
  for (const score of scores) summary[score] += 1;
  return summary;
}
