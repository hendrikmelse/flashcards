import { Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "../api/hooks";

export function RequireAuth() {
  const { data: user, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) return <p className="status">Loading…</p>;
  if (isError) {
    return <p className="status error">Could not reach the server. Try again shortly.</p>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

// Login and register are pointless once signed in.
export function PublicOnly() {
  const { data: user, isPending } = useMe();
  if (isPending) return <p className="status">Loading…</p>;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
