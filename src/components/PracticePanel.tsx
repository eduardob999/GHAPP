import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { useSkillStates } from '../hooks/useSkillStates';
import { upsertSkillPracticeState } from '../storage/skillsState';
import {
  fullCatalog,
  planStructuredSession,
  summariseOutcome,
  type SessionPhase,
  type StructuredSession,
} from '../domain/sessionPlanner';
import { hasDiagram } from '../domain/shapeTrainer';
import { targetChordFor } from '../domain/earGrading';
import { progressionIdFromSkillId, progressionsForSkill } from '../domain/progressions';
import { appendSession } from '../storage/sessionLog';
import {
  CATEGORY_LABELS,
  FAMILY_LABELS,
  SKILL_CATALOG,
  type PracticeResult,
  type SkillPracticeState,
} from '../domain/skills';

/**
 * Today's Session.
 *
 * The plan is computed once and then held for the sitting rather than being
 * recomputed from live state. Re-planning on every snapshot would make a card
 * vanish the instant it was graded — the state write moves its `dueAt` into the
 * future, so the planner immediately stops selecting it. Freezing the list lets
 * a graded card stay put and report when it will come back.
 */

const RESULTS: { value: PracticeResult; label: string; variant: string }[] = [
  { value: 'easy', label: 'Easy', variant: 'grade--easy' },
  { value: 'good', label: 'Good', variant: 'grade--good' },
  { value: 'hard', label: 'Hard', variant: 'grade--hard' },
  { value: 'fail', label: 'Fail', variant: 'grade--fail' },
];

/** The shape of a sitting, in the order it is played. */
const PHASES: {
  key: keyof Omit<StructuredSession, 'all'>;
  /** Matches `SessionPhase`, so the CSS and the domain agree on the name. */
  phase: SessionPhase;
  title: string;
  blurb: string;
}[] = [
  {
    key: 'warmUp',
    phase: 'warm-up',
    title: 'Warm-up',
    blurb: 'Something you already know, to get the hands moving. No pressure here.',
  },
  {
    key: 'rotation',
    phase: 'rotation',
    title: 'Rotation',
    blurb: 'The work, interleaved so no two neighbours drill the same thing.',
  },
  {
    key: 'coolDown',
    phase: 'cool-down',
    title: 'Cool-down',
    blurb: 'Finish on something that sounds good — that is what you will remember.',
  },
];

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function formatDue(due: Date, now: Date): string {
  const hours = (due.getTime() - now.getTime()) / (60 * 60 * 1000);

  if (Math.abs(hours) < 24) {
    return RELATIVE_TIME.format(Math.round(hours), 'hour');
  }

  return RELATIVE_TIME.format(Math.round(hours / 24), 'day');
}

export interface PracticePanelProps {
  user: User;
  /**
   * Hands a fretting shape to the Fretting Trainer. Optional so the panel still
   * renders standalone; the button only appears for shapes that have a diagram.
   */
  onOpenInTrainer?: (skillId: string) => void;
  /** Hands a scheduled progression to Chord Hero so it can actually be played. */
  onOpenInChordHero?: (progressionId: string) => void;
  /** Hands a single-string picking skill to the sniper, which scores it. */
  onOpenInSniper?: (skillId: string) => void;
}

export function PracticePanel({
  user,
  onOpenInTrainer,
  onOpenInChordHero,
  onOpenInSniper,
}: PracticePanelProps) {
  const { states, loading, error } = useSkillStates(user.uid);

  const [session, setSession] = useState<StructuredSession | null>(null);
  const [graded, setGraded] = useState<Record<string, PracticeResult>>({});
  /** One log record per sitting, written once the last card is graded. */
  const filedRef = useRef(false);

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.skillId, state])),
    [states],
  );

  // Plan once, after the first snapshot. Deliberately not re-run when `states`
  // changes — see the note at the top of the file.
  useEffect(() => {
    if (!loading && session === null) {
      setSession(planStructuredSession(fullCatalog(SKILL_CATALOG), states, new Date()));
    }
  }, [loading, session, states]);

  const replan = useCallback(() => {
    setGraded({});
    filedRef.current = false;
    setSession(planStructuredSession(fullCatalog(SKILL_CATALOG), states, new Date()));
  }, [states]);

  const grade = useCallback(
    (skillId: string, result: PracticeResult) => {
      setGraded((previous) => ({ ...previous, [skillId]: result }));

      // Always grade against the live state rather than the copy captured when
      // the session was planned, so re-grading a card compounds correctly.
      const current: SkillPracticeState | null = stateById.get(skillId) ?? null;

      // Not awaited: offline this promise stays pending until the network
      // returns, while the local write — and the subscription above — update
      // immediately.
      void upsertSkillPracticeState(user.uid, { skillId, result, current }).catch(
        (writeError: unknown) => {
          console.error('[practice] Grade did not reach the server.', writeError);
        },
      );
    },
    [stateById, user.uid],
  );

  const now = new Date();
  const items = session?.all ?? [];
  const remaining = items.filter((item) => !graded[item.definition.id]).length;
  const total = items.length;

  /**
   * One record for the whole sitting, alongside the per-skill grades.
   *
   * Skill state answers "when should this come back"; this answers "did I
   * practise on Tuesday, and how did it go" — which is what the streak and any
   * future evaluation of the scheduler are built from. Written once, when the
   * last card is graded, and never awaited.
   */
  useEffect(() => {
    if (filedRef.current || total === 0 || remaining > 0) return;
    filedRef.current = true;

    const outcome = summariseOutcome(
      items.map((item) => graded[item.definition.id]).filter((g): g is PracticeResult => !!g),
      total,
    );

    void appendSession(user.uid, {
      kind: 'today',
      subject: 'session',
      title: `Today's Session — ${total} skills`,
      accuracy: outcome.accuracy,
      steps: outcome.items,
      hits: outcome.easy + outcome.good,
      partials: outcome.hard,
      misses: outcome.fail,
      graded: 'self',
    }).catch((writeError: unknown) => {
      console.error('[practice] Session summary did not reach the server.', writeError);
    });
  }, [items, graded, remaining, total, user.uid]);

  return (
    <section className="card">
      <div className="card__header">
        {total > 0 ? (
          <span className="pill">
            {total - remaining} of {total} done
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          Could not load your practice history: {error}. The tuner still works.
        </p>
      ) : null}

      {loading || session === null ? (
        <p className="card__body">Working out what to practise…</p>
      ) : session.all.length === 0 ? (
        <p className="card__body">
          You&apos;re all caught up. Come back later, or add more skills to the catalog.
        </p>
      ) : (
        <>
          <p className="card__body">
            Play each one. The microphone scores it and schedules the next visit — nothing here
            asks you to mark your own work.
          </p>

          {PHASES.map(({ key, phase, title, blurb }) => {
            const phaseItems = session[key];
            if (phaseItems.length === 0) return null;

            return (
              <div key={key} className="phase" data-phase={phase}>
                <div className="phase__header">
                  <h2 className="phase__title">{title}</h2>
                  <p className="phase__blurb">{blurb}</p>
                </div>
                <ol className="tasklist">
                  {phaseItems.map((item) => {
              const { definition } = item;
              const result = graded[definition.id];
              const liveState = stateById.get(definition.id);
              const dueAt = result && liveState?.dueAt ? liveState.dueAt.toDate() : null;

              return (
                <li
                  key={definition.id}
                  className={`task${result ? ' task--done' : ''}`}
                >
                  <div className="task__tags">
                    <span className="tag">{CATEGORY_LABELS[definition.category]}</span>
                    {definition.family ? (
                      <span className="tag tag--muted">{FAMILY_LABELS[definition.family]}</span>
                    ) : null}
                    {definition.suggestedDurationSeconds ? (
                      <span className="tag tag--muted">
                        {definition.suggestedDurationSeconds}s
                      </span>
                    ) : null}
                    {!item.state ? <span className="tag tag--new">new</span> : null}
                  </div>

                  <h3 className="task__title">{definition.title}</h3>
                  <p className="task__description">{definition.description}</p>

                  {result ? (
                    <p className="task__result">
                      Marked <strong>{result}</strong>
                      {dueAt ? ` — back ${formatDue(dueAt, now)}` : ' — saved'}
                    </p>
                  ) : (
                    (() => {
                      /*
                       * Anything the microphone can judge is played, not
                       * self-reported: the card routes into the mode that
                       * listens, and the grade comes from there. Self-grading
                       * survives only for the skills nothing can hear yet —
                       * fingerstyle patterns, theory items — where the
                       * alternative is no scheduling at all.
                       */
                      const progressionId =
                        progressionIdFromSkillId(definition.id) ??
                        progressionsForSkill(definition.id)[0]?.id;
                      // A single-string picking drill is scored strike by
                      // strike, so it is heard too.
                      const sniperSkill = /^picking\.single\./.test(definition.id);
                      const canBeHeard =
                        (hasDiagram(definition) && targetChordFor(definition) !== null) ||
                        Boolean(progressionId) ||
                        sniperSkill;

                      if (canBeHeard) {
                        return (
                          <button
                            type="button"
                            className="button button--primary"
                            data-testid="play-it"
                            onClick={() =>
                              progressionId
                                ? onOpenInChordHero?.(progressionId)
                                : sniperSkill
                                  ? onOpenInSniper?.(definition.id)
                                  : onOpenInTrainer?.(definition.id)
                            }
                          >
                            Play it →
                          </button>
                        );
                      }

                      return (
                        <div className="task__grades">
                          {RESULTS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={`button button--grade ${option.variant}`}
                              onClick={() => grade(definition.id, option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  )}

                </li>
              );
            })}
                </ol>
              </div>
            );
          })}

          {remaining === 0 ? (
            <>
              <p className="notice notice--ok" data-testid="session-complete">
                Session complete — {total} skills, filed to your practice log. Everything you
                graded is scheduled to come back on its own.
              </p>
              <button type="button" className="button button--primary" onClick={replan}>
                Plan another session
              </button>
            </>
          ) : (
            <button type="button" className="button button--ghost" onClick={replan}>
              Re-plan session
            </button>
          )}
        </>
      )}
    </section>
  );
}
