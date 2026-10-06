import { Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "../api/hooks";
import { NotFoundPage } from "../pages/NotFoundPage";

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

// The admin pages are for admin accounts. To anyone else they do not exist: the address shows the
// page not found page, as it would for any address that leads nowhere, without redirecting.
// (Sits inside RequireAuth, so the user is known by now.)
export function RequireAdmin() {
  const { data: user } = useMe();
  if (user?.role !== "admin") return <NotFoundPage />;
  return <Outlet />;
}
