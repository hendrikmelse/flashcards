import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  EARLY_START_WINDOW_MS,
  type DirectionSummary,
  type StudyCountsResponse,
} from "@flashcards/shared";
import { useDashboard } from "../api/hooks";
import { usePacks } from "../api/packs";
import { formatClock, useCountdown } from "../hooks/useCountdown";
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

// Nothing is ready, but a session may be on its way: cards you were just learning
// come back once the gap since your last session has passed. Counts down to then,
// and in the last few minutes offers to start the next session early.
function NothingToStudy({
  study,
  fetchedAt,
  nextDueAt,
  serverNow,
}: {
  study: StudyCountsResponse;
  fetchedAt: number;
  nextDueAt: string | null;
  serverNow: string | null;
}) {
  const qc = useQueryClient();
  const next = study.nextSession;
  // The server's clock tells how long is left; the countdown then runs on this device's clock.
  const deadline = next ? fetchedAt + (Date.parse(next.at) - Date.parse(study.now)) : null;
  const left = useCountdown(deadline);
  const over = left === 0;

  // When the wait is over, look again: the cards are ready.
  useEffect(() => {
    if (!over) return;
    for (const key of ["study", "stats", "deck"]) qc.invalidateQueries({ queryKey: [key] });
  }, [over, qc]);

  const early = left !== null && left > 0 && left <= EARLY_START_WINDOW_MS;
  return (
    <>
      <p className="hero-title">No cards to study right now</p>
      {next && left !== null ? (
        <p className="muted">
          {plural(next.count, "card")} will be ready in <strong>{formatClock(left)}</strong>.
        </p>
      ) : (
        nextDueAt && serverNow && <p className="muted">Next card {formatUntil(nextDueAt, serverNow)}.</p>
      )}
      {study.tomorrow > 0 && (
        <p className="muted">{plural(study.tomorrow, "card")} will be ready tomorrow.</p>
      )}
      {!next && !(nextDueAt && serverNow) && study.tomorrow === 0 && (
        <p className="muted">Come back later or add more words.</p>
      )}
      {early && (
        <div className="hero-actions">
          <Link to="/study?early=1" className="button primary">
            Start next session now
          </Link>
        </div>
      )}
    </>
  );
}

// For someone with an empty deck: where to start, and how the app works, in two steps.
function GettingStarted() {
  return (
    <section className="getting-started" aria-label="Getting started">
      <h2 className="section-title">How it works</h2>
      <ol className="steps">
        <li>
          <strong>Add some words.</strong> Packs are ready-made lists, from everyday starter words
          to the most common 5,000. Add a whole pack, or look up single words.
        </li>
        <li>
          <strong>Study a little each day.</strong> Reveal the answer, then say how it went: Again,
          Hard, Good or Easy. The app uses your answers to bring each word back just before you
          would forget it.
        </li>
      </ol>
      <p className="getting-started-more">
        <Link to="/how-it-works">Learn more about scheduling</Link>
      </p>
    </section>
  );
}

export function DashboardPage() {
  const [directions, setDirections] = useState<DirectionSummary[] | undefined>();
  const filter = useDeckFilter(directions);
  const { deck, deckAll, study, stats } = useDashboard(filter.selected);
  // The starter pack is where a new person is pointed first.
  const packs = usePacks({ from: "en", to: "nl" });
  const starter = packs.data?.find((p) => p.slug === "starter");
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
      <div className="page-head">
        <h1>Dashboard</h1>
        {deckAll.data.summary.total > 0 && (
          <div className="page-head-actions">
            <Link to="/deck" className="button secondary">
              View deck
            </Link>
            <Link to="/add-words" className="button secondary">
              Add more words
            </Link>
          </div>
        )}
      </div>

      {deckAll.data.summary.total === 0 ? (
        <>
          <div className="hero">
            <p className="hero-title">Your deck is empty</p>
            <p className="muted">
              Add a pack or a few words and what to study next will show up here.
            </p>
            <div className="hero-actions">
              {starter && (
                <Link to={`/add-words/${starter.id}`} className="button primary">
                  Start with the starter words
                </Link>
              )}
              <Link to="/add-words" className={`button ${starter ? "secondary" : "primary"}`}>
                Browse words
              </Link>
            </div>
          </div>
          <GettingStarted />
        </>
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
              <NothingToStudy
                study={study.data}
                fetchedAt={study.dataUpdatedAt}
                nextDueAt={nextDueAt}
                serverNow={stats.data?.now ?? null}
              />
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
        </>
      )}

      <p className="page-footer">
        This app uses <Link to="/how-it-works">FSRS</Link> for review scheduling
      </p>
    </>
  );
}
