import { useState } from "react";
import { Link } from "react-router";
import type { DirectionSummary } from "@flashcards/shared";
import { useDashboard } from "../api/hooks";
import { shortDirection, sameDirection, useDeckFilter } from "../hooks/useDeckFilter";
import { formatUntil } from "../lib/relativeTime";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "new" | "learning" | "review" }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">
        {tone && <span className={`dot ${tone}`} aria-hidden="true" />}
        {label}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// How a set of cards splits into new / learning / review, as one stacked bar.
function DeckBar({ counts }: { counts: { new: number; learning: number; review: number } }) {
  const total = counts.new + counts.learning + counts.review;
  const parts = (["review", "learning", "new"] as const).filter((k) => counts[k] > 0);
  return (
    <div
      className="deck-bar"
      role="img"
      aria-label={`${counts.review} review, ${counts.learning} learning, ${counts.new} new, of ${total} cards`}
    >
      {parts.map((k) => (
        <span key={k} className={`seg ${k}`} style={{ flexGrow: counts[k] }} />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [directions, setDirections] = useState<DirectionSummary[] | undefined>();
  const filter = useDeckFilter(directions);
  const { deck, deckAll, study, stats } = useDashboard(filter.selected);
  // Keep the last known directions so the filter doesn't vanish while stats refetch.
  if (stats.data && stats.data.directions !== directions) setDirections(stats.data.directions);

  if (deckAll.isPending || study.isPending) return <p className="status">Loading…</p>;
  if (deckAll.isError || study.isError) {
    return <p className="status error">Could not load your dashboard. Please refresh.</p>;
  }

  // The "ready to study" card is about the whole deck. Only "Your deck" below follows the toggle.
  const { counts } = study.data;
  const dueNow = counts.learning + counts.review;
  const ready = dueNow + counts.new;
  const byDirection = stats.data?.directions ?? [];
  const nextDueAt = stats.data?.nextDueAt ?? null;
  // One button per direction with something ready, but only when that is a real choice.
  const readyIn = (d: DirectionSummary) => d.ready.learning + d.ready.review + d.ready.new;
  const studyable = byDirection.filter((d) => readyIn(d) > 0);

  return (
    <>
      <h1>Dashboard</h1>

      {deckAll.data.summary.total === 0 ? (
        <div className="hero">
          <p className="hero-title">Your deck is empty</p>
          <p className="muted">
            Add a pack or a few words and what to study next will show up here.
          </p>
          <Link to="/packs" className="button primary">
            Browse packs
          </Link>
        </div>
      ) : (
        <>
          <section className="hero" aria-label="Ready to study">
            {ready > 0 ? (
              <>
                <p className="hero-title">{plural(ready, "card")} ready to study</p>
                <p className="muted">
                  {dueNow > 0 && `${dueNow} due now`}
                  {dueNow > 0 && counts.new > 0 && " · "}
                  {counts.new > 0 && `${counts.new} new`}
                </p>
              </>
            ) : (
              <>
                <p className="hero-title">You’re all caught up</p>
                <p className="muted">Nothing to study right now. Come back later or add more words.</p>
                {nextDueAt && stats.data && (
                  <p className="muted">Next card {formatUntil(nextDueAt, stats.data.now)}.</p>
                )}
              </>
            )}
            {ready > 0 && (
              <div className="hero-actions">
                <Link to="/study" className="button primary">
                  Start studying
                </Link>
                {studyable.length > 1 &&
                  studyable.map((d) => (
                    <Link
                      key={`${d.fromLanguage}-${d.toLanguage}`}
                      to={`/study?from=${encodeURIComponent(d.fromLanguage)}&to=${encodeURIComponent(d.toLanguage)}`}
                      className="button secondary"
                      aria-label={`Study ${shortDirection(d)}, ${readyIn(d)} ready`}
                    >
                      {shortDirection(d)}
                      <span className="count">{readyIn(d)}</span>
                    </Link>
                  ))}
              </div>
            )}
          </section>

          <h2 className="section-title">Your deck</h2>
          {byDirection.length > 1 && (
            <div className="toggle deck-view" role="group" aria-label="Deck view">
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
          {deck.data ? (
            <>
              <DeckBar counts={{ new: deck.data.summary.new, learning: deck.data.summary.learning + deck.data.summary.relearning, review: deck.data.summary.review }} />
              <section aria-label="Progress" className="stats secondary">
                <Stat label="Review" value={deck.data.summary.review} tone="review" />
                <Stat label="Learning" value={deck.data.summary.learning + deck.data.summary.relearning} tone="learning" />
                <Stat label="New" value={deck.data.summary.new} tone="new" />
              </section>
            </>
          ) : (
            <p className="status">{deck.isError ? "Could not load this view." : "Loading…"}</p>
          )}
          <div className="deck-actions">
            <Link to="/deck" className="button secondary">
              View deck
            </Link>
            <Link to="/packs" className="button secondary">
              Add more words
            </Link>
          </div>
        </>
      )}

      <p className="page-footer">
        This app uses <Link to="/how-it-works">FSRS</Link> for review scheduling
      </p>
    </>
  );
}
