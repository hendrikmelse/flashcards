import { useEffect, useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { Link } from "react-router";
import { DECK_SORT_DEFAULT_ORDER, DECK_SORTS, type DeckCardView, type DeckSort, type DirectionSummary } from "@flashcards/shared";
import { useDeckCards, useStats, type DeckStage } from "../api/hooks";
import { CardDialog } from "../components/CardDialog";
import { PageHeadActions } from "../components/PageHeadActions";
import { useLanguages } from "../api/packs";
import { displayLemma, entriesFor, langAttrs } from "../components/entries";
import { sameDirection, shortDirection, useDeckFilter } from "../hooks/useDeckFilter";
import { isOneOf, isOneOfOrNull, isString, useRemembered } from "../hooks/useRemembered";
import { formatUntil } from "../lib/relativeTime";

const STAGES: { stage: DeckStage; label: string }[] = [
  { stage: "all", label: "All" },
  { stage: "new", label: "New" },
  { stage: "learning", label: "Learning" },
  { stage: "review", label: "Review" },
];

const STATE_LABEL = { new: "New", learning: "Learning", relearning: "Relearning", review: "Review" } as const;
// Relearning shares the learning color.
const STATE_TONE = { new: "new", learning: "learning", relearning: "learning", review: "review" } as const;

const SORT_LABEL: Record<DeckSort, string> = {
  added: "Recently added",
  due: "Next due",
  status: "Status",
  alpha: "Alphabetical",
};

// What each direction of each sort means, for the reverse button.
const ORDER_LABEL: Record<DeckSort, Record<"asc" | "desc", string>> = {
  added: { desc: "Newest first", asc: "Oldest first" },
  due: { asc: "Soonest first", desc: "Latest first" },
  status: { asc: "New to review", desc: "Review to new" },
  alpha: { asc: "A to Z", desc: "Z to A" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function whenDue(card: DeckCardView): string {
  if (card.state === "new") return "Not studied yet";
  const now = new Date().toISOString();
  return Date.parse(card.dueAt) <= Date.parse(now) ? "Due now" : `Due ${formatUntil(card.dueAt, now)}`;
}

type RowProps = {
  card: DeckCardView;
  onOpen: () => void;
  showDirection: boolean;
};

function CardRow({ card, onOpen, showDirection }: RowProps) {
  const front = entriesFor(card.front, card.fromLanguage).map(displayLemma).join(", ");
  const back = entriesFor(card.back, card.toLanguage).map(displayLemma).join(", ");
  return (
    <li className="deck-row card-row">
      <button
        type="button"
        className="row-open"
        aria-haspopup="dialog"
        aria-label={`Open card: ${front}`}
        onClick={onOpen}
      >
        <span className="pair">
          <span className="prompt" {...langAttrs(card.fromLanguage)}>
            {front || "—"}
          </span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
          <span className="answer" {...langAttrs(card.toLanguage)}>
            {back || "—"}
          </span>
          {showDirection && (
            <span className="direction-tag">
              {shortDirection({ fromLanguage: card.fromLanguage, toLanguage: card.toLanguage })}
            </span>
          )}
        </span>
      </button>
      <span className="card-status">
        <span className="status-line">
          <span className={`dot ${STATE_TONE[card.state]}`} aria-hidden="true" />
          {STATE_LABEL[card.state]}
        </span>
        <span className="muted">{whenDue(card)}</span>
      </span>
    </li>
  );
}

export function DeckPage() {
  usePageTitle("My deck");
  const stats = useStats();
  const languages = useLanguages();
  // Keep the last known directions so the toggle doesn't vanish while stats refetch.
  const [directions, setDirections] = useState<DirectionSummary[] | undefined>();
  if (stats.data && stats.data.directions !== directions) setDirections(stats.data.directions);
  const filter = useDeckFilter(directions);

  // The filters are remembered, so leaving the page and coming back finds them as they were.
  const [stage, setStage] = useRemembered<DeckStage>("deck:stage", "all", isOneOf("all", "new", "learning", "review"));
  const [query, setQuery] = useRemembered("deck:query", "", isString);
  const [term, setTerm] = useState(query.trim());
  // Search once typing pauses.
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Until the user picks a sort, studied stages read best soonest-due first and the rest newest first.
  const [sortChoice, setSortChoice] = useRemembered<DeckSort | null>("deck:sort", null, isOneOfOrNull(...DECK_SORTS));
  const [orderChoice, setOrderChoice] = useRemembered<"asc" | "desc" | null>(
    "deck:order",
    null,
    isOneOfOrNull("asc", "desc"),
  );
  const sort = sortChoice ?? (stage === "learning" || stage === "review" ? "due" : "added");
  const order = orderChoice ?? DECK_SORT_DEFAULT_ORDER[sort];

  const list = useDeckCards(filter.selected, stage, term, sort, order);
  const byDirection = directions ?? [];

  // The card being looked at in full, if any.
  const [openCard, setOpenCard] = useState<DeckCardView | null>(null);

  if (list.isPending) return <p className="status">Loading…</p>;
  if (list.isError) return <p className="status error">Could not load your deck. Please refresh.</p>;

  const cards = list.data.pages.flatMap((p) => p.cards);
  const { summary } = list.data.pages[0]!;
  const counts: Record<DeckStage, number> = {
    all: summary.total,
    new: summary.new,
    learning: summary.learning + summary.relearning,
    review: summary.review,
  };
  const filtering = stage !== "all" || term !== "";

  // The headline is the whole deck, whatever direction is selected below. Until the
  // per-direction stats arrive, a selected direction has no total to show yet.
  const deckTotal = directions
    ? directions.reduce((sum, d) => sum + d.total, 0)
    : filter.selected
      ? null
      : summary.total;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My deck</h1>
          {deckTotal !== null && <p className="lead">{plural(deckTotal, "card")}</p>}
        </div>
        <PageHeadActions>
          <Link to="/" className="button secondary">
            Go to dashboard
          </Link>
          <Link to="/add-words" className="button secondary">
            Add more words
          </Link>
        </PageHeadActions>
      </div>

      {summary.total === 0 ? (
        <div className="hero">
          <p className="hero-title">Your deck is empty</p>
          <p className="muted">Add a pack or a few words and they will show up here.</p>
          <Link to="/add-words" className="button primary">
            Browse words
          </Link>
        </div>
      ) : (
        <>
          <input
            type="search"
            className="search"
            placeholder="Search your deck"
            aria-label="Search your deck"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="search-options">
            {byDirection.length > 1 && (
              <div className="toggle" role="group" aria-label="Deck view">
                {byDirection.map((d) => (
                  <button
                    key={`${d.fromLanguage}-${d.toLanguage}`}
                    type="button"
                    aria-pressed={sameDirection(d, filter.selected)}
                    onClick={() => filter.select({ from: d.fromLanguage, to: d.toLanguage })}
                  >
                    {shortDirection(d)}
                  </button>
                ))}
                <button type="button" aria-pressed={!filter.selected} onClick={() => filter.select(null)}>
                  {byDirection.length === 2 ? "Both" : "All"}
                </button>
              </div>
            )}
            <div className="toggle" role="group" aria-label="Status">
              {STAGES.map(({ stage: s, label }) => (
                <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(s)}>
                  {label}
                  <span className="count">{counts[s]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sort-row">
            <label className="sort-by">
              Sort by
              <select
                className="dropdown"
                value={sort}
                onChange={(e) => {
                  setSortChoice(e.target.value as DeckSort);
                  setOrderChoice(null);
                }}
              >
                {DECK_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="toggle">
              <button
                type="button"
                aria-pressed={false}
                aria-label={`Reverse order, currently ${ORDER_LABEL[sort][order]}`}
                onClick={() => setOrderChoice(order === "asc" ? "desc" : "asc")}
              >
                {order === "asc" ? "↑" : "↓"} {ORDER_LABEL[sort][order]}
              </button>
            </div>
          </div>

          {cards.length === 0 ? (
            <p className="empty">{filtering ? "No cards match." : "No cards in this view."}</p>
          ) : (
            <ul className="concept-list">
              {cards.map((c) => (
                <CardRow
                  key={c.id}
                  card={c}
                  onOpen={() => setOpenCard(c)}
                  showDirection={!filter.selected && byDirection.length > 1}
                />
              ))}
            </ul>
          )}

          {list.hasNextPage && (
            <button
              className="secondary more"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              aria-busy={list.isFetchingNextPage}
            >
              {/* The label stays (hidden) so the button keeps its width under the spinner. */}
              <span style={list.isFetchingNextPage ? { visibility: "hidden" } : undefined}>Load more cards</span>
              {list.isFetchingNextPage && <span className="spinner" aria-hidden="true" />}
            </button>
          )}
        </>
      )}

      {openCard && <CardDialog card={openCard} languages={languages.data ?? []} onClose={() => setOpenCard(null)} />}
    </>
  );
}
