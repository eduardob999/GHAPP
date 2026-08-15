import { DEFAULT_HANDEDNESS, stringColumn, type Handedness } from '../domain/handedness';
import type { FingerPosition } from '../domain/skills';

/**
 * A chord diagram, drawn as inline SVG.
 *
 * Vertical neck in the usual chord-chart orientation: strings run top to bottom
 * with the low E on the left, frets run across. No dependencies, no images —
 * it scales cleanly and inherits the app's theme colours through CSS.
 */

export interface FretboardDiagramProps {
  rootString: number;
  rootFret: number;
  /** Lowest fret to draw. 0 draws the nut. */
  lowestFret: number;
  highestFret: number;
  fingers: FingerPosition[];
  mutedStrings?: number[];
  title?: string;
  subtitle?: string;
  /** Mirrors the neck for a left-handed player. Numbering is unaffected. */
  handedness?: Handedness;
}

const STRINGS = [6, 5, 4, 3, 2, 1] as const;

const STRING_GAP = 26;
const FRET_HEIGHT = 34;
const DOT_RADIUS = 10;

/**
 * Room for the position label to the left of the grid. It has to clear both a
 * two-digit label ("10fr") and the dot or barre cap that sits on the leftmost
 * string, whose centre is at PAD_LEFT and so extends DOT_RADIUS to its left.
 */
const PAD_LEFT = 42;
const PAD_RIGHT = 16;
const MARKER_Y = 13; // where the open/muted marks sit, above the nut
const GRID_TOP = 28;
const NUT_THICKNESS = 5;

const GRID_WIDTH = (STRINGS.length - 1) * STRING_GAP;
const WIDTH = PAD_LEFT + GRID_WIDTH + PAD_RIGHT;

/**
 * Low E on the left for a right-handed chart, on the right for a left-handed
 * one. The flip lives in `stringColumn`, so this stays a single multiply.
 */
function stringX(string: number, handedness: Handedness): number {
  return PAD_LEFT + stringColumn(string, handedness) * STRING_GAP;
}

export function FretboardDiagram({
  rootString,
  rootFret,
  lowestFret,
  highestFret,
  fingers,
  mutedStrings = [],
  title,
  subtitle,
  handedness = DEFAULT_HANDEDNESS,
}: FretboardDiagramProps) {
  // With the nut showing, the first drawn row is fret 1 — fret 0 lives above it
  // as an open marker, not as a row.
  const showNut = lowestFret === 0;
  const firstRowFret = showNut ? 1 : lowestFret;
  const rows = Math.max(1, highestFret - firstRowFret + 1);

  const gridTop = GRID_TOP;
  const gridBottom = gridTop + rows * FRET_HEIGHT;
  const height = gridBottom + 8;

  const fretY = (fret: number) => gridTop + (fret - firstRowFret + 0.5) * FRET_HEIGHT;

  const muted = new Set(mutedStrings);
  const stopped = fingers.filter((f) => f.fret > 0);
  const stoppedStrings = new Set(stopped.map((f) => f.string));

  // Anything neither muted nor stopped rings open.
  const openStrings = STRINGS.filter((s) => !muted.has(s) && !stoppedStrings.has(s));

  // Barre notes at the same fret collapse into one bar.
  const barresByFret = new Map<number, number[]>();
  for (const finger of fingers) {
    if (!finger.barre) continue;
    const group = barresByFret.get(finger.fret);
    if (group) group.push(finger.string);
    else barresByFret.set(finger.fret, [finger.string]);
  }

  const barredKeys = new Set(
    fingers.filter((f) => f.barre).map((f) => `${f.string}:${f.fret}`),
  );
  const dots = stopped.filter((f) => !barredKeys.has(`${f.string}:${f.fret}`));

  const isRoot = (string: number, fret: number) => string === rootString && fret === rootFret;

  return (
    <div className="diagram">
      <svg
        className="fretboard"
        viewBox={`0 0 ${WIDTH} ${height}`}
        width={WIDTH}
        height={height}
        role="img"
        aria-label={title ? `${title} chord diagram` : 'Chord diagram'}
      >
        {/* Fret wires */}
        {Array.from({ length: rows + 1 }, (_, i) => (
          <line
            key={`fret-${i}`}
            className="fretboard__fret"
            x1={PAD_LEFT}
            x2={PAD_LEFT + GRID_WIDTH}
            y1={gridTop + i * FRET_HEIGHT}
            y2={gridTop + i * FRET_HEIGHT}
          />
        ))}

        {/* Strings */}
        {STRINGS.map((string) => (
          <line
            key={`string-${string}`}
            className="fretboard__string"
            x1={stringX(string, handedness)}
            x2={stringX(string, handedness)}
            y1={gridTop}
            y2={gridBottom}
          />
        ))}

        {showNut ? (
          <rect
            className="fretboard__nut"
            x={PAD_LEFT}
            y={gridTop - NUT_THICKNESS}
            width={GRID_WIDTH}
            height={NUT_THICKNESS}
          />
        ) : (
          <text
            className="fretboard__position"
            x={PAD_LEFT - DOT_RADIUS - 4}
            y={fretY(firstRowFret) + 4}
          >
            {firstRowFret}fr
          </text>
        )}

        {/* Muted strings: ✕ above the nut, drawn rather than typed so it does
            not depend on a font having the glyph. */}
        {[...muted].map((string) => (
          <g key={`mute-${string}`} className="fretboard__muted">
            <line
              x1={stringX(string, handedness) - 5}
              y1={MARKER_Y - 5}
              x2={stringX(string, handedness) + 5}
              y2={MARKER_Y + 5}
            />
            <line
              x1={stringX(string, handedness) + 5}
              y1={MARKER_Y - 5}
              x2={stringX(string, handedness) - 5}
              y2={MARKER_Y + 5}
            />
          </g>
        ))}

        {/* Open strings */}
        {openStrings.map((string) => (
          <circle
            key={`open-${string}`}
            className={`fretboard__open${isRoot(string, 0) ? ' fretboard__open--root' : ''}`}
            cx={stringX(string, handedness)}
            cy={MARKER_Y}
            r={5}
          />
        ))}

        {/* Barres */}
        {[...barresByFret.entries()].map(([fret, strings]) => {
          // Take the extremes of the *coordinates*, not of the string numbers.
          // The highest-numbered string is only the leftmost on a right-handed
          // chart; mirrored, this produced a negative width and no barre at all.
          const xs = strings.map((string) => stringX(string, handedness));
          const left = Math.min(...xs);
          const right = Math.max(...xs);
          return (
            <rect
              key={`barre-${fret}`}
              className="fretboard__barre"
              x={left - DOT_RADIUS}
              y={fretY(fret) - DOT_RADIUS}
              width={right - left + DOT_RADIUS * 2}
              height={DOT_RADIUS * 2}
              rx={DOT_RADIUS}
            />
          );
        })}

        {/* Barre finger label, once per bar */}
        {[...barresByFret.entries()].map(([fret, strings]) => {
          const finger = fingers.find((f) => f.barre && f.fret === fret)?.finger;
          if (!finger) return null;
          return (
            <text
              key={`barre-label-${fret}`}
              className="fretboard__finger"
              x={Math.min(...strings.map((string) => stringX(string, handedness)))}
              y={fretY(fret) + 4}
            >
              {finger}
            </text>
          );
        })}

        {/* Stopped notes */}
        {dots.map((finger) => (
          <g key={`dot-${finger.string}-${finger.fret}`}>
            <circle
              className={`fretboard__dot${isRoot(finger.string, finger.fret) ? ' fretboard__dot--root' : ''}`}
              cx={stringX(finger.string, handedness)}
              cy={fretY(finger.fret)}
              r={DOT_RADIUS}
            />
            {finger.finger ? (
              <text
                className="fretboard__finger"
                x={stringX(finger.string, handedness)}
                y={fretY(finger.fret) + 4}
              >
                {finger.finger}
              </text>
            ) : null}
          </g>
        ))}

        {/* Root marker on a barred root, which has no dot of its own */}
        {barredKeys.has(`${rootString}:${rootFret}`) ? (
          <circle
            className="fretboard__root-ring"
            cx={stringX(rootString, handedness)}
            cy={fretY(rootFret)}
            r={DOT_RADIUS - 3}
          />
        ) : null}
      </svg>

      {subtitle ? <p className="diagram__caption">{subtitle}</p> : null}
    </div>
  );
}
