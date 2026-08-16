import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChordDetector } from '../hooks/useChordDetector';
import { useSkillStates } from '../hooks/useSkillStates';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { PROGRESSIONS, progressionSkillId, type ChordProgression } from '../domain/progressions';
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
import { MicNotice } from './MicNotice';

/**
 * String Sniper — picking accuracy, on real music.
 *
 * It used to drill single notes: pick the 3rd string eight times without
 * touching a neighbour. That measured the right thing — did the pick land where
 * you aimed — and taught nothing, because nobody plays one string eight times
 * in any music ever written.
 *
 * It now drills riffs. The same measurement, note by note, on something worth
 * playing: the notes are shown as string and fret, the cursor advances when the
 * expected note is heard, and a wrong note is counted without skipping ahead so
 * you can correct it.
 *
 * No clock. A slow player is not punished and a stopped player is not advanced
 * past — the rule the whole app now runs on.
 */

/** Riffs are the progressions made entirely of single notes. */
const RIFFS: readonly ChordProgression[] = PROGRESSIONS.filter(
  (progression) =>
    !progression.tuning && progression.chords.every((step) => step.mode === 'riff'),
);

export interface StringSniperPanelProps {
  user?: { uid: string };
  /** A `picking.*` skill handed over by Today's Session. */
  requestedSkillId?: string | null;
  onRequestHandled?: () => void;
}

export function StringSniperPanel({
  user,
  requestedSkillId = null,
  onRequestHandled,
}: StringSniperPanelProps = {}) {
  const { states } = useSkillStates(user?.uid ?? '');
  const {
    currentNote,
    error: micError,
    errorCode,
    isStarting,
    start: startListening,
    stop: stopListening,
    reset: resetDetector,
  } = useChordDetector();

  const [riffId, setRiffId] = useState<string>(() => RIFFS[0]?.id ?? '');
  const [drill, setDrill] = useState<RiffDrillState | null>(null);
  const [grade, setGrade] = useState<string | null>(null);

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.skillId, state])),
    [states],
  );

  const riff = RIFFS.find((option) => option.id === riffId) ?? RIFFS[0];

  /** Every note of the riff, flattened — the drill is one run, not four bars. */
  const notes = useMemo(
    () => riff?.chords.flatMap((step) => step.notes ?? []) ?? [],
    [riff],
  );
  const positions = useMemo(() => riffPositions(notes), [notes]);

  // A riff handed over by Today's Session: pick the one that drills that skill.
  useEffect(() => {
    if (!requestedSkillId) return;

    const match = RIFFS.find((option) => option.practisesSkillIds?.includes(requestedSkillId));
    if (match) setRiffId(match.id);
    onRequestHandled?.();
  }, [requestedSkillId, onRequestHandled]);

  const skillId = riff?.practisesSkillIds?.[0] ?? (riff ? progressionSkillId(riff.id) : null);

  const file = useCallback(
    (state: RiffDrillState) => {
      const summary = summariseRiff(state);
      const result = gradeRiff(summary);
      setGrade(result);

      if (!result || !user || !skillId) return;

      // Not awaited: the local cache updates the schedule on screen at once.
      void upsertSkillPracticeState(user.uid, {
        skillId,
        result,
        current: stateById.get(skillId) ?? null,
      }).catch((error: unknown) => {
        console.error('[sniper] Riff did not reach the server.', error);
      });
    },
    [skillId, stateById, user],
  );

  // Feed what is heard into the drill. The detector reports a ringing note on
  // every frame, and `hearNote` counts only changes.
  useEffect(() => {
    if (!drill || isRiffComplete(drill)) return;

    const next = hearNote(drill, currentNote);
    if (next === drill) return;

    setDrill(next);
    if (isRiffComplete(next)) {
      stopListening();
      file(next);
    }
  }, [currentNote, drill, file, stopListening]);

  useEffect(() => stopListening, [stopListening]);

  const begin = useCallback(async () => {
    setGrade(null);
    resetDetector();
    if (!(await startListening())) return;
    setDrill(startRiff(notes));
  }, [notes, resetDetector, startListening]);

  const summary = drill ? summariseRiff(drill) : null;
  const waitingFor = drill ? expectedNote(drill) : null;
  const cursor = drill?.cursor ?? 0;

  return (
    <section className="card">
      <div className="card__header">
        <span className="pill">{RIFFS.length} riffs</span>
      </div>

      <p className="card__body">
        Pick the notes in order. It listens for each one and moves on when it hears it — no
        clock, so take as long as you like over the awkward jumps.
      </p>

      {errorCode ? (
        <MicNotice code={errorCode} detail={micError} onRetry={() => void begin()} />
      ) : null}

      {!drill ? (
        <>
          <label className="field" htmlFor="riff-select">
            <span className="field__label">Riff</span>
            <select
              id="riff-select"
              className="select"
              value={riff?.id ?? ''}
              onChange={(event) => setRiffId(event.target.value)}
            >
              {RIFFS.map((option) => (
                <option key={option.id} value={option.id}>
                  {stateById.has(progressionSkillId(option.id)) ? '✓ ' : ''}
                  {option.title}
                </option>
              ))}
            </select>
          </label>

          {riff?.teaches ? <p className="card__hint">{riff.teaches}</p> : null}

          <ol className="riffline" data-testid="riff-preview">
            {positions.map((position, index) => (
              <li key={`${position}-${index}`} className="riffline__note">
                {position}
              </li>
            ))}
          </ol>

          <p className="card__hint">
            Written <strong>string:fret</strong> — 6 is the thickest string, 0 means open.
          </p>

          <button
            type="button"
            className="button button--primary"
            onClick={() => void begin()}
            disabled={isStarting || notes.length === 0}
          >
            {isStarting ? 'Waiting for microphone…' : 'Start the riff'}
          </button>
        </>
      ) : (
        <>
          <ol className="riffline" data-testid="riff-progress">
            {positions.map((position, index) => (
              <li
                key={`${position}-${index}`}
                className={`riffline__note${
                  index < cursor
                    ? ' riffline__note--done'
                    : index === cursor
                      ? ' riffline__note--now'
                      : ''
                }`}
              >
                {position}
              </li>
            ))}
          </ol>

          <div
            className={`verdict ${currentNote ? 'verdict--hit' : 'verdict--idle'}`}
            role="status"
            data-testid="sniper-hearing"
          >
            {isRiffComplete(drill)
              ? 'Done.'
              : currentNote
                ? `Hearing ${currentNote}`
                : 'Listening…'}
          </div>

          <p className="card__hint" data-testid="sniper-next">
            {isRiffComplete(drill)
              ? `${summary?.played} of ${summary?.total} in order, ${summary?.wrong} stray note${summary?.wrong === 1 ? '' : 's'}.`
              : `Next: ${positions[cursor] ?? ''}${waitingFor ? ` (${waitingFor})` : ''}`}
          </p>

          {grade ? (
            <p className="notice notice--ok" data-testid="sniper-grade">
              Filed as <strong>{grade}</strong>.
            </p>
          ) : null}

          <div className="task__grades">
            <button type="button" className="button button--primary" onClick={() => void begin()}>
              {isRiffComplete(drill) ? 'Again' : 'Restart'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                stopListening();
                setDrill(null);
                setGrade(null);
              }}
            >
              Choose another
            </button>
          </div>
        </>
      )}
    </section>
  );
}
