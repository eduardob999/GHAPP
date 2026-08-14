import type { AudioEngineErrorCode } from '../audio/audioEngine';
import { micGuidance } from '../domain/micGuidance';

/**
 * What every panel shows when the microphone will not start.
 *
 * One component rather than three variations, so the advice cannot drift apart
 * between the tuner, the sniper and Chord Hero — and so a panel that gains
 * microphone use later cannot forget to explain itself.
 */

export interface MicNoticeProps {
  code: AudioEngineErrorCode;
  /** The engine's own message, kept as detail rather than as the headline. */
  detail?: string | null;
  onRetry?: () => void;
  /** Offered only by panels that have something to do without audio. */
  onContinueWithout?: () => void;
  continueLabel?: string;
}

export function MicNotice({
  code,
  detail,
  onRetry,
  onContinueWithout,
  continueLabel = 'Carry on without the microphone',
}: MicNoticeProps) {
  const guidance = micGuidance(code);

  return (
    <div className="micnotice" role="alert" data-testid="mic-notice" data-mic-code={code}>
      <p className="micnotice__headline">{guidance.headline}</p>
      <p className="micnotice__explanation">{guidance.explanation}</p>

      {guidance.steps.length > 0 ? (
        <ol className="micnotice__steps">
          {guidance.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}

      <div className="micnotice__actions">
        {guidance.canRetry && onRetry ? (
          <button type="button" className="button button--primary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {guidance.offerSelfGrading && onContinueWithout ? (
          <button type="button" className="button button--ghost" onClick={onContinueWithout}>
            {continueLabel}
          </button>
        ) : null}
      </div>

      {detail ? <p className="micnotice__detail">Details: {detail}</p> : null}
    </div>
  );
}
