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
  describeRiffPositions,
  gradeByEar,
  targetChordFor,
  type HeardChord,
} from '../domain/earGrading';
import {
  EMPTY_EVIDENCE,
  EMPTY_STRIKES,
  addFrame,
  addStrike,
  decisionProgress,
  describeEvidence,
  describeStrikes,
  isDecided,
  isStruckThrough,
  strikeProgress,
  type EvidenceState,
  type StrikeState,
} from '../domain/activityProgress';
import {
  expectedNote,
  gradeRiff,
  hearNote,
  isRiffComplete,
  riffPositions,
  startRiff,
  summariseRiff,
  type RiffDrillState,
} from '../domain/riffDrill';
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
 * this file is the surface. It renders the current activity, listens, moves on
 * when the playing says it is over, and files what happened. There is
 * deliberately no setting on this screen: the moment it grows a tempo slider it
 * becomes another thing to configure before playing, which is the mode it
 * exists to replace.
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
  /**
   * The two ways a picked activity finishes.
   *
   * `drill` is the riff drill String Sniper runs on: it knows which notes are
   * coming and advances the cursor as each one is heard. `strikes` is the
   * tune-up, which counts strings struck without judging their pitch — see
   * `activityProgress.ts` for why those cannot be the same thing.
   */
  const [drill, setDrill] = useState<RiffDrillState | null>(null);
  const [strikes, setStrikes] = useState<StrikeState>(EMPTY_STRIKES);

  const {
    currentChord,
    currentNote,
    onsets,
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
   * shape wants frames of chords, a progression wants them bucketed by step.
   * Collecting once and interpreting at the end keeps a single listening path
   * rather than four.
   *
   * The picked kinds keep no buffer at all: a riff, a picking drill and the
   * tune-up are folded into `drill` and `strikes` as they are heard, because
   * those decide when the activity is *over* and a buffer read at the end
   * cannot.
   */
  const frames = useRef<HeardChord[]>([]);
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
  /** The same, for the two note-driven kinds. */
  const drillRef = useRef<RiffDrillState | null>(null);
  const strikesRef = useRef<StrikeState>(EMPTY_STRIKES);
  /**
   * The detector's onset buffer, which it mutates in place.
   *
   * Held by identity rather than copied: an onset is what tells a re-picked
   * string from a ringing one, and without it a drill whose next note is the
   * one still sounding cannot advance at all (docs/NEXT.md 16d).
   */
  const onsetsRef = useRef<number[]>(onsets);
  useEffect(() => {
    onsetsRef.current = onsets;
  }, [onsets]);
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

      const heardNote = latestNote.current;
      const lastOnset = onsetsRef.current[onsetsRef.current.length - 1] ?? null;

      // The tune-up: six strings struck, in whatever order, and on it goes. It
      // is the one activity that must not ask for a *particular* pitch — a
      // guitar being out of tune is the reason it is on screen.
      if (activity.kind === 'tune') {
        const struck = addStrike(strikesRef.current, heardNote, lastOnset);
        if (struck !== strikesRef.current) {
          strikesRef.current = struck;
          setStrikes(struck);
        }

        if (isStruckThrough(struck, activity.notes?.length ?? 6)) advanceRef.current();
        return;
      }

      if (activity.kind === 'shape') {
        frames.current.push(latestChord.current);

        // Evidence, not elapsed time, ends the activity.
        const definition_ = definitionFor(activity.skillId);
        const target = definition_ ? targetChordFor(definition_) : null;
        if (!target) return;

        const next = addFrame(evidenceRef.current, target, latestChord.current);
        evidenceRef.current = next;
        setEvidence(next);

        if (isDecided(next)) advanceRef.current();
        return;
      }

      // Riffs and picking drills: note by note, with no clock — the drill
      // String Sniper runs. A picking activity used to carry no notes at all,
      // so nothing here could ever decide it was over and the only way past it
      // was the Skip button. It now ends on its last note being played, and a
      // slow player is waited for rather than marched past.
      const drill_ = drillRef.current;
      if (drill_) {
        const next = hearNote(drill_, heardNote, lastOnset);
        if (next !== drill_) {
          drillRef.current = next;
          setDrill(next);
        }

        if (isRiffComplete(next)) advanceRef.current();
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

  /**
   * Arms whichever finishing rule the next activity runs on.
   *
   * A riff or a picking drill gets the note sequence it is finished by; the
   * tune-up gets a clean strike count; chord work gets neither, and is decided
   * by frames of evidence as before.
   */
  const armFor = useCallback((activity: Activity | null) => {
    const drilled =
      activity && activity.kind !== 'tune' && activity.notes?.length
        ? startRiff(activity.notes)
        : null;

    drillRef.current = drilled;
    setDrill(drilled);
    strikesRef.current = EMPTY_STRIKES;
    setStrikes(EMPTY_STRIKES);
  }, []);

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
      stepFrames.current = new Map();
      stepNotes.current = new Map();
      activityStartedAt.current = performance.now();

      setScript(built);
      setOutcomes([]);
      setLastDetail(null);
      setIndex(0);
      setEvidence(EMPTY_EVIDENCE);
      evidenceRef.current = EMPTY_EVIDENCE;
      armFor(built.activities[0] ?? null);
      setPhase('running');
    },
    [armFor, states, streak, recentAccuracy, minutes, resetDetector, startListening],
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
      const struck = strikesRef.current.struck;
      return {
        activityId: activity.id,
        grade: null, // Tuning is not a skill to schedule.
        detail:
          struck.length > 0
            ? `Heard ${struck.length} string${struck.length === 1 ? '' : 's'}: ${struck.join(' · ')}.`
            : 'Nothing heard — check the microphone before the next one.',
      };
    }

    // A riff or a picking drill, judged by the notes that were actually
    // played. The same summary and the same grade String Sniper files, so the
    // two modes cannot drift into disagreeing about the same run.
    const drill_ = drillRef.current;
    if (drill_) {
      const summary = summariseRiff(drill_);
      const struck = summary.played + summary.wrong;

      return {
        activityId: activity.id,
        grade: gradeRiff(summary),
        detail:
          struck === 0
            ? 'Nothing heard for that one.'
            : `${summary.played} of ${summary.total} in order, ${summary.wrong} stray note${
                summary.wrong === 1 ? '' : 's'
              }.`,
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
    stepFrames.current = new Map();
    stepNotes.current = new Map();
    activityStartedAt.current = performance.now();
    armFor(scriptRef.current.activities[next] ?? null);

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
  }, [armFor, judge, states, stopListening, user.uid]);

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

  // How close the current activity is to a verdict. Not time — evidence: notes
  // played for the picked kinds, frames of the right chord for the held ones.
  const segmentProgress = drill
    ? Math.min(1, drill.cursor / Math.max(1, drill.notes.length))
    : activity?.kind === 'tune'
      ? strikeProgress(strikes, activity.notes?.length ?? 6)
      : decisionProgress(evidence);

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

        {/*
          The notes, with the cursor on the one being waited for. Showing where
          the drill has got to is what makes "it moves on by itself" legible —
          without it, a session that advances silently looks like a session
          that skipped something.
        */}
        {activity?.notes?.length ? (
          <>
            <ol className="riffline" data-testid="auto-riffline">
              {riffPositions(activity.notes).map((position, position_) => {
                const done =
                  activity.kind === 'tune'
                    ? position_ < strikes.struck.length
                    : position_ < (drill?.cursor ?? 0);
                const now = !done && (activity.kind === 'tune'
                  ? position_ === strikes.struck.length
                  : position_ === (drill?.cursor ?? 0));

                return (
                  <li
                    key={`${position}-${position_}`}
                    className={`riffline__note${
                      done ? ' riffline__note--done' : now ? ' riffline__note--now' : ''
                    }`}
                  >
                    {position}
                  </li>
                );
              })}
            </ol>
            <p className="auto__riff" data-testid="auto-riff">
              <span className="auto__rifflegend">string:fret · 6 is thickest, 0 is open</span>
            </p>
          </>
        ) : (
          (() => {
            const progression = progressionOf(activity);
            const riffNotes = progression?.chords.flatMap((step) => step.notes ?? []) ?? [];
            if (riffNotes.length === 0) return null;

            return (
              <p className="auto__riff" data-testid="auto-riff">
                <span className="auto__riffpositions">{describeRiffPositions(riffNotes)}</span>
                <span className="auto__rifflegend">string:fret · 6 is thickest, 0 is open</span>
              </p>
            );
          })()
        )}

        {progressionOf(activity)?.strumming ? (
          <p className="strumming" data-testid="auto-strumming">
            <span className="strumming__pattern">
              {progressionOf(activity)!.strumming!.pattern}
            </span>
          </p>
        ) : null}

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
          {drill
            ? isRiffComplete(drill)
              ? 'Done.'
              : `Next: ${riffPositions(drill.notes)[drill.cursor] ?? ''}${
                  expectedNote(drill) ? ` (${expectedNote(drill)})` : ''
                }`
            : activity?.kind === 'tune'
              ? describeStrikes(strikes, activity.notes?.length ?? 6)
              : describeEvidence(evidence)}
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
