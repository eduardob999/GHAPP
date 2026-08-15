import type { ChordProgression, ProgressionChord } from './progressions';

/**
 * Songs.
 *
 * Fifteen well-known songs reduced to the thing a beginner actually needs: the
 * chords, in order, at a tempo you can change them at. Playing something you
 * recognise is the strongest motivation this app has access to, and a chord
 * progression is a far better teacher than a drill because you can *hear* when
 * it is wrong.
 *
 * **Chords only, deliberately.** Titles and artists are here as identification
 * — this is the song you are playing — and the chord sequences are the harmonic
 * skeleton, which is not what copyright protects. No lyrics, no melodies, no
 * tablature transcribed from a recording. If you want the words, buy the song.
 *
 * Everything else comes free from being a `ChordProgression`: scored by ear,
 * scheduled by FSRS, gated by the curriculum so a song containing F does not
 * appear until F has been taught.
 *
 * Keys are chosen for open chords rather than for the record. Several of these
 * are played with a capo on the original; the chord *shapes* are what matter
 * for learning, and a capo is a transposition, not a different song.
 */

interface SongSpec {
  id: string;
  title: string;
  artist: string;
  /** Why this one is worth playing, in the app's voice. */
  teaches: string;
  tempoBpm: number;
  level: ChordProgression['level'];
  /** Chords in order: [root, quality, beats?]. */
  chords: [string, ProgressionChord['quality'], number?][];
  /** Said out loud when the song is presented, e.g. a capo note. */
  note?: string;
}

const SONGS: SongSpec[] = [
  {
    id: 'song.three-little-birds',
    title: 'Three Little Birds',
    artist: 'Bob Marley',
    teaches: 'A, D and E — three chords, and the cheerfullest song on this list.',
    tempoBpm: 74,
    level: 'beginner',
    chords: [['A', 'maj'], ['A', 'maj'], ['D', 'maj'], ['A', 'maj'], ['E', 'maj'], ['D', 'maj'], ['A', 'maj'], ['A', 'maj']],
  },
  {
    id: 'song.knockin-on-heavens-door',
    title: "Knockin' on Heaven's Door",
    artist: 'Bob Dylan',
    teaches: 'The four-chord loop that half of folk music is built on.',
    tempoBpm: 68,
    level: 'beginner',
    chords: [['G', 'maj'], ['D', 'maj'], ['A', 'min'], ['A', 'min'], ['G', 'maj'], ['D', 'maj'], ['C', 'maj'], ['C', 'maj']],
  },
  {
    id: 'song.love-me-do',
    title: 'Love Me Do',
    artist: 'The Beatles',
    teaches: 'Three chords, one bar each. The first song most people finish.',
    tempoBpm: 76,
    level: 'beginner',
    chords: [['G', 'maj'], ['C', 'maj'], ['G', 'maj'], ['C', 'maj'], ['D', 'maj'], ['C', 'maj'], ['G', 'maj'], ['G', 'maj']],
  },
  {
    id: 'song.horse-with-no-name',
    title: 'A Horse with No Name',
    artist: 'America',
    teaches: 'Two chords, back and forth. Good for getting the strumming hand steady.',
    tempoBpm: 80,
    level: 'beginner',
    chords: [['E', 'min'], ['D', 'maj'], ['E', 'min'], ['D', 'maj'], ['E', 'min'], ['D', 'maj'], ['E', 'min'], ['D', 'maj']],
  },
  {
    id: 'song.stand-by-me',
    title: 'Stand by Me',
    artist: 'Ben E. King',
    teaches: 'The 50s progression — I–vi–IV–V — in the key everyone plays it in.',
    tempoBpm: 72,
    level: 'beginner',
    chords: [['G', 'maj'], ['G', 'maj'], ['E', 'min'], ['E', 'min'], ['C', 'maj'], ['D', 'maj'], ['G', 'maj'], ['G', 'maj']],
  },
  {
    id: 'song.zombie',
    title: 'Zombie',
    artist: 'The Cranberries',
    teaches: 'Four chords that never resolve. Let each one ring its full bar.',
    tempoBpm: 76,
    level: 'beginner',
    chords: [['E', 'min'], ['C', 'maj'], ['G', 'maj'], ['D', 'maj'], ['E', 'min'], ['C', 'maj'], ['G', 'maj'], ['D', 'maj']],
  },
  {
    id: 'song.riptide',
    title: 'Riptide',
    artist: 'Vance Joy',
    teaches: 'Am–G–C, over and over, quickly. A change-speed test disguised as a song.',
    tempoBpm: 82,
    level: 'beginner',
    note: 'Recorded with a capo at the 1st fret. Without one it sounds a semitone low — the shapes are the same.',
    chords: [['A', 'min'], ['G', 'maj'], ['C', 'maj'], ['C', 'maj'], ['A', 'min'], ['G', 'maj'], ['C', 'maj'], ['C', 'maj']],
  },
  {
    id: 'song.bad-moon-rising',
    title: 'Bad Moon Rising',
    artist: 'Creedence Clearwater Revival',
    teaches: 'D–A–G, and a strum that has to stay even while the chords move fast.',
    tempoBpm: 84,
    level: 'beginner',
    chords: [['D', 'maj'], ['A', 'maj'], ['G', 'maj'], ['D', 'maj'], ['D', 'maj'], ['A', 'maj'], ['G', 'maj'], ['D', 'maj']],
  },
  {
    id: 'song.im-yours',
    title: "I'm Yours",
    artist: 'Jason Mraz',
    teaches: 'G–D–Em–C. The four chords that will play a hundred other songs.',
    tempoBpm: 78,
    level: 'beginner',
    note: 'Recorded with a capo at the 4th fret.',
    chords: [['G', 'maj'], ['D', 'maj'], ['E', 'min'], ['C', 'maj'], ['G', 'maj'], ['D', 'maj'], ['E', 'min'], ['C', 'maj']],
  },
  {
    id: 'song.perfect',
    title: 'Perfect',
    artist: 'Ed Sheeran',
    teaches: 'The same four chords in a waltz — three beats to the bar, not four.',
    tempoBpm: 64,
    level: 'beginner',
    note: 'Three beats per bar. Count 1-2-3, not 1-2-3-4.',
    chords: [['G', 'maj', 3], ['E', 'min', 3], ['C', 'maj', 3], ['D', 'maj', 3], ['G', 'maj', 3], ['E', 'min', 3], ['C', 'maj', 3], ['D', 'maj', 3]],
  },
  {
    id: 'song.let-it-be',
    title: 'Let It Be',
    artist: 'The Beatles',
    teaches: 'C–G–Am–F. The F is the hard one, and the reason this is not first on the list.',
    tempoBpm: 70,
    level: 'intermediate',
    chords: [['C', 'maj'], ['G', 'maj'], ['A', 'min'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj'], ['F', 'maj'], ['C', 'maj']],
  },
  {
    id: 'song.with-or-without-you',
    title: 'With or Without You',
    artist: 'U2',
    teaches: 'Four chords, one bar each, for the whole song. Ideal for locking in a strum.',
    tempoBpm: 76,
    level: 'beginner',
    chords: [['D', 'maj'], ['A', 'maj'], ['B', 'min'], ['G', 'maj'], ['D', 'maj'], ['A', 'maj'], ['B', 'min'], ['G', 'maj']],
  },
  {
    id: 'song.sweet-home-alabama',
    title: 'Sweet Home Alabama',
    artist: 'Lynyrd Skynyrd',
    teaches: 'D–C–G on a loop. The changes are quick — start slower than feels right.',
    tempoBpm: 88,
    level: 'beginner',
    chords: [['D', 'maj', 2], ['C', 'maj', 2], ['G', 'maj', 4], ['D', 'maj', 2], ['C', 'maj', 2], ['G', 'maj', 4]],
  },
  {
    id: 'song.wonderwall',
    title: 'Wonderwall',
    artist: 'Oasis',
    teaches: 'Em7 and Cmaj7 — the two chords that make this sound like the record.',
    tempoBpm: 74,
    level: 'intermediate',
    note: 'Recorded with a capo at the 2nd fret.',
    chords: [['E', 'min7'], ['G', 'maj'], ['D', 'maj'], ['A', 'maj'], ['E', 'min7'], ['G', 'maj'], ['D', 'maj'], ['A', 'maj']],
  },
  {
    id: 'song.hallelujah',
    title: 'Hallelujah',
    artist: 'Leonard Cohen',
    teaches: 'C–Am–F–G, and the patience to let a slow song stay slow.',
    tempoBpm: 60,
    level: 'intermediate',
    chords: [['C', 'maj'], ['A', 'min'], ['C', 'maj'], ['A', 'min'], ['F', 'maj'], ['G', 'maj'], ['C', 'maj'], ['C', 'maj']],
  },
];

function toProgression(song: SongSpec): ChordProgression {
  return {
    id: song.id,
    title: song.title,
    genre: 'Songs',
    level: song.level,
    tempoBpm: song.tempoBpm,
    description: `${song.artist}.${song.note ? ` ${song.note}` : ''}`,
    teaches: song.teaches,
    chords: song.chords.map(([root, quality, beats], index) => ({
      id: `s${index}`,
      root,
      quality,
      durationBeats: beats ?? 4,
      mode: 'strum' as const,
    })),
  };
}

/** The songs, as progressions — scored, scheduled and gated like everything else. */
export const SONG_PROGRESSIONS: readonly ChordProgression[] = SONGS.map(toProgression);

/** Artist for a song id, for the listing. Not part of the progression itself. */
export const ARTIST_BY_SONG: ReadonlyMap<string, string> = new Map(
  SONGS.map((song) => [song.id, song.artist]),
);
