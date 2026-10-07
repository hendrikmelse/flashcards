import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useLogout, useMe } from "../api/hooks";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
import { useScrollCues } from "../hooks/useScrollCues";
import { FlagIcon, GearIcon, LogOutIcon, ShieldIcon } from "./icons";
import { SplitFlag } from "./LanguageFlag";
import { VerifyEmailNotice } from "./VerifyEmailNotice";

export function Layout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const { direction } = useActiveLanguages();
  // The filter blocks on the page that scroll sideways on a phone show it, and keep what is selected in view.
  useScrollCues();
  // The settings, reports, and admin buttons toggle: on their own page they go back to the dashboard.
  // (On a page inside the admin area, the admin button goes up to the admin dashboard first.)
  const { pathname } = useLocation();
  const onSettings = pathname === "/settings";
  const onReports = pathname === "/reports";
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdmin = user?.role === "admin";
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
          <NavLink to={onReports ? "/" : "/reports"} className={`icon-button${onReports ? " active" : ""}`} aria-label="Reports" data-tooltip="Reports">
            <FlagIcon />
          </NavLink>
          {/* Only admin accounts have this button; the server refuses everyone else anyway. */}
          {isAdmin && (
            <NavLink to={pathname === "/admin" ? "/" : "/admin"} className={`icon-button${onAdmin ? " active" : ""}`} aria-label="Admin dashboard" data-tooltip="Admin dashboard">
              <ShieldIcon />
            </NavLink>
          )}
          <NavLink to={onSettings ? "/" : "/settings"} className={`icon-button${onSettings ? " active" : ""}`} aria-label="Settings" data-tooltip="Settings">
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
