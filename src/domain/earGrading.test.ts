import { describe, expect, it } from 'vitest';

import type { ChordQuality } from '../audio/chordDetection';
import {
  compareHeard,
  describeEarResult,
  describeRiffPositions,
  formatFretPosition,
  fretPositionOf,
  gradeByEar,
  midiOf,
  noteAt,
  targetChordFor,
  type EarResult,
  type EarVerdict,
  type HeardChord,
  type TargetChord,
} from './earGrading';
import {
  SKILL_CATALOG,
  type FrettingMetadata,
  type FrettingSkillDefinition,
  type MicroSkillDefinition,
  type PracticeResult,
} from './skills';

/** The chord under the microscope unless a test says otherwise. */
const G_MAJOR: TargetChord = { root: 'G', quality: 'maj' };

const heard = (root: string, quality: ChordQuality): HeardChord => ({ root, quality });

/** A rep's worth of frames: `n` copies of the same reading. */
const window = (n: number, frame: HeardChord): HeardChord[] =>
  Array.from({ length: n }, () => frame);

/** Best to worst, so a test can say "no worse than" without naming a grade. */
const GRADE_RANK: Record<PracticeResult, number> = { fail: 0, hard: 1, good: 2, easy: 3 };

const shape = (metadata: FrettingMetadata): MicroSkillDefinition => ({
  id: 'test.shape',
  category: 'fretting_shape',
  difficulty: 'beginner',
  title: 'A shape that exists only in this file',
  description: 'Fixture.',
  active: true,
  metadata,
});

describe('noteAt', () => {
  it('numbers the strings the way a guitarist does, 6 low and 1 high', () => {
    // The whole domain and every diagram in the app agree on this direction.
    // Flipping it silently renames every chord a fretting skill is graded
    // against, and nothing else in the module would complain.
    expect(noteAt(6, 0)).toBe('E');
    expect(noteAt(5, 0)).toBe('A');
    expect(noteAt(4, 0)).toBe('D');
    expect(noteAt(3, 0)).toBe('G');
    expect(noteAt(2, 0)).toBe('B');
    expect(noteAt(1, 0)).toBe('E');
  });

  it('climbs a semitone per fret and returns to the same name an octave up', () => {
    expect(noteAt(6, 1)).toBe('F');
    expect(noteAt(6, 12)).toBe('E');
    expect(noteAt(5, 3)).toBe('C');
    expect(noteAt(6, 24)).toBe('E');
  });

  it('refuses a string that is not on the guitar rather than guessing one', () => {
    expect(noteAt(0, 0)).toBeNull();
    expect(noteAt(7, 0)).toBeNull();
    expect(noteAt(-1, 0)).toBeNull();
  });

  it('refuses a fret behind the nut', () => {
    expect(noteAt(6, -1)).toBeNull();
  });
});

describe('targetChordFor', () => {
  it('derives the chord from the catalog, so a shape cannot drift from what grades it', () => {
    // A C-shape rooted on the 5th string at the 3rd fret is a C major. The
    // point of deriving it is that the chord and the diagram cannot disagree.
    const skill = SKILL_CATALOG.find((s) => s.id === 'fretting.caged.c-shape.major.3rd');
    expect(skill).toBeDefined();
    expect(targetChordFor(skill!)).toEqual({ root: 'C', quality: 'maj' });
  });

  it('grades an open position, where the root sits at fret zero', () => {
    // Fret 0 is falsy, so a presence check written the obvious way would drop
    // every open chord in the catalog. Twelve of them carry `rootFret: 0`.
    expect(targetChordFor(shape({ chordQuality: 'major', rootString: 6, rootFret: 0 }))).toEqual({
      root: 'E',
      quality: 'maj',
    });
  });

  it('returns null for a skill that is not a fretting shape', () => {
    const picking: MicroSkillDefinition = {
      id: 'test.picking',
      category: 'picking_technique',
      difficulty: 'beginner',
      title: 'Fixture',
      description: 'Fixture.',
      active: true,
      metadata: { technique: 'pick', targetStrings: [6, 5] },
    };
    expect(targetChordFor(picking)).toBeNull();
  });

  it('returns null when the metadata does not say where the root is', () => {
    expect(targetChordFor(shape({ chordQuality: 'major', rootFret: 3 }))).toBeNull();
    expect(targetChordFor(shape({ chordQuality: 'major', rootString: 5 }))).toBeNull();
    expect(targetChordFor(shape({ rootString: 5, rootFret: 3 }))).toBeNull();
  });

  it('returns null for a quality it has no mapping for, rather than guessing major', () => {
    // `sus2` and `sus4` are legal catalog qualities and have no entry in the
    // mapping table. Nothing in the catalog uses them today, so this pins the
    // behaviour before somebody adds a sus shape: ungradeable is the safe
    // answer, a silent fallback to major is not.
    expect(targetChordFor(shape({ chordQuality: 'sus2', rootString: 5, rootFret: 3 }))).toBeNull();
    expect(targetChordFor(shape({ chordQuality: 'sus4', rootString: 5, rootFret: 3 }))).toBeNull();
  });

  it('maps both spellings of a dominant seventh onto the same quality', () => {
    const a = targetChordFor(shape({ chordQuality: 'dominant', rootString: 6, rootFret: 3 }));
    const b = targetChordFor(shape({ chordQuality: 'dominant7', rootString: 6, rootFret: 3 }));
    expect(a).toEqual({ root: 'G', quality: '7' });
    expect(a).toEqual(b);
  });

  it('derives a chord for every catalog shape that carries the metadata to do it', () => {
    // The docstring promises a new shape becomes gradeable with no extra data.
    // This is the check that the promise still holds across all 56 skills.
    const gradeable = SKILL_CATALOG.filter(
      (s): s is FrettingSkillDefinition =>
        s.category === 'fretting_shape' &&
        s.metadata.rootString !== undefined &&
        s.metadata.rootFret !== undefined &&
        s.metadata.chordQuality !== undefined,
    );

    expect(gradeable.length).toBeGreaterThan(0);
    for (const skill of gradeable) {
      expect(targetChordFor(skill), skill.id).not.toBeNull();
    }
  });
});

describe('compareHeard', () => {
  it('reports a frame that carried nothing as unheard, never as wrong', () => {
    // This is the module's reason for existing, stated in its own header: a
    // flat battery, a muted interface or a player who stopped to answer the
    // door is not a failure to play the chord. It is the same one-way rule the
    // repo applies to timing, where a missing onset never demotes: an
    // observation the microphone failed to make is not evidence against the
    // player. Anything that turns this into 'wrong' poisons the schedule with
    // events that never happened.
    expect(compareHeard(G_MAJOR, null)).toBe('unheard');
  });

  it('calls an exact match clean', () => {
    expect(compareHeard(G_MAJOR, heard('G', 'maj'))).toBe('clean');
  });

  it('calls the same set of notes under another name clean', () => {
    // C6 and Am7 are both {C, E, G, A}. A pitch-class profile cannot tell them
    // apart because there is nothing to tell apart, so calling one an error
    // would punish a correct chord for how the detector chose to name it.
    expect(compareHeard({ root: 'C', quality: '6' }, heard('A', 'min7'))).toBe('clean');
    expect(compareHeard({ root: 'A', quality: 'min7' }, heard('C', '6'))).toBe('clean');
  });

  it('calls every rotation of a diminished seventh clean', () => {
    for (const root of ['D#', 'F#', 'A']) {
      expect(compareHeard({ root: 'C', quality: 'dim7' }, heard(root, 'dim7'))).toBe('clean');
    }
  });

  it('calls a third that never speaks close, because that is a damped string', () => {
    expect(compareHeard(G_MAJOR, heard('G', '5'))).toBe('close');
    expect(compareHeard({ root: 'G', quality: 'min' }, heard('G', '5'))).toBe('close');
  });

  it('calls a ringing seventh close, because a plucked string carries one', () => {
    // Every plucked string puts a flat 7th in its own partials, so a plain G
    // read as G7 is the detector describing a correct chord.
    expect(compareHeard(G_MAJOR, heard('G', '7'))).toBe('close');
    expect(compareHeard(G_MAJOR, heard('G', 'maj7'))).toBe('close');
    expect(compareHeard(G_MAJOR, heard('G', '6'))).toBe('close');
    expect(compareHeard(G_MAJOR, heard('G', 'add9'))).toBe('close');
  });

  it('calls a contradicted third wrong, in both directions', () => {
    // The one thing the rule is strict about: major against minor is the other
    // chord entirely, not a bad reading of this one.
    expect(compareHeard(G_MAJOR, heard('G', 'min'))).toBe('wrong');
    expect(compareHeard({ root: 'G', quality: 'min' }, heard('G', 'maj'))).toBe('wrong');
    expect(compareHeard(G_MAJOR, heard('G', 'dim'))).toBe('wrong');
    expect(compareHeard({ root: 'G', quality: 'min7' }, heard('G', '7'))).toBe('wrong');
  });

  it('treats an absent third as close from either side', () => {
    // A power chord heard where a triad was wanted, and a triad heard where a
    // power chord was wanted, are both a third nobody can confirm.
    expect(compareHeard({ root: 'G', quality: '5' }, heard('G', 'min'))).toBe('close');
    expect(compareHeard({ root: 'G', quality: '5' }, heard('G', 'maj'))).toBe('close');
    expect(compareHeard({ root: 'G', quality: 'sus4' }, heard('G', 'min'))).toBe('close');
  });

  it('calls a different root wrong however close the quality', () => {
    expect(compareHeard(G_MAJOR, heard('A', 'maj'))).toBe('wrong');
    expect(compareHeard(G_MAJOR, heard('G#', 'maj'))).toBe('wrong');
    expect(compareHeard(G_MAJOR, heard('D', 'maj'))).toBe('wrong');
  });

  it('recognises a flat spelling of a root as the same chord', () => {
    // Was the FINDING recorded here, asserting the defect rather than
    // endorsing it. docs/NEXT.md 16f, now fixed: the root resolves through
    // `pitchClassOfRoot`, which knows both spellings.
    expect(compareHeard({ root: 'Bb', quality: 'maj' }, heard('A#', 'maj'))).toBe('clean');
    expect(compareHeard({ root: 'Db', quality: 'maj' }, heard('C#', 'maj'))).toBe('clean');
  });

  it('no longer reads two unspellable roots as the same chord', () => {
    // The dangerous half of the same finding, and the one that was live here:
    // this call site compared masks with a bare `===`, so two roots that both
    // masked to 0 graded CLEAN. A wrong answer accepted, which is the
    // direction that costs the player a rep they never earned.
    //
    // The roots have to be genuine nonsense to reach it. Fixing the flat
    // lookup moved `Bb` and `Db` onto real, different masks, so the pair that
    // originally demonstrated the bug no longer exercises the guard at all: a
    // mutation run with the guard deleted passed all 335 tests. What is left
    // is a typo in the catalog, which is precisely what `samePitchClass` in
    // tunings.ts exists to make fail visibly rather than silently.
    expect(compareHeard({ root: 'H', quality: 'maj' }, heard('Zz', 'min'))).toBe('wrong');
    expect(compareHeard({ root: 'H', quality: 'maj' }, heard('H', 'min'))).toBe('wrong');
    expect(compareHeard({ root: 'Bb', quality: 'maj' }, heard('Db', 'min'))).toBe('wrong');
  });
});

describe('gradeByEar', () => {
  it('files a silent rep as unheard with no grade at all, rather than as a failure', () => {
    // The property the whole module is built around. A grade of null means
    // nothing is written to the scheduler, so a rep the microphone missed
    // cannot move a due date. Turning this into 'fail' would teach the
    // schedule that skills decay every time the interface is muted.
    const result = gradeByEar(G_MAJOR, window(20, null));

    expect(result.grade).toBeNull();
    expect(result.verdict).toBe('unheard');
    expect(result.heardFrames).toBe(0);
    expect(result.mostHeard).toBeNull();
  });

  it('files an empty window as unheard rather than dividing by zero', () => {
    const result = gradeByEar(G_MAJOR, []);

    expect(result.grade).toBeNull();
    expect(result.verdict).toBe('unheard');
    expect(result.totalFrames).toBe(0);
    expect(result.cleanFraction).toBe(0);
    expect(result.closeFraction).toBe(0);
  });

  it('still refuses to grade when only a frame or two carried a chord', () => {
    // Two clean frames in twenty is 10 per cent, under the 15 per cent floor.
    // A rep this thin is a microphone problem, not a playing problem, even
    // when everything it did catch was perfect.
    const frames = [...window(2, heard('G', 'maj')), ...window(18, null)];
    const result = gradeByEar(G_MAJOR, frames);

    expect(result.grade).toBeNull();
    expect(result.verdict).toBe('unheard');
    expect(result.heardFrames).toBe(2);
  });

  it('fails a barely audible rep that was clean whenever it was audible', () => {
    // FINDING, and the edge sits one frame away from the test above. Three
    // clean frames in twenty clears the 15 per cent hearing floor, and then
    // both grading thresholds are measured against the whole window, so the
    // rep is filed as 'fail'. Every frame that carried a chord carried the
    // right one. The module header says it deliberately does not punish
    // silence; at exactly this share it does. Recorded as the code behaves.
    const frames = [...window(3, heard('G', 'maj')), ...window(17, null)];
    const result = gradeByEar(G_MAJOR, frames);

    expect(result.grade).toBe('fail');
    expect(result.verdict).toBe('wrong');
    expect(result.cleanFraction).toBeCloseTo(0.15, 10);
  });

  it('calls a chord held cleanly for a third of the rep good, not merely passable', () => {
    // Generous about duration on purpose: the rest of a rep is spent changing
    // into the chord and out of it again.
    const frames = [...window(7, heard('G', 'maj')), ...window(13, null)];
    const result = gradeByEar(G_MAJOR, frames);

    expect(result.grade).toBe('good');
    expect(result.verdict).toBe('clean');
  });

  it('calls a chord held cleanly for most of the rep easy', () => {
    const frames = [...window(12, heard('G', 'maj')), ...window(8, null)];
    expect(gradeByEar(G_MAJOR, frames).grade).toBe('easy');
  });

  it('fails a confidently wrong chord however long it is held', () => {
    // Strict about identity in the same breath as being generous about
    // duration: twenty frames of a spotless E minor is still not a G.
    const result = gradeByEar(G_MAJOR, window(20, heard('E', 'min')));

    expect(result.grade).toBe('fail');
    expect(result.verdict).toBe('wrong');
    expect(result.cleanFraction).toBe(0);
  });

  it('grades a chord whose third never speaks as hard rather than a failure', () => {
    const result = gradeByEar(G_MAJOR, window(20, heard('G', '5')));

    expect(result.grade).toBe('hard');
    expect(result.verdict).toBe('close');
    expect(result.closeFraction).toBe(1);
    expect(result.cleanFraction).toBe(0);
  });

  it('never lowers the grade when more of the rep comes back clean', () => {
    // Monotonicity is the property a threshold tweak breaks first, and it is
    // the one a player would notice: playing more of the chord correctly must
    // never score worse.
    let previous = -1;
    for (let clean = 0; clean <= 20; clean += 1) {
      const frames = [
        ...window(clean, heard('G', 'maj')),
        ...window(20 - clean, heard('E', 'min')),
      ];
      const grade = gradeByEar(G_MAJOR, frames).grade;
      expect(grade).not.toBeNull();

      const rank = GRADE_RANK[grade!];
      expect(rank, `${clean} clean frames`).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it('does not care what order the frames arrived in', () => {
    // There is no timing dimension here, only a tally, and two runs of the
    // same rep must agree.
    const front = [...window(8, heard('G', 'maj')), ...window(12, heard('E', 'min'))];
    const interleaved = front.slice().reverse();

    expect(gradeByEar(G_MAJOR, interleaved)).toEqual(gradeByEar(G_MAJOR, front));
  });

  it('reports what was heard most often, ignoring the frames that carried nothing', () => {
    // This is what the feedback line names back to the player, so it has to be
    // the chord actually played, not the first frame or the silence around it.
    const frames = [
      ...window(4, null),
      ...window(3, heard('E', 'min')),
      ...window(9, heard('C', 'maj')),
      ...window(4, null),
    ];
    const result = gradeByEar(G_MAJOR, frames);

    expect(result.mostHeard).toEqual({ root: 'C', quality: 'maj' });
    expect(result.heardFrames).toBe(12);
    expect(result.totalFrames).toBe(20);
  });

  it('measures both fractions against the whole window, not against what it heard', () => {
    // FINDING. `EarResult` documents `cleanFraction` as "Fraction of heard
    // frames that matched cleanly" and `closeFraction` as "Fraction that were
    // at least close", but both are divided by `totalFrames`. Ten clean frames
    // out of twenty, where only those ten carried any chord at all, reports
    // 0.5 and not 1.0. The grading thresholds are calibrated on the divisor
    // the code uses, so this is a comment to fix rather than a divisor to
    // change. Recorded as the code behaves.
    const frames = [...window(10, heard('G', 'maj')), ...window(10, null)];
    const result = gradeByEar(G_MAJOR, frames);

    expect(result.heardFrames).toBe(10);
    expect(result.cleanFraction).toBe(0.5);
    expect(result.closeFraction).toBe(0.5);
  });

  it('is deterministic: the same rep graded twice gives the same answer', () => {
    const frames = [
      ...window(6, heard('G', 'maj')),
      ...window(4, heard('G', '5')),
      ...window(10, null),
    ];
    expect(gradeByEar(G_MAJOR, frames)).toEqual(gradeByEar(G_MAJOR, frames));
  });
});

describe('describeEarResult', () => {
  const resultFor = (frames: readonly HeardChord[]): EarResult => gradeByEar(G_MAJOR, frames);

  it('says it could not hear rather than blaming the player', () => {
    // The line a muted interface produces. It must read as an instruction
    // about the microphone, never as a verdict on the playing.
    const line = describeEarResult(G_MAJOR, resultFor(window(20, null)));

    expect(line).toContain('Did not hear that one');
    expect(line).toContain('closer to the microphone');
    expect(line).not.toContain('not a G');
  });

  it('names the chord the way a player writes it', () => {
    const clean = (quality: ChordQuality): string =>
      describeEarResult(
        { root: 'G', quality },
        gradeByEar({ root: 'G', quality }, window(20, heard('G', quality))),
      );

    expect(clean('maj')).toBe('Clean G, held well.');
    expect(clean('min')).toBe('Clean Gm, held well.');
    expect(clean('7')).toBe('Clean G7, held well.');
    expect(clean('maj7')).toBe('Clean Gmaj7, held well.');
    expect(clean('5')).toBe('Clean G5, held well.');
  });

  it('asks for a longer hold when the chord was right but brief', () => {
    const brief = resultFor([...window(7, heard('G', 'maj')), ...window(13, null)]);

    expect(brief.verdict).toBe('clean');
    expect(describeEarResult(G_MAJOR, brief)).toBe('That was G. Hold it a little longer next time.');
  });

  it('names what it actually heard when the chord was the wrong one', () => {
    const wrong = resultFor(window(20, heard('E', 'min')));

    expect(describeEarResult(G_MAJOR, wrong)).toBe('That sounded like E, not G.');
  });

  it('still produces a line when there is nothing to name', () => {
    // A defensive branch: `gradeByEar` cannot reach 'wrong' with nothing heard,
    // since a grade at all requires 15 per cent of the window to carry a
    // chord. Pinned so a future caller that builds an EarResult by hand does
    // not print "undefined" at the player.
    const handBuilt: EarResult = {
      grade: 'fail',
      cleanFraction: 0,
      closeFraction: 0,
      heardFrames: 0,
      totalFrames: 20,
      mostHeard: null,
      verdict: 'wrong',
    };

    expect(describeEarResult(G_MAJOR, handBuilt)).toBe('That was not G yet.');
  });

  it('always returns a line, whatever the verdict', () => {
    const verdicts: EarVerdict[] = ['clean', 'close', 'wrong', 'unheard'];
    for (const verdict of verdicts) {
      const line = describeEarResult(G_MAJOR, {
        grade: null,
        cleanFraction: 0.4,
        closeFraction: 0.6,
        heardFrames: 8,
        totalFrames: 20,
        mostHeard: heard('E', 'min'),
        verdict,
      });
      expect(line.length, verdict).toBeGreaterThan(0);
      expect(line, verdict).not.toContain('undefined');
    }
  });
});

describe('midiOf', () => {
  it('puts A4 at 69, which is what every tuner in the app already assumes', () => {
    expect(midiOf('A4')).toBe(69);
  });

  it('agrees with the open strings the fretboard search is built on', () => {
    // If these two tables ever drift, `fretPositionOf` starts sending people to
    // the wrong fret with no error anywhere.
    expect(midiOf('E2')).toBe(40);
    expect(midiOf('A2')).toBe(45);
    expect(midiOf('D3')).toBe(50);
    expect(midiOf('G3')).toBe(55);
    expect(midiOf('B3')).toBe(59);
    expect(midiOf('E4')).toBe(64);
  });

  it('reads the five common flat spellings as their sharp equivalents', () => {
    expect(midiOf('Bb3')).toBe(midiOf('A#3'));
    expect(midiOf('Eb3')).toBe(midiOf('D#3'));
    expect(midiOf('Db4')).toBe(midiOf('C#4'));
    expect(midiOf('Gb4')).toBe(midiOf('F#4'));
    expect(midiOf('Ab4')).toBe(midiOf('G#4'));
  });

  it('returns null for the two flat spellings that have no entry', () => {
    // Cb and Fb are the notes with no black key under them, and the table does
    // not carry them. Recorded because a riff written in a flat key could hit
    // one, and it would silently print the raw note name instead of a fret.
    expect(midiOf('Cb4')).toBeNull();
    expect(midiOf('Fb4')).toBeNull();
  });

  it('handles the negative octave at the bottom of the MIDI range', () => {
    expect(midiOf('C-1')).toBe(0);
  });

  it('returns null for anything that is not a note with an octave', () => {
    expect(midiOf('H4')).toBeNull();
    expect(midiOf('A')).toBeNull();
    expect(midiOf('')).toBeNull();
    expect(midiOf('A4 ')).toBeNull();
    expect(midiOf('not a note')).toBeNull();
  });
});

describe('fretPositionOf', () => {
  it('places a note at the lowest fret that reaches it', () => {
    // The stated preference is the open position, because that is where a
    // beginner's hand already is.
    expect(fretPositionOf('E2')).toEqual({ string: 6, fret: 0 });
    expect(fretPositionOf('A2')).toEqual({ string: 5, fret: 0 });
    expect(fretPositionOf('C3')).toEqual({ string: 5, fret: 3 });
    expect(fretPositionOf('E3')).toEqual({ string: 4, fret: 2 });
    expect(fretPositionOf('A3')).toEqual({ string: 3, fret: 2 });
  });

  it('keeps every position it returns on the guitar', () => {
    for (const note of ['E2', 'G3', 'C4', 'A4', 'E4', 'D3']) {
      const position = fretPositionOf(note);
      expect(position, note).not.toBeNull();
      expect(position!.string, note).toBeGreaterThanOrEqual(1);
      expect(position!.string, note).toBeLessThanOrEqual(6);
      expect(position!.fret, note).toBeGreaterThanOrEqual(0);
      expect(position!.fret, note).toBeLessThanOrEqual(12);
    }
  });

  it('returns null for a note the guitar cannot reach at all', () => {
    expect(fretPositionOf('C1')).toBeNull();
    expect(fretPositionOf('A5')).toBeNull();
  });

  it('reaches further up the neck when it is allowed to', () => {
    expect(fretPositionOf('A5', 24)).toEqual({ string: 1, fret: 17 });
  });

  it('returns null for something that is not a note', () => {
    expect(fretPositionOf('H4')).toBeNull();
    expect(fretPositionOf('')).toBeNull();
  });
});

describe('describeRiffPositions', () => {
  it('writes a riff as string and fret, the way a chord chart reads', () => {
    expect(formatFretPosition({ string: 6, fret: 5 })).toBe('6:5');
    expect(describeRiffPositions(['E2', 'C3'])).toBe('6:0  5:3');
  });

  it('takes the open string every time, even when that leaves the hand position', () => {
    // FINDING. The docstring gives "A2 C3 D3 E3" as "6:5 5:3 5:5 4:2", a riff
    // sitting under one hand at the 5th fret, and says the sort "keeps a riff
    // inside one hand position". The code sorts each note independently by
    // lowest fret, with no memory of the note before it, so two of those four
    // come out elsewhere: A2 is played open on the 5th string and D3 open on
    // the 4th. The result is playable but it is spread over four strings and
    // three hand positions rather than one. Recorded as the code behaves; the
    // comment describes an intention the sort does not implement.
    expect(describeRiffPositions(['A2', 'C3', 'D3', 'E3'])).toBe('5:0  5:3  4:0  4:2');
  });

  it('leaves a note it cannot place exactly as it was written', () => {
    // Better a note name the player can look up than a blank in the middle of
    // a riff.
    expect(describeRiffPositions(['A2', 'wobble', 'E3'])).toBe('5:0  wobble  4:2');
  });

  it('returns an empty line for an empty riff', () => {
    expect(describeRiffPositions([])).toBe('');
  });
});
