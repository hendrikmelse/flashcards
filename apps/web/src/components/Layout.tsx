import { NavLink, Outlet } from "react-router";
import { useLogout, useMe } from "../api/hooks";

export function Layout() {
  const { data: user } = useMe();
  const logout = useLogout();

  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand">
          Flashcards
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/study">Study</NavLink>
          <NavLink to="/packs">Packs</NavLink>
        </nav>
        <div className="account">
          <span className="email">{user?.email}</span>
          <button className="link" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Log out
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
