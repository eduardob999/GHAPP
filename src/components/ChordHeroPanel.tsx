import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChordDetector } from '../hooks/useChordDetector';
import {
  shortChordLabel,
  formatChord,
  type ChordQuality,
} from '../audio/chordDetection';
import {
  PROGRESSIONS,
  chordAt,
  chordDurationMs,
  scoreDetection,
  progressionDurationMs,
  scoreWindow,
  summarise,
  type ChordProgression,
  type ChordScore,
} from '../domain/progressions';
import { SKILL_BY_ID } from '../domain/skills';
import { toDiagram } from '../domain/shapeTrainer';
import { FretboardDiagram } from './FretboardDiagram';

/**
 * Chord Hero — play a progression in time and get scored by ear.
 *
 * The clock is wall-clock driven, like the trainer's countdown, so a throttled
 * background tab cannot make the progression drift out of time.
 *
 * Scoring happens over a window rather than at an instant. Recognition needs a
 * few hundred milliseconds of ringing string to be sure, so each chord is
 * judged on everything heard during its scoring window, graded on the best
 * moment in it.
 */

const SCORE_LABELS: Record<ChordScore, { text: string; modifier: string }> = {
  hit: { text: 'Hit', modifier: 'verdict--hit' },
  partial: { text: 'Right root, wrong quality', modifier: 'verdict--off' },
  miss: { text: 'Miss', modifier: 'verdict--wrong' },
  unclear: { text: 'No clear chord', modifier: 'verdict--idle' },
};

/**
 * Grace period at the start of each chord before observations count. Gives you
 * time to move your hand, and skips the window that still contains the
 * previous chord.
 */
const LEAD_IN_MS = 450;

/**
 * Clock and sampling period. Faster than the detector's own cadence, so the
 * beat bar moves smoothly; repeat readings are harmless because a chord is
 * graded on its best moment, not on an average.
 */
const SAMPLE_INTERVAL_MS = 100;

type Phase = 'idle' | 'playing' | 'finished';

/** One reading taken while a chord was expected; null means nothing heard. */
type Observation = { root: string; quality: ChordQuality } | null;

interface ChordResult {
  chordId: string;
  score: ChordScore;
}

export function ChordHeroPanel() {
  const { isRunning, isStarting, currentChord, currentResult, error, start, stop, reset } =
    useChordDetector();

  const [progressionId, setProgressionId] = useState<string>(PROGRESSIONS[0]!.id);
  const [tempoBpm, setTempoBpm] = useState<number>(PROGRESSIONS[0]!.tempoBpm);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [results, setResults] = useState<ChordResult[]>([]);

  const startedAtRef = useRef(0);
  const observationsRef = useRef<Map<string, Observation[]>>(new Map());

  const progression: ChordProgression =
    PROGRESSIONS.find((p) => p.id === progressionId) ?? PROGRESSIONS[0]!;

  const totalMs = useMemo(
    () => progressionDurationMs(progression, tempoBpm),
    [progression, tempoBpm],
  );

  const active = phase === 'playing' ? chordAt(progression, tempoBpm, elapsedMs) : null;
  const upcoming = active ? progression.chords[active.index + 1] : progression.chords[0];

  // Mirrors the detector output so the sampler below can read it without the
  // effect having to re-run when it changes.
  const latestChordRef = useRef<Observation>(null);
  useEffect(() => {
    latestChordRef.current = currentChord
      ? { root: currentChord.root, quality: currentChord.quality }
      : null;
  }, [currentChord]);

  /**
   * The clock: advances time, samples the detector, and grades chords as the
   * run leaves them.
   *
   * Sampling is driven by this timer rather than by the detector's output
   * changing. Keying it to changes was the obvious thing and it was wrong — a
   * chord held steady never changes, so a whole segment would record a single
   * observation and later chords none at all.
   *
   * Wall-clock based, so a throttled tab cannot make the progression drift.
   */
  useEffect(() => {
    if (phase !== 'playing') return;

    const tick = () => {
      const now = performance.now() - startedAtRef.current;
      setElapsedMs(now);

      const active = chordAt(progression, tempoBpm, now);
      if (active && now - active.startMs >= LEAD_IN_MS) {
        const bucket = observationsRef.current.get(active.chord.id) ?? [];
        bucket.push(latestChordRef.current);
        observationsRef.current.set(active.chord.id, bucket);
      }

      // Grade every chord the run has already passed. Chords with no
      // observations still appear, as "unclear" — silence is a result too, and
      // dropping them would understate the total.
      const graded: ChordResult[] = [];
      let start = 0;
      for (const chord of progression.chords) {
        const end = start + chordDurationMs(chord, tempoBpm);
        if (end <= now) {
          graded.push({
            chordId: chord.id,
            score: scoreWindow(chord, observationsRef.current.get(chord.id) ?? []).score,
          });
        }
        start = end;
      }
      setResults(graded);

      if (now >= totalMs) setPhase('finished');
    };

    tick();
    const handle = window.setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [phase, totalMs, progression, tempoBpm]);

  const handleStart = useCallback(async () => {
    observationsRef.current = new Map();
    setResults([]);
    setElapsedMs(0);
    reset();

    if (!isRunning) {
      await start();
    }

    startedAtRef.current = performance.now();
    setPhase('playing');
    console.info('[chord-hero] Started', progression.id, 'at', tempoBpm, 'bpm');
  }, [isRunning, progression.id, reset, start, tempoBpm]);

  const handleStop = useCallback(() => {
    setPhase('idle');
    stop();
  }, [stop]);

  function selectProgression(id: string) {
    const next = PROGRESSIONS.find((p) => p.id === id);
    if (!next) return;
    setProgressionId(id);
    setTempoBpm(next.tempoBpm);
    setPhase('idle');
    setResults([]);
    observationsRef.current = new Map();
  }

  const summary = summarise(results.map((r) => r.score));
  const diagram = active?.chord.positionMetadata?.shapeId
    ? diagramFor(active.chord.positionMetadata.shapeId)
    : null;

  const segmentProgress = active
    ? Math.min(1, (elapsedMs - active.startMs) / (active.endMs - active.startMs))
    : 0;

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Chord Hero</h2>
        <span className="pill">beta</span>
      </div>

      <p className="card__body">
        Play the progression in time. The app listens and scores each chord by ear — nothing is
        recorded or uploaded.
      </p>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {phase === 'idle' ? (
        <>
          <label className="field" htmlFor="progression-select">
            <span className="field__label">Progression</span>
            <select
              id="progression-select"
              className="select"
              value={progressionId}
              onChange={(event) => selectProgression(event.target.value)}
            >
              {PROGRESSIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          {progression.description ? (
            <p className="card__hint">{progression.description}</p>
          ) : null}

          <div className="field">
            <span className="field__label">Tempo — {tempoBpm} bpm</span>
            <div className="segmented segmented--wrap">
              {[0.5, 0.75, 1].map((factor) => {
                const bpm = Math.round(progression.tempoBpm * factor);
                return (
                  <button
                    key={factor}
                    type="button"
                    className={`segmented__option${bpm === tempoBpm ? ' segmented__option--active' : ''}`}
                    onClick={() => setTempoBpm(bpm)}
                    aria-pressed={bpm === tempoBpm}
                  >
                    {factor === 1 ? `${bpm} bpm` : `${bpm} bpm (${factor === 0.5 ? 'half' : 'slow'})`}
                  </button>
                );
              })}
            </div>
          </div>

          <ol className="chordlist">
            {progression.chords.map((chord) => (
              <li key={chord.id} className="chordlist__item">
                <span className="chordlist__name">{shortChordLabel(chord.root, chord.quality)}</span>
                <span className="chordlist__mode">{chord.mode}</span>
              </li>
            ))}
          </ol>

          <button
            type="button"
            className="button button--primary"
            onClick={() => void handleStart()}
            disabled={isStarting}
          >
            {isStarting ? 'Waiting for microphone…' : 'Start progression'}
          </button>
          <p className="card__hint">
            Your browser asks for microphone access the first time. Works offline.
          </p>
        </>
      ) : null}

      {phase === 'playing' && active ? (
        <>
          <div className="hero">
            <div className="hero__now">
              <span className="hero__label">Now</span>
              <span className="hero__chord">
                {shortChordLabel(active.chord.root, active.chord.quality)}
              </span>
              <span className="hero__mode">
                {active.chord.mode === 'strum' ? 'Strum and hold' : 'Arpeggiate'}
              </span>
            </div>
            <div className="hero__next">
              <span className="hero__label">Next</span>
              <span className="hero__chord hero__chord--next">
                {upcoming ? shortChordLabel(upcoming.root, upcoming.quality) : '—'}
              </span>
            </div>
          </div>

          <div
            className="beatbar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(segmentProgress * 100)}
            aria-label="Progress through the current chord"
          >
            <span className="beatbar__fill" style={{ width: `${segmentProgress * 100}%` }} />
          </div>

          {active.chord.positionMetadata ? (
            <p className="card__hint">
              String {active.chord.positionMetadata.rootString}, fret{' '}
              {active.chord.positionMetadata.rootFret}
              {' · '}
              chord {active.index + 1} of {progression.chords.length}
            </p>
          ) : null}

          {diagram ? (
            <FretboardDiagram
              rootString={diagram.rootString}
              rootFret={diagram.rootFret}
              lowestFret={diagram.lowestFret}
              highestFret={diagram.highestFret}
              fingers={diagram.fingers}
              mutedStrings={diagram.mutedStrings}
              title={formatChord(active.chord.root, active.chord.quality)}
            />
          ) : null}

          <div className={`verdict ${liveModifier(active.chord, currentChord)}`} role="status">
            {currentChord
              ? `Hearing ${shortChordLabel(currentChord.root, currentChord.quality)}`
              : (currentResult?.noiseLevel ?? 0) > 0.5
                ? 'Too noisy — strum more cleanly'
                : 'Listening…'}
          </div>

          <button type="button" className="button button--ghost" onClick={handleStop}>
            Stop
          </button>
        </>
      ) : null}

      {phase === 'finished' ? (
        <>
          <p className="notice notice--ok">
            {summary.hit} of {summary.total} chords hit
            {summary.partial > 0 ? `, ${summary.partial} close` : ''}
            {summary.unclear > 0 ? `, ${summary.unclear} unclear` : ''}.
          </p>

          <ol className="chordlist">
            {progression.chords.map((chord) => {
              const result = results.find((r) => r.chordId === chord.id);
              const label = SCORE_LABELS[result?.score ?? 'unclear'];
              return (
                <li key={chord.id} className="chordlist__item">
                  <span className="chordlist__name">
                    {shortChordLabel(chord.root, chord.quality)}
                  </span>
                  <span className={`tag ${label.modifier}`}>{label.text}</span>
                </li>
              );
            })}
          </ol>

          <div className="task__grades">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void handleStart()}
            >
              Play again
            </button>
            <button type="button" className="button button--ghost" onClick={handleStop}>
              Done
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * Colour for the live read-out.
 *
 * Green means "this is the chord you were asked for", not merely "a chord was
 * recognised" — in a panel that scores you, colouring a confidently wrong
 * chord green reads as approval.
 */
function liveModifier(
  expected: { root: string; quality: ChordQuality },
  heard: { root: string; quality: ChordQuality } | null,
): string {
  if (!heard) return 'verdict--idle';
  switch (scoreDetection(expected, heard)) {
    case 'hit': return 'verdict--hit';
    case 'partial': return 'verdict--off';
    default: return 'verdict--wrong';
  }
}

function diagramFor(shapeId: string) {
  const definition = SKILL_BY_ID.get(shapeId);
  return definition ? toDiagram(definition) : null;
}
