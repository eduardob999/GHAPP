import { useState } from 'react';
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

export function StringSniperPanel() {
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

  const [targetString, setTargetString] = useState<GuitarStringIndex>(6);
  const [presetId, setPresetId] = useState<string>('open');

  const preset: FretPreset = FRET_PRESETS.find((p) => p.id === presetId) ?? FRET_PRESETS[0]!;

  const draftConfig: StringSniperConfig = {
    targetString,
    allowedFrets: preset.range,
  };

  const activeConfig = currentConfig ?? draftConfig;
  const ambiguous = overlappingStrings(activeConfig);
  const verdict = FEEDBACK[lastResult ?? 'no_signal'];

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">String Sniper</h2>
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
