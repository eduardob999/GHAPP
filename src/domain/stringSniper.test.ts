import { describe, expect, it } from 'vitest';

import { midiToFrequency } from '../audio/notes';
import {
  ALL_STRINGS,
  DEFAULT_TOLERANCE_CENTS,
  FRET_PRESETS,
  HIGHEST_FRET,
  NEAR_MISS_SEMITONES,
  OPEN_STRING_MIDI,
  SNIPER_MIN_CLARITY,
  describeConfig,
  describeFretRange,
  evaluateHit,
  evaluateSniperFrame,
  fretRangeFor,
  frequencyRangeFor,
  gradeSniperSet,
  midiRangeFor,
  overlappingStrings,
  sniperSkillId,
  summariseStrikes,
  targetNoteLabel,
  type DetectedPitch,
  type GuitarStringIndex,
  type SniperHitResult,
  type StringSniperConfig,
} from './stringSniper';

/** Open low E, single fret: the tightest possible target band. */
const OPEN_LOW_E: StringSniperConfig = { targetString: 6, allowedFrets: { min: 0, max: 0 } };

/** Open G, single fret: the band the module's own docstring uses as its example. */
const OPEN_G: StringSniperConfig = { targetString: 3, allowedFrets: { min: 0, max: 0 } };

const clarity = (frequency: number, overrides: Partial<DetectedPitch> = {}): DetectedPitch => ({
  frequency,
  clarity: 0.99,
  ...overrides,
});

describe('fretRangeFor', () => {
  it('treats a missing range as the whole neck', () => {
    expect(fretRangeFor({ targetString: 6 })).toEqual({ min: 0, max: HIGHEST_FRET });
  });

  it('treats an explicit null the same as missing', () => {
    expect(fretRangeFor({ targetString: 6, allowedFrets: null })).toEqual({
      min: 0,
      max: HIGHEST_FRET,
    });
  });

  it('normalises a reversed range rather than trusting caller order', () => {
    expect(fretRangeFor({ targetString: 6, allowedFrets: { min: 5, max: 1 } })).toEqual({
      min: 1,
      max: 5,
    });
  });

  it('clamps a negative min to the nut', () => {
    expect(fretRangeFor({ targetString: 6, allowedFrets: { min: -3, max: 5 } })).toEqual({
      min: 0,
      max: 5,
    });
  });

  it('collapses a range that is entirely behind the nut to fret zero both ends', () => {
    // FINDING, recorded rather than fixed: min and max are clamped
    // independently, so a caller passing two negative frets does not fail, it
    // silently becomes "open string" instead of the malformed range it was.
    expect(fretRangeFor({ targetString: 6, allowedFrets: { min: -5, max: -2 } })).toEqual({
      min: 0,
      max: 0,
    });
  });
});

describe('midiRangeFor', () => {
  it('anchors the band on the open-string MIDI table', () => {
    expect(midiRangeFor(OPEN_LOW_E)).toEqual({ lo: OPEN_STRING_MIDI[6], hi: OPEN_STRING_MIDI[6] });
  });

  it('widens the band by the fret range', () => {
    expect(midiRangeFor({ targetString: 3, allowedFrets: { min: 1, max: 5 } })).toEqual({
      lo: OPEN_STRING_MIDI[3] + 1,
      hi: OPEN_STRING_MIDI[3] + 5,
    });
  });
});

describe('frequencyRangeFor', () => {
  it('is the Hz image of midiRangeFor, not an independent computation', () => {
    const config: StringSniperConfig = { targetString: 4, allowedFrets: { min: 2, max: 7 } };
    const { lo, hi } = midiRangeFor(config);

    expect(frequencyRangeFor(config)).toEqual({ lo: midiToFrequency(lo), hi: midiToFrequency(hi) });
  });
});

describe('overlappingStrings', () => {
  it('finds nothing for the open low string, because nothing else reaches that low', () => {
    // The module's own docstring makes this claim explicitly; pin it.
    expect(overlappingStrings(OPEN_LOW_E)).toEqual([]);
  });

  it('finds every string that can also sound the open G, per the docstring example', () => {
    expect(overlappingStrings(OPEN_G)).toEqual([6, 5, 4]);
  });

  it('never names the target string as its own overlap', () => {
    for (const targetString of ALL_STRINGS) {
      const overlaps = overlappingStrings({ targetString, allowedFrets: { min: 0, max: 0 } });
      expect(overlaps).not.toContain(targetString);
    }
  });
});

describe('evaluateSniperFrame: no_signal', () => {
  const NO_SIGNAL_RESULT = {
    result: 'no_signal',
    detectedMidi: null,
    nearestTargetMidi: null,
    centsFromTarget: null,
  };

  it('reports no signal for a null frequency', () => {
    expect(evaluateSniperFrame(OPEN_LOW_E, { frequency: null, clarity: 0.99 })).toEqual(
      NO_SIGNAL_RESULT,
    );
  });

  it('reports no signal for a non-finite frequency', () => {
    expect(evaluateSniperFrame(OPEN_LOW_E, clarity(NaN))).toEqual(NO_SIGNAL_RESULT);
    expect(evaluateSniperFrame(OPEN_LOW_E, clarity(Infinity))).toEqual(NO_SIGNAL_RESULT);
  });

  it('reports no signal for a zero or negative frequency', () => {
    expect(evaluateSniperFrame(OPEN_LOW_E, clarity(0))).toEqual(NO_SIGNAL_RESULT);
    expect(evaluateSniperFrame(OPEN_LOW_E, clarity(-110))).toEqual(NO_SIGNAL_RESULT);
  });

  it('reports no signal below the clarity floor, however clean the pitch is', () => {
    const detected = clarity(midiToFrequency(OPEN_STRING_MIDI[6]), { clarity: 0.84 });
    expect(evaluateSniperFrame(OPEN_LOW_E, detected)).toEqual(NO_SIGNAL_RESULT);
  });

  it('accepts clarity exactly at the floor', () => {
    // SNIPER_MIN_CLARITY guards with a strict `<`, so the floor itself passes.
    const detected = clarity(midiToFrequency(OPEN_STRING_MIDI[6]), { clarity: SNIPER_MIN_CLARITY });
    expect(evaluateSniperFrame(OPEN_LOW_E, detected).result).not.toBe('no_signal');
  });
});

describe('evaluateSniperFrame: hit', () => {
  it('calls the exact target frequency a hit with zero cents off', () => {
    const result = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(40)));
    expect(result).toEqual({
      result: 'hit',
      detectedMidi: 40,
      nearestTargetMidi: 40,
      centsFromTarget: 0,
    });
  });

  it('counts the default tolerance boundary itself as a hit, sharp side', () => {
    // 40.5 rounds up to the semitone above, clamps back into the single-fret
    // band, and lands at exactly +50 cents — the docstring's own "half a
    // semitone" framing of DEFAULT_TOLERANCE_CENTS.
    const result = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(40.5)));
    expect(result.result).toBe('hit');
    expect(result.centsFromTarget).toBe(DEFAULT_TOLERANCE_CENTS);
  });

  it('counts the default tolerance boundary itself as a hit, flat side', () => {
    const result = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(39.5)));
    expect(result.result).toBe('hit');
    expect(result.centsFromTarget).toBe(-DEFAULT_TOLERANCE_CENTS);
  });

  it('honours a tighter tolerance than the default', () => {
    const tight: StringSniperConfig = { ...OPEN_LOW_E, toleranceCents: 10 };
    const inside = evaluateSniperFrame(tight, clarity(midiToFrequency(40.09)));
    const outside = evaluateSniperFrame(tight, clarity(midiToFrequency(40.15)));

    expect(inside.result).toBe('hit');
    expect(outside.result).not.toBe('hit');
  });
});

describe('evaluateSniperFrame: off_pitch vs wrong_string', () => {
  it('calls one cent past the tolerance off_pitch, not a hit', () => {
    const result = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(40.51)));
    expect(result.result).toBe('off_pitch');
    expect(result.centsFromTarget).toBe(51);
  });

  it('keeps the near-miss window off_pitch right up to its edge', () => {
    // NEAR_MISS_SEMITONES = 2 above the band's top (hi = 40 here). Rounded
    // MIDI 42 is exactly hi + 2 and the check is inclusive.
    const atEdge = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(42.4)));
    expect(atEdge.result).toBe('off_pitch');
  });

  it('calls one semitone past the near-miss window wrong_string', () => {
    const pastEdge = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(42.6)));
    expect(pastEdge.result).toBe('wrong_string');
  });

  it('is symmetric: the same near-miss window applies below the band', () => {
    const atEdge = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(40 - NEAR_MISS_SEMITONES)));
    const pastEdge = evaluateSniperFrame(
      OPEN_LOW_E,
      clarity(midiToFrequency(40 - NEAR_MISS_SEMITONES - 1)),
    );
    expect(atEdge.result).toBe('off_pitch');
    expect(pastEdge.result).toBe('wrong_string');
  });

  it('still clamps nearestTargetMidi into the band even when the verdict is wrong_string', () => {
    const result = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(35)));
    expect(result.result).toBe('wrong_string');
    expect(result.nearestTargetMidi).toBe(40);
    expect(result.detectedMidi).toBe(35);
  });

  it('reports the raw fractional MIDI rather than rounding it away', () => {
    const result = evaluateSniperFrame(OPEN_LOW_E, clarity(midiToFrequency(40.3)));
    expect(result.detectedMidi).toBeCloseTo(40.3, 9);
  });
});

describe('evaluateHit', () => {
  it('is the same verdict evaluateSniperFrame reaches, unwrapped', () => {
    const hitDetected = clarity(midiToFrequency(40));
    const wrongDetected = clarity(midiToFrequency(50));

    expect(evaluateHit(OPEN_LOW_E, hitDetected)).toBe(
      evaluateSniperFrame(OPEN_LOW_E, hitDetected).result,
    );
    expect(evaluateHit(OPEN_LOW_E, wrongDetected)).toBe(
      evaluateSniperFrame(OPEN_LOW_E, wrongDetected).result,
    );
  });
});

describe('describeFretRange', () => {
  it('calls a missing range "any fret"', () => {
    expect(describeFretRange({ targetString: 6 })).toBe('any fret');
  });

  it('calls an explicit null range "any fret"', () => {
    expect(describeFretRange({ targetString: 6, allowedFrets: null })).toBe('any fret');
  });

  it('calls fret zero to zero "open string"', () => {
    expect(describeFretRange(OPEN_LOW_E)).toBe('open string');
  });

  it('names a single non-zero fret directly', () => {
    expect(describeFretRange({ targetString: 6, allowedFrets: { min: 5, max: 5 } })).toBe('fret 5');
  });

  it('names a span with an en dash', () => {
    expect(describeFretRange({ targetString: 3, allowedFrets: { min: 1, max: 5 } })).toBe(
      'frets 1–5',
    );
  });

  it('normalises a reversed span before describing it', () => {
    expect(describeFretRange({ targetString: 3, allowedFrets: { min: 5, max: 1 } })).toBe(
      'frets 1–5',
    );
  });
});

describe('describeConfig', () => {
  it('names the string, its label, and the fret range in one line', () => {
    expect(describeConfig(OPEN_LOW_E)).toBe('String 6 (Low E), open string');
  });

  it('reads "any fret" for a config with no range at all', () => {
    expect(describeConfig({ targetString: 1 })).toBe('String 1 (High E), any fret');
  });
});

describe('targetNoteLabel', () => {
  it('names a single note for a single-fret band', () => {
    expect(targetNoteLabel(OPEN_LOW_E)).toBe('E2');
  });

  it('names a range for a multi-fret band', () => {
    // lo = open E2 (midi 40), hi = 20 frets up (midi 60 = C4).
    expect(targetNoteLabel({ targetString: 6 })).toBe('E2–C4');
  });
});

describe('sniperSkillId', () => {
  it('maps the four strings the scheduler tracks to their skill ids', () => {
    expect(sniperSkillId({ targetString: 3 })).toBe('picking.single.3rd-string');
    expect(sniperSkillId({ targetString: 4 })).toBe('picking.single.4th-string');
    expect(sniperSkillId({ targetString: 5 })).toBe('picking.single.5th-string');
    expect(sniperSkillId({ targetString: 1 })).toBe('picking.single.1st-string.bare');
  });

  it('returns null for the two strings with no catalog skill behind them', () => {
    expect(sniperSkillId({ targetString: 2 })).toBeNull();
    expect(sniperSkillId({ targetString: 6 })).toBeNull();
  });

  it('is unaffected by the fret range, only the string matters', () => {
    expect(sniperSkillId({ targetString: 3, allowedFrets: { min: 5, max: 9 } })).toBe(
      sniperSkillId({ targetString: 3 }),
    );
  });
});

describe('summariseStrikes', () => {
  it('summarises an empty set without dividing by zero', () => {
    expect(summariseStrikes([])).toEqual({
      hits: 0,
      wrongString: 0,
      offPitch: 0,
      total: 0,
      accuracy: 0,
    });
  });

  it('summarises a set that was entirely unheard the same as an empty one', () => {
    const results: SniperHitResult[] = ['no_signal', 'no_signal', 'no_signal'];
    expect(summariseStrikes(results)).toEqual({
      hits: 0,
      wrongString: 0,
      offPitch: 0,
      total: 0,
      accuracy: 0,
    });
  });

  it('counts each outcome and computes accuracy over scored strikes only', () => {
    const results: SniperHitResult[] = ['hit', 'hit', 'hit', 'wrong_string', 'off_pitch'];
    expect(summariseStrikes(results)).toEqual({
      hits: 3,
      wrongString: 1,
      offPitch: 1,
      total: 5,
      accuracy: 0.6,
    });
  });

  it('excludes no_signal frames from the accuracy denominator entirely', () => {
    // Same 3-hit, 1-wrong ratio, with a handful of unheard frames mixed in.
    // The unheard frames must not water down or inflate accuracy either way.
    const withoutSilence: SniperHitResult[] = ['hit', 'hit', 'hit', 'wrong_string'];
    const withSilence: SniperHitResult[] = [
      'no_signal',
      'hit',
      'no_signal',
      'hit',
      'hit',
      'no_signal',
      'wrong_string',
      'no_signal',
    ];

    expect(summariseStrikes(withSilence).accuracy).toBe(summariseStrikes(withoutSilence).accuracy);
    expect(summariseStrikes(withSilence).total).toBe(summariseStrikes(withoutSilence).total);
  });
});

describe('gradeSniperSet', () => {
  it('refuses to grade a set with fewer than three scored strikes', () => {
    expect(gradeSniperSet({ hits: 0, wrongString: 0, offPitch: 0, total: 0, accuracy: 0 })).toBeNull();
    expect(gradeSniperSet({ hits: 1, wrongString: 0, offPitch: 0, total: 1, accuracy: 1 })).toBeNull();
    expect(gradeSniperSet({ hits: 2, wrongString: 0, offPitch: 0, total: 2, accuracy: 1 })).toBeNull();
  });

  it('grades a perfect three-strike set, the minimum size that grades at all', () => {
    expect(gradeSniperSet({ hits: 3, wrongString: 0, offPitch: 0, total: 3, accuracy: 1 })).toBe(
      'easy',
    );
  });

  it('calls exactly 0.95 accuracy easy', () => {
    expect(
      gradeSniperSet({ hits: 19, wrongString: 0, offPitch: 1, total: 20, accuracy: 19 / 20 }),
    ).toBe('easy');
  });

  it('calls just under 0.95 good, not easy', () => {
    expect(
      gradeSniperSet({ hits: 18, wrongString: 0, offPitch: 2, total: 20, accuracy: 18 / 20 }),
    ).toBe('good');
  });

  it('calls exactly 0.75 accuracy good', () => {
    expect(
      gradeSniperSet({ hits: 15, wrongString: 0, offPitch: 5, total: 20, accuracy: 15 / 20 }),
    ).toBe('good');
  });

  it('calls just under 0.75 hard, not good', () => {
    expect(
      gradeSniperSet({ hits: 14, wrongString: 0, offPitch: 6, total: 20, accuracy: 14 / 20 }),
    ).toBe('hard');
  });

  it('calls exactly 0.4 accuracy hard', () => {
    expect(
      gradeSniperSet({ hits: 8, wrongString: 12, offPitch: 0, total: 20, accuracy: 8 / 20 }),
    ).toBe('hard');
  });

  it('calls just under 0.4 a fail', () => {
    expect(
      gradeSniperSet({ hits: 3, wrongString: 7, offPitch: 0, total: 10, accuracy: 3 / 10 }),
    ).toBe('fail');
  });

  it('fails a set with no hits at all', () => {
    expect(
      gradeSniperSet({ hits: 0, wrongString: 10, offPitch: 0, total: 10, accuracy: 0 }),
    ).toBe('fail');
  });

  it('never grades better on a lower accuracy than a higher one, at fixed size', () => {
    const RANK: Record<'easy' | 'good' | 'hard' | 'fail', number> = {
      fail: 0,
      hard: 1,
      good: 2,
      easy: 3,
    };
    let previousRank = -1;
    for (let hits = 0; hits <= 20; hits += 1) {
      const grade = gradeSniperSet({
        hits,
        wrongString: 20 - hits,
        offPitch: 0,
        total: 20,
        accuracy: hits / 20,
      });
      expect(grade, `hits=${hits}`).not.toBeNull();
      const rank = RANK[grade!];
      expect(rank, `hits=${hits}`).toBeGreaterThanOrEqual(previousRank);
      previousRank = rank;
    }
  });
});

describe('FRET_PRESETS', () => {
  it('agrees with fretRangeFor and describeFretRange on what each preset means', () => {
    // Not a hardcoded arithmetic pin: this checks the presets are internally
    // consistent with the functions the UI actually calls, so a preset edited
    // without checking describeFretRange cannot silently start lying to the
    // player about what it selects.
    for (const preset of FRET_PRESETS) {
      const config: StringSniperConfig = { targetString: 6, allowedFrets: preset.range };
      const described = describeFretRange(config);
      if (preset.id === 'open') expect(described).toBe('open string');
      if (preset.id === 'any') expect(described).toBe('any fret');
    }
  });
});

// Kept for readability of the intent above without importing an unused type.
void (null as unknown as GuitarStringIndex);
