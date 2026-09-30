import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="auth">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </main>
  );
}
