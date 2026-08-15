import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { createChimePlayer, type ChimePlayer } from '../audio/chime';
import {
  buildAutoSession,
  definitionFor,
  describeSession,
  isFinished,
  progressAt,
  scoreSession,
  type Activity,
  type ActivityOutcome,
  type AutoSessionScript,
} from '../domain/autoSession';
import { useChordDetector } from '../hooks/useChordDetector';
import {
  describeEarResult,
  gradeByEar,
  targetChordFor,
  type HeardChord,
} from '../domain/earGrading';
import {
  EMPTY_EVIDENCE,
  addFrame,
  decisionProgress,
  describeEvidence,
  isDecided,
  type EvidenceState,
} from '../domain/activityProgress';
import {
  PROGRESSION_BY_ID,
  chordAt,
  gradeFromSummary,
  progressionDurationMs,
  scoreWindow,
  scoreRiffWindow,
  summarise,
  type ChordScore,
} from '../domain/progressions';
import { shortChordLabel } from '../audio/chordDetection';
import { MicNotice } from './MicNotice';
import { toDiagram } from '../domain/shapeTrainer';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { appendSession } from '../storage/sessionLog';
import { useSkillStates } from '../hooks/useSkillStates';
import { usePracticeStreak } from '../hooks/usePracticeStreak';
import { useRecentSessions } from '../hooks/useRecentSessions';
import { FretboardDiagram } from './FretboardDiagram';
import { useHandedness } from '../hooks/useHandedness';

/**
 * The auto session: press play, then play.
 *
 * Everything about *what* happens is decided in `src/domain/autoSession.ts` —
 * this file is the surface. It renders the current activity, counts it down,
 * moves on when it is over, and files what happened. There is deliberately no
 * setting on this screen: the moment it grows a tempo slider it becomes another
 * thing to configure before playing, which is the mode it exists to replace.
 *
 * Laid out from the Claude Design mockup (screen 1a): a segmented rail across
 * the top, one large card in the middle carrying whatever the current activity
 * needs, and a single full-width action at the bottom.
 */

interface AutoSessionPanelProps {
  user: User;
  /** How long the sitting should be. Defaults to the seven-minute session. */
  minutes?: number;
}

type Phase = 'ready' | 'running' | 'paused' | 'finished';

/** How often the microphone is sampled into the activity's buffer. */
const SAMPLE_MS = 100;

/** The eyebrow above the rail: where you are, in words. */
function activityLabel(activity: Activity | null): string {
  if (!activity) return 'Session complete';

  switch (activity.kind) {
    case 'tune':
      return 'Tune up';
    case 'shape':
      return 'Chord shape';
    case 'progression':
      return 'Chord changes';
    case 'riff':
      return 'Notes';
    case 'sniper':
      return 'Picking accuracy';
  }
}

export function AutoSessionPanel({ user, minutes }: AutoSessionPanelProps) {
  const { states } = useSkillStates(user.uid);
  const handedness = useHandedness(user);
  const { streak } = usePracticeStreak(user.uid);
  const { sessions } = useRecentSessions(user.uid, 10);

  const [phase, setPhase] = useState<Phase>('ready');
  const [index, setIndex] = useState(0);
  const [evidence, setEvidence] = useState<EvidenceState>(EMPTY_EVIDENCE);
  const [script, setScript] = useState<AutoSessionScript | null>(null);
  const [outcomes, setOutcomes] = useState<ActivityOutcome[]>([]);
  const [lastDetail, setLastDetail] = useState<string | null>(null);

  const {
    currentChord,
    currentNote,
    error: micError,
    errorCode,
    isRunning: micRunning,
    isStarting,
    start: startListening,
    stop: stopListening,
    reset: resetDetector,
  } = useChordDetector();

  /**
   * Everything heard during the current activity.
   *
   * One microphone, one buffer, read differently per activity kind — a chord
   * shape wants frames of chords, a progression wants them bucketed by step,
   * a riff wants note names. Collecting once and interpreting at the end keeps
   * a single listening path rather than four.
   */
  const frames = useRef<HeardChord[]>([]);
  const notes = useRef<string[]>([]);
  const stepFrames = useRef<Map<string, HeardChord[]>>(new Map());
  const stepNotes = useRef<Map<string, string[]>>(new Map());
  const activityStartedAt = useRef(0);
  /**
   * Read by the sampling effect above.
   *
   * An effect that fires on every detector frame would otherwise capture the
   * script and index from the render that created it — the same stale-closure
   * bug this project has hit twice before, and the reason both are refs.
   */
  const scriptRef = useRef<AutoSessionScript | null>(null);
  const indexRef = useRef(0);
  const outcomesRef = useRef<ActivityOutcome[]>([]);
  /** Read inside the sampler, which must not close over a render's state. */
  const evidenceRef = useRef<EvidenceState>(EMPTY_EVIDENCE);
  /**
   * The sampler calls this rather than `advance` directly.
   *
   * `advance` is rebuilt whenever the skill states change, and an interval that
   * captured an old one would judge with a stale buffer — the same class of bug
   * as the two stale closures already recorded in this project.
   */
  const advanceRef = useRef<() => void>(() => {});

  const chime = useRef<ChimePlayer | null>(null);
  useEffect(
    () => () => {
      chime.current?.close();
      chime.current = null;
      stopListening();
    },
    [stopListening],
  );

  const recentAccuracy = useMemo(
    () => sessions.filter((s) => s.steps > 0).map((s) => s.accuracy),
    [sessions],
  );

  const progressionOf = (activity: Activity | null) =>
    activity?.progressionId ? (PROGRESSION_BY_ID.get(activity.progressionId) ?? null) : null;

  // Latest reading from the detector, for the sampler below.
  const latestChord = useRef<HeardChord>(null);
  const latestNote = useRef<string | null>(null);

  useEffect(() => {
    latestChord.current = currentChord
      ? { root: currentChord.root, quality: currentChord.quality }
      : null;
  }, [currentChord]);

  useEffect(() => {
    latestNote.current = currentNote;
  }, [currentNote]);

  /**
   * One sampler for the whole session, on a fixed clock.
   *
   * **Not** driven by detector updates, which was the first attempt and was
   * wrong: the pitch detector republishes every 30 ms while the chord detector
   * publishes eight times a second, so an effect keyed on both pushed a chord
   * frame — usually `null` — on every *note* flicker. The buffer filled with
   * nulls, the heard-share fell under the threshold, and a correctly played
   * chord was reported as "not heard". A steady sample rate makes each frame
   * mean the same thing, which is what the scorers assume.
   */
  useEffect(() => {
    if (phase !== 'running') return;

    const handle = window.setInterval(() => {
      const script_ = scriptRef.current;
      const activity = script_?.activities[indexRef.current];
      if (!activity) return;

      if (activity.kind === 'shape' || activity.kind === 'tune') {
        frames.current.push(latestChord.current);
        if (latestNote.current) notes.current.push(latestNote.current);

        // Evidence, not elapsed time, ends the activity. A tune-up has no
        // target chord to match, so it waits for the player to move on.
        const definition_ = definitionFor(activity.skillId);
        const target = definition_ ? targetChordFor(definition_) : null;
        if (!target) return;

        const next = addFrame(evidenceRef.current, target, latestChord.current);
        evidenceRef.current = next;
        setEvidence(next);

        if (isDecided(next)) advanceRef.current();
        return;
      }

      const progression = progressionOf(activity);
      if (!progression) return;

      // A progression is bounded by the music itself: it ends when the last
      // step has been played, which is a musical length rather than a session
      // timer. Until the first sound arrives it does not start at all.
      const heardYet = evidenceRef.current.heard > 0 || latestChord.current !== null;
      if (!heardYet) {
        activityStartedAt.current = performance.now();
        return;
      }
      if (latestChord.current) {
        evidenceRef.current = { ...evidenceRef.current, heard: evidenceRef.current.heard + 1 };
      }

      const elapsedMs = performance.now() - activityStartedAt.current;
      if (elapsedMs > progressionDurationMs(progression, activity.tempoBpm ?? progression.tempoBpm)) {
        advanceRef.current();
        return;
      }

      // Judge each frame against the step that was actually sounding.
      const step = chordAt(
        progression,
        activity.tempoBpm ?? progression.tempoBpm,
        performance.now() - activityStartedAt.current,
      );
      if (!step) return;

      if (step.chord.mode === 'riff') {
        const bucket = stepNotes.current.get(step.chord.id) ?? [];
        if (latestNote.current) bucket.push(latestNote.current);
        stepNotes.current.set(step.chord.id, bucket);
      } else {
        const bucket = stepFrames.current.get(step.chord.id) ?? [];
        bucket.push(latestChord.current);
        stepFrames.current.set(step.chord.id, bucket);
      }
    }, SAMPLE_MS);

    return () => window.clearInterval(handle);
  }, [phase]);

  // Built once per sitting, when Play is pressed. Rebuilding it live would mean
  // the session changing shape underneath someone mid-activity.
  const start = useCallback(
    async (mode: 'listen' | 'silent' = 'listen') => {
      resetDetector();

      // Never start a scored session on a microphone that did not open: every
      // activity would be judged on silence.
      // Never start a scored session on a microphone that did not open: every
      // activity would be judged on silence.
      if (mode === 'listen' && !(await startListening())) return;

      const built = buildAutoSession({
        states,
        streak,
        now: new Date(),
        recentAccuracy,
        canListen: mode === 'listen',
        ...(minutes !== undefined ? { minutes } : {}),
      });

      scriptRef.current = built;
      indexRef.current = 0;
      outcomesRef.current = [];
      frames.current = [];
      notes.current = [];
      stepFrames.current = new Map();
      stepNotes.current = new Map();
      activityStartedAt.current = performance.now();

      setScript(built);
      setOutcomes([]);
      setLastDetail(null);
      setIndex(0);
      setEvidence(EMPTY_EVIDENCE);
      evidenceRef.current = EMPTY_EVIDENCE;
      setPhase('running');
    },
    [states, streak, recentAccuracy, minutes, resetDetector, startListening],
  );

  const progress = script ? progressAt(script, index) : null;
  const activity = progress?.activity ?? null;

  /**
   * What the microphone made of the activity that just ended.
   *
   * Each kind is judged by the module that already knows how: chord shapes by
   * `gradeByEar`, progressions and riffs by the same scorers Chord Hero uses.
   * The auto session adds no scoring rules of its own — a second set would
   * disagree with the first eventually.
   */
  const judge = useCallback((activity: Activity): ActivityOutcome => {
    const definitionForActivity = definitionFor(activity.skillId);

    if (activity.kind === 'tune') {
      const heardAnything = notes.current.length > 0;
      return {
        activityId: activity.id,
        grade: null, // Tuning is not a skill to schedule.
        detail: heardAnything
          ? `Heard ${notes.current[notes.current.length - 1]}. Tuned up.`
          : 'Nothing heard — check the microphone before the next one.',
      };
    }

    if (activity.kind === 'shape') {
      const target = definitionForActivity ? targetChordFor(definitionForActivity) : null;
      if (!target) return { activityId: activity.id, grade: null, detail: 'Nothing to score here.' };

      const result = gradeByEar(target, frames.current);
      return {
        activityId: activity.id,
        grade: result.grade,
        detail: describeEarResult(target, result),
      };
    }

    const progression = progressionOf(activity);
    if (!progression) return { activityId: activity.id, grade: null, detail: '' };

    const scores: ChordScore[] = progression.chords.map((step) =>
      step.mode === 'riff'
        ? scoreRiffWindow(step.notes ?? [], stepNotes.current.get(step.id) ?? []).score
        : scoreWindow(step, stepFrames.current.get(step.id) ?? []).score,
    );

    const summary = summarise(scores);
    const heardAnything = summary.total > summary.unclear;

    return {
      activityId: activity.id,
      grade: heardAnything ? gradeFromSummary(summary) : null,
      detail: heardAnything
        ? `${summary.hit} of ${summary.total} clean.`
        : 'Nothing heard for that one.',
    };
  }, []);

  /** Scores the activity that just ended, files it, and moves on. */
  const advance = useCallback(() => {
    const current = scriptRef.current?.activities[indexRef.current];
    if (!scriptRef.current || !current) return;

    const outcome = judge(current);
    outcomesRef.current = [...outcomesRef.current, outcome];
    setOutcomes(outcomesRef.current);
    setLastDetail(outcome.detail);

    // Silence files nothing: an activity nobody played is not a failure, and
    // filing it would teach the scheduler about an event that never happened.
    if (current.skillId && outcome.grade) {
      void upsertSkillPracticeState(user.uid, {
        skillId: current.skillId,
        result: outcome.grade,
        current: states.find((s) => s.skillId === current.skillId) ?? null,
      }).catch((error: unknown) => {
        console.error('[auto] Could not file activity.', error);
      });
    }

    const next = indexRef.current + 1;
    indexRef.current = next;
    setIndex(next);
    setEvidence(EMPTY_EVIDENCE);
    evidenceRef.current = EMPTY_EVIDENCE;
    frames.current = [];
    notes.current = [];
    stepFrames.current = new Map();
    stepNotes.current = new Map();
    activityStartedAt.current = performance.now();

    if (isFinished(scriptRef.current, next)) {
      const score = scoreSession(outcomesRef.current);

      setPhase('finished');
      stopListening();
      chime.current ??= createChimePlayer();
      chime.current.play(score.accuracy >= 0.65 ? 'success' : 'gentle');

      void appendSession(user.uid, {
        kind: 'today',
        subject: 'auto-session',
        title: `Auto session — ${scriptRef.current.activities.length} activities`,
        accuracy: score.accuracy,
        steps: score.scored,
        hits: score.clean,
        partials: 0,
        misses: score.scored - score.clean,
        graded: 'audio',
      }).catch((error: unknown) => {
        console.error('[auto] Session log write failed.', error);
      });
    }
  }, [judge, states, stopListening, user.uid]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);



  const definition = definitionFor(activity?.skillId);
  const diagram = definition ? toDiagram(definition) : null;

  if (phase === 'ready' || !script || !progress) {
    return (
      <section className="card auto">
        <div className="auto__intro">
          <p className="section-head__eyebrow">Seven minutes before dinner</p>
          <h2 className="auto__headline">Ready when you are.</h2>
          <p className="auto__lead">
            No settings. It picks what is due, sets the tempo from how your last runs went, and
            moves you on. Put the guitar in your hands and press play.
          </p>
        </div>
        {errorCode ? (
          <MicNotice
            code={errorCode}
            detail={micError}
            onRetry={() => void start('listen')}
            onContinueWithout={() => void start('silent')}
            continueLabel="Run it without scoring"
          />
        ) : null}

        <button
          type="button"
          className="button button--primary button--block"
          onClick={() => void start('listen')}
          disabled={isStarting}
        >
          {isStarting ? 'Waiting for microphone…' : 'Start the session'}
        </button>
      </section>
    );
  }

  if (phase === 'finished') {
    const score = scoreSession(outcomes);

    return (
      <section className="card auto" data-testid="auto-finished">
        <div className="auto__intro">
          <p className="section-head__eyebrow">Done</p>
          <h2 className="auto__headline" data-testid="auto-points">
            {score.points} points
          </h2>
          <p className="auto__lead">{describeSession(score)}</p>
        </div>

        <ul className="outcomes" data-testid="outcomes">
          {outcomes.map((outcome, position) => {
            const activity = script.activities[position];
            return (
              <li key={outcome.activityId} className="outcomes__row">
                <span className="outcomes__title">{activity?.title ?? ''}</span>
                <span className={`tag ${outcome.grade ? `grade--${outcome.grade}` : 'tag--muted'}`}>
                  {outcome.grade ?? 'not heard'}
                </span>
                <span className="outcomes__detail">{outcome.detail}</span>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="button button--primary button--block"
          onClick={() => void start('listen')}
        >
          Go again
        </button>
      </section>
    );
  }

  // How close the current activity is to a verdict. Not time — evidence.
  const segmentProgress = decisionProgress(evidence);

  return (
    <section className="card auto auto--playing" data-testid="auto-session">
      {/* The rail: done, doing, still to come. */}
      <div className="rail" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total}
        aria-valuenow={progress.done} aria-label="Session progress">
        {script.activities.map((item, position) => (
          <span
            key={item.id}
            className={`rail__seg${
              position < index ? ' rail__seg--done' : position === index ? ' rail__seg--now' : ''
            }`}
          >
            {position === index ? (
              <span className="rail__fill" style={{ width: `${segmentProgress * 100}%` }} />
            ) : null}
          </span>
        ))}
      </div>

      {/* Changes once per activity, so it is safe to announce in full. */}
      <p className="visually-hidden" role="status" data-testid="auto-live">
        {`Step ${index + 1} of ${progress.total}. ${activityLabel(activity)}: ${activity?.title ?? ''}. ${activity?.coaching ?? ''}`}
      </p>

      <div className="rail__legend">
        <span data-testid="auto-step">
          {index + 1}/{progress.total} · {activityLabel(activity)}
        </span>
        <span data-testid="auto-points-live">{scoreSession(outcomes).points} pts</span>
      </div>

      <div className="auto__stage">
        <p className="auto__eyebrow">
          {activity?.kind === 'tune' ? 'Tune up' : activity?.kind === 'shape' ? 'Change to' : 'Play'}
        </p>
        <p className="auto__title" data-testid="auto-title">
          {activity?.title}
        </p>

        {diagram ? (
          <FretboardDiagram
              handedness={handedness}
            rootString={diagram.rootString}
            rootFret={diagram.rootFret}
            lowestFret={diagram.lowestFret}
            highestFret={diagram.highestFret}
            fingers={diagram.fingers}
            mutedStrings={diagram.mutedStrings}
            title={definition?.title ?? activity?.title ?? ''}
          />
        ) : null}

        {activity?.tempoBpm ? (
          <p className="auto__tempo" data-testid="auto-tempo">
            {activity.tempoBpm} BPM
          </p>
        ) : null}

        {/*
          What the microphone makes of it right now, and how close that is to a
          verdict. This replaced a countdown: the thing worth watching is the
          playing, not the clock.
        */}
        <div
          className={`verdict ${currentChord || currentNote ? 'verdict--hit' : 'verdict--idle'}`}
          role="status"
          data-testid="auto-hearing"
          data-running={String(micRunning)}
        >
          {activity?.kind === 'tune' || activity?.kind === 'riff' || activity?.kind === 'sniper'
            ? currentNote
              ? `Hearing ${currentNote}`
              : 'Listening…'
            : currentChord
              ? `Hearing ${shortChordLabel(currentChord.root, currentChord.quality)}`
              : 'Listening…'}
        </div>

        <p className="auto__coaching" data-testid="auto-evidence">
          {describeEvidence(evidence)}
        </p>

        {lastDetail ? (
          <p className="auto__lastdetail" data-testid="auto-last">
            {lastDetail}
          </p>
        ) : null}
      </div>

      <div className="auto__actions">
        <button
          type="button"
          className="button button--primary button--block"
          onClick={() => setPhase(phase === 'running' ? 'paused' : 'running')}
        >
          {phase === 'running' ? 'Pause session' : 'Resume'}
        </button>
        <button
          type="button"
          className="button button--ghost button--block"
          onClick={() => advanceRef.current()}
        >
          Skip this one
        </button>
      </div>

      <p className="card__hint auto__rationale">{script.rationale}</p>
    </section>
  );
}
