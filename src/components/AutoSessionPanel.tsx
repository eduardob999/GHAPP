import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { createChimePlayer, type ChimePlayer } from '../audio/chime';
import {
  buildAutoSession,
  definitionFor,
  isFinished,
  progressAt,
  type Activity,
  type AutoSessionScript,
} from '../domain/autoSession';
import { toDiagram } from '../domain/shapeTrainer';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { appendSession } from '../storage/sessionLog';
import { useSkillStates } from '../hooks/useSkillStates';
import { usePracticeStreak } from '../hooks/usePracticeStreak';
import { useRecentSessions } from '../hooks/useRecentSessions';
import { FretboardDiagram } from './FretboardDiagram';

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

const TICK_MS = 250;

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${`${whole % 60}`.padStart(2, '0')}`;
}

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
  const { streak } = usePracticeStreak(user.uid);
  const { sessions } = useRecentSessions(user.uid, 10);

  const [phase, setPhase] = useState<Phase>('ready');
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [script, setScript] = useState<AutoSessionScript | null>(null);

  const chime = useRef<ChimePlayer | null>(null);
  useEffect(
    () => () => {
      chime.current?.close();
      chime.current = null;
    },
    [],
  );

  const recentAccuracy = useMemo(
    () => sessions.filter((s) => s.steps > 0).map((s) => s.accuracy),
    [sessions],
  );

  // Built once per sitting, when Play is pressed. Rebuilding it live would mean
  // the session changing shape underneath someone mid-activity.
  const start = useCallback(() => {
    setScript(
      buildAutoSession({
        states,
        streak,
        now: new Date(),
        recentAccuracy,
        ...(minutes !== undefined ? { minutes } : {}),
      }),
    );
    setIndex(0);
    setElapsed(0);
    setPhase('running');
  }, [states, streak, recentAccuracy, minutes]);

  const progress = script ? progressAt(script, index) : null;
  const activity = progress?.activity ?? null;

  /** Files one activity, then moves to the next. */
  const advance = useCallback(() => {
    if (!script) return;

    const current = script.activities[index];
    if (current?.skillId) {
      // Completing an activity is not the same as playing it well — the auto
      // session has no verdict of its own, so it files the neutral grade and
      // lets the drills that *do* score contribute the real ones.
      void upsertSkillPracticeState(user.uid, {
        skillId: current.skillId,
        result: 'good',
        current: states.find((s) => s.skillId === current.skillId) ?? null,
      }).catch((error: unknown) => {
        console.error('[auto] Could not file activity.', error);
      });
    }

    const next = index + 1;
    setIndex(next);
    setElapsed(0);

    if (isFinished(script, next)) {
      setPhase('finished');
      chime.current ??= createChimePlayer();
      chime.current.play('success');

      void appendSession(user.uid, {
        kind: 'today',
        subject: 'auto-session',
        title: `Auto session — ${script.activities.length} activities`,
        accuracy: 1,
        steps: script.activities.length,
        hits: script.activities.length,
        partials: 0,
        misses: 0,
        graded: 'self',
      }).catch((error: unknown) => {
        console.error('[auto] Session log write failed.', error);
      });
    }
  }, [script, index, states, user.uid]);

  // The clock. One interval for the whole session rather than one per activity,
  // so a slow render cannot leave two running at once.
  useEffect(() => {
    if (phase !== 'running' || !activity) return;

    const handle = window.setInterval(() => {
      setElapsed((previous) => {
        const next = previous + TICK_MS / 1000;
        if (next >= activity.seconds) {
          advance();
          return 0;
        }
        return next;
      });
    }, TICK_MS);

    return () => window.clearInterval(handle);
  }, [phase, activity, advance]);

  const definition = definitionFor(activity?.skillId);
  const diagram = definition ? toDiagram(definition) : null;

  if (phase === 'ready' || !script || !progress) {
    return (
      <section className="card auto">
        <div className="auto__intro">
          <p className="section-head__eyebrow">Seven minutes before dinner</p>
          <h1 className="auto__headline">Ready when you are.</h1>
          <p className="auto__lead">
            No settings. It picks what is due, sets the tempo from how your last runs went, and
            moves you on. Put the guitar in your hands and press play.
          </p>
        </div>
        <button type="button" className="button button--primary button--block" onClick={start}>
          Start the session
        </button>
      </section>
    );
  }

  if (phase === 'finished') {
    return (
      <section className="card auto">
        <div className="auto__intro">
          <p className="section-head__eyebrow">Done</p>
          <h1 className="auto__headline">That is the session.</h1>
          <p className="auto__lead">
            {script.activities.length} activities, filed to your practice log. Come back tomorrow
            and it will pick up where this left off.
          </p>
        </div>
        <button type="button" className="button button--primary button--block" onClick={start}>
          Go again
        </button>
      </section>
    );
  }

  const segmentProgress = activity ? Math.min(1, elapsed / activity.seconds) : 0;

  return (
    <section className="card auto" data-testid="auto-session">
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

      <div className="rail__legend">
        <span data-testid="auto-step">
          Step {index + 1} of {progress.total} · {activityLabel(activity)}
        </span>
        <span>{formatClock(progress.secondsRemaining - elapsed)} left</span>
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
            rootString={diagram.rootString}
            rootFret={diagram.rootFret}
            lowestFret={diagram.lowestFret}
            highestFret={diagram.highestFret}
            fingers={diagram.fingers}
            mutedStrings={diagram.mutedStrings}
            title={definition?.title ?? activity?.title ?? ''}
          />
        ) : null}

        <p className="auto__coaching">{activity?.coaching}</p>

        {activity?.tempoBpm ? (
          <p className="auto__tempo" data-testid="auto-tempo">
            {activity.tempoBpm} BPM
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
        <button type="button" className="button button--ghost button--block" onClick={advance}>
          Skip this one
        </button>
      </div>

      <p className="card__hint auto__rationale">{script.rationale}</p>
    </section>
  );
}
