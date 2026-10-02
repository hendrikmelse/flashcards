import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ConceptSearchResult, LanguageInfo } from "@flashcards/shared";
import { useAddConcept, useConceptSearch, useLanguages, usePacks } from "../api/packs";
import { ConceptRow } from "../components/ConceptRow";
import { DirectionPicker } from "../components/DirectionPicker";
import { useDirection } from "../hooks/useDirection";

export function PacksPage() {
  const languages = useLanguages();
  if (languages.isPending) return <p className="status">Loading…</p>;
  if (languages.isError) return <p className="status error">Could not load languages.</p>;
  if (languages.data.length < 2) {
    return <p className="status">Packs need at least two languages to be available.</p>;
  }
  return <PackList languages={languages.data} />;
}

type Mode = "packs" | "words";

function PackList({ languages }: { languages: LanguageInfo[] }) {
  const { direction, setDirection } = useDirection(languages);
  const [mode, setMode] = useState<Mode>("packs");
  const [query, setQuery] = useState("");
  const [hideInDeck, setHideInDeck] = useState(false);

  return (
    <>
      <h1>Packs</h1>
      <p className="lead">Pick a pack of words to add to your deck, or look up a single word.</p>
      <DirectionPicker languages={languages} direction={direction} onChange={setDirection} />

      <input
        type="search"
        className="search"
        placeholder={mode === "packs" ? "Search packs" : "Search words"}
        aria-label={mode === "packs" ? "Search packs" : "Search words"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="search-options">
        <div className="toggle" role="group" aria-label="Search for">
          {(["packs", "words"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "packs" ? "Packs" : "Words"}
            </button>
          ))}
        </div>
        <div className="toggle">
          <button type="button" aria-pressed={hideInDeck} onClick={() => setHideInDeck(!hideInDeck)}>
            Hide already added results
          </button>
        </div>
      </div>

      {mode === "packs" ? (
        <PackResults languages={languages} query={query} hideInDeck={hideInDeck} />
      ) : (
        <WordResults languages={languages} query={query} hideInDeck={hideInDeck} />
      )}
    </>
  );
}

type ResultProps = { languages: LanguageInfo[]; query: string; hideInDeck: boolean };

function PackResults({ languages, query, hideInDeck }: ResultProps) {
  const { direction, search } = useDirection(languages);
  const packs = usePacks(direction);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Packs whose name matches come first; the rest only match through the description.
  // The API returns packs by name, and the sort is stable, so each group stays alphabetical.
  const shown = packs.data
    ?.map((pack) => {
      const name = pack.name.toLowerCase();
      const text = `${name} ${(pack.description ?? "").toLowerCase()}`;
      return {
        pack,
        rank: words.every((w) => name.includes(w)) ? 0 : words.every((w) => text.includes(w)) ? 1 : 2,
      };
    })
    .filter((m) => m.rank < 2)
    // A pack is "done" once every word that can be a card in this direction is in the deck.
    .filter(({ pack }) => !hideInDeck || !(pack.availableCount && pack.addedCount === pack.availableCount))
    .sort((x, y) => x.rank - y.rank)
    .map((m) => m.pack);

  return (
    <>
      {packs.isPending && <p className="status">Loading…</p>}
      {packs.isError && <p className="status error">Could not load packs. Please refresh.</p>}
      {packs.data?.length === 0 && <p className="empty">There are no packs yet.</p>}
      {packs.data && packs.data.length > 0 && shown?.length === 0 && (
        <p className="empty">
          {words.length > 0 ? `No packs match “${query.trim()}”.` : "Every pack is already in your deck."}
        </p>
      )}

      <ul className="pack-list">
        {shown?.map((pack) => {
          const available = pack.availableCount ?? 0;
          const added = pack.addedCount ?? 0;
          return (
            <li key={pack.id} className="pack-card">
              <h2>
                <Link to={`/packs/${pack.id}${search}`}>{pack.name}</Link>
              </h2>
              {pack.description && <p className="muted">{pack.description}</p>}
              {available === 0 ? (
                <p className="muted">No words available in this direction yet.</p>
              ) : (
                <>
                  <progress
                    value={added}
                    max={available}
                    aria-label={`${pack.name}: ${added} of ${available} words in your deck`}
                  />
                  <p className="muted">
                    {added === available
                      ? `All ${available} words are in your deck`
                      : `${added} of ${available} words in your deck`}
                    {pack.conceptCount > available &&
                      ` · ${pack.conceptCount - available} not available in this direction yet`}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function WordResults({ languages, query, hideInDeck }: ResultProps) {
  const { direction } = useDirection(languages);
  const [term, setTerm] = useState("");
  const found = useConceptSearch(term, direction, hideInDeck);
  const addConcept = useAddConcept(direction);

  // With "hide already added" on, a word you just added would vanish from the
  // results. Keep it (as "In deck") so the list doesn't move under the cursor,
  // until the search changes or the filter is toggled. `index` is where it goes back.
  const [recent, setRecent] = useState(
    new Map<string, { index: number; result: ConceptSearchResult; done: boolean }>(),
  );
  useEffect(() => setRecent(new Map()), [term, hideInDeck]);
  const forget = (id: string) =>
    setRecent((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  const add = (result: ConceptSearchResult, index: number) => {
    const id = result.conceptId;
    setRecent((prev) => new Map(prev).set(id, { index, result, done: false }));
    addConcept.mutate(id, {
      onSuccess: () =>
        setRecent((prev) => {
          const entry = prev.get(id);
          return entry ? new Map(prev).set(id, { ...entry, done: true }) : prev;
        }),
      onError: () => forget(id),
    });
  };

  // Look up words once typing pauses.
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  if (query.trim().length < 2) {
    return <p className="empty">Type at least two letters to find a word in either language.</p>;
  }

  // Refetching after an add can overlap pages, so drop repeats.
  const rows = [...new Map((found.data?.pages ?? []).flatMap((p) => p.concepts).map((c) => [c.conceptId, c])).values()];
  [...recent.values()]
    .filter((r) => !rows.some((c) => c.conceptId === r.result.conceptId))
    .sort((a, b) => a.index - b.index)
    .forEach((r) =>
      rows.splice(Math.min(r.index, rows.length), 0, r.done ? { ...r.result, inDeck: true } : r.result),
    );

  return (
    <>
      {found.isError && <p className="status error">Could not search for words.</p>}
      {found.data && term === query.trim() && rows.length === 0 && (
        <p className="empty">No words match “{term}”.</p>
      )}
      {rows.length > 0 && (
        <ul className="concept-list">
          {rows.map((c, i) => {
            return (
              <ConceptRow
                key={c.conceptId}
                entries={c.entries}
                from={direction.from}
                to={direction.to}
                inDeck={c.inDeck}
                adding={addConcept.isPending && addConcept.variables === c.conceptId}
                disabled={addConcept.isPending}
                onAdd={() => add(c, i)}
              />
            );
          })}
        </ul>
      )}
      {found.hasNextPage && (
        <button
          className="secondary more"
          onClick={() => found.fetchNextPage()}
          disabled={found.isFetchingNextPage}
          aria-busy={found.isFetchingNextPage}
        >
          {/* The label stays (hidden) so the button keeps its width under the spinner. */}
          <span style={found.isFetchingNextPage ? { visibility: "hidden" } : undefined}>
            Load more matches
          </span>
          {found.isFetchingNextPage && <span className="spinner" aria-hidden="true" />}
        </button>
      )}
      {addConcept.isError && (
        <p role="alert" className="form-error">
          Could not add that word. Please try again.
        </p>
      )}
    </>
  );
}
