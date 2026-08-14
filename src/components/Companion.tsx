import type { CompanionMood } from '../domain/companion';

/**
 * The practice companion.
 *
 * Inline SVG for the same reason the chord diagrams are: no image assets, no
 * network, and it renders from the service worker cache on the first offline
 * launch. Expression is data — eyes and mouth are chosen per mood — so adding a
 * mood cannot leave the face half-updated.
 *
 * Motion lives in CSS, behind `prefers-reduced-motion`. A bobbing character is
 * charming right up until it is the thing making someone feel unwell.
 */

interface CompanionProps {
  mood: CompanionMood;
  size?: number;
}

type Eyes = 'open' | 'happy' | 'wide' | 'closed' | 'soft';
type Mouth = 'smile' | 'grin' | 'small' | 'flat' | 'open';

const FACE: Record<CompanionMood, { eyes: Eyes; mouth: Mouth; blush: boolean }> = {
  new: { eyes: 'wide', mouth: 'small', blush: false },
  idle: { eyes: 'open', mouth: 'smile', blush: false },
  listening: { eyes: 'wide', mouth: 'small', blush: false },
  pleased: { eyes: 'happy', mouth: 'grin', blush: true },
  encouraging: { eyes: 'soft', mouth: 'smile', blush: false },
  celebrating: { eyes: 'happy', mouth: 'open', blush: true },
  'missed-you': { eyes: 'soft', mouth: 'small', blush: false },
  sleepy: { eyes: 'closed', mouth: 'flat', blush: false },
};

function Eye({ x, kind }: { x: number; kind: Eyes }) {
  if (kind === 'closed') {
    return <path d={`M${x - 5} 30 q5 4 10 0`} className="companion__stroke" fill="none" />;
  }

  if (kind === 'happy') {
    return <path d={`M${x - 5} 31 q5 -6 10 0`} className="companion__stroke" fill="none" />;
  }

  const radius = kind === 'wide' ? 5 : kind === 'soft' ? 3.6 : 4.2;

  return (
    <>
      <circle cx={x} cy={30} r={radius} fill="#12101f" />
      <circle cx={x + 1.4} cy={28.4} r={radius / 3} fill="#ffffff" />
    </>
  );
}

function Mouth({ kind }: { kind: Mouth }) {
  switch (kind) {
    case 'grin':
      return <path d="M24 39 q8 9 16 0 q-8 4 -16 0z" fill="#12101f" />;
    case 'open':
      return <ellipse cx="32" cy="41" rx="5.5" ry="6" fill="#12101f" />;
    case 'small':
      return <circle cx="32" cy="40" r="2.6" fill="#12101f" />;
    case 'flat':
      return <path d="M27 40 h10" className="companion__stroke" fill="none" />;
    case 'smile':
    default:
      return <path d="M25 39 q7 6 14 0" className="companion__stroke" fill="none" />;
  }
}

export function Companion({ mood, size = 96 }: CompanionProps) {
  const face = FACE[mood];

  return (
    <svg
      className={`companion companion--${mood}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Your practice companion looks ${mood.replace('-', ' ')}`}
      data-mood={mood}
    >
      {/* A plectrum, which is the smallest object in the room with a personality. */}
      <path
        className="companion__body"
        d="M32 6 C46 6 58 17 58 31 C58 45 45 58 32 58 C19 58 6 45 6 31 C6 17 18 6 32 6 Z"
      />
      <path
        className="companion__sheen"
        d="M18 16 C24 10 34 9 40 12 C33 12 24 16 21 24 Z"
      />

      {face.blush ? (
        <>
          <ellipse cx="17" cy="38" rx="4" ry="2.6" className="companion__blush" />
          <ellipse cx="47" cy="38" rx="4" ry="2.6" className="companion__blush" />
        </>
      ) : null}

      <Eye x={24} kind={face.eyes} />
      <Eye x={40} kind={face.eyes} />
      <Mouth kind={face.mouth} />

      {mood === 'listening' ? (
        <g className="companion__ears" aria-hidden="true">
          <path d="M4 24 q-3 7 0 14" className="companion__stroke" fill="none" />
          <path d="M60 24 q3 7 0 14" className="companion__stroke" fill="none" />
        </g>
      ) : null}

      {mood === 'sleepy' ? (
        <text className="companion__zzz" x="46" y="16" aria-hidden="true">
          z
        </text>
      ) : null}

      {mood === 'celebrating' ? (
        <g className="companion__sparks" aria-hidden="true">
          <circle cx="10" cy="12" r="2.2" />
          <circle cx="54" cy="10" r="1.8" />
          <circle cx="58" cy="46" r="2" />
        </g>
      ) : null}
    </svg>
  );
}
