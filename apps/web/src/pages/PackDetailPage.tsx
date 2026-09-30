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
import { displayLemma, entriesFor } from "../components/entries";
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

  const pack = concepts.data.pages[0]!.pack;
  const rows = concepts.data.pages.flatMap((p) => p.concepts);
  const summary = packs.data?.find((p) => p.id === id);
  const allAdded =
    summary !== undefined &&
    (summary.availableCount ?? 0) > 0 &&
    summary.addedCount === summary.availableCount;
  const nothingAvailable = summary !== undefined && (summary.availableCount ?? 0) === 0;

  return (
    <>
      <h1>{pack.name}</h1>
      {pack.description && <p className="lead">{pack.description}</p>}

      <div className="pack-actions">
        <button
          className="primary"
          onClick={() => addPack.mutate()}
          disabled={addPack.isPending || allAdded || nothingAvailable}
        >
          {addPack.isPending ? "Adding…" : allAdded ? "All words added" : "Add all to my deck"}
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
          {rows.map((c) => {
            const front = entriesFor(c.entries, direction.from).map(displayLemma).join(", ");
            const back = entriesFor(c.entries, direction.to).map(displayLemma).join(", ");
            const adding = addConcept.isPending && addConcept.variables === c.conceptId;
            return (
              <li key={c.conceptId} className={c.available ? undefined : "unavailable"}>
                <span className="pair">
                  <span className="prompt">{front || "—"}</span>
                  <span className="arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="answer">{back || "—"}</span>
                </span>
                {c.inDeck ? (
                  <span className="badge">In deck</span>
                ) : !c.available ? (
                  <span className="badge muted">Not available yet</span>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => addConcept.mutate(c.conceptId)}
                    disabled={addConcept.isPending}
                    aria-label={`Add ${front} to my deck`}
                  >
                    {adding ? "Adding…" : "Add"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {addConcept.isError && (
        <p role="alert" className="form-error">
          Could not add that word. Please try again.
        </p>
      )}

      {concepts.hasNextPage && (
        <button
          className="secondary more"
          onClick={() => concepts.fetchNextPage()}
          disabled={concepts.isFetchingNextPage}
        >
          {concepts.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
