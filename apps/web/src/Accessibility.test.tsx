import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { a11yViolations } from "./test/axe";
import { installMockApi, json, mock, renderApp, USER, sentence } from "./test/harness";

const EN_NL = "fromLanguage=en&toLanguage=nl";

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: "noun",
  details,
});

const dog = {
  id: "card-dog",
  conceptId: "c1",
  fromLanguage: "en",
  toLanguage: "nl",
  state: "new",
  dueAt: "2026-01-01T00:00:00.000Z",
  addedAt: "2025-12-31T00:00:00.000Z",
  front: [entry("en", "dog", { plural: "dogs" })],
  back: [entry("nl", "hond", { article: "de", plural: "honden" })],
  sentences: { front: ["The dog barks."], back: ["De hond blaft."] },
};
const fish = {
  ...dog,
  id: "card-fish",
  conceptId: "c2",
  front: [entry("en", "fish", { uncountable: true })],
  back: [entry("nl", "vis", { article: "de", plural: "vissen" })],
  sentences: { front: [], back: [] },
};

const packs = [
  {
    id: "p1",
    slug: "sample",
    name: "Sample pack",
    description: "Demo data",
    category: "topic",
    conceptCount: 2,
    availableCount: 2,
    addedCount: 1,
  },
];

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  mock.handlers["GET /study?limit=100"] = () =>
    json(200, { now: "x", counts: { learning: 0, review: 0, new: 2 }, cards: [dog, fish] });
  mock.handlers["GET /deck"] = () =>
    json(200, {
      summary: { total: 2, new: 2, learning: 0, relearning: 0, review: 0, dueNow: 2 },
      hasMore: false,
      cards: [dog, fish],
    });
  mock.handlers["GET /reports"] = () =>
    json(200, {
      reports: [
        {
          id: "r1",
          kind: "card",
          title: "",
          conceptId: "c1",
          front: dog.front,
          back: dog.back,
          fromLanguage: "en",
          toLanguage: "nl",
          reason: "translation",
          note: "It should say hond.",
          status: "resolved",
          comments: [
            { id: "m1", body: "Thanks for looking.", fromAdmin: false, createdAt: "2026-10-02T10:00:00.000Z" },
            { id: "m2", body: "Fixed, thanks!", fromAdmin: true, createdAt: "2026-10-03T09:00:00.000Z" },
          ],
          createdAt: "2026-10-01T10:00:00.000Z",
          resolvedAt: "2026-10-03T10:00:00.000Z",
        },
      ],
    });
  mock.handlers["GET /deck/card-dog"] = () => json(200, { card: dog, sentences: dog.sentences });
  mock.handlers[`GET /packs?${EN_NL}`] = () => json(200, { packs });
  mock.handlers[`GET /packs/p1?${EN_NL}&limit=1000`] = () =>
    json(200, {
      pack: { id: "p1", slug: "sample", name: "Sample pack", description: "Demo data" },
      concepts: [
        { conceptId: "c1", position: 0, available: true, inDeck: true, entries: [dog.front[0], dog.back[0]] },
        { conceptId: "c2", position: 1, available: true, inDeck: false, entries: [fish.front[0], fish.back[0]] },
      ],
    });
});
afterEach(() => vi.unstubAllGlobals());

describe("automated accessibility checks (axe)", () => {
  it.each([
    ["the dashboard", "/", "Dashboard"],
    ["my deck", "/deck", "My deck"],
    ["the add words page", "/add-words", "Add words"],
    ["a pack's page", "/add-words/p1", "Sample pack"],
    ["how scheduling works", "/how-it-works", "How scheduling works"],
    ["your reports", "/reports", "Your reports"],
  ])("finds nothing on %s", async (_name, route, heading) => {
    renderApp(route);
    await screen.findByRole("heading", { name: heading });
    expect(await a11yViolations()).toEqual([]);
  });

  it.each(["profile", "study", "appearance", "security", "data"])("finds nothing on the %s settings tab", async (tab) => {
    renderApp(`/settings?tab=${tab}`);
    await screen.findByRole("tabpanel");
    expect(await a11yViolations()).toEqual([]);
  });

  it("finds nothing on a study card, before or after the answer", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    expect(await a11yViolations()).toEqual([]);
    await screen.findByRole("button", { name: "Good" });
    expect(await a11yViolations()).toEqual([]);
  });

  it("finds nothing on an open card", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.click(await screen.findByRole("button", { name: "Open card: dog" }));
    await screen.findByText(sentence("De hond blaft."));
    expect(await a11yViolations()).toEqual([]);
  });

  it.each([
    ["the login page", "/login", "Log in"],
    ["the sign-up page", "/register", "Create your account"],
    ["the forgot password page", "/forgot-password", "Reset your password"],
    ["the choose a new password page", `/reset-password?token=${"a".repeat(43)}`, "Choose a new password"],
    ["the page for a link that does not work", "/reset-password", "This link does not work"],
  ])("finds nothing on %s", async (_name, route, heading) => {
    mock.loggedIn = false;
    renderApp(route);
    await screen.findByRole("heading", { name: heading });
    expect(await a11yViolations()).toEqual([]);
  });

  it("finds nothing under the reminder to confirm the email address", async () => {
    mock.handlers["GET /auth/me"] = () => json(200, { user: { ...USER, emailVerified: false } });
    renderApp("/");
    await screen.findByRole("region", { name: "Confirm your email" });
    expect(await a11yViolations()).toEqual([]);
  });

  it("finds nothing on the page not found page", async () => {
    renderApp("/nowhere");
    await screen.findByRole("heading", { name: "Page not found" });
    expect(await a11yViolations()).toEqual([]);
  });
});

describe("page titles", () => {
  it.each([
    ["/", "Dashboard"],
    ["/study", "Study"],
    ["/deck", "My deck"],
    ["/add-words", "Add words"],
    ["/settings", "Settings"],
    ["/how-it-works", "How scheduling works"],
    ["/nowhere", "Page not found"],
  ])("%s is titled %s", async (route, title) => {
    renderApp(route);
    await screen.findByRole("heading", { level: 1 });
    expect(document.title).toBe(`${title} · Flashcards`);
  });

  it("uses the pack's own name on its page", async () => {
    renderApp("/add-words/p1");
    await screen.findByRole("heading", { name: "Sample pack" });
    expect(document.title).toBe("Sample pack · Flashcards");
  });

  it("titles the login and sign-up pages", async () => {
    mock.loggedIn = false;
    renderApp("/login");
    await screen.findByRole("heading", { name: "Log in" });
    expect(document.title).toBe("Log in · Flashcards");
  });

  it.each([
    ["/forgot-password", "Reset your password"],
    ["/reset-password?token=" + "a".repeat(43), "Choose a new password"],
    ["/verify-email", "Confirm your email"],
  ])("titles the email link page %s", async (route, title) => {
    mock.loggedIn = false;
    renderApp(route);
    await screen.findByRole("heading", { level: 1 });
    expect(document.title).toBe(`${title} · Flashcards`);
  });
});

describe("moving around with the keyboard", () => {
  it("starts with a link that skips to the content, and it moves focus there", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveFocus();

    await user.keyboard("{Enter}");
    const main = screen.getByRole("main");
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute("id", "main");
  });

  it("moves focus to the content after going to another page", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });
    // Not moved on the first load: the page is simply where you are.
    expect(screen.getByRole("main")).not.toHaveFocus();

    await user.click(screen.getByRole("link", { name: "My deck" }));
    await screen.findByRole("heading", { name: "My deck" });
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("leaves focus on the study card's button when the page put it there", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });
    await user.click(screen.getByRole("link", { name: "Study" }));
    const show = await screen.findByRole("button", { name: "Show answer" });
    expect(show).toHaveFocus();
  });
});

describe("words marked with their language", () => {
  it("marks the words, forms, and sentences of a card with their language", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));

    const answer = screen.getByRole("region", { name: "Answer" });
    const word = within(answer).getByText("de hond");
    expect(word).toHaveAttribute("lang", "nl");
    expect(word).toHaveAttribute("dir", "auto");
    expect(within(answer).getByText(sentence("De hond blaft."))).toHaveAttribute("lang", "nl");
    expect(within(answer).getByText("honden")).toHaveAttribute("lang", "nl");

    const front = screen.getByText("dog");
    expect(front).toHaveAttribute("lang", "en");
    expect(screen.getByText(sentence("The dog barks."))).toHaveAttribute("lang", "en");
  });

  it("does not mark the app's own notes about a word as being in its language", async () => {
    mock.handlers["GET /study?limit=100"] = () =>
      json(200, {
        now: "x",
        counts: { learning: 0, review: 0, new: 1 },
        cards: [{ ...dog, front: dog.back, back: [entry("en", "fish", { uncountable: true })] }],
      });
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    expect(screen.getByText("uncountable")).not.toHaveAttribute("lang");
  });

  it("marks both sides of a word in the lists", async () => {
    renderApp("/deck");
    const row = (await screen.findByRole("button", { name: "Open card: dog" })).closest("li") as HTMLElement;
    expect(within(row).getByText("dog")).toHaveAttribute("lang", "en");
    expect(within(row).getByText("de hond")).toHaveAttribute("lang", "nl");
  });
});

describe("checkboxes on the settings page", () => {
  it("can be turned on and off with the space bar from the keyboard", async () => {
    mock.handlers["PATCH /settings"] = () => json(200, {});
    const user = userEvent.setup();
    renderApp("/settings?tab=appearance");
    const box = await screen.findByRole("checkbox", { name: "Rate a card with the number keys 1 to 4" });
    box.focus();
    expect(box).toBeChecked();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
    await user.keyboard(" ");
    expect(box).toBeChecked();
  });
});

describe("reading the answer", () => {
  it("describes the Good button with the answer, since focus lands on it", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    const good = screen.getByRole("button", { name: "Good" });
    expect(good).toHaveFocus();
    expect(good).toHaveAttribute("aria-describedby", "answer-word");
    expect(good.getAttribute("aria-describedby")).toBe(screen.getByText("de hond").closest("p")!.id);
  });
});

describe("the number key shortcuts", () => {
  const reviewsSent = () => mock.calls.filter((c) => c === "POST /reviews");

  beforeEach(() => {
    mock.handlers["POST /reviews"] = () =>
      json(200, {
        userCardId: "card-dog",
        state: "learning",
        intervalDays: 0,
        reviewedAt: "2026-01-01T12:00:00.000Z",
        dueAt: "2026-01-01T12:10:00.000Z",
        replayed: false,
      });
  });

  it("rate the card by default", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    // The key hints are shown on the buttons (and hidden from screen readers, which get the names).
    expect(within(screen.getByRole("button", { name: "Again" })).getByText("1")).toBeInTheDocument();
    await user.keyboard("3");
    await screen.findByRole("button", { name: "Show answer" }); // the next card
    expect(reviewsSent()).toHaveLength(1);
  });

  it("can be turned off in the settings, which also removes the key hints", async () => {
    const user = userEvent.setup();
    renderApp("/settings?tab=appearance");
    const box = await screen.findByRole("checkbox", { name: "Rate a card with the number keys 1 to 4" });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(localStorage.getItem("ratingShortcuts")).toBe("off");

    // A fresh visit to the study page keeps them off.
    await user.click(screen.getByRole("link", { name: "Study" }));
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    const again = screen.getByRole("button", { name: "Again" });
    expect(within(again).queryByText("1")).not.toBeInTheDocument();
    await user.keyboard("3");
    expect(reviewsSent()).toHaveLength(0);
  });

  it("can be turned back on", async () => {
    localStorage.setItem("ratingShortcuts", "off");
    const user = userEvent.setup();
    renderApp("/settings?tab=appearance");
    const box = await screen.findByRole("checkbox", { name: "Rate a card with the number keys 1 to 4" });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    expect(localStorage.getItem("ratingShortcuts")).toBeNull();
  });
});
