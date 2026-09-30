import { Link } from "react-router";
import { useDashboard } from "../api/hooks";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function DashboardPage() {
  const { deck, study } = useDashboard();

  if (deck.isPending || study.isPending) return <p className="status">Loading…</p>;
  if (deck.isError || study.isError) {
    return <p className="status error">Could not load your dashboard. Please refresh.</p>;
  }

  const { summary } = deck.data;
  const { counts } = study.data;
  const dueNow = counts.learning + counts.review;

  return (
    <>
      <h1>Dashboard</h1>
      {summary.total === 0 ? (
        <p className="empty">
          Your deck is empty. <Link to="/packs">Browse packs</Link> and add some words, and what to
          study next will show up here.
        </p>
      ) : (
        <>
          {dueNow + counts.new > 0 ? (
            <p>
              <Link to="/study" className="button primary">
                Start studying
              </Link>
            </p>
          ) : (
            <p className="muted">Nothing to study right now. Come back later or add more words.</p>
          )}
          <section aria-label="Today" className="stats">
            <Stat label="Due now" value={dueNow} />
            <Stat label="New available today" value={counts.new} />
            <Stat label="Cards in deck" value={summary.total} />
          </section>
          <section aria-label="Progress" className="stats secondary">
            <Stat label="New" value={summary.new} />
            <Stat label="Learning" value={summary.learning + summary.relearning} />
            <Stat label="Review" value={summary.review} />
          </section>
        </>
      )}
    </>
  );
}
