import { usePitchDetector } from '../hooks/usePitchDetector';
import { IN_TUNE_CENTS, isInTune } from '../audio/notes';
import { MicNotice } from './MicNotice';

/**
 * Live tuner. Read-only for now — it deliberately writes nothing to Firestore
 * and touches no scheduler state.
 */

function clarityLabel(clarity: number): string {
  if (clarity >= 0.95) return 'high';
  if (clarity >= 0.85) return 'medium';
  return 'low';
}

export function TunerPanel() {
  const { isRunning, isStarting, error, frequency, clarity, level, note, start, stop } =
    usePitchDetector();

  const cents = note?.cents ?? 0;
  const inTune = note !== null && isInTune(cents);

  return (
    <section className="card">
      <div className="card__header">
        <span className="pill">beta</span>
      </div>

      <p className="card__body">
        Play a single note — one string at a time works best. Nothing is recorded or uploaded; the
        audio never leaves your device.
      </p>

      {error ? (
        <MicNotice code={error.code} detail={error.message} onRetry={start} />
      ) : null}

      {isRunning ? (
        <>
          <div className="tuner">
            <div
              className={`tuner__note${note && inTune ? ' tuner__note--in-tune' : ''}`}
              aria-label={note ? `Detected note ${note.label}` : 'No note detected'}
            >
              {note?.label ?? '—'}
            </div>

            <div className="tuner__cents">
              {note ? `${cents > 0 ? '+' : ''}${cents} cents` : 'listening…'}
            </div>

            <div
              className="tuner__meter"
              role="meter"
              aria-valuemin={-50}
              aria-valuemax={50}
              aria-valuenow={note ? cents : 0}
              aria-label="Cents from the nearest note"
            >
              <span className="tuner__meter-zone" />
              <span className="tuner__meter-centre" />
              {note ? (
                <span
                  className={`tuner__needle${inTune ? ' tuner__needle--in-tune' : ''}`}
                  // -50..+50 cents maps across the full width of the meter.
                  style={{ left: `${50 + cents}%` }}
                />
              ) : null}
            </div>

            <p className="tuner__hint">
              {note
                ? inTune
                  ? 'In tune'
                  : cents < 0
                    ? 'Flat — tune up'
                    : 'Sharp — tune down'
                : `Within ${IN_TUNE_CENTS} cents counts as in tune.`}
            </p>
          </div>

          <dl className="datalist">
            <div className="datalist__row">
              <dt>Frequency</dt>
              <dd>{frequency === null ? '—' : `${frequency.toFixed(1)} Hz`}</dd>
            </div>
            <div className="datalist__row">
              <dt>Clarity</dt>
              <dd>
                <span className="levelbar" aria-hidden="true">
                  <span className="levelbar__fill" style={{ width: `${clarity * 100}%` }} />
                </span>
                {clarityLabel(clarity)}
              </dd>
            </div>
            <div className="datalist__row">
              <dt>Input level</dt>
              <dd>
                <span className="levelbar" aria-hidden="true">
                  {/* RMS rarely exceeds ~0.3 on a guitar, so the meter is scaled to suit. */}
                  <span
                    className="levelbar__fill"
                    style={{ width: `${Math.min(100, level * 300)}%` }}
                  />
                </span>
                {level > 0.005 ? 'signal' : 'quiet'}
              </dd>
            </div>
          </dl>

          <button type="button" className="button button--ghost" onClick={stop}>
            Stop tuner
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="button button--primary"
            onClick={start}
            disabled={isStarting}
          >
            {isStarting ? 'Waiting for microphone…' : 'Start tuner'}
          </button>
          <p className="card__hint">
            Your browser will ask for microphone access the first time. The tuner works offline.
          </p>
        </>
      )}
    </section>
  );
}
