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
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByText("No cards to study right now")).toBeInTheDocument();
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
      expect(mock.calls.filter((c) => c.startsWith("GET /study"))).toEqual(["GET /study/counts"]);
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

    describe("when a session is on its way", () => {
      const nothingReady = () =>
        (mock.handlers["GET /study/counts"] = () => json(200, countsWith(7 * 60_000)));
      // The server says the next session opens in `ms`, with 4 cards ready then.
      const countsWith = (ms: number) => ({
        now: "2026-01-15T10:00:00.000Z",
        counts: { learning: 0, review: 0, new: 0 },
        nextSession: { at: new Date(Date.parse("2026-01-15T10:00:00.000Z") + ms).toISOString(), count: 4 },
        tomorrow: 0,
      });

      it("counts down to when the cards will be ready, and says how many", async () => {
        nothingReady();
        renderApp("/");
        const hero = await screen.findByRole("region", { name: "Ready to study" });
        expect(await within(hero).findByText("No cards to study right now")).toBeInTheDocument();
        await waitFor(() => expect(hero).toHaveTextContent(/4 cards will be ready in (7:00|6:59)\./));
        // More than five minutes to go: no way to start early.
        expect(within(hero).queryByRole("link", { name: "Start next session now" })).not.toBeInTheDocument();
      });

      it("offers to start the next session now in the last five minutes", async () => {
        mock.handlers["GET /study/counts"] = () => json(200, countsWith(4 * 60_000 + 30_000));
        renderApp("/");
        const hero = await screen.findByRole("region", { name: "Ready to study" });
        await waitFor(() => expect(hero).toHaveTextContent(/4 cards will be ready in 4:(30|29)\./));
        expect(within(hero).getByRole("link", { name: "Start next session now" })).toHaveAttribute(
          "href",
          "/study?early=1",
        );
      });

      it("shows exactly five minutes as early enough, and ten as not", async () => {
        mock.handlers["GET /study/counts"] = () => json(200, countsWith(5 * 60_000));
        const view = renderApp("/");
        expect(await screen.findByRole("link", { name: "Start next session now" })).toBeInTheDocument();
        view.unmount();

        mock.handlers["GET /study/counts"] = () => json(200, countsWith(10 * 60_000));
        renderApp("/");
        const hero = await screen.findByRole("region", { name: "Ready to study" });
        await waitFor(() => expect(hero).toHaveTextContent(/will be ready in (10:00|9:59)/));
        expect(screen.queryByRole("link", { name: "Start next session now" })).not.toBeInTheDocument();
      });

      it("uses the singular for a single card", async () => {
        mock.handlers["GET /study/counts"] = () => {
          const c = countsWith(7 * 60_000);
          return json(200, { ...c, nextSession: { ...c.nextSession, count: 1 } });
        };
        renderApp("/");
        const hero = await screen.findByRole("region", { name: "Ready to study" });
        await waitFor(() => expect(hero).toHaveTextContent(/1 card will be ready in (7:00|6:59)\./));
      });

      it("looks again for the cards when the countdown reaches zero", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          let calls = 0;
          mock.handlers["GET /study/counts"] = () => {
            calls++;
            return calls === 1
              ? json(200, countsWith(2_000))
              : json(200, { now: "x", counts: { learning: 4, review: 0, new: 0 }, nextSession: null });
          };
          renderApp("/");
          const hero = await screen.findByRole("region", { name: "Ready to study" });
          await waitFor(() => expect(hero).toHaveTextContent(/will be ready in 0:0\d/));
          await vi.advanceTimersByTimeAsync(3_000);
          expect(await screen.findByText("4 cards ready to study")).toBeInTheDocument();
          expect(calls).toBeGreaterThanOrEqual(2);
        } finally {
          vi.useRealTimers();
        }
      });

      describe("with no countdown", () => {
        const idle = (tomorrow: number, nextDueAt: string | null = null) => {
          mock.handlers["GET /study/counts"] = () =>
            json(200, {
              now: "2026-01-15T10:00:00.000Z",
              counts: { learning: 0, review: 0, new: 0 },
              nextSession: null,
              tomorrow,
            });
          mock.handlers["GET /stats"] = () => json(200, stats([dir("en", "nl")], { nextDueAt }));
        };

        it("says how many cards will be ready tomorrow", async () => {
          idle(28);
          renderApp("/");
          expect(await screen.findByText("28 cards will be ready tomorrow.")).toBeInTheDocument();
          expect(screen.getByText("No cards to study right now")).toBeInTheDocument();
          expect(screen.queryByText("Come back later or add more words.")).not.toBeInTheDocument();
        });

        it("uses the singular, and shows it alongside when the next card is due", async () => {
          idle(1, "2026-01-15T13:00:00.000Z");
          renderApp("/");
          expect(await screen.findByText("1 card will be ready tomorrow.")).toBeInTheDocument();
          expect(screen.getByText("Next card in 3 hours.")).toBeInTheDocument();
        });

        it("says nothing about tomorrow when nothing will be ready", async () => {
          idle(0);
          renderApp("/");
          expect(await screen.findByText("Come back later or add more words.")).toBeInTheDocument();
          expect(screen.queryByText(/ready tomorrow/)).not.toBeInTheDocument();
        });

        it("also shows it while a countdown is running", async () => {
          mock.handlers["GET /study/counts"] = () =>
            json(200, {
              now: "2026-01-15T10:00:00.000Z",
              counts: { learning: 0, review: 0, new: 0 },
              nextSession: { at: "2026-01-15T10:07:00.000Z", count: 4 },
              tomorrow: 28,
            });
          renderApp("/");
          const hero = await screen.findByRole("region", { name: "Ready to study" });
          await waitFor(() => expect(hero).toHaveTextContent(/4 cards will be ready in/));
          expect(hero).toHaveTextContent("28 cards will be ready tomorrow.");
        });
      });

      it("falls back to when the next card is due when no session is held back", async () => {
        mock.handlers["GET /study/counts"] = () =>
          json(200, { now: "2026-01-15T10:00:00.000Z", counts: { learning: 0, review: 0, new: 0 }, nextSession: null });
        mock.handlers["GET /stats"] = () =>
          json(200, stats([dir("en", "nl")], { nextDueAt: "2026-01-15T13:00:00.000Z" }));
        renderApp("/");
        expect(await screen.findByText("Next card in 3 hours.")).toBeInTheDocument();
      });
    });

    it("says when the next card is due if nothing is ready", async () => {
      mock.handlers["GET /study/counts"] = () =>
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
    mock.handlers["GET /study/counts"] = () =>
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
