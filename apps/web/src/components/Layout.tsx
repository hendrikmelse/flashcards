import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useLogout, useMe } from "../api/hooks";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
import { GearIcon, LogOutIcon } from "./icons";
import { SplitFlag } from "./LanguageFlag";
import { VerifyEmailNotice } from "./VerifyEmailNotice";

export function Layout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const { direction } = useActiveLanguages();
  // The settings button toggles: on the settings page it goes back to the dashboard.
  const { pathname } = useLocation();
  const onSettings = pathname === "/settings";
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // A page change in a single-page app is silent to a screen reader and leaves keyboard focus on
  // the link that was used. Move focus to the content after each navigation (not the first load),
  // unless the new page already put it somewhere useful, like the study card's button.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = main.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [pathname]);

  function skipToContent(e: React.MouseEvent) {
    e.preventDefault();
    main.current?.focus();
  }

  return (
    <>
      <a href="#main" className="skip-link" onClick={skipToContent}>
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand">
          Flashcards
        </NavLink>
        {/* Decoration only: the language pair being learned. */}
        <SplitFlag left={direction.from} right={direction.to} />
        <nav aria-label="Main">
          <NavLink to="/" end data-label="Dashboard">
            Dashboard
          </NavLink>
          <NavLink to="/study" data-label="Study">
            Study
          </NavLink>
          <NavLink to="/deck" data-label="My deck">
            My deck
          </NavLink>
          <NavLink to="/add-words" data-label="Add words">
            Add words
          </NavLink>
        </nav>
        <div className="account">
          <span className="email">{user?.name ? `Hi, ${user.name}` : user?.email}</span>
          <NavLink to={onSettings ? "/" : "/settings"} className="icon-button" aria-label="Settings" data-tooltip="Settings">
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
      <VerifyEmailNotice />
      <main className="page" id="main" tabIndex={-1} ref={main}>
        {/* A new page for each direction being learned, so nothing of the last one (a study session,
            an open card, search results) is left over when it changes. */}
        <Outlet key={`${direction.from}>${direction.to}`} />
      </main>
    </>
  );
}
