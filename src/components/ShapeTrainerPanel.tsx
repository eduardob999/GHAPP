import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { useSkillStates } from '../hooks/useSkillStates';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { describeInterval } from '../domain/scheduler';
import {
  DEFAULT_REP_SECONDS,
  REP_DURATIONS_SECONDS,
  describeShape,
  nextShape,
  shapeToTab,
  toDiagram,
  trainableShapes,
} from '../domain/shapeTrainer';
import {
  CATEGORY_LABELS,
  FAMILY_LABELS,
  SKILL_CATALOG,
  type FrettingSkillDefinition,
  type PracticeResult,
} from '../domain/skills';
import { FretboardDiagram } from './FretboardDiagram';

/**
 * Fretting-hand trainer: one shape, one short timed rep, one honest grade.
 *
 * The timer is deliberately short. Brief focused reps spread across days beat
 * long unfocused ones, and a fixed countdown stops a rep drifting into
 * noodling. Grades go through the same scheduler and the same
 * `/users/{uid}/skills/{skillId}` documents as Today's Session — this is a
 * different way into the same practice record, not a parallel one.
 */

const RESULTS: { value: PracticeResult; label: string; variant: string }[] = [
  { value: 'easy', label: 'Easy', variant: 'grade--easy' },
  { value: 'good', label: 'Good', variant: 'grade--good' },
  { value: 'hard', label: 'Hard', variant: 'grade--hard' },
  { value: 'fail', label: 'Fail', variant: 'grade--fail' },
];

type Phase = 'idle' | 'running' | 'grading' | 'graded';

export interface ShapeTrainerPanelProps {
  user: User;
  /** Set by PracticePanel's "Open in trainer"; null when nothing is pending. */
  requestedSkillId: string | null;
  onRequestHandled: () => void;
}

export function ShapeTrainerPanel({
  user,
  requestedSkillId,
  onRequestHandled,
}: ShapeTrainerPanelProps) {
  const { states, error } = useSkillStates(user.uid);

  const shapes = useMemo(() => trainableShapes(SKILL_CATALOG), []);
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.skillId, state])),
    [states],
  );

  const [selectedId, setSelectedId] = useState<string>(() => shapes[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [repSeconds, setRepSeconds] = useState<number>(DEFAULT_REP_SECONDS);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number>(DEFAULT_REP_SECONDS);
  const [lastGrade, setLastGrade] = useState<PracticeResult | null>(null);

  const sectionRef = useRef<HTMLElement | null>(null);

  const selected: FrettingSkillDefinition | undefined =
    shapes.find((shape) => shape.id === selectedId) ?? shapes[0];

  const diagram = selected ? toDiagram(selected) : null;

  const selectShape = useCallback((id: string) => {
    setSelectedId(id);
    setPhase('idle');
    setDeadline(null);
    setLastGrade(null);
  }, []);

  // Honour a request from Today's Session to train a specific shape.
  useEffect(() => {
    if (!requestedSkillId) return;

    if (shapes.some((shape) => shape.id === requestedSkillId)) {
      selectShape(requestedSkillId);
      setRemaining(repSeconds);
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    onRequestHandled();
  }, [requestedSkillId, shapes, selectShape, onRequestHandled, repSeconds]);

  /**
   * Countdown driven by a wall-clock deadline rather than by counting ticks:
   * background tabs throttle timers, and a tick-counting timer would silently
   * run long.
   */
  useEffect(() => {
    if (phase !== 'running' || deadline === null) return;

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setPhase('grading');
    };

    tick();
    const handle = window.setInterval(tick, 200);
    return () => window.clearInterval(handle);
  }, [phase, deadline]);

  function startRep() {
    setLastGrade(null);
    setRemaining(repSeconds);
    setDeadline(Date.now() + repSeconds * 1000);
    setPhase('running');
  }

  function grade(result: PracticeResult) {
    if (!selected) return;

    setLastGrade(result);
    setPhase('graded');
    setDeadline(null);

    const current = stateById.get(selected.id) ?? null;

    // Not awaited: offline this promise stays pending until the network
    // returns, while the local write updates the subscription immediately.
    void upsertSkillPracticeState(user.uid, {
      skillId: selected.id,
      result,
      current,
    }).catch((writeError: unknown) => {
      console.error('[trainer] Grade did not reach the server.', writeError);
    });
  }

  function goToNextShape() {
    const next = nextShape(shapes, states, new Date(), selected?.id);
    if (next) selectShape(next.id);
    setRemaining(repSeconds);
  }

  const liveState = selected ? stateById.get(selected.id) : undefined;
  const nextDue = liveState?.intervalDays;

  if (!selected || !diagram) {
    return (
      <section className="card" ref={sectionRef}>
        <div className="card__header">
        </div>
        <p className="card__body">No drawable shapes in the catalog.</p>
      </section>
    );
  }

  return (
    <section className="card" ref={sectionRef}>
      <div className="card__header">
        <span className="pill">{shapes.length} shapes</span>
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          Could not load your practice history: {error}. Grades may not save.
        </p>
      ) : null}

      <label className="field" htmlFor="shape-select">
        <span className="field__label">Shape</span>
        <select
          id="shape-select"
          className="select"
          value={selected.id}
          onChange={(event) => selectShape(event.target.value)}
        >
          {[...new Set(shapes.map((shape) => shape.family))].map((family) => (
            <optgroup key={family} label={family ? FAMILY_LABELS[family] : 'Other'}>
              {shapes
                .filter((shape) => shape.family === family)
                .map((shape) => (
                  <option key={shape.id} value={shape.id}>
                    {shape.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="task__tags">
        <span className="tag">{CATEGORY_LABELS[selected.category]}</span>
        <span className="tag tag--muted">{describeShape(selected)}</span>
        {!liveState ? <span className="tag tag--new">new</span> : null}
      </div>

      <h3 className="task__title">{selected.title}</h3>

      <FretboardDiagram
        rootString={diagram.rootString}
        rootFret={diagram.rootFret}
        lowestFret={diagram.lowestFret}
        highestFret={diagram.highestFret}
        fingers={diagram.fingers}
        mutedStrings={diagram.mutedStrings}
        title={selected.title}
        subtitle={`${shapeToTab(diagram)} — low E first. The ringed dot is the root.`}
      />

      <p className="task__description">{selected.description}</p>

      {phase === 'idle' ? (
        <>
          <div className="field">
            <span className="field__label">Rep length</span>
            <div className="segmented segmented--wrap">
              {REP_DURATIONS_SECONDS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  className={`segmented__option${seconds === repSeconds ? ' segmented__option--active' : ''}`}
                  onClick={() => {
                    setRepSeconds(seconds);
                    setRemaining(seconds);
                  }}
                  aria-pressed={seconds === repSeconds}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>

          <p className="card__hint">
            Form the shape and play it cleanly for the whole rep. Relaxed thumb, curved fingers,
            the least pressure that still sounds every note.
          </p>

          <div className="task__grades">
            <button type="button" className="button button--primary" onClick={startRep}>
              Start {repSeconds}s rep
            </button>
            <button type="button" className="button button--ghost" onClick={goToNextShape}>
              Next shape
            </button>
          </div>
        </>
      ) : null}

      {phase === 'running' ? (
        <>
          <div className="countdown" role="timer" aria-live="off">
            <span className="countdown__value">{remaining}</span>
            <span className="countdown__unit">seconds left</span>
          </div>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setPhase('grading')}
          >
            Finish now
          </button>
        </>
      ) : null}

      {phase === 'grading' ? (
        <>
          <p className="notice notice--ok">Rep done. How did that shape feel?</p>
          <div className="task__grades">
            {RESULTS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`button button--grade ${option.variant}`}
                onClick={() => grade(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {phase === 'graded' ? (
        <>
          <p className="notice notice--ok">
            Marked <strong>{lastGrade}</strong>
            {nextDue !== undefined ? ` — back in ${describeInterval(nextDue)}.` : ' — saved.'}
          </p>
          <div className="task__grades">
            <button type="button" className="button button--primary" onClick={goToNextShape}>
              Next shape
            </button>
            <button type="button" className="button button--ghost" onClick={startRep}>
              Repeat this one
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
