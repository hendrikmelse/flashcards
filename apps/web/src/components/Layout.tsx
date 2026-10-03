import { NavLink, Outlet } from "react-router";
import { useLogout, useMe } from "../api/hooks";
import { GearIcon, LogOutIcon } from "./icons";

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
          <NavLink to="/deck">My deck</NavLink>
          <NavLink to="/add-words">Add words</NavLink>
        </nav>
        <div className="account">
          <span className="email">{user?.name ? `Hi, ${user.name}` : user?.email}</span>
          <NavLink to="/settings" className="icon-button" aria-label="Settings" data-tooltip="Settings">
            <GearIcon />
          </NavLink>
          <button
            type="button"
            className="icon-button"
            aria-label="Log out"
            data-tooltip="Log out"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOutIcon />
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
