import { describe, expect, it } from 'vitest';
import {
  EMPTY_STRIKES,
  addStrike,
  describeStrikes,
  isStruckThrough,
  strikeProgress,
} from './activityProgress';

/**
 * The strike counter is what ends the tune-up, and the tune-up is the first
 * thing in every session — so a bug here is a session that cannot be started
 * without pressing Skip, which is exactly the state this replaced.
 */
describe('addStrike', () => {
  it('counts a note as one strike however many frames it rings for', () => {
    let state = addStrike(EMPTY_STRIKES, 'E2');
    state = addStrike(state, 'E2');
    state = addStrike(state, 'E2');

    expect(state.struck).toEqual(['E2']);
  });

  it('counts the next string', () => {
    let state = addStrike(EMPTY_STRIKES, 'E2');
    state = addStrike(state, 'A2');

    expect(state.struck).toEqual(['E2', 'A2']);
  });

  it('counts the same string picked again after it stopped sounding', () => {
    let state = addStrike(EMPTY_STRIKES, 'E2');
    state = addStrike(state, null);
    state = addStrike(state, 'E2');

    expect(state.struck).toEqual(['E2', 'E2']);
  });

  it('counts the same string re-picked while still ringing, on a new onset', () => {
    let state = addStrike(EMPTY_STRIKES, 'E2', 100);
    state = addStrike(state, 'E2', 100); // same attack, still ringing
    state = addStrike(state, 'E2', 900); // picked again

    expect(state.struck).toEqual(['E2', 'E2']);
  });

  it('returns the state it was given when nothing changed', () => {
    const state = addStrike(EMPTY_STRIKES, 'E2', 100);

    // Identity, not equality: the panel samples ten times a second and
    // re-renders only when this changes.
    expect(addStrike(state, 'E2', 100)).toBe(state);
    expect(addStrike(EMPTY_STRIKES, null)).toBe(EMPTY_STRIKES);
  });

  it('does not count silence as a strike', () => {
    let state = addStrike(EMPTY_STRIKES, null);
    state = addStrike(state, null);

    expect(state.struck).toEqual([]);
  });

  it('asks nothing about pitch — an out-of-tune string still counts', () => {
    // The point of the tune-up: the 6th string reading D#2 is precisely the
    // case it exists for, and it must not block the session.
    let state = addStrike(EMPTY_STRIKES, 'D#2');
    state = addStrike(state, 'G#2');

    expect(state.struck).toHaveLength(2);
  });
});

describe('isStruckThrough', () => {
  it('is false until every string asked for has been heard', () => {
    let state = EMPTY_STRIKES;
    for (const note of ['E2', 'A2', 'D3', 'G3', 'B3']) state = addStrike(state, note);

    expect(isStruckThrough(state, 6)).toBe(false);
    expect(isStruckThrough(addStrike(state, 'E4'), 6)).toBe(true);
  });

  it('never asks for zero, which would end an activity before it started', () => {
    expect(isStruckThrough(EMPTY_STRIKES, 0)).toBe(false);
  });
});

describe('strikeProgress', () => {
  it('runs 0 to 1 and stops there', () => {
    let state = EMPTY_STRIKES;
    expect(strikeProgress(state, 6)).toBe(0);

    for (const note of ['E2', 'A2', 'D3']) state = addStrike(state, note);
    expect(strikeProgress(state, 6)).toBeCloseTo(0.5);

    for (const note of ['G3', 'B3', 'E4', 'E4']) state = addStrike(state, note);
    expect(strikeProgress(state, 6)).toBe(1);
  });
});

describe('describeStrikes', () => {
  it('says how to move on before anything is heard', () => {
    expect(describeStrikes(EMPTY_STRIKES, 6)).toMatch(/moves on/i);
  });

  it('counts up while playing', () => {
    const state = addStrike(EMPTY_STRIKES, 'E2');
    expect(describeStrikes(state, 6)).toContain('1 of 6');
  });
});
