import { useEffect, useState } from "react";
import { Link } from "react-router";
import { DECK_SORT_DEFAULT_ORDER, DECK_SORTS, type DeckCardView, type DeckSort, type DirectionSummary } from "@flashcards/shared";
import { useDeckCards, useStats, type DeckStage } from "../api/hooks";
import { displayLemma, entriesFor } from "../components/entries";
import { sameDirection, shortDirection, useDeckFilter } from "../hooks/useDeckFilter";
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
  interval: "Interval",
  lapses: "Lapses",
  alpha: "Alphabetical",
};

// What each direction of each sort means, for the reverse button.
const ORDER_LABEL: Record<DeckSort, Record<"asc" | "desc", string>> = {
  added: { desc: "Newest first", asc: "Oldest first" },
  due: { asc: "Soonest first", desc: "Latest first" },
  status: { asc: "New to review", desc: "Review to new" },
  interval: { desc: "Longest first", asc: "Shortest first" },
  lapses: { desc: "Most first", asc: "Fewest first" },
  alpha: { asc: "A to Z", desc: "Z to A" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function whenDue(card: DeckCardView): string {
  if (card.state === "new") return "Not studied yet";
  const now = new Date().toISOString();
  return Date.parse(card.dueAt) <= Date.parse(now) ? "Due now" : `Due ${formatUntil(card.dueAt, now)}`;
}

function details(card: DeckCardView): string | null {
  if (card.state === "new") return null;
  const parts = [];
  if (card.intervalDays >= 1) parts.push(`${plural(Math.round(card.intervalDays), "day")} interval`);
  if (card.lapses > 0) parts.push(plural(card.lapses, "lapse"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function CardRow({ card, showDirection }: { card: DeckCardView; showDirection: boolean }) {
  const front = entriesFor(card.front, card.fromLanguage).map(displayLemma).join(", ");
  const back = entriesFor(card.back, card.toLanguage).map(displayLemma).join(", ");
  const extra = details(card);
  return (
    <li>
      <span className="pair">
        <span className="prompt">{front || "—"}</span>
        <span className="arrow" aria-hidden="true">
          →
        </span>
        <span className="answer">{back || "—"}</span>
        {showDirection && (
          <span className="direction-tag">
            {shortDirection({ fromLanguage: card.fromLanguage, toLanguage: card.toLanguage })}
          </span>
        )}
      </span>
      <span className="card-status">
        <span className="status-line">
          <span className={`dot ${STATE_TONE[card.state]}`} aria-hidden="true" />
          {STATE_LABEL[card.state]}
        </span>
        <span className="muted">{[whenDue(card), extra].filter(Boolean).join(" · ")}</span>
      </span>
    </li>
  );
}

export function DeckPage() {
  const stats = useStats();
  // Keep the last known directions so the toggle doesn't vanish while stats refetch.
  const [directions, setDirections] = useState<DirectionSummary[] | undefined>();
  if (stats.data && stats.data.directions !== directions) setDirections(stats.data.directions);
  const filter = useDeckFilter(directions);

  const [stage, setStage] = useState<DeckStage>("all");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  // Search once typing pauses.
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Until the user picks a sort, studied stages read best soonest-due first and the rest newest first.
  const [sortChoice, setSortChoice] = useState<DeckSort | null>(null);
  const [orderChoice, setOrderChoice] = useState<"asc" | "desc" | null>(null);
  const sort = sortChoice ?? (stage === "learning" || stage === "review" ? "due" : "added");
  const order = orderChoice ?? DECK_SORT_DEFAULT_ORDER[sort];

  const list = useDeckCards(filter.selected, stage, term, sort, order);
  const byDirection = directions ?? [];

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
      <p>
        <Link to="/">← Dashboard</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>My deck</h1>
          {deckTotal !== null && <p className="lead">{plural(deckTotal, "card")}</p>}
        </div>
        {summary.total > 0 && (
          <Link to="/packs" className="button secondary">
            Add more words
          </Link>
        )}
      </div>

      {summary.total === 0 ? (
        <div className="hero">
          <p className="hero-title">Your deck is empty</p>
          <p className="muted">Add a pack or a few words and they will show up here.</p>
          <Link to="/packs" className="button primary">
            Browse packs
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
                <CardRow key={c.id} card={c} showDirection={!filter.selected && byDirection.length > 1} />
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
    </>
  );
}
