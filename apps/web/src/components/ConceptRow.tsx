import type { EntryView } from "@flashcards/shared";
import { displayLemma, entriesFor } from "./entries";

type Props = {
  entries: EntryView[];
  from: string;
  to: string;
  available?: boolean;
  inDeck?: boolean;
  adding: boolean;
  disabled: boolean;
  onAdd: () => void;
};

// One word as "front → back" with its deck status or an Add button.
export function ConceptRow({ entries, from, to, available = true, inDeck, adding, disabled, onAdd }: Props) {
  const front = entriesFor(entries, from).map(displayLemma).join(", ");
  const back = entriesFor(entries, to).map(displayLemma).join(", ");
  return (
    <li className={available ? undefined : "unavailable"}>
      <span className="pair">
        <span className="prompt">{front || "—"}</span>
        <span className="arrow" aria-hidden="true">
          →
        </span>
        <span className="answer">{back || "—"}</span>
      </span>
      {inDeck ? (
        <span className="badge">In deck</span>
      ) : !available ? (
        <span className="badge muted">Not available yet</span>
      ) : (
        <button
          className="secondary"
          onClick={onAdd}
          disabled={disabled}
          aria-busy={adding}
          aria-label={adding ? `Adding ${front} to my deck` : `Add ${front} to my deck`}
        >
          {/* The label stays (hidden) so the button keeps its width under the spinner. */}
          <span style={adding ? { visibility: "hidden" } : undefined}>Add</span>
          {adding && <span className="spinner" aria-hidden="true" />}
        </button>
      )}
    </li>
  );
}
