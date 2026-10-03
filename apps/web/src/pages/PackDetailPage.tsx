import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AddPackResult, EntryView } from "@flashcards/shared";
import { ApiError } from "../api/client";
import {
  ADD_DIRECTION,
  OTHER_WAY,
  useAddConcept,
  useAddPack,
  usePackConcepts,
  usePacks,
} from "../api/packs";
import { ConceptDialog } from "../components/CardDialog";
import { ConceptRow } from "../components/ConceptRow";

function describeAdd(r: AddPackResult): string {
  const parts = [
    r.added === 0
      ? "No new cards were added."
      : `Added ${r.added} new card${r.added === 1 ? "" : "s"}.`,
  ];
  if (r.alreadyInDeck > 0) parts.push(`${r.alreadyInDeck} already in your deck.`);
  if (r.unavailable > 0) parts.push(`${r.unavailable} not available yet.`);
  return parts.join(" ");
}

// Every word that can be a card in the direction is in the deck.
function allInDeck(summary: { availableCount?: number; addedCount?: number } | undefined) {
  return summary !== undefined && (summary.availableCount ?? 0) > 0 && summary.addedCount === summary.availableCount;
}

export function PackDetailPage() {
  const { id = "" } = useParams();
  const concepts = usePackConcepts(id, ADD_DIRECTION);
  // Words are added both ways round, so the pack is done once both directions are in the deck.
  const packs = usePacks(ADD_DIRECTION);
  const otherWay = usePacks(OTHER_WAY);
  const addPack = useAddPack(id);
  const addConcept = useAddConcept();
  // The word being looked at as a card, if any.
  const [open, setOpen] = useState<{ conceptId: string; entries: EntryView[] } | null>(null);

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
  const allAdded = allInDeck(summary) && allInDeck(otherWay.data?.find((p) => p.id === id));
  const nothingAvailable = summary !== undefined && (summary.availableCount ?? 0) === 0;

  return (
    <>
      <p>
        <Link to="/add-words">← All packs</Link>
      </p>
      <h1>{pack.name}</h1>
      {pack.description && <p className="lead">{pack.description}</p>}

      <div className="pack-actions">
        <button
          className="primary"
          onClick={() => addPack.mutate()}
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
        <div role="status" className={addPack.isError ? "form-error" : "muted"}>
          {addPack.isError
            ? "Could not add this pack. Please try again."
            : addPack.data
              ? describeAdd(addPack.data)
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
              from={ADD_DIRECTION.from}
              to={ADD_DIRECTION.to}
              available={c.available}
              inDeck={c.inDeck}
              adding={addConcept.isPending && addConcept.variables === c.conceptId}
              disabled={addConcept.isPending}
              onAdd={() => addConcept.mutate(c.conceptId)}
              onOpen={() => setOpen({ conceptId: c.conceptId, entries: c.entries })}
            />
          ))}
        </ul>
      )}

      {addConcept.isError && (
        <p role="alert" className="form-error">
          Could not add that word. Please try again.
        </p>
      )}

      {open && <ConceptDialog conceptId={open.conceptId} entries={open.entries} onClose={() => setOpen(null)} />}
    </>
  );
}
