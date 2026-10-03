import { useEffect, useState } from "react";
import { Link } from "react-router";
import { DECK_SORT_DEFAULT_ORDER, DECK_SORTS, type DeckCardView, type DeckSort, type DirectionSummary } from "@flashcards/shared";
import { useDeckCards, useStats, type DeckStage } from "../api/hooks";
import { useAddMirror, useAddMirrors } from "../api/packs";
import { BusyLabel } from "../components/BusyLabel";
import { displayLemma, entriesFor } from "../components/entries";
import { sameDirection, shortDirection, useDeckFilter } from "../hooks/useDeckFilter";
import { isBoolean, isOneOf, isOneOfOrNull, isString, useRemembered } from "../hooks/useRemembered";
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

type RowProps = {
  card: DeckCardView;
  showDirection: boolean;
  adding: boolean;
  justAdded: boolean;
  disabled: boolean;
  onAddReverse: () => void;
};

function CardRow({ card, showDirection, adding, justAdded, disabled, onAddReverse }: RowProps) {
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
      <span className="card-actions">
        {justAdded ? (
          <span className="badge">Reverse added</span>
        ) : (
          !card.hasMirror && (
            <button
              className="secondary"
              onClick={onAddReverse}
              disabled={disabled}
              aria-busy={adding}
              aria-label={`Add reverse of ${front}`}
            >
              <BusyLabel busy={adding}>Add reverse</BusyLabel>
            </button>
          )
        )}
        <span className="card-status">
          <span className="status-line">
            <span className={`dot ${STATE_TONE[card.state]}`} aria-hidden="true" />
            {STATE_LABEL[card.state]}
          </span>
          <span className="muted">{[whenDue(card), extra].filter(Boolean).join(" · ")}</span>
        </span>
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

  const [missingOnly, setMissingOnly] = useRemembered("deck:missingOnly", false, isBoolean);
  const list = useDeckCards(filter.selected, stage, term, sort, order, missingOnly);
  const byDirection = directions ?? [];

  const addMirror = useAddMirror();
  const addMirrors = useAddMirrors();
  // A card you just mirrored stays in the list (marked "Reverse added") even if the
  // "missing reverse" filter would drop it, so the list doesn't move under the cursor.
  // `index` is where it goes back. Cleared when the view changes.
  const [recent, setRecent] = useState(
    new Map<string, { index: number; card: DeckCardView; done: boolean }>(),
  );
  const [bulkResult, setBulkResult] = useState<number | null>(null);
  const view = [filter.selected?.from, filter.selected?.to, stage, term, sort, order, missingOnly].join("|");
  useEffect(() => {
    setRecent(new Map());
    setBulkResult(null);
  }, [view]);

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
  const filtering = stage !== "all" || term !== "" || missingOnly;
  const { mirrorable } = list.data.pages[0]!;

  const rows = [...new Map(cards.map((c) => [c.id, c])).values()];
  [...recent.values()]
    .filter((r) => !rows.some((c) => c.id === r.card.id))
    .sort((x, y) => x.index - y.index)
    .forEach((r) => rows.splice(Math.min(r.index, rows.length), 0, r.card));

  const addReverse = (card: DeckCardView, index: number) => {
    setRecent((prev) => new Map(prev).set(card.id, { index, card, done: false }));
    addMirror.mutate(
      { cardId: card.id, conceptId: card.conceptId, fromLanguage: card.toLanguage, toLanguage: card.fromLanguage },
      {
        onSuccess: () =>
          setRecent((prev) => {
            const entry = prev.get(card.id);
            return entry ? new Map(prev).set(card.id, { ...entry, done: true }) : prev;
          }),
        onError: () =>
          setRecent((prev) => {
            const next = new Map(prev);
            next.delete(card.id);
            return next;
          }),
      },
    );
  };

  const addAllReverses = () => {
    setBulkResult(null);
    addMirrors.mutate(
      {
        ...(filter.selected ? { fromLanguage: filter.selected.from, toLanguage: filter.selected.to } : {}),
        ...(stage !== "all" ? { state: stage } : {}),
        ...(term ? { q: term } : {}),
      },
      { onSuccess: (r) => setBulkResult(r.added) },
    );
  };
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
            <div className="toggle">
              <button type="button" aria-pressed={missingOnly} onClick={() => setMissingOnly(!missingOnly)}>
                Missing reverse
              </button>
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

          {(mirrorable > 0 || bulkResult !== null) && (
            <div className="mirror-bar">
              {mirrorable > 0 && (
                <button
                  className="secondary"
                  onClick={addAllReverses}
                  disabled={addMirrors.isPending}
                  aria-busy={addMirrors.isPending}
                >
                  <BusyLabel busy={addMirrors.isPending}>
                    Add reverse for {mirrorable === 1 ? "1 card" : `all ${mirrorable} cards`} in this view
                  </BusyLabel>
                </button>
              )}
              <span className="muted" role="status">
                {addMirrors.isError
                  ? "Could not add the reverse cards. Please try again."
                  : bulkResult !== null
                    ? `Added ${bulkResult === 1 ? "1 reverse card" : `${bulkResult} reverse cards`}.`
                    : mirrorable > 0
                      ? "They join your new cards, introduced a few at a time."
                      : ""}
              </span>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="empty">{filtering ? "No cards match." : "No cards in this view."}</p>
          ) : (
            <ul className="concept-list">
              {rows.map((c, i) => (
                <CardRow
                  key={c.id}
                  card={c}
                  showDirection={!filter.selected && byDirection.length > 1}
                  adding={addMirror.isPending && addMirror.variables?.cardId === c.id}
                  justAdded={recent.get(c.id)?.done === true}
                  disabled={addMirror.isPending}
                  onAddReverse={() => addReverse(c, i)}
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
    </>
  );
}
