import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

beforeEach(() => installMockApi());
afterEach(() => vi.unstubAllGlobals());

describe("auth flow", () => {
  it("redirects anonymous visitors to the login page", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("logs in and lands on the dashboard", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your deck" })).toBeInTheDocument();
  });

  it("shows an error for wrong credentials and stays on the form", async () => {
    mock.handlers["POST /auth/login"] = () => json(401, { error: "Invalid email or password" });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("validates on the client before calling the API", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(mock.calls).not.toContain("POST /auth/register");
  });

  it("registers a new account", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("explains when the email is already registered", async () => {
    mock.handlers["POST /auth/register"] = () => json(409, { error: "Email already registered" });
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
  });

  it("explains when sign-ups are invite-only", async () => {
    mock.handlers["POST /auth/register"] = () => json(403, { error: "Registration is closed" });
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "eve@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invite-only");
  });

  it("sends signed-in users away from the login page", async () => {
    mock.loggedIn = true;
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("logs out back to the login page", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("shows how the deck splits into review, learning and new", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const progress = await screen.findByRole("region", { name: "Progress" });
    expect(progress).toHaveTextContent("4Review");
    expect(progress).toHaveTextContent("3Learning"); // 2 + 1
    expect(progress).toHaveTextContent("5New");
    expect(screen.getByRole("img", { name: /4 review, 3 learning, 5 new, of 12 cards/ })).toBeInTheDocument();
  });

  it("summarizes what is ready and offers to add more words", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const hero = await screen.findByRole("region", { name: "Ready to study" });
    expect(hero).toHaveTextContent("11 cards ready to study"); // 4 due + 7 new
    expect(hero).toHaveTextContent("4 due now · 7 new");
    expect(within(hero).getByRole("link", { name: "Start studying" })).toHaveAttribute("href", "/study");
    // "Add more words" lives next to "View deck", not in the hero.
    expect(within(hero).queryByRole("link", { name: "Add more words" })).not.toBeInTheDocument();
    const yourDeck = screen.getByRole("heading", { name: "Your deck" }).parentElement!;
    expect(within(yourDeck).getByRole("link", { name: "View deck" })).toHaveAttribute("href", "/deck");
    expect(within(yourDeck).getByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/packs");
    expect(screen.getByRole("img", { name: /3 learning/ })).toBeInTheDocument();
  });

  it("says you are caught up when nothing is due", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /study?limit=1"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByText("You’re all caught up")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start studying" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/packs");
  });

  describe("with several decks", () => {
    const summary = (n: number) => ({
      summary: { total: n, new: 1, learning: 1, relearning: 0, review: n - 2, dueNow: 2 },
    });
    const dir = (from: string, to: string, extra = {}) => ({
      fromLanguage: from,
      toLanguage: to,
      total: 8,
      new: 2,
      learning: 1,
      review: 5,
      dueNow: 3,
      nextDueAt: null,
      ready: { learning: 1, review: 2, new: 4 },
      ...extra,
    });
    const stats = (directions: unknown[], extra = {}) => ({
      now: "2026-01-15T10:00:00.000Z",
      reviewsToday: 9,
      nextDueAt: null,
      directions,
      ...extra,
    });

    beforeEach(() => {
      localStorage.removeItem("dashboardDirection");
      mock.loggedIn = true;
      mock.handlers["GET /stats"] = () =>
        json(200, stats([dir("en", "nl"), dir("nl", "en", { dueNow: 0 })]));
    });

    it("narrows only the deck section to one direction, leaving what is ready to study alone", async () => {
      mock.handlers["GET /deck?limit=1&fromLanguage=nl&toLanguage=en"] = () =>
        json(200, { summary: { total: 8, new: 1, learning: 1, relearning: 0, review: 6, dueNow: 2 } });
      const user = userEvent.setup();
      renderApp("/");
      const hero = await screen.findByRole("region", { name: "Ready to study" });
      expect(hero).toHaveTextContent("11 cards ready to study");

      await user.click(await screen.findByRole("button", { name: "NL → EN" }));
      expect(await within(screen.getByRole("region", { name: "Progress" })).findByText("6")).toBeInTheDocument();
      expect(hero).toHaveTextContent("11 cards ready to study");
      expect(within(hero).getByRole("link", { name: "Start studying" })).toHaveAttribute("href", "/study");
      expect(mock.calls.filter((c) => c.startsWith("GET /study"))).toEqual(["GET /study?limit=1"]);
      expect(screen.getByRole("button", { name: "NL → EN" })).toHaveAttribute("aria-pressed", "true");
      expect(JSON.parse(localStorage.getItem("dashboardDirection")!)).toEqual({ from: "nl", to: "en" });

      await user.click(screen.getByRole("button", { name: "Both" }));
      expect(await screen.findByRole("button", { name: "Both" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "NL → EN" })).toHaveAttribute("aria-pressed", "false");
      expect(hero).toHaveTextContent("11 cards ready to study");
    });

    it("offers a button per direction with its ready count, next to Start studying", async () => {
      mock.handlers["GET /stats"] = () =>
        json(200, stats([dir("en", "nl", { ready: { learning: 1, review: 2, new: 4 } }), dir("nl", "en", { ready: { learning: 0, review: 1, new: 2 } })]));
      renderApp("/");
      const hero = await screen.findByRole("region", { name: "Ready to study" });
      const en = await within(hero).findByRole("link", { name: "Study EN → NL, 7 ready" });
      expect(en).toHaveAttribute("href", "/study?from=en&to=nl");
      expect(en).toHaveTextContent("7");
      expect(within(hero).getByRole("link", { name: "Study NL → EN, 3 ready" })).toHaveAttribute(
        "href",
        "/study?from=nl&to=en",
      );
      expect(within(hero).getByRole("link", { name: "Start studying" })).toHaveAttribute("href", "/study");
    });

    it("leaves out a direction with nothing ready, and the buttons when it is no real choice", async () => {
      mock.handlers["GET /stats"] = () =>
        json(200, stats([dir("en", "nl"), dir("nl", "en", { ready: { learning: 0, review: 0, new: 0 } })]));
      renderApp("/");
      const hero = await screen.findByRole("region", { name: "Ready to study" });
      await screen.findByRole("button", { name: "NL → EN" }); // stats have loaded
      expect(within(hero).queryByRole("link", { name: /^Study / })).not.toBeInTheDocument();
    });

    it("hides the deck filter when there is only one direction", async () => {
      mock.handlers["GET /stats"] = () => json(200, stats([dir("en", "nl")]));
      renderApp("/");
      await screen.findByRole("heading", { name: "Your deck" });
      expect(screen.queryByRole("group", { name: "Deck view" })).not.toBeInTheDocument();
    });

    it("says when the next card is due if nothing is ready", async () => {
      mock.handlers["GET /study?limit=1"] = () =>
        json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 }, cards: [] });
      mock.handlers["GET /stats"] = () =>
        json(200, stats([dir("en", "nl")], { nextDueAt: "2026-01-15T13:00:00.000Z" }));
      renderApp("/");
      expect(await screen.findByText("Next card in 3 hours.")).toBeInTheDocument();
    });

    it("still works when the extra stats cannot be loaded", async () => {
      mock.handlers["GET /stats"] = () => json(500, { error: "boom" });
      renderApp("/");
      expect(await screen.findByRole("link", { name: "Start studying" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Deck view" })).not.toBeInTheDocument();
    });
  });

  it("links to the page explaining how scheduling works", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "FSRS" }));
    expect(await screen.findByRole("heading", { name: "How scheduling works" })).toBeInTheDocument();
    expect(screen.getByText("Again")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Dashboard/ })[0]).toHaveAttribute("href", "/");
  });

  it("shows an empty state for a new user", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, {
        summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 },
      });
    mock.handlers["GET /study?limit=1"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByText(/Your deck is empty/)).toBeInTheDocument();
  });

  it("shows an error when the data cannot be loaded", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () => json(500, { error: "boom" });
    renderApp("/");
    expect(await screen.findByText(/Could not load your dashboard/)).toBeInTheDocument();
  });
});
