import { useEffect, useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { Link } from "react-router";
import {
  PACK_CATEGORIES,
  PACK_CATEGORY_LABELS,
  type ConceptSearchResult,
  type EntryView,
  type PackCategory,
} from "@flashcards/shared";
import { useAddConcept, useConceptSearch, usePacks } from "../api/packs";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
import { useAddWordsIntro } from "../hooks/useAddWordsIntro";
import { ConceptDialog } from "../components/CardDialog";
import { PackRequest } from "../components/PackRequest";
import { PageHeadActions } from "../components/PageHeadActions";
import { SearchIcon } from "../components/icons";
import { ConceptRow } from "../components/ConceptRow";
import { isBoolean, isOneOf, isString, useRemembered } from "../hooks/useRemembered";

type Mode = "packs" | "words";

type CategoryFilter = PackCategory | "all";

/** How long the All button flashes, which the animation in the stylesheet fits (three pulses). */
const FLASH_MS = 1500;

export function PacksPage() {
  usePageTitle("Add words");
  const { direction } = useActiveLanguages();
  const intro = useAddWordsIntro();
  const packs = usePacks(direction);
  // The filters are remembered, so leaving the page and coming back finds them as they were.
  const [mode, setMode] = useRemembered<Mode>("packs:mode", "packs", isOneOf("packs", "words"));
  const [query, setQuery] = useRemembered("packs:query", "", isString);
  const [hideInDeck, setHideInDeck] = useRemembered("packs:hideInDeck", false, isBoolean);
  const [category, setCategory] = useRemembered<CategoryFilter>(
    "packs:category",
    "all",
    isOneOf("all", ...PACK_CATEGORIES),
  );

  // The categories there are, so ones with no packs at all are not offered: they stay on offer
  // while a search finds nothing in them, so the buttons do not come and go as you type.
  const everyCategory = new Set((packs.data ?? []).map((p) => p.category));
  const categories = PACK_CATEGORIES.filter((c) => everyCategory.has(c));
  // How many packs the search finds in each category (and in all of them), counted the way the list
  // is, so each count is how many packs choosing that category would show.
  const found = matchPacks(packs.data ?? [], query, hideInDeck);
  const perCategory = new Map<PackCategory, number>();
  for (const p of found) perCategory.set(p.category, (perCategory.get(p.category) ?? 0) + 1);

  // A search that finds nothing in the category chosen, but does in others: the list looks empty
  // for no reason a glance can tell, so the All button flashes to point at where the packs are. It
  // flashes when that happens (the search moves on, or another category is chosen), not on every
  // keystroke after.
  const foundElsewhere =
    mode === "packs" && category !== "all" && query.trim() !== "" && (perCategory.get(category) ?? 0) === 0 && found.length > 0;
  const [flashAll, setFlashAll] = useState(false);
  useEffect(() => {
    setFlashAll(foundElsewhere);
    if (!foundElsewhere) return;
    const done = setTimeout(() => setFlashAll(false), FLASH_MS);
    return () => clearTimeout(done);
  }, [foundElsewhere, category]);

  // Until it is dismissed, the explainer is all there is: nothing can be added before it is read.
  if (intro) return intro;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add words</h1>
        </div>
        <PageHeadActions>
          <Link to="/" className="button secondary">
            Go to dashboard
          </Link>
          <Link to="/deck" className="button secondary">
            View deck
          </Link>
        </PageHeadActions>
      </div>

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
            {mode === "packs" ? "Hide packs already in deck" : "Hide words already in deck"}
          </button>
        </div>
      </div>
      {mode === "packs" && categories.length > 1 && (
        <div className="search-options">
          <div className="toggle" role="group" aria-label="Category">
            <button
              type="button"
              className={flashAll ? "flash" : undefined}
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              All<span className="count">{found.length}</span>
            </button>
            {categories.map((c) => (
              <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {PACK_CATEGORY_LABELS[c]}
                <span className="count">{perCategory.get(c) ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "packs" ? (
        <PackResults
          packs={packs}
          category={category}
          query={query}
          hideInDeck={hideInDeck}
          onShowAll={() => setCategory("all")}
        />
      ) : (
        <WordResults query={query} hideInDeck={hideInDeck} />
      )}
    </>
  );
}

type ResultProps = { query: string; hideInDeck: boolean };

// Sorts "Dutch words 501–1000" before "Dutch words 1001–1500": numbers by value, not letter by letter.
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type PackList = NonNullable<ReturnType<typeof usePacks>["data"]>;

const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The packs a search finds, in the order to show them, whatever their category: the filters beside
 * the list count these, and the list narrows them to the category chosen.
 * Packs whose name matches come first; the rest only match through the description. They start in
 * name order (the sort is stable), so each group stays in that order.
 */
function matchPacks(packs: PackList, query: string, hideInDeck: boolean): PackList {
  const words = searchWords(query);
  return [...packs]
    .sort((a, b) => byName.compare(a.name, b.name))
    .map((pack) => {
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
}

function PackResults({
  packs,
  category,
  query,
  hideInDeck,
  onShowAll,
}: ResultProps & { packs: ReturnType<typeof usePacks>; category: CategoryFilter; onShowAll: () => void }) {
  const words = searchWords(query);
  const matching = matchPacks(packs.data ?? [], query, hideInDeck);
  const shown = matching.filter((pack) => category === "all" || pack.category === category);

  return (
    <>
      {packs.isPending && <p className="status">Loading…</p>}
      {packs.isError && <p className="status error">Could not load packs. Please refresh.</p>}
      {packs.data?.length === 0 && <p className="empty">There are no packs yet.</p>}
      {packs.data && packs.data.length > 0 && shown.length === 0 && (
        words.length > 0 && category !== "all" && matching.length > 0 ? (
          // The category chosen has nothing for this search, but other categories do: point there
          // (the All filter flashes too) rather than offering to request a pack that may exist.
          <div className="empty empty-state">
            <SearchIcon />
            <p className="empty-title">
              No packs in <span className="category-name">{PACK_CATEGORY_LABELS[category]}</span> match “{query.trim()}”
            </p>
            <p>
              {matching.length} {matching.length === 1 ? "pack matches" : "packs match"} in other categories.
            </p>
            <button type="button" className="secondary" onClick={onShowAll}>
              Show results in all categories
            </button>
          </div>
        ) : words.length > 0 ? (
          <div className="empty empty-state">
            <SearchIcon />
            <p className="empty-title">No packs match “{query.trim()}”</p>
            <p>Try different words, or ask for the pack you were hoping to find.</p>
            <PackRequest key={query.trim()} query={query.trim()} />
          </div>
        ) : (
          <p className="empty">
            {hideInDeck ? "Every pack here is already in your deck." : "There are no packs in this category."}
          </p>
        )
      )}

      <ul className="pack-list">
        {shown.map((pack) => {
          const available = pack.availableCount ?? 0;
          const added = pack.addedCount ?? 0;
          return (
            <li key={pack.id} className="pack-card">
              <h2>
                <Link to={`/add-words/${pack.id}`}>{pack.name}</Link>
              </h2>
              {pack.description && <p className="muted">{pack.description}</p>}
              {available === 0 ? (
                <p className="muted">No words available yet.</p>
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
                      ` · ${pack.conceptCount - available} not available yet`}
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

function WordResults({ query, hideInDeck }: ResultProps) {
  const { direction } = useActiveLanguages();
  // Starts from the typed text, so a remembered search shows its results straight away.
  const [term, setTerm] = useState(query.trim());
  const found = useConceptSearch(term, direction, hideInDeck);
  const addConcept = useAddConcept();
  // The word being looked at as a card, if any.
  const [open, setOpen] = useState<{ conceptId: string; entries: EntryView[] } | null>(null);

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
                onOpen={() => setOpen({ conceptId: c.conceptId, entries: c.entries })}
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
      {open && <ConceptDialog conceptId={open.conceptId} entries={open.entries} onClose={() => setOpen(null)} />}
    </>
  );
}
