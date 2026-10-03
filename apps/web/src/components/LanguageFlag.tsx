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
