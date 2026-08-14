import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { createChimePlayer, type ChimePlayer } from '../audio/chime';
import { companionLine, companionMood, streakLabel } from '../domain/companion';
import {
  earnedMilestones,
  milestoneProgress,
  nextMilestone,
  reachedMilestone,
} from '../domain/streaks';
import { usePracticeStreak } from '../hooks/usePracticeStreak';
import { Companion } from './Companion';

/**
 * The companion, the streak, and the rewards for keeping it.
 *
 * Rewards are for *showing up*, never for playing well: the whole design leans
 * on short distributed sessions, so consistency is the thing worth reinforcing.
 * Accuracy already has its own feedback everywhere else in the app.
 *
 * The card reads the session log and writes nothing. A streak that could be
 * written to would eventually be written to wrongly.
 */

export interface CompanionCardProps {
  user: User;
  /** True while a drill has the microphone open, so the character can listen. */
  listening?: boolean;
  /**
   * Whether reward sounds play. On by default, but nothing makes a noise until
   * something is actually earned — a page that greets you with a sound is rude.
   */
  defaultSound?: boolean;
}

export function CompanionCard({ user, listening = false, defaultSound = true }: CompanionCardProps) {
  const { streak, lastAccuracy, error } = usePracticeStreak(user.uid);
  const [soundOn, setSoundOn] = useState(defaultSound);

  const chime = useRef<ChimePlayer | null>(null);
  useEffect(() => {
    return () => {
      chime.current?.close();
      chime.current = null;
    };
  }, []);

  const milestone = streak.practisedToday ? reachedMilestone(streak.current) : null;

  // Celebrated once per visit rather than once ever. Storing "seen" would mean
  // either a device-local flag — which makes a second device a second account —
  // or a write from a component that has no business writing anything.
  const celebratedRef = useRef<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (!milestone || celebratedRef.current === milestone.days) return;

    celebratedRef.current = milestone.days;
    setCelebrating(true);

    if (soundOn) {
      chime.current ??= createChimePlayer();
      chime.current.play('milestone');
    }

    const timer = window.setTimeout(() => setCelebrating(false), 6000);
    return () => window.clearTimeout(timer);
  }, [milestone, soundOn]);

  const mood = useMemo(
    () =>
      companionMood({
        streak: streak.current,
        practisedToday: streak.practisedToday,
        daysSinceLast: streak.daysSinceLast,
        listening,
        lastAccuracy: streak.practisedToday ? lastAccuracy : null,
        milestoneJustReached: celebrating,
      }),
    [streak, listening, lastAccuracy, celebrating],
  );

  // Seeded by the streak so the line is stable across re-renders and changes as
  // your practice does. A random pick would flicker on every render.
  const line = companionLine(mood, streak.current + streak.totalDays);

  const next = nextMilestone(streak.current);
  const progress = milestoneProgress(streak.current);
  const earned = earnedMilestones(streak.longest);

  return (
    <section className="card companion-card">
      <div className="card__header">
        <h2 className="card__title">Your companion</h2>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => {
            const next = !soundOn;
            setSoundOn(next);
            if (next) {
              chime.current ??= createChimePlayer();
              chime.current.play('gentle');
            }
          }}
          aria-pressed={soundOn}
        >
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>

      {error ? (
        <p className="notice notice--muted">
          Could not read your practice history: {error}. Everything else still works.
        </p>
      ) : null}

      <div className="companion-card__body">
        <Companion mood={mood} />
        <div className="companion-card__text">
          <p className="companion-card__line" data-testid="companion-line">
            {line}
          </p>
          {/*
            Shown straight away rather than behind the log's loading flag.
            Offline with a cold cache the first snapshot can take a long time or
            never arrive at all, and a companion stuck on "counting the days…"
            is worse than one that starts at nothing and corrects itself the
            moment the history lands.
          */}
          <p className="companion-card__streak" data-testid="streak-label">
            {streakLabel(streak.current, streak.practisedToday)}
          </p>
        </div>
      </div>

      {celebrating && milestone ? (
        <p className="notice notice--ok" data-testid="milestone-notice">
          <strong>{milestone.name}.</strong> {milestone.blurb}
        </p>
      ) : null}

      {next ? (
        <div className="milestone">
          <div className="milestone__labels">
            <span>{next.name}</span>
            <span className="milestone__count">
              {streak.current} / {next.days} days
            </span>
          </div>
          <div
            className="beatbar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label={`Progress toward ${next.name}`}
          >
            <span className="beatbar__fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : null}

      {earned.length > 0 ? (
        <ul className="badges" data-testid="badges">
          {earned.map((m) => (
            <li key={m.days} className="badge" title={m.blurb}>
              <span className="badge__days">{m.days}d</span>
              <span className="badge__name">{m.name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="card__hint">
        Best run: {streak.longest} day{streak.longest === 1 ? '' : 's'} · {streak.totalDays} day
        {streak.totalDays === 1 ? '' : 's'} practised in total.
      </p>
    </section>
  );
}
