import { Link } from "react-router";
import { useAdminStats } from "../api/hooks";
import { usePageTitle } from "../hooks/usePageTitle";

const number = new Intl.NumberFormat();

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{number.format(value)}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint muted">{hint}</div>}
    </div>
  );
}

// For admin accounts only (see RequireAdmin and the /admin API routes, which check again on the
// server): how the app is being used, then the reports waiting for an answer.
export function AdminDashboardPage() {
  usePageTitle("Admin dashboard");
  const stats = useAdminStats();

  return (
    <>
      <div className="page-head">
        <h1>Admin dashboard</h1>
      </div>

      {stats.isPending && <p className="status">Loading…</p>}
      {stats.isError && <p className="status error">Could not load the statistics. Please refresh.</p>}

      {stats.data && (
        <>
          <section aria-label="Overview">
            <h2 className="section-title">Overview</h2>
            <div className="stats">
              <Stat label="Accounts" value={stats.data.accounts} />
              <Stat
                label="Active accounts"
                value={stats.data.activeAccounts}
                hint="Studied a card in the last 7 days"
              />
              <Stat label="Reviews, all time" value={stats.data.reviews.total} />
              <Stat label="Reviews, last 7 days" value={stats.data.reviews.lastWeek} />
            </div>
          </section>

          <section aria-label="Reports">
            <div className="section-head">
              <div className="section-head-title">
                <h2 className="section-title">Reports</h2>
              </div>
              <Link to="/admin/reports" className="button primary">
                Manage reports
              </Link>
            </div>
            <div className="stats">
              <Stat label="Open reports" value={stats.data.openReports.total} />
              <Stat label="Word problems" value={stats.data.openReports.byKind.card} hint="Open" />
              <Stat label="Bugs" value={stats.data.openReports.byKind.bug} hint="Open" />
              <Stat label="Suggestions" value={stats.data.openReports.byKind.suggestion} hint="Open" />
              <Stat label="Pack requests" value={stats.data.openReports.byKind.pack_request} hint="Open" />
            </div>
          </section>
        </>
      )}
    </>
  );
}
