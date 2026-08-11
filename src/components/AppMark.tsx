/**
 * The app's fretboard mark, matching public/icons.
 *
 * Drawn rather than set as an emoji: 🎸 falls back to a tofu box on any system
 * without a colour emoji font, which includes plenty of Linux desktops.
 */
export function AppMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      className="app-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Guitar Practice Companion"
    >
      <rect width="64" height="64" rx="14" fill="#12101f" />
      <rect x="17" y="6" width="30" height="52" fill="#8a5a3b" />
      {[18, 30, 42, 54].map((y) => (
        <rect key={y} x="17" y={y - 1} width="30" height="2.4" fill="#d8d8e0" />
      ))}
      <circle cx="32" cy="36" r="4" fill="#7c5cff" />
      {[21.3, 25.6, 29.9, 34.1, 38.4, 42.7].map((x, index) => (
        <rect
          key={x}
          x={x}
          y="6"
          width={0.7 + index * 0.22}
          height="52"
          fill="#f5ead6"
          opacity="0.95"
        />
      ))}
    </svg>
  );
}
