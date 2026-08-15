import { useCallback, useEffect, useRef, useState } from 'react';
import { useStringSniper } from '../hooks/useStringSniper';
import {
  ALL_STRINGS,
  FRET_PRESETS,
  STRING_LABELS,
  describeConfig,
  overlappingStrings,
  targetNoteLabel,
  type FretPreset,
  type GuitarStringIndex,
  type SniperHitResult,
  type StringSniperConfig,
} from '../domain/stringSniper';
import { MicNotice } from './MicNotice';
import {
  STRIKES_PER_SET,
  gradeSniperSet,
  sniperSkillId,
  summariseStrikes,
} from '../domain/stringSniper';
import { upsertSkillPracticeState } from '../storage/skillsState';
import { useSkillStates } from '../hooks/useSkillStates';

/**
 * String Sniper — picking accuracy.
 *
 * Free practice for now: results are shown and discarded, not written to
 * Firestore and not fed to the spaced scheduler.
 */

/**
 * Text only, no emoji. The colour already carries the verdict, and a bare 🎯
 * renders as a tofu box on any system without a colour emoji font — the same
 * reason the app mark is drawn as SVG rather than set as 🎸.
 */
const FEEDBACK: Record<SniperHitResult, { text: string; modifier: string }> = {
  hit: { text: 'Hit!', modifier: 'verdict--hit' },
  wrong_string: { text: 'Wrong string', modifier: 'verdict--wrong' },
  off_pitch: { text: 'Right string, off pitch', modifier: 'verdict--off' },
  no_signal: { text: 'Listening…', modifier: 'verdict--idle' },
};

export interface StringSniperPanelProps {
  /** Present when the drill should file what it hears. */
  user?: { uid: string };
  /** A `picking.single.*` skill handed over by Today's Session. */
  requestedSkillId?: string | null;
  onRequestHandled?: () => void;
}

/** Which string a scheduled picking skill is about. */
const STRING_FOR_SKILL: Record<string, GuitarStringIndex> = {
  'picking.single.1st-string.bare': 1,
  'picking.single.3rd-string': 3,
  'picking.single.4th-string': 4,
  'picking.single.5th-string': 5,
};

export function StringSniperPanel({
  user,
  requestedSkillId = null,
  onRequestHandled,
}: StringSniperPanelProps = {}) {
  const {
    isRunning,
    isStarting,
    currentConfig,
    lastResult,
    lastDetected,
    error,
    errorCode,
    start,
    stop,
  } =
    useStringSniper();

  const { states } = useSkillStates(user?.uid ?? '');

  /**
   * Strikes in the current set.
   *
   * The drill judged every strike and then threw the verdict away, so the one
   * mode that was already objectively scored contributed nothing to the
   * schedule. A set of eight now becomes a grade.
   */
  const [strikes, setStrikes] = useState<SniperHitResult[]>([]);
  const [setGrade, setSetGrade] = useState<string | null>(null);
  const lastCountedRef = useRef<SniperHitResult | null>(null);

  const [targetString, setTargetString] = useState<GuitarStringIndex>(6);
  const [presetId, setPresetId] = useState<string>('open');

  const preset: FretPreset = FRET_PRESETS.find((p) => p.id === presetId) ?? FRET_PRESETS[0]!;

  const draftConfig: StringSniperConfig = {
    targetString,
    allowedFrets: preset.range,
  };

  const activeConfig = currentConfig ?? draftConfig;
  const ambiguous = overlappingStrings(activeConfig);
  const skillId = sniperSkillId(activeConfig);

  // Arriving from Today's Session: set the string up rather than asking again.
  useEffect(() => {
    if (!requestedSkillId) return;
    const string = STRING_FOR_SKILL[requestedSkillId];
    if (string) setTargetString(string);
    onRequestHandled?.();
  }, [requestedSkillId, onRequestHandled]);

  const fileSet = useCallback(
    (results: SniperHitResult[]) => {
      const summary = summariseStrikes(results);
      const grade = gradeSniperSet(summary);
      setSetGrade(grade);

      if (!grade || !user || !skillId) return;

      // Not awaited: the local cache — and so the schedule on screen — updates
      // immediately, and offline this promise would never settle.
      void upsertSkillPracticeState(user.uid, {
        skillId,
        result: grade,
        current: states.find((state) => state.skillId === skillId) ?? null,
      }).catch((error: unknown) => {
        console.error('[sniper] Set did not reach the server.', error);
      });
    },
    [skillId, states, user],
  );

  // One strike per *change* of verdict: the detector reports the same result on
  // every frame while a note rings, and counting frames would score a single
  // sustained note as a full set.
  useEffect(() => {
    if (!isRunning || !lastResult || lastResult === 'no_signal') {
      if (lastResult === 'no_signal') lastCountedRef.current = null;
      return;
    }

    if (lastCountedRef.current === lastResult) return;
    lastCountedRef.current = lastResult;

    setStrikes((previous) => {
      if (previous.length >= STRIKES_PER_SET) return previous;
      const next = [...previous, lastResult];
      if (next.length === STRIKES_PER_SET) fileSet(next);
      return next;
    });
  }, [lastResult, isRunning, fileSet]);

  const verdict = FEEDBACK[lastResult ?? 'no_signal'];

  return (
    <section className="card">
      <div className="card__header">
        <span className="pill">beta</span>
      </div>

      <p className="card__body">
        Pick one string without looking. The drill listens and tells you whether the note you
        produced belongs on your target.
      </p>

      {errorCode ? (
        <MicNotice
          code={errorCode}
          detail={error}
          onRetry={() => void start(draftConfig)}
        />
      ) : null}

      {!isRunning ? (
        <>
          <fieldset className="field">
            <legend className="field__label">Target string</legend>
            <div className="segmented">
              {ALL_STRINGS.map((string) => (
                <button
                  key={string}
                  type="button"
                  className={`segmented__option${string === targetString ? ' segmented__option--active' : ''}`}
                  onClick={() => setTargetString(string)}
                  aria-pressed={string === targetString}
                >
                  <span className="segmented__index">{string}</span>
                  <span className="segmented__name">{STRING_LABELS[string]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field__label">Frets</legend>
            <div className="segmented segmented--wrap">
              {FRET_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`segmented__option${option.id === presetId ? ' segmented__option--active' : ''}`}
                  onClick={() => setPresetId(option.id)}
                  aria-pressed={option.id === presetId}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="card__hint">
            Target: {describeConfig(draftConfig)} — aim for {targetNoteLabel(draftConfig)}.
          </p>

          {ambiguous.length > 0 ? (
            <p className="notice notice--muted">
              Heads up: that note is also reachable on{' '}
              {ambiguous.length === 1
                ? `string ${ambiguous[0]}`
                : `strings ${ambiguous.slice(0, -1).join(', ')} and ${ambiguous.at(-1)}`}
              . A microphone hears pitch, not which string you plucked, so this setting checks the
              note rather than your aim.
            </p>
          ) : null}

          <button
            type="button"
            className="button button--primary"
            onClick={() => void start(draftConfig)}
            disabled={isStarting}
          >
            {isStarting ? 'Waiting for microphone…' : 'Start drill'}
          </button>
        </>
      ) : (
        <>
          <p className="card__hint">
            Target: {describeConfig(activeConfig)} — aim for {targetNoteLabel(activeConfig)}.
          </p>

          <div className={`verdict ${verdict.modifier}`} role="status">
            {verdict.text}
          </div>

          <div className="strikes" data-testid="strikes">
            {Array.from({ length: STRIKES_PER_SET }, (_, index) => {
              const strike = strikes[index];
              return (
                <span
                  key={index}
                  className={`strikes__pip${strike ? ` strikes__pip--${strike === 'hit' ? 'hit' : 'miss'}` : ''}`}
                  aria-hidden="true"
                />
              );
            })}
            <span className="strikes__count">
              {strikes.length}/{STRIKES_PER_SET}
            </span>
          </div>

          {setGrade ? (
            <p className="notice notice--ok" data-testid="sniper-grade">
              Set of {STRIKES_PER_SET}: {summariseStrikes(strikes).hits} clean — filed as{' '}
              <strong>{setGrade}</strong>.
              <button
                type="button"
                className="task__link"
                onClick={() => {
                  setStrikes([]);
                  setSetGrade(null);
                  lastCountedRef.current = null;
                }}
              >
                Another set →
              </button>
            </p>
          ) : null}

          <dl className="datalist">
            <div className="datalist__row">
              <dt>Detected</dt>
              <dd>
                {lastDetected.noteName && lastDetected.frequency !== null
                  ? `${lastDetected.noteName} (${lastDetected.frequency.toFixed(1)} Hz)`
                  : '—'}
              </dd>
            </div>
            <div className="datalist__row">
              <dt>From target</dt>
              <dd>
                {lastDetected.cents === null
                  ? '—'
                  : `${lastDetected.cents > 0 ? '+' : ''}${lastDetected.cents} cents`}
              </dd>
            </div>
            <div className="datalist__row">
              <dt>Clarity</dt>
              <dd>{lastDetected.clarity === null ? '—' : lastDetected.clarity.toFixed(2)}</dd>
            </div>
          </dl>

          <button type="button" className="button button--ghost" onClick={stop}>
            Stop drill
          </button>
        </>
      )}
    </section>
  );
}
