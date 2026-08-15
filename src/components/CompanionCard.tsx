import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { createChimePlayer, type ChimePlayer } from '../audio/chime';
import { companionLine, companionMood, streakLabel } from '../domain/companion';
import {
  STREAK_MILESTONES,
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
    <>
      {error ? (
        <p className="notice notice--muted">
          Could not read your practice history: {error}. Everything else still works.
        </p>
      ) : null}

      {/* The companion, with its mood as the eyebrow and its line as the point. */}
      <section className="card companion-card">
        <div className="companion-card__body">
          <div className="companion-card__tile">
            <Companion mood={mood} size={78} />
          </div>
          <div className="companion-card__text">
            <p className="companion-card__mood">
              {streak.practisedToday ? 'Today' : 'So far'} · {mood.replace('-', ' ')}
            </p>
            <p className="companion-card__line" data-testid="companion-line">
              {line}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="button button--ghost button--small companion-card__sound"
          onClick={() => {
            const wanted = !soundOn;
            setSoundOn(wanted);
            if (wanted) {
              chime.current ??= createChimePlayer();
              chime.current.play('gentle');
            }
          }}
          aria-pressed={soundOn}
        >
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </section>

      {celebrating && milestone ? (
        <p className="notice notice--ok" data-testid="milestone-notice">
          <strong>{milestone.name}.</strong> {milestone.blurb}
        </p>
      ) : null}

      {/* The streak, as the number it is. */}
      <section className="card streak">
        <div className="streak__top">
          <p className="streak__count">
            <span className="streak__number">{streak.current}</span>
            <span className="streak__unit">day streak</span>
          </p>
          <span className="streak__best">best: {streak.longest}</span>
        </div>

        <p className="companion-card__streak" data-testid="streak-label">
          {streakLabel(streak.current, streak.practisedToday)}
        </p>

        {next ? (
          <>
            <div
              className="meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label={`Progress toward ${next.name}`}
            >
              <span className="meter__fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="streak__legend">
              <span>
                {next.days - streak.current} day{next.days - streak.current === 1 ? '' : 's'} to the{' '}
                {next.name} badge
              </span>
              <span className="streak__ratio">
                {streak.current}/{next.days}
              </span>
            </div>
          </>
        ) : (
          <p className="card__hint">Every badge earned. Genuinely.</p>
        )}
      </section>

      {/* Every badge, earned and not — an empty slot is the reason to come back. */}
      <section className="card">
        <p className="section-head__eyebrow">
          Badges · {earned.length} of {STREAK_MILESTONES.length}
        </p>
        <ul className="badgegrid" data-testid="badges">
          {STREAK_MILESTONES.map((m) => {
            const won = m.days <= streak.longest;
            return (
              <li key={m.days} className={`badgegrid__item${won ? ' badgegrid__item--won' : ''}`}>
                <span className="badgegrid__disc" title={m.blurb}>
                  {won ? m.days : ''}
                </span>
                <span className="badgegrid__name">{m.name}</span>
              </li>
            );
          })}
        </ul>
        <p className="card__hint">
          {streak.totalDays} day{streak.totalDays === 1 ? '' : 's'} practised in total.
        </p>
      </section>
    </>
  );
}
