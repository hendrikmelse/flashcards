import { Link } from "react-router";
import { usePageTitle } from "../hooks/usePageTitle";
import type { StudyCountsResponse } from "@flashcards/shared";
import { useDashboard } from "../api/hooks";
import { usePacks } from "../api/packs";
import { PageHeadActions } from "../components/PageHeadActions";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
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

// Nothing is ready: say when the next card comes due, and what tomorrow will bring.
function NothingToStudy({
  study,
  nextDueAt,
  serverNow,
}: {
  study: StudyCountsResponse;
  nextDueAt: string | null;
  serverNow: string | null;
}) {
  return (
    <>
      <p className="hero-title">No cards to study right now</p>
      {nextDueAt && serverNow && <p className="muted">Next card {formatUntil(nextDueAt, serverNow)}.</p>}
      {study.tomorrow > 0 && (
        <p className="muted">{plural(study.tomorrow, "card")} will be ready tomorrow.</p>
      )}
      {!(nextDueAt && serverNow) && study.tomorrow === 0 && (
        <p className="muted">Come back later or add more words.</p>
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
          Hard, Good, or Easy. The app uses your answers to bring each word back just before you
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
  usePageTitle("Dashboard");
  const { deck, study, stats } = useDashboard();
  // The starter pack is where a new person is pointed first.
  const packs = usePacks(useActiveLanguages().direction);
  const starter = packs.data?.find((p) => p.slug === "starter");

  if (deck.isPending || study.isPending) return <p className="status">Loading…</p>;
  if (deck.isError || study.isError) {
    return <p className="status error">Could not load your dashboard. Please refresh.</p>;
  }

  // The "ready to study" card is about the whole deck. Only "Your deck" below follows the toggle.
  const { counts } = study.data;
  const dueNow = counts.learning + counts.review;
  const ready = dueNow + counts.new;
  const nextDueAt = stats.data?.nextDueAt ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <PageHeadActions>
          <Link to="/deck" className="button secondary">
            View deck
          </Link>
          <Link to="/add-words" className="button secondary">
            Add more words
          </Link>
        </PageHeadActions>
      </div>

      {deck.data.summary.total === 0 ? (
        <>
          <div className="hero hero-empty">
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
                  {dueNow > 0 && `${dueNow} due for review`}
                  {dueNow > 0 && counts.new > 0 && " · "}
                  {counts.new > 0 && `${counts.new} new`}
                </p>
              </>
            ) : (
              <NothingToStudy
                study={study.data}
                nextDueAt={nextDueAt}
                serverNow={stats.data?.now ?? null}
              />
            )}
          </section>

          {/* Only worth saying when the limit is why there is nothing to study: with cards due, there is. */}
          {study.data.newLimitReached && ready === 0 && (
            <p className="muted limit-note">
              No new cards are available to study today because you have reached your daily new card limit.
              <br />
              You can change the limit in <Link to="/settings?tab=study">Settings</Link>.
            </p>
          )}

          <div className="section-head">
            <div className="section-head-title">
              <h2 className="section-title">Your deck</h2>
              <span className="muted">{plural(deck.data.summary.total, "card")}</span>
            </div>
            {/* On a phone the page's own buttons are hidden, so the deck is one tap away from here. */}
            <Link to="/deck" className="button secondary section-head-deck">
              View deck
            </Link>
          </div>
          <DeckBar counts={{ new: deck.data.summary.new, learning: deck.data.summary.learning + deck.data.summary.relearning, review: deck.data.summary.review }} />
          <section aria-label="Progress" className="stats secondary">
            <Stat label="Review" value={deck.data.summary.review} tone="review" />
            <Stat label="Learning" value={deck.data.summary.learning + deck.data.summary.relearning} tone="learning" />
            <Stat label="New" value={deck.data.summary.new} tone="new" />
          </section>
        </>
      )}

      <p className="page-footer">
        This app uses <Link to="/how-it-works">FSRS</Link> for review scheduling
      </p>
    </>
  );
}
