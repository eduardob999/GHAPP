import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { useChordDetector } from '../hooks/useChordDetector';
import { createMetronome, type Metronome } from '../audio/metronome';
import { createChimePlayer, type ChimePlayer } from '../audio/chime';
import { shortChordLabel, type ChordQuality } from '../audio/chordDetection';
import {
  GENRES,
  PLAY_MODE_HINTS,
  PROGRESSIONS,
  chordAt,
  chordDurationMs,
  progressionDurationMs,
  scoreDetection,
  scoreRiffWindow,
  scoreWindow,
  summarise,
  applyTiming,
  missedStepsProgression,
  rampTempo,
  timingVerdict,
  type TimingVerdict,
  gradeFromSummary,
  progressionSkillId,
  needsRetuning,
  tuningOf,
  type ChordProgression,
  type ChordScore,
  type ProgressionChord,
  type ProgressionLevel,
} from '../domain/progressions';
import { SKILL_BY_ID } from '../domain/skills';
import { MicNotice } from './MicNotice';
import { useSkillStates } from '../hooks/useSkillStates';
import { useRecentSessions } from '../hooks/useRecentSessions';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { appendSession } from '../storage/sessionLog';
import { describeInterval } from '../domain/scheduler';
import { toDiagram } from '../domain/shapeTrainer';
import { FretboardDiagram } from './FretboardDiagram';

/**
 * Chord Hero — play a progression in time and get scored by ear.
 *
 * Steps are graded two ways depending on their mode: chord steps by chord
 * recognition, riff steps by which notes were heard. Both run off the same
 * microphone and the same DSP engine.
 *
 * The clock is wall-clock driven, so a throttled background tab cannot make the
 * progression drift, and each step is graded on its best moment rather than an
 * instant — recognition needs a few hundred milliseconds of ringing string.
 */

const SCORE_LABELS: Record<ChordScore, { text: string; modifier: string }> = {
  hit: { text: 'Hit', modifier: 'verdict--hit' },
  partial: { text: 'Close', modifier: 'verdict--off' },
  miss: { text: 'Miss', modifier: 'verdict--wrong' },
  unclear: { text: 'Not heard', modifier: 'verdict--idle' },
};

/** Grace period at the start of a step before observations count. */
const LEAD_IN_MS = 420;
const SAMPLE_INTERVAL_MS = 90;
/** Beats of count-in before the first chord, so you are not caught cold. */
const COUNT_IN_BEATS = 4;

type Phase = 'idle' | 'countin' | 'playing' | 'finished';
type Observation = { root: string; quality: ChordQuality } | null;

interface StepResult {
  chordId: string;
  score: ChordScore;
  /** Attack offset from the step's start, in ms. Negative is early. */
  timingMs: number | null;
}

const TIMING_TEXT: Record<TimingVerdict, string> = {
  early: 'early',
  'on-time': 'in time',
  late: 'late',
  none: '',
};

function describeTiming(offsetMs: number | null): string {
  const verdict = timingVerdict(offsetMs);
  if (verdict === 'none') return '';
  if (verdict === 'on-time') return TIMING_TEXT[verdict];
  return `${Math.abs(Math.round(offsetMs ?? 0))}ms ${TIMING_TEXT[verdict]}`;
}

function stepLabel(step: ProgressionChord): string {
  return step.mode === 'riff' && step.notes
    ? step.notes.join(' ')
    : shortChordLabel(step.root, step.quality);
}

function diagramFor(shapeId: string | undefined) {
  if (!shapeId) return null;
  const definition = SKILL_BY_ID.get(shapeId);
  return definition ? toDiagram(definition) : null;
}

export interface ChordHeroPanelProps {
  user: User;
  /** Set when Today's Session hands over a progression; null when idle. */
  requestedProgressionId?: string | null;
  onRequestHandled?: () => void;
  /** Reports whether the microphone is currently open, so the companion can listen. */
  onListeningChange?: (listening: boolean) => void;
}

export function ChordHeroPanel({
  user,
  requestedProgressionId = null,
  onRequestHandled,
  onListeningChange,
}: ChordHeroPanelProps) {
  const {
    currentChord,
    currentNote,
    currentResult,
    onsets,
    error,
    errorCode,
    isStarting,
    start,
    stop,
    reset,
  } = useChordDetector();

  const [genre, setGenre] = useState<string>('Essentials');
  const [level, setLevel] = useState<ProgressionLevel | 'all'>('all');
  const [progressionId, setProgressionId] = useState<string>(PROGRESSIONS[0]!.id);
  const [tempoScale, setTempoScale] = useState<number>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [clickOn, setClickOn] = useState(true);
  const [timingStrict, setTimingStrict] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** Set when replaying only the steps that went badly. */
  const [override, setOverride] = useState<ChordProgression | null>(null);
  const [rampOn, setRampOn] = useState(false);
  /**
   * Self-graded mode: the same steps on the same clock, graded by the player.
   *
   * Milestone 4's requirement is that a denied microphone does not take the app
   * away, and a rhythm game with no scoring is not a fallback — it is a
   * metronome. Here the run is identical apart from where the verdict comes
   * from, so the scheduler, the log and the streak all keep working.
   */
  const [selfGrading, setSelfGrading] = useState(false);
  const selfScores = useRef<Map<string, ChordScore>>(new Map());

  const { states } = useSkillStates(user.uid);
  const { sessions } = useRecentSessions(user.uid, 6);
  const stateById = useMemo(() => new Map(states.map((st) => [st.skillId, st])), [states]);

  const startedAtRef = useRef(0);
  const chordObs = useRef<Map<string, Observation[]>>(new Map());
  const noteObs = useRef<Map<string, string[]>>(new Map());
  const latestChord = useRef<Observation>(null);
  const latestNote = useRef<string | null>(null);
  const gradedIds = useRef<Set<string>>(new Set());
  const stepOnset = useRef<Map<string, number>>(new Map());
  /**
   * Mirrors `bestStreak` for the logger. The clock effect captures `recordRun`
   * from the render that created it, so anything read straight from state
   * inside it would be whatever it was when the run started — zero.
   */
  const bestStreakRef = useRef(0);
  const metronome = useRef<Metronome | null>(null);
  const chime = useRef<ChimePlayer | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const visible = useMemo(
    () =>
      PROGRESSIONS.filter(
        (p) =>
          p.genre === genre &&
          // Never hide the currently selected one behind the level filter, or a
          // hand-off from Today's Session could land on an empty list.
          (level === 'all' || p.level === level || p.id === progressionId),
      ),
    [genre, level, progressionId],
  );

  const selected: ChordProgression =
    visible.find((p) => p.id === progressionId) ?? visible[0] ?? PROGRESSIONS[0]!;

  // A misses-replay temporarily stands in for the chosen progression.
  const progression: ChordProgression = override ?? selected;

  const tempoBpm = Math.round(progression.tempoBpm * tempoScale);
  const scoreById = useMemo(
    () => new Map(results.map((r) => [r.chordId, r.score])),
    [results],
  );
  const totalMs = useMemo(
    () => progressionDurationMs(progression, tempoBpm),
    [progression, tempoBpm],
  );

  useEffect(() => {
    latestChord.current = currentChord
      ? { root: currentChord.root, quality: currentChord.quality }
      : null;
  }, [currentChord]);

  useEffect(() => {
    latestNote.current = currentNote;
  }, [currentNote]);

  /** Count-in: four beats of nothing but a number, then the run starts. */
  useEffect(() => {
    if (phase !== 'countin') return;
    const beatMs = 60_000 / tempoBpm;
    const handle = window.setInterval(() => {
      setCountInBeat((beat) => {
        if (beat + 1 >= COUNT_IN_BEATS) {
          startedAtRef.current = performance.now();
          setPhase('playing');
          return 0;
        }
        return beat + 1;
      });
    }, beatMs);
    return () => window.clearInterval(handle);
  }, [phase, tempoBpm]);

  /** The clock: advances time, samples the detector, grades finished steps. */
  useEffect(() => {
    if (phase !== 'playing') return;

    const tick = () => {
      const now = performance.now() - startedAtRef.current;
      setElapsedMs(now);

      const active = chordAt(progression, tempoBpm, now);

      // First attack inside this step, relative to when the step began.
      if (active && !stepOnset.current.has(active.chord.id)) {
        const stepStartedAt = startedAtRef.current + active.startMs;
        const hit = onsets.find((at) => at >= stepStartedAt - 250 && at <= stepStartedAt + 600);
        if (hit !== undefined) stepOnset.current.set(active.chord.id, hit - stepStartedAt);
      }

      if (active && now - active.startMs >= LEAD_IN_MS) {
        if (active.chord.mode === 'riff') {
          const bucket = noteObs.current.get(active.chord.id) ?? [];
          if (latestNote.current) bucket.push(latestNote.current);
          noteObs.current.set(active.chord.id, bucket);
        } else {
          const bucket = chordObs.current.get(active.chord.id) ?? [];
          bucket.push(latestChord.current);
          chordObs.current.set(active.chord.id, bucket);
        }
      }

      const graded: StepResult[] = [];
      let start = 0;
      for (const step of progression.chords) {
        const end = start + chordDurationMs(step, tempoBpm);
        if (end <= now) {
          const pitchScore = selfGrading
            ? // Anything the player did not rule on is `unclear`, not a miss:
              // failing to press a button is not the same as playing it wrong.
              (selfScores.current.get(step.id) ?? 'unclear')
            : step.mode === 'riff'
              ? scoreRiffWindow(step.notes ?? [], noteObs.current.get(step.id) ?? []).score
              : scoreWindow(step, chordObs.current.get(step.id) ?? []).score;

          // Timing can demote a clean hit, never promote anything.
          const timingMs = stepOnset.current.get(step.id) ?? null;
          const score = timingStrict ? applyTiming(pitchScore, timingMs) : pitchScore;
          graded.push({ chordId: step.id, score, timingMs });

          // Streak updates once per step, the first time it is graded.
          if (!gradedIds.current.has(step.id)) {
            gradedIds.current.add(step.id);
            if (score === 'hit') {
              setStreak((s) => {
                const next = s + 1;
                bestStreakRef.current = Math.max(bestStreakRef.current, next);
                setBestStreak(bestStreakRef.current);
                return next;
              });
            } else {
              setStreak(0);
            }
          }
        }
        start = end;
      }
      setResults(graded);

      if (now >= totalMs) {
        metronome.current?.stop();
        setPhase('finished');
        recordRun(graded);
      }
    };

    tick();
    const handle = window.setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [phase, totalMs, progression, tempoBpm, selfGrading]);

  /**
   * Files the run with the spaced scheduler.
   *
   * Same `upsertSkillPracticeState` and the same `/users/{uid}/skills` documents
   * as Today's Session and the shape trainer — a progression is just another
   * thing you practise, so it earns an ease and an interval like everything
   * else. Not awaited: offline the write lands in the local cache immediately
   * and syncs later.
   */
  const recordRun = useCallback(
    (graded: StepResult[]) => {
      const runSummary = summarise(graded.map((g) => g.score));
      if (runSummary.total === 0) return;

      const grade = gradeFromSummary(runSummary);
      const skillId = progressionSkillId(progression.id);
      const current = stateById.get(skillId) ?? null;

      void upsertSkillPracticeState(user.uid, { skillId, result: grade, current }).catch(
        (writeError: unknown) => {
          console.error('[chord-hero] Result did not reach the server.', writeError);
        },
      );

      // Raw history alongside the scheduler summary: skill state is overwritten
      // on every rep, this is not.
      const timings = graded
        .map((r) => r.timingMs)
        .filter((t): t is number => t !== null);

      void appendSession(user.uid, {
        kind: 'chord-hero',
        subject: progression.id,
        title: progression.title,
        accuracy: runSummary.hit / runSummary.total,
        steps: runSummary.total,
        hits: runSummary.hit,
        partials: runSummary.partial,
        misses: runSummary.miss + runSummary.unclear,
        tempoBpm,
        bestStreak: bestStreakRef.current,
        graded: selfGrading ? 'self' : 'audio',
        ...(timings.length > 0
          ? {
              meanTimingMs: Math.round(
                timings.reduce((sum, t) => sum + Math.abs(t), 0) / timings.length,
              ),
            }
          : {}),
      }).catch((logError: unknown) => {
        console.error('[chord-hero] Session log write failed.', logError);
      });

      if (rampOn) {
        const next = rampTempo(tempoBpm, progression.tempoBpm, runSummary.hit / runSummary.total);
        if (next !== tempoBpm) {
          setTempoScale(next / progression.tempoBpm);
          console.info('[chord-hero] Clean pass — tempo up to', next, 'bpm.');
        }
      }

      // A reward sound at the end of a run you started yourself. Pitched above
      // the analysis band like the metronome, so it cannot be scored even if the
      // detector is still running when it plays.
      chime.current ??= createChimePlayer();
      chime.current.play(runSummary.hit / runSummary.total >= 0.65 ? 'success' : 'gentle');

      setSavedNote(grade);
      console.info('[chord-hero] Filed run as', grade, 'for', skillId);
    },
    [
      progression.id,
      progression.title,
      progression.tempoBpm,
      stateById,
      user.uid,
      tempoBpm,
      rampOn,
      selfGrading,
    ],
  );

  /** Jump to a progression handed over by Today's Session. */
  useEffect(() => {
    if (!requestedProgressionId) return;

    const target = PROGRESSIONS.find((p) => p.id === requestedProgressionId);
    if (target) {
      setGenre(target.genre);
      setProgressionId(target.id);
      setTempoScale(1);
      setPhase('idle');
      setSavedNote(null);
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    onRequestHandled?.();
  }, [requestedProgressionId, onRequestHandled]);

  useEffect(
    () => () => {
      metronome.current?.stop();
      chime.current?.close();
      chime.current = null;
    },
    [],
  );

  // The companion listens while the microphone is open — which it is not in a
  // self-graded run.
  const listening = !selfGrading && (phase === 'countin' || phase === 'playing');
  useEffect(() => {
    onListeningChange?.(listening);
  }, [listening, onListeningChange]);

  const active = phase === 'playing' ? chordAt(progression, tempoBpm, elapsedMs) : null;
  const lane = active
    ? progression.chords.slice(active.index + 1, active.index + 4)
    : progression.chords.slice(0, 3);

  const handleStart = useCallback(
    async (mode: 'listen' | 'self' = 'listen') => {
      chordObs.current = new Map();
      noteObs.current = new Map();
      gradedIds.current = new Set();
      stepOnset.current = new Map();
      selfScores.current = new Map();
      setResults([]);
      setElapsedMs(0);
      setStreak(0);
      setBestStreak(0);
      bestStreakRef.current = 0;
      setCountInBeat(0);
      setSavedNote(null);
      reset();

      const listen = mode === 'listen';

      // Never start the clock on a microphone that did not open. Before this,
      // a denied permission produced a full run of misses and filed it with the
      // scheduler as a fail — punishing the user for a browser setting.
      if (listen && !(await start())) {
        setSelfGrading(false);
        setPhase('idle');
        return;
      }

      setSelfGrading(!listen);

      if (clickOn) {
        metronome.current ??= createMetronome();
        await metronome.current.start(tempoBpm, COUNT_IN_BEATS);
      }

      setPhase('countin');
    },
    [clickOn, reset, start, tempoBpm],
  );

  /** The player's verdict on the step that is sounding right now. */
  const gradeCurrentStep = useCallback(
    (score: ChordScore) => {
      const current = chordAt(progression, tempoBpm, performance.now() - startedAtRef.current);
      if (current) selfScores.current.set(current.chord.id, score);
    },
    [progression, tempoBpm],
  );

  const handleStop = useCallback(() => {
    setPhase('idle');
    setSelfGrading(false);
    metronome.current?.stop();
    stop();
  }, [stop]);

  function pickGenre(next: string) {
    setOverride(null);
    setGenre(next);
    const first = PROGRESSIONS.find(
      (p) => p.genre === next && (level === 'all' || p.level === level),
    );
    if (first) setProgressionId(first.id);
    setPhase('idle');
  }

  const summary = summarise(results.map((r) => r.score));
  const accuracy = summary.total > 0 ? Math.round((summary.hit / summary.total) * 100) : 0;
  const diagram = diagramFor(active?.chord.positionMetadata?.shapeId);
  const segmentProgress = active
    ? Math.min(1, (elapsedMs - active.startMs) / (active.endMs - active.startMs))
    : 0;

  const liveScore: ChordScore | null =
    active && active.chord.mode !== 'riff'
      ? scoreDetection(active.chord, latestChord.current)
      : null;

  return (
    <section className="card" ref={sectionRef}>
      <div className="card__header">
        <h2 className="card__title">Chord Hero</h2>
        <span className="pill">{PROGRESSIONS.length} progressions</span>
      </div>

      {errorCode && phase === 'idle' ? (
        <MicNotice
          code={errorCode}
          detail={error}
          onRetry={() => void handleStart('listen')}
          onContinueWithout={() => void handleStart('self')}
          continueLabel="Play it self-graded"
        />
      ) : error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {phase === 'idle' ? (
        <>
          <p className="card__body">
            Pick something to play. The app listens and scores each chord or riff by ear —
            nothing is recorded or uploaded.
          </p>

          <div className="field">
            <span className="field__label">Style</span>
            <div className="segmented segmented--wrap">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`segmented__option${g === genre ? ' segmented__option--active' : ''}`}
                  onClick={() => pickGenre(g)}
                  aria-pressed={g === genre}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Level</span>
            <div className="segmented segmented--wrap">
              {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`segmented__option${l === level ? ' segmented__option--active' : ''}`}
                  onClick={() => setLevel(l)}
                  aria-pressed={l === level}
                >
                  {l === 'all' ? 'All' : l}
                </button>
              ))}
            </div>
          </div>

          <label className="field" htmlFor="progression-select">
            <span className="field__label">Progression ({visible.length} here)</span>
            <select
              id="progression-select"
              className="select"
              value={progression.id}
              onChange={(event) => setProgressionId(event.target.value)}
            >
              {visible.map((p) => (
                <option key={p.id} value={p.id}>
                  {stateById.has(progressionSkillId(p.id)) ? '✓ ' : ''}
                  {p.title} · {p.level}
                </option>
              ))}
            </select>
          </label>

          {needsRetuning(progression) ? (
            <p className="notice notice--warn" data-testid="tuning-notice">
              <strong>{tuningOf(progression).name}:</strong> {tuningOf(progression).instructions} The
              tuner on the Dashboard will get you there.
            </p>
          ) : null}

          {progression.description ? <p className="card__hint">{progression.description}</p> : null}
          {progression.teaches ? (
            <p className="card__hint">
              <strong>Teaches:</strong> {progression.teaches}
            </p>
          ) : null}

          <div className="field">
            <span className="field__label">Tempo — {tempoBpm} bpm</span>
            <div className="segmented segmented--wrap">
              {[0.5, 0.75, 1, 1.25].map((factor) => (
                <button
                  key={factor}
                  type="button"
                  className={`segmented__option${factor === tempoScale ? ' segmented__option--active' : ''}`}
                  onClick={() => setTempoScale(factor)}
                  aria-pressed={factor === tempoScale}
                >
                  {Math.round(progression.tempoBpm * factor)}
                </button>
              ))}
            </div>
          </div>

          <ol className="chordlist">
            {progression.chords.map((step) => (
              <li key={step.id} className="chordlist__item">
                <span className="chordlist__name">{stepLabel(step)}</span>
                <span className="chordlist__mode">
                  {step.shapeLabel ? `${step.shapeLabel} · ` : ''}
                  {PLAY_MODE_HINTS[step.mode]}
                </span>
              </li>
            ))}
          </ol>

          {sessions.length > 0 ? (
            <>
              <span className="field__label">Recent runs</span>
              <ul className="history">
                {sessions.map((session) => (
                  <li key={session.id} className="history__row">
                    <span className="history__title">{session.title}</span>
                    <span className="history__bar" aria-hidden="true">
                      <span
                        className="history__fill"
                        style={{ width: `${Math.round(session.accuracy * 100)}%` }}
                      />
                    </span>
                    <span className="history__pct">
                      {Math.round(session.accuracy * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {override ? (
            <p className="notice notice--ok">
              Replaying <strong>{override.chords.length}</strong> tricky step
              {override.chords.length === 1 ? '' : 's'} from your last run, slower.
            </p>
          ) : null}

          <div className="field">
            <span className="field__label">Tempo ramp</span>
            <div className="segmented segmented--wrap">
              {[false, true].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  className={`segmented__option${on === rampOn ? ' segmented__option--active' : ''}`}
                  onClick={() => setRampOn(on)}
                  aria-pressed={on === rampOn}
                >
                  {on ? 'Speed up when clean' : 'Fixed tempo'}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Scoring</span>
            <div className="segmented segmented--wrap">
              {[false, true].map((strict) => (
                <button
                  key={String(strict)}
                  type="button"
                  className={`segmented__option${strict === timingStrict ? ' segmented__option--active' : ''}`}
                  onClick={() => setTimingStrict(strict)}
                  aria-pressed={strict === timingStrict}
                >
                  {strict ? 'Notes + timing' : 'Notes only'}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Click track</span>
            <div className="segmented segmented--wrap">
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  className={`segmented__option${on === clickOn ? ' segmented__option--active' : ''}`}
                  onClick={() => setClickOn(on)}
                  aria-pressed={on === clickOn}
                >
                  {on ? 'Metronome on' : 'Off'}
                </button>
              ))}
            </div>
          </div>

          <div className="task__grades">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void handleStart('listen')}
              disabled={isStarting}
            >
              {isStarting ? 'Waiting for microphone…' : 'Play'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void handleStart('self')}
              disabled={isStarting}
              data-testid="play-self-graded"
            >
              Play self-graded
            </button>
          </div>
          <p className="card__hint">
            On <strong>notes + timing</strong>, a chord played more than 70&nbsp;ms off the
            beat drops from Hit to Close. The click sits above 2&nbsp;kHz, outside the range
            the detector analyses, so it keeps you in time without scoring itself.
          </p>
        </>
      ) : null}

      {phase === 'countin' ? (
        <div className="countdown">
          <span className="countdown__value">{COUNT_IN_BEATS - countInBeat}</span>
          <span className="countdown__unit">get ready — {progression.title}</span>
        </div>
      ) : null}

      {phase === 'playing' && active ? (
        <>
          <div className="hero">
            <div className="hero__now">
              <span className="hero__label">Now</span>
              <span className="hero__chord">{stepLabel(active.chord)}</span>
              <span className="hero__mode">
                {active.chord.shapeLabel
                  ? `${active.chord.shapeLabel} · ${PLAY_MODE_HINTS[active.chord.mode]}`
                  : PLAY_MODE_HINTS[active.chord.mode]}
              </span>
            </div>
            <div className="hero__next">
              <span className="hero__label">Streak</span>
              <span className="hero__chord hero__chord--next">{streak}</span>
            </div>
          </div>

          <div className="lane">
            {lane.map((step) => (
              <span key={step.id} className="lane__item">
                {stepLabel(step)}
              </span>
            ))}
            {lane.length === 0 ? <span className="lane__item">last one</span> : null}
          </div>

          <div
            className="beatbar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(segmentProgress * 100)}
            aria-label="Progress through the current step"
          >
            <span className="beatbar__fill" style={{ width: `${segmentProgress * 100}%` }} />
          </div>

          <p className="card__hint">
            {needsRetuning(progression) ? `${tuningOf(progression).name} · ` : ''}
            Step {active.index + 1} of {progression.chords.length}
            {active.chord.positionMetadata
              ? ` · string ${active.chord.positionMetadata.rootString}, fret ${active.chord.positionMetadata.rootFret}`
              : ''}
          </p>

          {diagram ? (
            <FretboardDiagram
              rootString={diagram.rootString}
              rootFret={diagram.rootFret}
              lowestFret={diagram.lowestFret}
              highestFret={diagram.highestFret}
              fingers={diagram.fingers}
              mutedStrings={diagram.mutedStrings}
              title={stepLabel(active.chord)}
            />
          ) : null}

          {selfGrading ? (
            <div className="selfgrade" data-testid="selfgrade">
              <p className="card__hint">
                No microphone — you are the judge. Rule on each step as it passes; anything you
                leave alone counts as unclear rather than as a miss.
              </p>
              <div className="task__grades">
                <button
                  type="button"
                  className="button button--grade grade--easy"
                  onClick={() => gradeCurrentStep('hit')}
                  data-testid="selfgrade-hit"
                >
                  Got it
                </button>
                <button
                  type="button"
                  className="button button--grade grade--hard"
                  onClick={() => gradeCurrentStep('partial')}
                >
                  Nearly
                </button>
                <button
                  type="button"
                  className="button button--grade grade--fail"
                  onClick={() => gradeCurrentStep('miss')}
                  data-testid="selfgrade-miss"
                >
                  Missed
                </button>
              </div>
            </div>
          ) : (
          <div
            className={`verdict ${
              active.chord.mode === 'riff'
                ? currentNote
                  ? 'verdict--hit'
                  : 'verdict--idle'
                : liveScore
                  ? SCORE_LABELS[liveScore].modifier
                  : 'verdict--idle'
            }`}
            role="status"
          >
            {active.chord.mode === 'riff'
              ? currentNote
                ? `Hearing ${currentNote}`
                : 'Listening…'
              : currentChord
                ? `Hearing ${shortChordLabel(currentChord.root, currentChord.quality)}`
                : (currentResult?.noiseLevel ?? 0) > 0.55
                  ? 'Too noisy — play more cleanly'
                  : 'Listening…'}
          </div>
          )}

          <button type="button" className="button button--ghost" onClick={handleStop}>
            Stop
          </button>
        </>
      ) : null}

      {phase === 'finished' ? (
        <>
          <div className="hero">
            <div className="hero__now">
              <span className="hero__label">Accuracy</span>
              <span className="hero__chord">{accuracy}%</span>
              <span className="hero__mode">
                {summary.hit}/{summary.total} clean
                {summary.partial > 0 ? `, ${summary.partial} close` : ''}
              </span>
            </div>
            <div className="hero__next">
              <span className="hero__label">Best streak</span>
              <span className="hero__chord hero__chord--next">{bestStreak}</span>
            </div>
          </div>

          <ol className="chordlist">
            {progression.chords.map((step) => {
              const result = results.find((r) => r.chordId === step.id);
              const label = SCORE_LABELS[result?.score ?? 'unclear'];
              return (
                <li key={step.id} className="chordlist__item">
                  <span className="chordlist__name">{stepLabel(step)}</span>
                  <span className="chordlist__mode">{describeTiming(result?.timingMs ?? null)}</span>
                  <span className={`tag ${label.modifier}`}>{label.text}</span>
                </li>
              );
            })}
          </ol>

          {savedNote ? (
            <p className="notice notice--ok">
              Filed as <strong>{savedNote}</strong>
              {(() => {
                const interval = stateById.get(progressionSkillId(progression.id))?.intervalDays;
                return interval !== undefined ? ` — back in ${describeInterval(interval)}.` : '.';
              })()}
            </p>
          ) : null}

          <div className="task__grades">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void handleStart()}
            >
              Play again
            </button>

            {(() => {
              const misses = missedStepsProgression(progression, scoreById);
              return misses ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setOverride(misses);
                    setTempoScale(1);
                    setPhase('idle');
                  }}
                >
                  Practise the {misses.chords.length} tricky bits
                </button>
              ) : null;
            })()}

            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setOverride(null);
                handleStop();
              }}
            >
              Choose another
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
