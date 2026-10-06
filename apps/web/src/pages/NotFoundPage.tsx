import { Link, useLocation } from "react-router";
import { useMe } from "../api/hooks";
import { usePageTitle } from "../hooks/usePageTitle";

// Shown for an address that leads nowhere (and for the admin pages to anyone who is not an admin).
// Someone signed in who landed here by following a link of ours can report it as a bug: the link
// opens the bug form on the reports page with the address filled in.
export function NotFoundPage() {
  usePageTitle("Page not found");
  // Whether someone is signed in decides the links below, so they wait for it rather than showing
  // the signed-out ones for a moment.
  const { data: user, isPending } = useMe();
  const { pathname } = useLocation();
  const report = `/reports?${new URLSearchParams({ report: "bug", at: pathname.slice(0, 200) })}`;

  return (
    <main className="not-found">
      <p className="not-found-code" aria-hidden="true">
        404
      </p>
      <h1>Page not found</h1>
      <p className="muted">
        There is nothing at this address. It may have moved, or there may be a typo in it.
      </p>
      {!isPending && (
        <div className="not-found-actions">
          <Link to={user ? "/" : "/login"} className="button primary">
            {user ? "Back to the dashboard" : "Log in"}
          </Link>
        </div>
      )}
      {user && (
        <p className="not-found-report">
          Did a link in the app bring you here? <Link to={report}>Report it as a bug</Link>
        </p>
      )}
    </main>
  );
}
