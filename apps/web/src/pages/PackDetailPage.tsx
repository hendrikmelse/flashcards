import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AddPackResult, LanguageInfo } from "@flashcards/shared";
import { ApiError } from "../api/client";
import {
  useAddConcept,
  useAddPack,
  useLanguages,
  usePackConcepts,
  usePacks,
  type Direction,
} from "../api/packs";
import { DirectionPicker } from "../components/DirectionPicker";
import { BusyLabel } from "../components/BusyLabel";
import { ConceptRow } from "../components/ConceptRow";
import { useDirection } from "../hooks/useDirection";

export function PackDetailPage() {
  const languages = useLanguages();
  if (languages.isPending) return <p className="status">Loading…</p>;
  if (languages.isError || languages.data.length < 2) {
    return <p className="status error">Could not load languages.</p>;
  }
  return <PackDetailShell languages={languages.data} />;
}

function PackDetailShell({ languages }: { languages: LanguageInfo[] }) {
  const { direction, setDirection, search } = useDirection(languages);
  return (
    <>
      <p>
        <Link to={`/packs${search}`}>← All packs</Link>
      </p>
      <DirectionPicker languages={languages} direction={direction} onChange={setDirection} />
      {/* Remount on direction change so results from the old direction vanish. */}
      <PackDetail key={`${direction.from}-${direction.to}`} direction={direction} />
    </>
  );
}

function describeAdd(r: AddPackResult): string {
  const parts = [
    r.added === 0
      ? "No new cards were added."
      : `Added ${r.added} new card${r.added === 1 ? "" : "s"}.`,
  ];
  if (r.alreadyInDeck > 0) parts.push(`${r.alreadyInDeck} already in your deck.`);
  if (r.unavailable > 0) parts.push(`${r.unavailable} not available in this direction yet.`);
  return parts.join(" ");
}

function PackDetail({ direction }: { direction: Direction }) {
  const { id = "" } = useParams();
  const concepts = usePackConcepts(id, direction);
  const packs = usePacks(direction);
  const addPack = useAddPack(id, direction);
  const addConcept = useAddConcept(direction);

  // The same pack the other way around, for cards you want to study in both directions.
  const reverse = { from: direction.to, to: direction.from };
  const reversePacks = usePacks(reverse);
  const addReverse = useAddPack(id, reverse);
  const [last, setLast] = useState<"forward" | "reverse">("forward");

  if (concepts.isPending) return <p className="status">Loading…</p>;
  if (concepts.isError) {
    const missing =
      concepts.error instanceof ApiError && (concepts.error.status === 404 || concepts.error.status === 400);
    return (
      <p className="status error">
        {missing ? "That pack was not found." : "Could not load this pack. Please refresh."}
      </p>
    );
  }

  const { pack, concepts: rows } = concepts.data;
  const summary = packs.data?.find((p) => p.id === id);
  const allAdded =
    summary !== undefined &&
    (summary.availableCount ?? 0) > 0 &&
    summary.addedCount === summary.availableCount;
  const nothingAvailable = summary !== undefined && (summary.availableCount ?? 0) === 0;
  const reverseSummary = reversePacks.data?.find((p) => p.id === id);
  const allReverseAdded =
    reverseSummary !== undefined &&
    (reverseSummary.availableCount ?? 0) > 0 &&
    reverseSummary.addedCount === reverseSummary.availableCount;
  const noReverseAvailable = reverseSummary !== undefined && (reverseSummary.availableCount ?? 0) === 0;
  const reverseName = `${reverse.from.toUpperCase()} → ${reverse.to.toUpperCase()}`;
  const shown = last === "reverse" ? addReverse : addPack;

  return (
    <>
      <h1>{pack.name}</h1>
      {pack.description && <p className="lead">{pack.description}</p>}

      <div className="pack-actions">
        <button
          className="primary"
          onClick={() => {
            setLast("forward");
            addPack.mutate();
          }}
          disabled={addPack.isPending || allAdded || nothingAvailable}
          aria-busy={addPack.isPending}
          aria-label={addPack.isPending ? "Adding words to my deck" : undefined}
        >
          {/* The label stays (hidden) so the button keeps its width under the spinner. */}
          <span style={addPack.isPending ? { visibility: "hidden" } : undefined}>
            {allAdded ? "All words added" : "Add all to my deck"}
          </span>
          {addPack.isPending && <span className="spinner" aria-hidden="true" />}
        </button>
        <button
          className="secondary"
          onClick={() => {
            setLast("reverse");
            addReverse.mutate();
          }}
          disabled={addReverse.isPending || allReverseAdded || noReverseAvailable}
          aria-busy={addReverse.isPending}
          aria-label={
            addReverse.isPending
              ? `Adding reverse cards (${reverseName})`
              : allReverseAdded
                ? "All reverse cards added"
                : `Add reverse cards (${reverseName})`
          }
        >
          <BusyLabel busy={addReverse.isPending}>
            {allReverseAdded ? "All reverse cards added" : `Add reverse (${reverseName})`}
          </BusyLabel>
        </button>
        <div role="status" className={shown.isError ? "form-error" : "muted"}>
          {shown.isError
            ? "Could not add this pack. Please try again."
            : shown.data
              ? `${last === "reverse" ? `${reverseName}: ` : ""}${describeAdd(shown.data)}`
              : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty">This pack has no words yet.</p>
      ) : (
        <ul className="concept-list">
          {rows.map((c) => (
            <ConceptRow
              key={c.conceptId}
              entries={c.entries}
              from={direction.from}
              to={direction.to}
              available={c.available}
              inDeck={c.inDeck}
              adding={addConcept.isPending && addConcept.variables === c.conceptId}
              disabled={addConcept.isPending}
              onAdd={() => addConcept.mutate(c.conceptId)}
            />
          ))}
        </ul>
      )}

      {addConcept.isError && (
        <p role="alert" className="form-error">
          Could not add that word. Please try again.
        </p>
      )}
    </>
  );
}
