import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { useSkillStates } from '../hooks/useSkillStates';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { fullCatalog, planSession, type PlannedItem } from '../domain/sessionPlanner';
import { hasDiagram } from '../domain/shapeTrainer';
import { progressionIdFromSkillId } from '../domain/progressions';
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
}

export function PracticePanel({
  user,
  onOpenInTrainer,
  onOpenInChordHero,
}: PracticePanelProps) {
  const { states, loading, error } = useSkillStates(user.uid);

  const [plan, setPlan] = useState<PlannedItem[] | null>(null);
  const [graded, setGraded] = useState<Record<string, PracticeResult>>({});

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.skillId, state])),
    [states],
  );

  // Plan once, after the first snapshot. Deliberately not re-run when `states`
  // changes — see the note at the top of the file.
  useEffect(() => {
    if (!loading && plan === null) {
      setPlan(planSession(fullCatalog(SKILL_CATALOG), states, new Date()));
    }
  }, [loading, plan, states]);

  const replan = useCallback(() => {
    setGraded({});
    setPlan(planSession(fullCatalog(SKILL_CATALOG), states, new Date()));
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
  const remaining = plan ? plan.filter((item) => !graded[item.definition.id]).length : 0;
  const total = plan?.length ?? 0;

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Today&apos;s Session</h2>
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

      {loading || plan === null ? (
        <p className="card__body">Working out what to practise…</p>
      ) : plan.length === 0 ? (
        <p className="card__body">
          You&apos;re all caught up. Come back later, or add more skills to the catalog.
        </p>
      ) : (
        <>
          <p className="card__body">
            Read each task, play it, then say how it felt. Grading is what schedules the next
            visit — be honest rather than generous.
          </p>

          <ol className="tasklist">
            {plan.map((item) => {
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
                  )}

                  {onOpenInTrainer && hasDiagram(definition) ? (
                    <button
                      type="button"
                      className="task__link"
                      onClick={() => onOpenInTrainer(definition.id)}
                    >
                      Open in Fretting Trainer →
                    </button>
                  ) : null}

                  {(() => {
                    const progressionId = progressionIdFromSkillId(definition.id);
                    return onOpenInChordHero && progressionId ? (
                      <button
                        type="button"
                        className="task__link"
                        onClick={() => onOpenInChordHero(progressionId)}
                      >
                        Play in Chord Hero →
                      </button>
                    ) : null;
                  })()}
                </li>
              );
            })}
          </ol>

          {remaining === 0 ? (
            <>
              <p className="notice notice--ok">
                Session complete. Everything you graded is scheduled to come back on its own.
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
