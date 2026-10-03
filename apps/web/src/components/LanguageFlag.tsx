import type { ReactElement } from "react";

// A small flag for a language, drawn as SVG (flag emoji do not show on Windows, only the country
// letters). A language is not a country, so these are only a quick visual cue: English uses the
// Union Jack. A language without a flag here shows its code.
const WIDTH = 28;
const HEIGHT = 20;

function Netherlands() {
  return (
    <>
      <rect width="9" height="2" fill="#AE1C28" />
      <rect y="2" width="9" height="2" fill="#FFFFFF" />
      <rect y="4" width="9" height="2" fill="#21468B" />
    </>
  );
}

// The Union Jack, drawn on its usual 60 by 30 grid and stretched into the same box as the others.
// The thin red diagonals are simplified (the real flag offsets them to each side of the white).
function UnionJack() {
  return (
    <svg x="0" y="0" width="9" height="6" viewBox="0 0 60 30" preserveAspectRatio="none">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30,0 V30 M0,15 H60" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

const FLAGS: Record<string, () => ReactElement> = { nl: Netherlands, en: UnionJack };

export function LanguageFlag({ code, label }: { code: string; label: string }) {
  const Flag = FLAGS[code];
  if (!Flag) {
    return (
      <span className="flag flag-code" role="img" aria-label={label}>
        {code.toUpperCase()}
      </span>
    );
  }
  return (
    <svg
      className="flag"
      role="img"
      aria-label={label}
      width={WIDTH}
      height={HEIGHT}
      viewBox="0 0 9 6"
      preserveAspectRatio="none"
    >
      <Flag />
    </svg>
  );
}

// Two flags in one picture, cut along a slash: the first shows to the left of it and the second to
// the right, as if one were laid over the other. Used for the app's own pair of languages, English
// and Dutch. Decoration, so it is hidden from screen readers.
const SLASH_TOP = 5.4;
const SLASH_BOTTOM = 3.6;
const SLASH_GAP = 0.6;
const SLASH_OVERSHOOT = 0.8; // how far it sticks out above and below, in flag units
const SLOPE = (SLASH_TOP - SLASH_BOTTOM) / 6; // how far the slash moves sideways per unit of height

export function SplitFlag({ left, right }: { left: string; right: string }) {
  const Left = FLAGS[left];
  const Right = FLAGS[right];
  if (!Left || !Right) return null;
  const id = `split-${left}-${right}`;
  return (
    <svg
      className="flag flag-split"
      aria-hidden="true"
      width={HEIGHT * 1.2 * 1.5}
      height={HEIGHT * 1.2}
      viewBox="0 0 9 6"
      preserveAspectRatio="none"
      overflow="visible"
    >
      <defs>
        <clipPath id={`${id}-shape`}>
          <rect width="9" height="6" rx="0.45" />
        </clipPath>
        <clipPath id={`${id}-left`}>
          <polygon points={`0,0 ${SLASH_TOP},0 ${SLASH_BOTTOM},6 0,6`} />
        </clipPath>
        <clipPath id={`${id}-right`}>
          <polygon points={`${SLASH_TOP},0 9,0 9,6 ${SLASH_BOTTOM},6`} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-shape)`}>
        <g clipPath={`url(#${id}-left)`}>
          <Left />
        </g>
        <g clipPath={`url(#${id}-right)`}>
          <Right />
        </g>
      </g>
      {/* The slash itself, in the muted text color. It runs a little past the flag at both ends. */}
      <line
        x1={SLASH_TOP + SLASH_OVERSHOOT * SLOPE}
        y1={-SLASH_OVERSHOOT}
        x2={SLASH_BOTTOM - SLASH_OVERSHOOT * SLOPE}
        y2={6 + SLASH_OVERSHOOT}
        stroke="var(--muted)"
        strokeWidth={SLASH_GAP}
      />
    </svg>
  );
}
