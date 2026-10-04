import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AddPackResult, EntryView } from "@flashcards/shared";
import { ApiError } from "../api/client";
import {
  useAddConcept,
  useAddPack,
  usePackConcepts,
  usePacks,
} from "../api/packs";
import { ConceptDialog } from "../components/CardDialog";
import { ConceptRow } from "../components/ConceptRow";
import { PageHeadActions } from "../components/PageHeadActions";
import { useActiveLanguages } from "../hooks/useActiveLanguages";

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

// The way back to the list of packs, at the top left of the page.
function AllPacks() {
  return (
    <Link to="/add-words" className="button secondary">
      Back to all packs
    </Link>
  );
}

// The buttons to the other main pages, as in the headers of Add words, which this page belongs to.
function Navigation() {
  return (
    <PageHeadActions>
      <Link to="/" className="button secondary">
        Go to dashboard
      </Link>
      <Link to="/deck" className="button secondary">
        View deck
      </Link>
    </PageHeadActions>
  );
}

export function PackDetailPage() {
  const { id = "" } = useParams();
  const { direction, otherWay: otherDirection } = useActiveLanguages();
  const concepts = usePackConcepts(id, direction);
  // Words are added both ways round, so the pack is done once both directions are in the deck.
  const packs = usePacks(direction);
  const otherWay = usePacks(otherDirection);
  const addPack = useAddPack(id);
  const addConcept = useAddConcept();
  // The word being looked at as a card, if any.
  const [open, setOpen] = useState<{ conceptId: string; entries: EntryView[] } | null>(null);

  if (concepts.isPending) return <p className="status">Loading…</p>;
  if (concepts.isError) {
    const missing =
      concepts.error instanceof ApiError && (concepts.error.status === 404 || concepts.error.status === 400);
    return (
      <>
        <div className="page-head">
          <AllPacks />
          <Navigation />
        </div>
        <p className="status error">
          {missing ? "That pack was not found." : "Could not load this pack. Please refresh."}
        </p>
      </>
    );
  }

  const { pack, concepts: rows } = concepts.data;
  const summary = packs.data?.find((p) => p.id === id);
  const allAdded = allInDeck(summary) && allInDeck(otherWay.data?.find((p) => p.id === id));
  const nothingAvailable = summary !== undefined && (summary.availableCount ?? 0) === 0;

  return (
    <>
      <div className="page-head pack-head">
        {/* The way back and the pack's name, level with the buttons at the right rather than below them. */}
        <div className="pack-head-left">
          <AllPacks />
          <h1 id="pack-title" className="pack-title">
            {pack.name}
          </h1>
        </div>
        <Navigation />
      </div>

      <section className="pack-page-card" aria-labelledby="pack-title">
        <div className="pack-intro">
          {pack.description && <p className="lead">{pack.description}</p>}

          <div className="pack-actions">
            <div role="status" className={addPack.isError ? "form-error" : "muted"}>
              {addPack.isError
                ? "Could not add this pack. Please try again."
                : addPack.data
                  ? describeAdd(addPack.data)
                  : null}
            </div>
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
                onOpen={() => setOpen({ conceptId: c.conceptId, entries: c.entries })}
              />
            ))}
          </ul>
        )}
      </section>

      {addConcept.isError && (
        <p role="alert" className="form-error">
          Could not add that word. Please try again.
        </p>
      )}

      {open && <ConceptDialog conceptId={open.conceptId} entries={open.entries} onClose={() => setOpen(null)} />}
    </>
  );
}
