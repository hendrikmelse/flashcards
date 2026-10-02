import type { LanguageInfo } from "@flashcards/shared";
import type { Direction } from "../api/packs";

type Props = {
  languages: LanguageInfo[];
  direction: Direction;
  onChange: (d: Direction) => void;
};

// Choosing the same language on both sides swaps them instead.
export function DirectionPicker({ languages, direction, onChange }: Props) {
  const setFrom = (from: string) =>
    onChange(from === direction.to ? { from, to: direction.from } : { from, to: direction.to });
  const setTo = (to: string) =>
    onChange(to === direction.from ? { from: direction.to, to } : { from: direction.from, to });

  return (
    <div className="direction" role="group" aria-label="Study direction">
      <label>
        Prompt language
        <select className="dropdown" value={direction.from} onChange={(e) => setFrom(e.target.value)}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="swap"
        aria-label="Swap languages"
        onClick={() => onChange({ from: direction.to, to: direction.from })}
      >
        ⇄
      </button>
      <label>
        Answer language
        <select className="dropdown" value={direction.to} onChange={(e) => setTo(e.target.value)}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
